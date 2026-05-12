import { useEffect, useState, useCallback, useRef } from "react";
import { whatsappApi, WAConversation, WAMessage } from "@/lib/whatsapp-api";
import { getSocket, joinInstance } from "@/lib/whatsapp-socket";

export function useWhatsAppConversations() {
  const [conversations, setConversations] = useState<WAConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const joined = useRef<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const data = await whatsappApi.listConversations();
      setConversations(data);
      data.forEach(c => {
        if (!joined.current.has(c.instanceId)) {
          joinInstance(c.instanceId);
          joined.current.add(c.instanceId);
        }
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const socket = getSocket();
    const onNewMessage = (payload: { conversation: WAConversation; message: WAMessage }) => {
      setConversations(curr => {
        const idx = curr.findIndex(c => c.id === payload.conversation.id);
        if (idx === -1) return [payload.conversation, ...curr];
        const next = curr.slice();
        next[idx] = payload.conversation;
        return next;
      });
    };
    const onUpdate = (payload: { conversation: WAConversation }) => {
      setConversations(curr => {
        const idx = curr.findIndex(c => c.id === payload.conversation.id);
        if (idx === -1) return [payload.conversation, ...curr];
        const next = curr.slice();
        next[idx] = { ...next[idx], ...payload.conversation };
        return next;
      });
    };
    const onDelete = (payload: { conversationId: string }) => {
      setConversations(curr => curr.filter(c => c.id !== payload.conversationId));
    };
    const onWipe = (payload: { instanceId: string }) => {
      setConversations(curr => curr.filter(c => c.instanceId !== payload.instanceId));
    };
    socket.on("message:new", onNewMessage);
    socket.on("conversation:update", onUpdate);
    socket.on("conversation:delete", onDelete);
    socket.on("conversation:wipe", onWipe);
    return () => {
      socket.off("message:new", onNewMessage);
      socket.off("conversation:update", onUpdate);
      socket.off("conversation:delete", onDelete);
      socket.off("conversation:wipe", onWipe);
    };
  }, []);

  const markRead = useCallback(async (conversationId: string) => {
    try {
      const updated = await whatsappApi.markRead(conversationId);
      setConversations(curr => curr.map(c => c.id === conversationId ? updated : c));
    } catch (err) {
      console.warn("markRead failed:", err);
    }
  }, []);

  return { conversations, loading, error, refresh, markRead };
}

export function useWhatsAppMessages(conversationId: string | null | undefined) {
  const [messages, setMessages] = useState<WAMessage[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    whatsappApi.getMessages(conversationId, { limit: 100 })
      .then(data => { if (!cancelled) setMessages(data); })
      .catch(err => console.warn("getMessages failed:", err))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId) return;
    const socket = getSocket();
    const onNewMessage = (payload: { conversation: WAConversation; message: WAMessage }) => {
      if (payload.conversation.id !== conversationId) return;
      setMessages(curr => {
        if (curr.some(m => m.id === payload.message.id)) return curr;
        const next = [...curr, payload.message];
        next.sort((a, b) => a.timestamp - b.timestamp);
        return next;
      });
    };
    const onAck = (payload: { messageId: string; chatId: string; ack: WAMessage["ack"] }) => {
      setMessages(curr => curr.map(m => m.id === payload.messageId ? { ...m, ack: payload.ack } : m));
    };
    socket.on("message:new", onNewMessage);
    socket.on("message:ack", onAck);
    return () => {
      socket.off("message:new", onNewMessage);
      socket.off("message:ack", onAck);
    };
  }, [conversationId]);

  return { messages, loading, setMessages };
}
