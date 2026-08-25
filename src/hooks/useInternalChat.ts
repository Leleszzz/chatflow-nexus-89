import { useCallback, useEffect, useState } from "react";
import { whatsappApi, InternalMessage, InternalThread } from "@/lib/whatsapp-api";
import { getSocket } from "@/lib/whatsapp-socket";
import { mensagemDeErro } from "@/lib/erros";

// O backend entrega os eventos na sala pessoal `user:<id>`, na qual o socket já
// entra sozinho no connect — não é preciso dar join em nada aqui.

/** Ordena por atividade mais recente; thread sem mensagem cai para o fim. */
const byRecency = (a: InternalThread, b: InternalThread) =>
  (b.lastMessageAt || b.createdAt || "").localeCompare(a.lastMessageAt || a.createdAt || "");

export function useInternalThreads(currentUserId: string | undefined) {
  const [threads, setThreads] = useState<InternalThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!currentUserId) return;
    try {
      setError(null);
      setThreads((await whatsappApi.listInternalThreads()).sort(byRecency));
    } catch (err) {
      setError(mensagemDeErro(err));
    } finally {
      setLoading(false);
    }
  }, [currentUserId]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!currentUserId) return;
    const socket = getSocket();

    const onMessage = (payload: { message: InternalMessage; thread: InternalThread }) => {
      setThreads(curr => {
        const idx = curr.findIndex(t => t.id === payload.thread.id);
        // Não-lida só conta quando não fui eu que mandei. A thread aberta é
        // zerada pelo markRead do componente da conversa.
        const bump = payload.message.senderId === currentUserId ? 0 : 1;
        if (idx === -1) return [{ ...payload.thread, unreadCount: bump }, ...curr];
        const next = curr.slice();
        next[idx] = {
          ...payload.thread,
          unreadCount: (curr[idx].unreadCount || 0) + bump,
        };
        return next.sort(byRecency);
      });
    };

    const onThread = (payload: { thread: InternalThread | null; threadId?: string; removed?: boolean }) => {
      // Grupo dissolvido, ou eu fui removido dele.
      const goneId = payload.removed ? payload.threadId : undefined;
      const lostAccess = payload.thread && !payload.thread.memberIds.includes(currentUserId)
        ? payload.thread.id
        : undefined;
      const drop = goneId || lostAccess;
      if (drop) {
        setThreads(curr => curr.filter(t => t.id !== drop));
        return;
      }
      if (!payload.thread) return;
      setThreads(curr => {
        const idx = curr.findIndex(t => t.id === payload.thread!.id);
        if (idx === -1) return [{ ...payload.thread!, unreadCount: 0 }, ...curr].sort(byRecency);
        const next = curr.slice();
        // Preserva o contador local: o payload da thread não carrega unreadCount.
        next[idx] = { ...payload.thread!, unreadCount: curr[idx].unreadCount };
        return next.sort(byRecency);
      });
    };

    // Emitido só para o próprio leitor — sincroniza o badge entre abas.
    const onRead = (payload: { threadId: string }) => {
      setThreads(curr => curr.map(t => (t.id === payload.threadId ? { ...t, unreadCount: 0 } : t)));
    };

    socket.on("internal:message", onMessage);
    socket.on("internal:thread", onThread);
    socket.on("internal:read", onRead);
    return () => {
      socket.off("internal:message", onMessage);
      socket.off("internal:thread", onThread);
      socket.off("internal:read", onRead);
    };
  }, [currentUserId]);

  const markRead = useCallback(async (threadId: string) => {
    setThreads(curr => curr.map(t => (t.id === threadId ? { ...t, unreadCount: 0 } : t)));
    try {
      await whatsappApi.markInternalThreadRead(threadId);
    } catch (err) {
      console.warn("markInternalThreadRead falhou:", err);
    }
  }, []);

  const totalUnread = threads.reduce((sum, t) => sum + (t.unreadCount || 0), 0);

  return { threads, loading, error, refresh, markRead, totalUnread, setThreads };
}

export function useInternalMessages(threadId: string | null | undefined, currentUserId: string | undefined) {
  const [messages, setMessages] = useState<InternalMessage[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!threadId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    whatsappApi.listInternalMessages(threadId, { limit: 100 })
      .then(data => { if (!cancelled) setMessages(data); })
      .catch(err => console.warn("listInternalMessages falhou:", err))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [threadId]);

  useEffect(() => {
    if (!threadId) return;
    const socket = getSocket();
    const onMessage = (payload: { message: InternalMessage }) => {
      if (payload.message.threadId !== threadId) return;
      setMessages(curr => (
        // O remetente já inseriu a mensagem otimisticamente; o evento chega
        // logo depois e não pode duplicar.
        curr.some(m => m.id === payload.message.id) ? curr : [...curr, payload.message]
      ));
    };
    socket.on("internal:message", onMessage);
    return () => { socket.off("internal:message", onMessage); };
  }, [threadId, currentUserId]);

  return { messages, loading, setMessages };
}

/** Badge global de não-lidas para a navegação, independente da página aberta. */
export function useInternalUnreadBadge(currentUserId: string | undefined) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!currentUserId) {
      setCount(0);
      return;
    }
    let cancelled = false;
    const load = () => whatsappApi.internalUnreadCount()
      .then(res => { if (!cancelled) setCount(res.count); })
      .catch(() => { /* silencioso: badge não é crítico */ });
    load();

    const socket = getSocket();
    const onMessage = (payload: { message: InternalMessage }) => {
      if (payload.message.senderId === currentUserId) return;
      setCount(curr => curr + 1);
    };
    socket.on("internal:message", onMessage);
    socket.on("internal:read", load);
    return () => {
      cancelled = true;
      socket.off("internal:message", onMessage);
      socket.off("internal:read", load);
    };
  }, [currentUserId]);

  return count;
}
