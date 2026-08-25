import { useEffect, useState, useCallback, useRef } from "react";
import { whatsappApi, WAConversation, WAMessage } from "@/lib/whatsapp-api";
import { getSocket, joinInstance } from "@/lib/whatsapp-socket";
import { mensagemDeErro } from "@/lib/erros";

// Tamanho da página da caixa de entrada. A listagem agora é paginada NO BANCO
// (antes o backend materializava a coleção inteira em memória a cada abertura
// da tela, de cada usuário).
const PAGINA_CONVERSAS = 300;

export function useWhatsAppConversations(busca?: string) {
  const [conversations, setConversations] = useState<WAConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [temMais, setTemMais] = useState(false);
  const [carregandoMais, setCarregandoMais] = useState(false);
  const joined = useRef<Set<string>>(new Set());

  const termo = (busca || "").trim();

  const entrarNasSalas = useCallback((lista: WAConversation[]) => {
    lista.forEach(c => {
      if (!joined.current.has(c.instanceId)) {
        joinInstance(c.instanceId);
        joined.current.add(c.instanceId);
      }
    });
  }, []);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const data = await whatsappApi.listConversations({
        limit: PAGINA_CONVERSAS,
        busca: termo || undefined,
      });
      setConversations(data);
      setTemMais(data.length >= PAGINA_CONVERSAS);
      entrarNasSalas(data);
    } catch (err) {
      setError(mensagemDeErro(err));
    } finally {
      setLoading(false);
    }
  }, [termo, entrarNasSalas]);

  /** Próxima página da caixa de entrada (botão "carregar mais"). */
  const carregarMais = useCallback(async () => {
    if (carregandoMais || !temMais) return;
    setCarregandoMais(true);
    try {
      const proxima = await whatsappApi.listConversations({
        limit: PAGINA_CONVERSAS,
        offset: conversations.length,
        busca: termo || undefined,
      });
      if (!proxima.length) {
        setTemMais(false);
        return;
      }
      setConversations(atual => {
        const conhecidas = new Set(atual.map(c => c.id));
        return [...atual, ...proxima.filter(c => !conhecidas.has(c.id))];
      });
      setTemMais(proxima.length >= PAGINA_CONVERSAS);
      entrarNasSalas(proxima);
    } catch (err) {
      console.warn("carregarMais failed:", err);
    } finally {
      setCarregandoMais(false);
    }
  }, [conversations.length, termo, temMais, carregandoMais, entrarNasSalas]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const socket = getSocket();
    const onNewMessage = (payload: { conversation: WAConversation; message: WAMessage }) => {
      setConversations(curr => {
        const idx = curr.findIndex(c => c.id === payload.conversation.id);
        if (idx === -1) return [payload.conversation, ...curr];
        const next = curr.slice();
        // Mescla em vez de substituir: um payload sem avatarUrl apagava a foto
        // do contato da lista até o próximo refresh.
        next[idx] = { ...next[idx], ...payload.conversation };
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

  return { conversations, loading, error, refresh, markRead, carregarMais, carregandoMais, temMais };
}

// Quantas mensagens vêm por página. O backend limita a 200; 60 é o suficiente
// para encher a tela e deixa o carregamento inicial leve.
const PAGINA_MENSAGENS = 60;

export function useWhatsAppMessages(conversationId: string | null | undefined) {
  const [messages, setMessages] = useState<WAMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [carregandoAntigas, setCarregandoAntigas] = useState(false);
  const [temMaisAntigas, setTemMaisAntigas] = useState(false);

  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      setTemMaisAntigas(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setTemMaisAntigas(false);
    whatsappApi.getMessages(conversationId, { limit: PAGINA_MENSAGENS })
      .then(data => {
        if (cancelled) return;
        setMessages(data);
        // Página cheia provavelmente significa que há mais para trás.
        setTemMaisAntigas(data.length >= PAGINA_MENSAGENS);
      })
      .catch(err => console.warn("getMessages failed:", err))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [conversationId]);

  /**
   * Carrega a página anterior do histórico.
   *
   * Antes o hook buscava 100 mensagens e ponto: conversa mais longa que isso
   * tinha o começo INALCANÇÁVEL pela interface, mesmo com a API já aceitando
   * `before` desde sempre. Para um atendimento de clínica, perder o histórico
   * é perder o contexto do paciente.
   */
  const carregarAntigas = useCallback(async () => {
    if (!conversationId || carregandoAntigas || !temMaisAntigas) return;
    const maisAntiga = messages[0];
    if (!maisAntiga) return;

    setCarregandoAntigas(true);
    try {
      const anteriores = await whatsappApi.getMessages(conversationId, {
        before: maisAntiga.timestamp,
        limit: PAGINA_MENSAGENS,
      });
      if (!anteriores.length) {
        setTemMaisAntigas(false);
        return;
      }
      setMessages(atual => {
        // Dedupe por id: `before` usa timestamp, e duas mensagens no mesmo
        // segundo fariam a página repetir uma delas.
        const conhecidas = new Set(atual.map(m => m.id));
        const novas = anteriores.filter(m => !conhecidas.has(m.id));
        return novas.length ? [...novas, ...atual] : atual;
      });
      setTemMaisAntigas(anteriores.length >= PAGINA_MENSAGENS);
    } catch (err) {
      console.warn("carregarAntigas failed:", err);
    } finally {
      setCarregandoAntigas(false);
    }
  }, [conversationId, messages, carregandoAntigas, temMaisAntigas]);

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
    // Edição ("editada") ou exclusão ("apagar para todos") vinda do WhatsApp.
    const onMessageUpdate = (payload: { messageId: string; chatId: string; deleted?: boolean; edited?: boolean; body?: string }) => {
      setMessages(curr => curr.map(m => {
        if (m.id !== payload.messageId) return m;
        if (payload.deleted) return { ...m, deleted: true };
        if (payload.edited) return { ...m, edited: true, body: payload.body ?? m.body };
        return m;
      }));
    };
    // Mídia baixada em segundo plano após o message:new — preenche sem refetch.
    const onMedia = (payload: { messageId: string; chatId: string; mediaUrl: string; mediaMime?: string }) => {
      setMessages(curr => curr.map(m => m.id === payload.messageId
        ? { ...m, mediaUrl: payload.mediaUrl, mediaMime: payload.mediaMime }
        : m));
    };
    socket.on("message:new", onNewMessage);
    socket.on("message:ack", onAck);
    socket.on("message:update", onMessageUpdate);
    socket.on("message:media", onMedia);
    return () => {
      socket.off("message:new", onNewMessage);
      socket.off("message:ack", onAck);
      socket.off("message:update", onMessageUpdate);
      socket.off("message:media", onMedia);
    };
  }, [conversationId]);

  return { messages, loading, setMessages, carregarAntigas, carregandoAntigas, temMaisAntigas };
}
