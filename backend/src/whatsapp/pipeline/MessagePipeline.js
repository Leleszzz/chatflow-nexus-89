import {
  mapMessage,
  mapChatFromBaileys,
  buildConversationId,
  previewFor,
  isPlaceholderName,
  isDisplayableMessage,
  isMediaMessage,
  jidIsUnsupported,
  bestName,
} from "../message-mapper.js";
import {
  appendMessage,
  bulkSaveMessages,
  updateMessageAck,
} from "../../storage/messages-repo.js";
import { upsertConversation, getConversation, getConversationsByIds, countConversations } from "../../storage/conversations-repo.js";
import { cancelDueToClientReply } from "../../storage/scheduled-messages-repo.js";
import { emitToInstance } from "../../socket/events.js";

// Idade máxima (em ms) para baixar mídia do HISTÓRICO. Mídia mais antiga que isso
// raramente é descriptografável e não é urgente — evita enfileirar milhares de
// downloads que falham num pareamento novo. 0 = sem limite. Mensagens ao vivo
// sempre baixam, independentemente disso.
const HISTORY_MEDIA_MAX_AGE_DAYS = Number(process.env.HISTORY_MEDIA_MAX_AGE_DAYS ?? 60);
const HISTORY_MEDIA_CUTOFF_MS = HISTORY_MEDIA_MAX_AGE_DAYS > 0
  ? HISTORY_MEDIA_MAX_AGE_DAYS * 24 * 3600 * 1000
  : 0;

// Caminho normalizado de ingestão (ao vivo + histórico): map -> persiste
// (idempotente) -> enfileira mídia/avatar -> emite. NÃO baixa mídia no hot path.
export class MessagePipeline {
  constructor({ instanceId, io, resolver, mediaQueue, chatsById, contactsByJid, isSelfJid, metrics }) {
    this.instanceId = instanceId;
    this.io = io;
    this.resolver = resolver;
    this.mediaQueue = mediaQueue;
    this.chatsById = chatsById;
    this.contactsByJid = contactsByJid;
    this.isSelfJid = isSelfJid || (() => false);
    this.metrics = metrics || null;
  }

  _emit(event, payload) {
    emitToInstance(this.io, this.instanceId, event, payload);
  }

  // Guarda o contato SEMPRE sob o JID canônico — o histórico entrega os dados
  // sob @lid enquanto as conversas são chaveadas por PN; sem isto o nome nunca
  // é encontrado e a conversa nasce "Sem nome".
  _rememberContact(rawJid, patch) {
    const jid = this.resolver.canonical(rawJid);
    if (!jid) return;
    const cur = this.contactsByJid.get(jid) || {};
    this.contactsByJid.set(jid, { ...cur, ...patch, id: jid });
  }

  // O cadastro pode ter ficado sob o par LID/PN aprendido depois — procura nos
  // dois e devolve um contato com o melhor nome real disponível.
  _contactFor(jid) {
    const found = [jid, this.resolver.lidFor(jid), this.resolver.pnFor(jid)]
      .filter(Boolean)
      .map(j => this.contactsByJid.get(j))
      .filter(Boolean);
    if (!found.length) return undefined;
    const name = bestName(found);
    return name ? { ...found[0], notify: name } : found[0];
  }

  // Preenche o nome de conversas já persistidas quando o contato chega depois
  // (contacts.upsert / lote de histórico posterior). Sem isto, uma conversa
  // importada sem nome ficaria "Sem nome" até chegar uma mensagem nova.
  async backfillNames(contacts) {
    const nameByConvId = new Map();
    for (const c of contacts || []) {
      const jid = this.resolver.canonical(c?.id);
      if (!jid || jidIsUnsupported(jid)) continue;
      const name = bestName([c]);
      if (!name) continue;
      nameByConvId.set(buildConversationId(this.instanceId, jid), name);
    }
    if (!nameByConvId.size) return;

    const convs = await getConversationsByIds([...nameByConvId.keys()]);
    for (const conv of convs) {
      const name = nameByConvId.get(conv.id);
      const needsCustomer = isPlaceholderName(conv.customer);
      const needsWaName = isPlaceholderName(conv.whatsappName);
      if (!needsCustomer && !needsWaName) continue;
      const updated = await upsertConversation({
        ...conv,
        customer: needsCustomer ? name : conv.customer,
        whatsappName: needsWaName ? name : conv.whatsappName,
      });
      this._emit("conversation:update", { conversation: updated });
    }
  }

  // Reemite a contagem real de conversas para o dashboard (campo `conversations`).
  async emitConversationCount() {
    try {
      const n = await countConversations(this.instanceId);
      this._emit("instance:sync-progress", { instanceId: this.instanceId, chatsDone: n, chatsTotal: n });
    } catch { /* ignora */ }
  }

  _enrich(conv, prior, lastStored, { historyPreview = false, unreadDelta = 1 } = {}) {
    const unreadCount = lastStored?.fromMe ? 0 : ((prior?.unreadCount || 0) + unreadDelta);
    return {
      ...conv,
      customer: isPlaceholderName(prior?.customer) ? conv.customer : prior.customer,
      whatsappName: isPlaceholderName(prior?.whatsappName) ? conv.whatsappName : prior.whatsappName,
      phone: prior?.phone || conv.phone,
      avatarUrl: prior?.avatarUrl,
      lastMessage: historyPreview ? (previewFor(lastStored) || conv.lastMessage) : previewFor(lastStored),
      lastMessageId: lastStored?.id,
      lastMessageFromMe: lastStored?.fromMe,
      lastMessageAck: lastStored?.ack ?? 0,
      lastInteraction: lastStored ? new Date(lastStored.timestamp * 1000).toISOString() : conv.lastInteraction,
      unreadCount,
      unread: unreadCount > 0,
    };
  }

  // Uma mensagem ao vivo (messages.upsert notify/append).
  async ingestLive(msg) {
    const jid = this.resolver.canonical(msg?.key?.remoteJid);
    if (!jid || jidIsUnsupported(jid) || this.isSelfJid(jid)) return;
    if (!isDisplayableMessage(msg)) return;

    if (msg.pushName && !msg.key?.fromMe) {
      this._rememberContact(msg.key?.participant || msg.key?.remoteJid, { notify: msg.pushName });
    }

    const stored = mapMessage(msg, { instanceId: this.instanceId });
    stored.chatId = jid;
    const added = await appendMessage(this.instanceId, jid, stored);

    if (!added) {
      // Já existia (ex.: enviada por send.js) — só sincroniza ack se subiu.
      if (stored.ack > 0) {
        const ackUpdated = await updateMessageAck(this.instanceId, jid, stored.id, stored.ack);
        if (ackUpdated) this._emit("message:ack", { messageId: stored.id, chatId: jid, ack: stored.ack });
        const prior = await getConversation(buildConversationId(this.instanceId, jid));
        if (prior && prior.lastMessageId === stored.id && (prior.lastMessageAck ?? 0) < stored.ack) {
          const updated = await upsertConversation({ ...prior, lastMessageAck: stored.ack });
          this._emit("conversation:update", { conversation: updated });
        }
      }
      return;
    }

    if (this.metrics) this.metrics.inc(this.instanceId, stored.fromMe ? "messagesOut" : "messagesIn");
    if (isMediaMessage(msg)) {
      this.mediaQueue.enqueue({ kind: "media", msg, jid, messageId: stored.id });
    }

    const conv = mapChatFromBaileys({
      jid,
      chatEntry: this.chatsById.get(jid),
      contact: this._contactFor(jid),
      instanceId: this.instanceId,
      lastMessage: stored,
    });
    const prior = await getConversation(conv.id);
    const isNew = !prior;
    const persisted = await upsertConversation(this._enrich(conv, prior, stored));

    this._emit("message:new", { conversation: persisted, message: stored });
    if (isNew) this.emitConversationCount();
    if (!persisted.avatarUrl) this.mediaQueue.enqueue({ kind: "avatar", jid, conversationId: persisted.id });

    if (!stored.fromMe) {
      try {
        const cancelled = await cancelDueToClientReply(this.instanceId, jid);
        for (const sch of cancelled) this._emit("scheduled:update", { scheduled: sch });
      } catch (err) {
        console.warn(`[pipeline:${this.instanceId}] cancelar agendamento falhou: ${err.message}`);
      }
    }
  }

  // Um lote de histórico (messaging-history.set). firstAtMs=0 desativa o piso.
  async ingestHistoryBatch({ chats, contacts, messages }, { firstAtMs = 0 } = {}) {
    for (const c of contacts || []) {
      if (c?.id) this._rememberContact(c.id, c);
    }

    const byChat = new Map();
    for (const m of messages || []) {
      const jid = this.resolver.canonical(m?.key?.remoteJid);
      if (!jid || jidIsUnsupported(jid) || this.isSelfJid(jid)) continue;
      if (!isDisplayableMessage(m)) continue;
      const tsMs = Number(m.messageTimestamp) * 1000;
      if (firstAtMs && tsMs && tsMs < firstAtMs) continue;
      if (!byChat.has(jid)) byChat.set(jid, []);
      byChat.get(jid).push(m);
    }

    for (const c of chats || []) {
      if (!c?.id || jidIsUnsupported(c.id) || this.isSelfJid(c.id)) continue;
      const cid = this.resolver.canonical(c.id);
      this.chatsById.set(cid, { ...(this.chatsById.get(cid) || {}), ...c, id: cid });
    }

    let persistedChats = 0;
    for (const [jid, msgs] of byChat) {
      const mapped = [];
      let lastStored = null;
      for (const m of msgs) {
        if (m.pushName && !m.key?.fromMe) {
          const senderJid = this.resolver.canonical(m.key?.participant || m.key?.remoteJid);
          if (senderJid && !this.contactsByJid.get(senderJid)?.notify) {
            this._rememberContact(senderJid, { notify: m.pushName });
          }
        }
        const stored = mapMessage(m, { instanceId: this.instanceId });
        stored.chatId = jid;
        mapped.push(stored);
        if (!lastStored || stored.timestamp > lastStored.timestamp) lastStored = stored;
        const recentEnough = !HISTORY_MEDIA_CUTOFF_MS || (stored.timestamp * 1000) >= (Date.now() - HISTORY_MEDIA_CUTOFF_MS);
        if (isMediaMessage(m) && recentEnough) this.mediaQueue.enqueue({ kind: "media", msg: m, jid, messageId: stored.id });
      }
      const insertedIdx = await bulkSaveMessages(this.instanceId, jid, mapped);
      if (this.metrics && insertedIdx.length) this.metrics.inc(this.instanceId, "messagesIn", insertedIdx.length);
      // Só mensagens recebidas GENUINAMENTE novas contam como não lidas —
      // re-syncs de mensagens já persistidas não inflam o badge.
      const newIncoming = insertedIdx.filter(i => !mapped[i]?.fromMe).length;

      const conv = mapChatFromBaileys({
        jid,
        chatEntry: this.chatsById.get(jid),
        contact: this._contactFor(jid),
        instanceId: this.instanceId,
        lastMessage: lastStored || undefined,
      });
      const prior = await getConversation(conv.id);
      const persisted = await upsertConversation(this._enrich(conv, prior, lastStored, { historyPreview: true, unreadDelta: newIncoming }));
      persistedChats += 1;
      if (!persisted.avatarUrl) this.mediaQueue.enqueue({ kind: "avatar", jid, conversationId: persisted.id });
    }
    return persistedChats;
  }
}
