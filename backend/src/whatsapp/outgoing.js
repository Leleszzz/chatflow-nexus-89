import { appendMessage, nextOutgoingTimestamp } from "../storage/messages-repo.js";
import { upsertConversation, getConversation } from "../storage/conversations-repo.js";
import { mapChatFromBaileys, ackForSentResult, buildConversationId, previewFor, isPlaceholderName } from "./message-mapper.js";
import { emitToInstance } from "../socket/events.js";

// Finaliza uma mensagem enviada: calcula timestamp/ack, persiste, enriquece a
// conversa com os dados anteriores e emite o evento "message:new".
// `message` traz os campos específicos do emissor (type/body e, opcionalmente, mediaUrl/mediaMime).
export async function finalizeOutgoingMessage({ io, client, instanceId, chatId, result, message, logLabel = "send" }) {
  const messageId = result?.key?.id || null;
  // Persiste sob o JID canônico (PN) para casar com as mensagens recebidas, que
  // são canonicalizadas no pipeline — evita dividir a conversa em @lid e PN.
  const canonicalChatId = client?.canonicalJid?.(chatId) || chatId;
  const baileysTs = Number(result?.messageTimestamp);
  const timestamp = await nextOutgoingTimestamp(instanceId, canonicalChatId, baileysTs);
  const initialAck = ackForSentResult(result?.status);

  if (messageId) {
    const stored = {
      id: messageId,
      chatId: canonicalChatId,
      instanceId,
      fromMe: true,
      author: "",
      timestamp,
      ack: initialAck,
      ...message,
    };
    await appendMessage(instanceId, canonicalChatId, stored);

    try {
      const chatEntry = client.getChatById ? client.getChatById(canonicalChatId) : null;
      const knownName = client?.knownNameFor?.(canonicalChatId) || "";
      const conv = mapChatFromBaileys({
        jid: canonicalChatId,
        chatEntry,
        contact: knownName ? { notify: knownName } : null,
        instanceId,
        lastMessage: stored,
      });
      const prior = await getConversation(buildConversationId(instanceId, canonicalChatId));
      const merged = {
        ...conv,
        customer: !isPlaceholderName(prior?.customer) ? prior.customer : conv.customer,
        whatsappName: !isPlaceholderName(prior?.whatsappName) ? prior.whatsappName : conv.whatsappName,
        phone: prior?.phone || conv.phone,
        avatarUrl: prior?.avatarUrl,
        lastMessage: previewFor(stored),
        lastMessageId: stored.id,
        lastMessageFromMe: true,
        lastMessageAck: initialAck,
        lastInteraction: new Date(stored.timestamp * 1000).toISOString(),
        unreadCount: 0,
        unread: false,
      };
      const persisted = await upsertConversation(merged);
      emitToInstance(io, instanceId, "message:new", { conversation: persisted, message: stored });
    } catch (err) {
      console.warn(`[${logLabel}] could not enrich conversation: ${err.message}`);
    }
  }

  return { messageId, timestamp };
}
