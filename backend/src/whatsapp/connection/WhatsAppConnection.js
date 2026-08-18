import path from "node:path";
import fs from "node:fs/promises";
import { EventEmitter } from "node:events";
import QRCode from "qrcode";
import pino from "pino";
import { Boom } from "@hapi/boom";
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  jidNormalizedUser,
  proto,
} from "@whiskeysockets/baileys";
import { config } from "../../config.js";
import { patchInstance, getInstance } from "../../storage/instances-repo.js";
import { listMessages, updateMessageMedia, updateMessageAck, markMessageDeleted, updateMessageBody } from "../../storage/messages-repo.js";
import { getConversation, upsertConversation, mergeConversations, repairMissingPhones, listConversationsMissingAvatar } from "../../storage/conversations-repo.js";
import { downloadAndSaveFromUrl } from "../../storage/media-repo.js";
import { buildConversationId, jidIsUnsupported, mapBaileysStatusToAck, bestName, extractEditedBody, previewFor } from "../message-mapper.js";
import { emitToInstance } from "../../socket/events.js";
import { suppressLibsignalSessionLogs } from "../suppress-libsignal-logs.js";
import { getCachedBaileysVersion } from "./baileys-version.js";
import { pickBrowser } from "./browser-fingerprint.js";
import { JidResolver } from "./jid-resolver.js";
import { MediaQueue } from "../pipeline/MediaQueue.js";
import { MessagePipeline } from "../pipeline/MessagePipeline.js";
import { downloadIfMedia } from "../pipeline/media-download.js";
import { metrics } from "../../observability/instance-metrics.js";

suppressLibsignalSessionLogs();
const logger = pino({ level: process.env.BAILEYS_LOG_LEVEL || "fatal" });

// Um job de mídia/avatar que falha por motivo transitório (socket subindo,
// rate limit, rede) é retentado com backoff. Sem isso a mensagem ficava sem
// arquivo para sempre — a mensagem bruta do Baileys não é persistida, então
// não há como reprocessá-la depois.
const MEDIA_RETRY_MAX = 3;
const MEDIA_RETRY_BASE_MS = 5000;
// Teto de conversas cujo avatar é reenfileirado ao reconectar, para um
// pareamento novo não inundar a fila.
const AVATAR_BACKFILL_LIMIT = 500;

// Conexão WhatsApp de UMA instância. Máquina de estados encapsulada, com
// teardown explícito (off de todos os listeners + limpeza dos Maps). NÃO decide
// reconexão — emite eventos de domínio para o ConnectionManager decidir.
//
// Eventos emitidos: 'open' {phone, isFreshPair}, 'close' {statusCode},
//                   'loggedOut', 'qr' {dataUrl}.
export class WhatsAppConnection extends EventEmitter {
  constructor({ instanceId, io }) {
    super();
    this.instanceId = instanceId;
    this.io = io;
    this.authDir = path.join(config.paths.baileysAuthDir, instanceId);
    this.state = "idle";
    this.sock = null;
    this.saveCreds = null;
    this._listeners = [];
    this.chatsById = new Map();
    this.contactsByJid = new Map();
    // Dedupe de jobs de avatar concorrentes para a mesma conversa. NÃO é marca
    // de "já tentou": quem evita o retrabalho é o `avatarUrl` já gravado.
    this._avatarInFlight = new Set();
    this._retryTimers = new Set();
    this.ownJid = null;
    this.lastQrDataUrl = null;
    this.lastPairingCode = null;
    this._softResyncTimer = null;
    this._pendingMerges = [];
    // Catch-up de janela offline: âncora (key mais nova vista por chat, mesmo
    // não descriptografada) + controle de reenvio/backfill.
    this._newestSeenKeyByChat = new Map();
    this._resendRequested = new Set();
    this._backfilling = false;
    this._backfillTimer = null;
    this.resolver = new JidResolver({
      instanceId,
      authDir: this.authDir,
      // A fusão começa já; guardamos a promise para poder aguardá-la ANTES de
      // emitir a mensagem nova (senão um update defasado sobrescreveria a última msg).
      onLearn: (lid, pn) => { this._pendingMerges.push(this._onLidLearned(lid, pn).catch(() => {})); },
    });
    this.mediaQueue = new MediaQueue({
      concurrency: 3,
      maxPending: 5000,
      process: job => this._processMediaJob(job),
      onError: (err, job) => console.warn(`[media-queue:${instanceId}] ${job?.kind} falhou: ${err.message}`),
    });
    this.pipeline = new MessagePipeline({
      instanceId,
      io,
      resolver: this.resolver,
      mediaQueue: this.mediaQueue,
      chatsById: this.chatsById,
      contactsByJid: this.contactsByJid,
      isSelfJid: jid => this._isSelfJid(jid),
      metrics,
    });
  }

  _setState(state) {
    this.state = state;
    metrics.set(this.instanceId, "state", state);
  }

  _emitIo(event, payload) {
    emitToInstance(this.io, this.instanceId, event, payload);
  }

  _isSelfJid(jid) {
    if (!jid || !this.ownJid) return false;
    try { return jidNormalizedUser(jid) === this.ownJid; } catch { return false; }
  }

  _on(event, fn) {
    this.sock.ev.on(event, fn);
    this._listeners.push([event, fn]);
  }

  async start() {
    await fs.mkdir(this.authDir, { recursive: true });
    await this.resolver.load();
    // Cura duplicatas @lid/@s.whatsapp.net que tenham sobrado de execuções anteriores.
    this._reconcileKnownMappings().catch(() => {});
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
    this.saveCreds = saveCreds;
    const version = await getCachedBaileysVersion();
    const inst = await getInstance(this.instanceId);
    // Modo de histórico: fullHistoryRequested (resync) força "full"; instâncias
    // antigas sem o campo historySync mantêm o comportamento legado ("none").
    const historyMode = inst?.fullHistoryRequested ? "full" : (inst?.historySync || "none");

    this.sock = makeWASocket({
      ...(version ? { version } : {}),
      auth: state,
      logger,
      syncFullHistory: historyMode === "full",
      // Sem isso o Baileys só processa notificações de histórico quando
      // syncFullHistory=true — o modo "recent" depende deste override.
      shouldSyncHistoryMessage: () => historyMode !== "none",
      markOnlineOnConnect: false,
      browser: pickBrowser(historyMode),
      generateHighQualityLinkPreview: false,
      getMessage: async key => {
        try {
          const msgs = await listMessages(this.instanceId, key?.remoteJid, { limit: 50 });
          const hit = msgs.find(m => m.id === key?.id);
          return hit ? { conversation: hit.body || "" } : undefined;
        } catch { return undefined; }
      },
    });
    this._setState("connecting");
    this._wireEvents();
    return this;
  }

  _wireEvents() {
    this._on("creds.update", () => { this.saveCreds?.(); });
    this._on("connection.update", u => this._onConnectionUpdate(u));
    this._on("chats.upsert", chats => this._mergeChats(chats));
    this._on("chats.update", chats => this._mergeChats(chats));
    // v7: o par LID↔telefone chega por evento próprio (substituiu o antigo
    // chats.phoneNumberShare). É por aqui que a conversa @lid ganha número e é
    // fundida com a conversa PN correspondente.
    this._on("lid-mapping.update", ev => {
      if (process.env.WA_DEBUG_SYNC) console.log("[sync:lid-mapping]", JSON.stringify(ev));
      try { this.resolver.remember(ev?.lid, ev?.pn); } catch {}
    });
    this._on("contacts.upsert", contacts => this._onContacts(contacts));
    this._on("contacts.update", contacts => this._onContacts(contacts));
    this._on("messaging-history.set", batch => this._onHistory(batch));
    this._on("messages.upsert", ev => this._onMessagesUpsert(ev));
    this._on("messages.update", updates => this._onMessagesUpdate(updates));
    this._on("message-receipt.update", updates => this._onReceiptUpdate(updates));
  }

  _mergeChats(chats) {
    for (const c of chats || []) {
      if (!c?.id) continue;
      const cid = this.resolver.canonical(c.id);
      this.chatsById.set(cid, { ...(this.chatsById.get(cid) || {}), ...c, id: cid });
    }
  }

  _collectAliasesFromContact(c) {
    if (!c) return;
    const alt = c.lid || c.phoneNumber || c.jid || c.pn;
    if (typeof c.id === "string" && typeof alt === "string") this.resolver.remember(c.id, alt);
  }

  _collectAliasesFromMsg(msg) {
    if (!msg) return;
    const k = msg.key || {};
    const cands = [
      k.remoteJid, k.remoteJidAlt, k.participant, k.participantPn, k.participantAlt,
      k.senderLid, k.senderPn, msg.participant, msg.participantAlt, msg.participantPn,
      msg.senderLid, msg.senderPn,
    ].filter(s => typeof s === "string");
    const lids = cands.filter(s => s.endsWith("@lid"));
    const pns = cands.filter(s => s.endsWith("@s.whatsapp.net"));
    for (const lid of lids) for (const pn of pns) this.resolver.remember(lid, pn);
  }

  // Funde a conversa @lid na conversa @s.whatsapp.net (PN) correspondente e
  // avisa o front para remover a duplicata. Idempotente.
  async _onLidLearned(lid, pn) {
    if (!lid || !pn || lid === pn) return null;
    try {
      const res = await mergeConversations(this.instanceId, lid, pn);
      if (res?.removedId) {
        this._emitIo("conversation:update", { conversation: res.merged });
        this._emitIo("conversation:delete", { conversationId: res.removedId });
        await this.pipeline.emitConversationCount();
      }
      return res;
    } catch (err) {
      console.warn(`[${this.instanceId}] merge lid→pn falhou: ${err.message}`);
      return null;
    }
  }

  async _reconcileKnownMappings() {
    for (const [lid, pn] of this.resolver.allMappings()) {
      await this._onLidLearned(lid, pn);
    }
  }

  // Aguarda fusões de conversa disparadas pelo aprendizado de mapeamentos LID,
  // garantindo que o "conversation:update" da fusão seja emitido ANTES do
  // "message:new" (que carrega a última mensagem correta).
  async _drainPendingMerges() {
    if (!this._pendingMerges.length) return;
    const pending = this._pendingMerges;
    this._pendingMerges = [];
    await Promise.allSettled(pending);
  }

  // Diagnóstico do sync (WA_DEBUG_SYNC=1): mostra o que o WhatsApp realmente
  // entrega — se contatos/chats vêm com nome, se as mensagens trazem pushName e
  // sob qual forma de JID (@lid vs @s.whatsapp.net) tudo chega.
  _debugSync(label, { contacts, chats, messages, lidPnMappings } = {}) {
    if (!process.env.WA_DEBUG_SYNC) return;
    const named = arr => (arr || []).filter(x => x?.name || x?.notify || x?.verifiedName).length;
    const lids = arr => (arr || []).filter(x => String(x?.id).endsWith("@lid")).length;
    const parts = [`[sync:${label}]`];
    if (lidPnMappings) parts.push(`lidPnMappings=${lidPnMappings.length}`);
    if (contacts) parts.push(`contacts=${contacts.length} comNome=${named(contacts)} @lid=${lids(contacts)}`);
    if (chats) parts.push(`chats=${chats.length} comNome=${named(chats)} @lid=${lids(chats)}`);
    if (messages) {
      const recebidas = messages.filter(m => !m?.key?.fromMe);
      parts.push(`msgs=${messages.length} recebidas=${recebidas.length} comPushName=${recebidas.filter(m => m?.pushName).length}`);
    }
    console.log(parts.join(" "));

    for (const c of (contacts || []).slice(0, 3)) console.log("   contato:", JSON.stringify(c).slice(0, 240));
    for (const c of (chats || []).slice(0, 3)) {
      console.log("   chat   :", JSON.stringify(c).slice(0, 240));
      console.log("   campos :", Object.keys(c || {}).join(","));
    }
    for (const m of (messages || []).filter(m => !m?.key?.fromMe).slice(0, 2)) {
      console.log("   msg.key:", JSON.stringify(m.key), "pushName:", JSON.stringify(m.pushName),
        "participant:", JSON.stringify(m.participant));
    }
  }

  async _onContacts(contacts) {
    this._debugSync("contacts", { contacts });
    for (const c of contacts || []) {
      // Aprende o par LID/PN ANTES de canonicalizar — o mapeamento pode vir daqui.
      this._collectAliasesFromContact(c);
      if (c?.id) {
        const cid = this.resolver.canonical(c.id);
        this.contactsByJid.set(cid, { ...(this.contactsByJid.get(cid) || {}), ...c, id: cid });
        // O Baileys sinaliza troca de foto com imgUrl "changed" (ou uma URL nova).
        // Sem reagir a isso o avatar ficava congelado para sempre.
        if ("imgUrl" in c && c.imgUrl && !jidIsUnsupported(cid)) {
          this.mediaQueue.enqueue({
            kind: "avatar",
            jid: cid,
            conversationId: buildConversationId(this.instanceId, cid),
            force: true,
          });
        }
      }
    }
    // O contato pode chegar DEPOIS da conversa ter sido criada pelo histórico:
    // preenche o nome de quem ainda está sem.
    await this.pipeline.backfillNames(contacts).catch(err =>
      console.warn(`[${this.instanceId}] backfill de nomes falhou: ${err.message}`));
  }

  async _onConnectionUpdate(update) {
    const { connection, lastDisconnect, qr } = update;
    // Sinal de que o WhatsApp terminou de empurrar as notificações offline:
    // momento certo para o backfill da janela em que ficamos fora.
    if (update.receivedPendingNotifications) this._scheduleBackfill();
    if (qr) {
      try {
        this.lastQrDataUrl = await QRCode.toDataURL(qr);
        this._setState("qr");
        await patchInstance(this.instanceId, { status: "qr-pendente" });
        this._emitIo("instance:qr", { instanceId: this.instanceId, qr: this.lastQrDataUrl });
        this._emitIo("instance:status", { instanceId: this.instanceId, status: "qr-pendente" });
        this.emit("qr", { dataUrl: this.lastQrDataUrl });
      } catch (err) {
        console.error(`[${this.instanceId}] qr handler falhou:`, err.message);
      }
    }
    if (connection === "open") {
      try {
        const userId = this.sock.user?.id || "";
        try { this.ownJid = jidNormalizedUser(userId); } catch { this.ownJid = null; }
        const phone = userId.split(":")[0].split("@")[0];
        const phoneFmt = phone ? `+${phone}` : "";
        const stored = await getInstance(this.instanceId);
        const firstConnectedAt = stored?.firstConnectedAt || new Date().toISOString();
        const isFreshPair = !stored?.firstConnectedAt;
        await patchInstance(this.instanceId, {
          status: "ativa",
          phone: phoneFmt,
          firstConnectedAt,
          lastSync: stored?.lastSync || firstConnectedAt,
        });
        this._setState("open");
        metrics.set(this.instanceId, "lastOpenAt", new Date().toISOString());
        this.lastQrDataUrl = null;
        this.lastPairingCode = null;
        this._emitIo("instance:ready", { instanceId: this.instanceId, phone: phoneFmt });
        this._emitIo("instance:status", { instanceId: this.instanceId, status: "ativa", phone: phoneFmt });
        console.log(`[${this.instanceId}] conexão aberta, phone=${phoneFmt}${isFreshPair ? " (pareamento novo)" : ""}`);
        this._repairPhones().catch(() => {});
        this._backfillAvatars().catch(err => console.warn(`[${this.instanceId}] backfill de avatar falhou: ${err.message}`));
        this.emit("open", { phone: phoneFmt, isFreshPair });
      } catch (err) {
        console.error(`[${this.instanceId}] open handler falhou:`, err.message);
      }
    }
    if (connection === "close") {
      const err = lastDisconnect?.error;
      const statusCode = (err instanceof Boom ? err.output?.statusCode : err?.output?.statusCode) || 0;
      const loggedOut = statusCode === 401;
      // 515 (restartRequired) é benigno — o Baileys sempre fecha assim logo após
      // o pareamento e o manager religa imediatamente; manter "conectando" evita
      // o flash de "desconectada" na UI.
      const benignRestart = !loggedOut && statusCode === DisconnectReason.restartRequired;
      const uiStatus = benignRestart ? "conectando" : "desconectada";
      this._setState(loggedOut ? "loggedOut" : "closed");
      metrics.set(this.instanceId, "lastDisconnectCode", statusCode);
      await patchInstance(this.instanceId, { status: uiStatus });
      this._emitIo("instance:status", { instanceId: this.instanceId, status: uiStatus });
      console.warn(`[${this.instanceId}] conexão fechada: statusCode=${statusCode} loggedOut=${loggedOut}`);
      if (loggedOut) this.emit("loggedOut", { statusCode });
      else this.emit("close", { statusCode });
    }
  }

  async _onHistory(batch) {
    try {
      this._debugSync("history", batch);
      // v7: o histórico traz o par LID↔telefone. Aprender ANTES de ingerir faz a
      // conversa já nascer sob o JID de número (com telefone), em vez de nascer
      // anônima sob @lid e só ser corrigida depois.
      for (const map of batch.lidPnMappings || []) {
        try { this.resolver.remember(map?.lid, map?.pn); } catch { /* ignora par inválido */ }
      }
      for (const c of batch.contacts || []) this._collectAliasesFromContact(c);
      for (const m of batch.messages || []) this._collectAliasesFromMsg(m);
      await this._drainPendingMerges();
      const inst = await getInstance(this.instanceId);
      const historyMode = inst?.fullHistoryRequested ? "full" : (inst?.historySync || "none");
      // Piso temporal só no modo "none" (e fora do soft-resync): nos modos
      // recent/full as conversas antigas são exatamente o que queremos persistir.
      const useFloor = historyMode === "none" && !inst?.softResyncActive;
      const firstAtMs = useFloor
        ? (inst?.firstConnectedAt ? new Date(inst.firstConnectedAt).getTime() : Date.now())
        : 0;
      const persisted = await this.pipeline.ingestHistoryBatch(batch, { firstAtMs });
      // Contatos deste lote podem nomear conversas criadas em lotes anteriores.
      await this.pipeline.backfillNames(batch.contacts).catch(() => {});
      await this.pipeline.emitConversationCount();
      if (batch.isLatest) {
        await patchInstance(this.instanceId, { historySynced: true, lastSync: new Date().toISOString(), fullHistoryRequested: false });
        console.log(`[${this.instanceId}] history sync batch final (persistidos ~${persisted} chats)`);
      }
    } catch (err) {
      console.error(`[${this.instanceId}] messaging-history.set falhou:`, err.message);
    }
  }

  async _onMessagesUpsert({ messages, type }) {
    if (type !== "notify" && type !== "append") return;
    for (const m of messages) this._collectAliasesFromMsg(m);
    await this._drainPendingMerges();
    for (const msg of messages) {
      // Registra a key (mesmo de mensagens que falharam ao descriptografar) para
      // servir de âncora no backfill da janela offline.
      this._recordSeenKey(msg);
      // Falha de descriptografia → pede ao telefone reenviar já decifrada.
      this._maybeRequestResend(msg);
      try {
        await this.pipeline.ingestLive(msg);
      } catch (err) {
        console.error(`[${this.instanceId}] ingestLive falhou:`, err.message);
      }
    }
  }

  // Guarda a key mais nova vista por chat (chave canônica), preservando o
  // remoteJid bruto para usar como âncora no fetchMessageHistory.
  _recordSeenKey(msg) {
    const rawJid = msg?.key?.remoteJid;
    const jid = this.resolver.canonical(rawJid);
    const id = msg?.key?.id;
    if (!jid || !id || jidIsUnsupported(jid) || this._isSelfJid(jid)) return;
    const ts = Number(msg.messageTimestamp) || 0;
    const cur = this._newestSeenKeyByChat.get(jid);
    if (!cur || ts >= cur.ts) {
      this._newestSeenKeyByChat.set(jid, { id, fromMe: Boolean(msg.key?.fromMe), ts, remoteJid: rawJid });
    }
  }

  // Para uma mensagem recebida que falhou ao descriptografar (stub CIPHERTEXT),
  // solicita o reenvio decifrado pelo telefone (uma vez por id).
  _maybeRequestResend(msg) {
    if (!msg || msg.key?.fromMe) return;
    if (msg.messageStubType !== proto.WebMessageInfo.StubType.CIPHERTEXT) return;
    const id = msg.key?.id;
    if (!id || this._resendRequested.has(id)) return;
    this._resendRequested.add(id);
    // Limita o crescimento em conexões longevas (Sets iteram por inserção → FIFO).
    if (this._resendRequested.size > 5000) {
      this._resendRequested.delete(this._resendRequested.values().next().value);
    }
    try {
      Promise.resolve(this.sock?.requestPlaceholderResend?.(msg.key)).catch(() => {});
    } catch { /* ignora */ }
  }

  _scheduleBackfill(delayMs = 3000) {
    if (this._backfillTimer) return;
    this._backfillTimer = setTimeout(() => {
      this._backfillTimer = null;
      this.syncRecent().catch(() => {});
    }, delayMs);
    this._backfillTimer.unref?.();
  }

  async _onMessagesUpdate(updates) {
    for (const u of updates) {
      try {
        const messageId = u.key?.id;
        const jid = this.resolver.canonical(u.key?.remoteJid);
        if (!messageId || !jid || jidIsUnsupported(jid)) continue;

        // Revoke ("apagar para todos"): o Baileys sintetiza o protocolMessage
        // em um update com message:null e stub REVOKE; key.id é a mensagem alvo.
        const isRevoke = u.update?.messageStubType === proto.WebMessageInfo.StubType.REVOKE ||
          u.update?.message === null;
        if (isRevoke) {
          const doc = await markMessageDeleted(this.instanceId, jid, messageId);
          if (doc) {
            this._emitIo("message:update", { messageId, chatId: jid, deleted: true });
            await this._refreshLastMessagePreview(jid, messageId, "Mensagem apagada");
          }
          continue;
        }

        // Edição: update.message = { editedMessage: { message: ... } }.
        if (u.update?.message) {
          const body = extractEditedBody(u.update.message);
          if (body) {
            const doc = await updateMessageBody(this.instanceId, jid, messageId, body);
            if (doc) {
              this._emitIo("message:update", { messageId, chatId: jid, edited: true, body });
              await this._refreshLastMessagePreview(jid, messageId, previewFor(doc));
            }
          }
          continue;
        }

        // Ack — recibos de entrega/leitura de chats 1:1 chegam como status numérico.
        const statusRaw = u.update?.status;
        if (typeof statusRaw !== "number") continue;
        const ack = mapBaileysStatusToAck(statusRaw);
        const ackUpdated = await updateMessageAck(this.instanceId, jid, messageId, ack);
        if (ackUpdated) this._emitIo("message:ack", { messageId, chatId: jid, ack });
        const conv = await getConversation(buildConversationId(this.instanceId, jid));
        if (conv && conv.lastMessageId === messageId && (conv.lastMessageAck ?? 0) < ack) {
          const updated = await upsertConversation({ ...conv, lastMessageAck: ack });
          this._emitIo("conversation:update", { conversation: updated });
        }
      } catch (err) {
        console.error(`[${this.instanceId}] messages.update falhou:`, err.message);
      }
    }
  }

  // Recibos por destinatário. Em chats 1:1 a leitura normalmente chega como
  // status numérico via messages.update; este handler cobre o caminho
  // message-receipt.update (hoje grupos/status, forward-compat para 1:1).
  async _onReceiptUpdate(updates) {
    for (const u of updates || []) {
      try {
        const messageId = u.key?.id;
        const jid = this.resolver.canonical(u.key?.remoteJid);
        if (!messageId || !jid || jidIsUnsupported(jid)) continue;
        const r = u.receipt || {};
        const ack = r.playedTimestamp ? 4 : r.readTimestamp ? 3 : r.receiptTimestamp ? 2 : 0;
        if (!ack) continue;
        const changed = await updateMessageAck(this.instanceId, jid, messageId, ack);
        if (changed) this._emitIo("message:ack", { messageId, chatId: jid, ack });
      } catch (err) {
        console.error(`[${this.instanceId}] message-receipt.update falhou:`, err.message);
      }
    }
  }

  // Conversas fundidas de @lid para PN podiam ficar sem telefone, embora o número
  // esteja no próprio chatId. Corrige as que já estão no banco ao conectar.
  async _repairPhones() {
    const corrigidas = await repairMissingPhones(this.instanceId);
    for (const conv of corrigidas) this._emitIo("conversation:update", { conversation: conv });
    if (corrigidas.length) console.log(`[${this.instanceId}] telefone preenchido em ${corrigidas.length} conversa(s)`);
  }

  // Se a mensagem alterada era a última da conversa, atualiza o preview da lista.
  async _refreshLastMessagePreview(jid, messageId, preview) {
    const conv = await getConversation(buildConversationId(this.instanceId, jid));
    if (!conv || conv.lastMessageId !== messageId) return;
    const updated = await upsertConversation({ ...conv, lastMessage: preview });
    this._emitIo("conversation:update", { conversation: updated });
  }

  // Reenfileira um job que falhou por motivo transitório, com backoff linear.
  // O timer é rastreado para o teardown não deixar disparo órfão.
  _retryLater(job, attempts) {
    const timer = setTimeout(() => {
      this._retryTimers.delete(timer);
      if (!this.sock) return; // conexão caiu no meio do caminho
      this.mediaQueue.enqueue({ ...job, attempts });
    }, MEDIA_RETRY_BASE_MS * attempts);
    if (typeof timer.unref === "function") timer.unref();
    this._retryTimers.add(timer);
  }

  async _processMediaJob(job) {
    if (job.kind === "media") {
      const info = await downloadIfMedia(job.msg, this.sock);
      metrics.set(this.instanceId, "mediaQueueDepth", this.mediaQueue.depth);
      if (!info.mediaUrl) {
        metrics.inc(this.instanceId, "mediaFailed");
        const attempts = (job.attempts || 0) + 1;
        if (attempts <= MEDIA_RETRY_MAX) this._retryLater(job, attempts);
        return;
      }
      await updateMessageMedia(this.instanceId, job.jid, job.messageId, info);
      this._emitIo("message:media", { messageId: job.messageId, chatId: job.jid, mediaUrl: info.mediaUrl, mediaMime: info.mediaMime });
    } else if (job.kind === "avatar") {
      if (this._avatarInFlight.has(job.conversationId)) return;
      this._avatarInFlight.add(job.conversationId);
      try {
        // `force` vem de contacts.update (foto trocada): nesse caso a conversa
        // já tem avatarUrl e mesmo assim precisa ser rebaixada.
        if (!job.force) {
          const atual = await getConversation(job.conversationId);
          if (atual?.avatarUrl) return;
        }
        const url = await this.getProfilePicUrl(job.jid);
        if (!url) return; // sem foto ou perfil privado — não insiste
        const saved = await downloadAndSaveFromUrl(url);
        if (!saved) throw new Error("download da foto de perfil falhou");
        const prior = await getConversation(job.conversationId);
        if (!prior) return;
        const updated = await upsertConversation({ id: job.conversationId, avatarUrl: saved.url });
        this._emitIo("conversation:update", { conversation: updated });
      } catch (err) {
        const attempts = (job.attempts || 0) + 1;
        if (attempts <= MEDIA_RETRY_MAX) this._retryLater(job, attempts);
        else console.warn(`[${this.instanceId}] avatar de ${job.jid} desistiu após ${MEDIA_RETRY_MAX} tentativas: ${err.message}`);
      } finally {
        this._avatarInFlight.delete(job.conversationId);
      }
    }
  }

  // Ao reconectar, tenta de novo a foto das conversas que ainda estão sem ela.
  async _backfillAvatars() {
    const pendentes = await listConversationsMissingAvatar(this.instanceId, AVATAR_BACKFILL_LIMIT);
    for (const conv of pendentes) {
      this.mediaQueue.enqueue({ kind: "avatar", jid: conv.chatId, conversationId: conv.id });
    }
    if (pendentes.length) console.log(`[${this.instanceId}] backfill de avatar enfileirado para ${pendentes.length} conversa(s)`);
  }

  // ---- API pública usada por rotas/manager ----
  isSocketOpen() {
    try {
      const ws = this.sock?.ws;
      if (ws && typeof ws.isOpen === "boolean") return ws.isOpen;
      return true;
    } catch { return true; }
  }

  getQrDataUrl() { return this.lastQrDataUrl; }
  getPairingCode() { return this.lastPairingCode; }
  getChatById(jid) { return this.chatsById.get(jid) || null; }
  sendMessage(jid, content, options) { return this.sock.sendMessage(jid, content, options); }

  // Envia recibos de leitura (tick azul) para keys { remoteJid, id, fromMe }.
  readMessages(keys) { return this.sock.readMessages(keys); }

  // Resolve o JID para a forma canônica (PN). LIDs conhecidos viram @s.whatsapp.net.
  canonicalJid(jid) { return this.resolver.canonical(jid); }

  // Aprende um par LID<->PN (dispara fusão de conversas via onLearn).
  rememberJidMapping(a, b) { return this.resolver.remember(a, b); }

  // Consulta o WhatsApp pelo número: devolve [{ jid, exists, lid }]. Corrige
  // normalizações do servidor (ex.: 9º dígito no Brasil) e expõe o LID do contato.
  async onWhatsApp(number) {
    try { return await this.sock.onWhatsApp(number); } catch { return undefined; }
  }

  // Melhor nome conhecido para um JID, olhando o contato pelo próprio JID e pelo
  // seu par LID/PN (o cadastro pode estar sob qualquer um dos dois).
  knownNameFor(jid) {
    const found = [jid, this.resolver.lidFor(jid), this.resolver.pnFor(jid)]
      .filter(Boolean)
      .map(j => this.contactsByJid.get(j))
      .filter(Boolean);
    return bestName(found);
  }

  // Funde uma eventual conversa @lid já existente na conversa PN informada.
  // Aguardável — usado ao iniciar conversa para a duplicata sumir na hora.
  async mergeKnownDuplicate(pn) {
    const lid = this.resolver.lidFor(pn);
    if (!lid) return null;
    return this._onLidLearned(lid, pn);
  }

  // null = o contato genuinamente não tem foto visível (não adianta insistir).
  // Qualquer outro erro é transitório e sobe, para virar retentativa.
  async getProfilePicUrl(jid) {
    try {
      return await this.sock.profilePictureUrl(jid, "image");
    } catch (err) {
      const status = err?.output?.statusCode ?? err?.data?.statusCode;
      const msg = String(err?.message || "").toLowerCase();
      if (status === 404 || status === 401 || status === 403
        || msg.includes("item-not-found") || msg.includes("forbidden") || msg.includes("not-authorized")) {
        return null;
      }
      throw err;
    }
  }

  // Enfileira a busca da foto de perfil de um contato. Usado por rotas que
  // criam conversa fora do fluxo de mensagem (ex.: POST /conversations/start).
  enqueueAvatar(jid, conversationId) {
    if (!jid || !conversationId || jidIsUnsupported(jid)) return;
    this.mediaQueue.enqueue({ kind: "avatar", jid, conversationId });
  }

  async requestPairingCode(phoneNumber) {
    const digits = String(phoneNumber || "").replace(/\D/g, "");
    if (!digits || digits.length < 10) throw new Error("número inválido — informe DDI + DDD + número, somente dígitos");
    if (this.sock?.authState?.creds?.registered) throw new Error("instância já está registrada");
    const code = await this.sock.requestPairingCode(digits);
    this.lastPairingCode = code;
    await patchInstance(this.instanceId, { status: "codigo-pendente" });
    this._emitIo("instance:pairing-code", { instanceId: this.instanceId, code });
    this._emitIo("instance:status", { instanceId: this.instanceId, status: "codigo-pendente" });
    return code;
  }

  // Backfill da janela offline: para cada chat onde a key mais nova VISTA na
  // reconexão (mesmo não descriptografada) é mais nova que a última mensagem que
  // temos no banco, puxa a janela faltante via fetchMessageHistory (vem do
  // app-state do telefone, sem o problema de descriptografia Signal) e pede o
  // reenvio decifrado da própria mensagem-âncora. Gated pelo manager / pelo
  // sinal receivedPendingNotifications.
  async syncRecent({ perChat = 50, maxChats = 30 } = {}) {
    if (this._backfilling) return;
    this._backfilling = true;
    const tag = `[${this.instanceId}][sync-recent]`;
    let chatsChecked = 0;
    try {
      const inst = await getInstance(this.instanceId);
      const lastSyncMs = inst?.lastSync ? new Date(inst.lastSync).getTime() : 0;
      const gapMs = lastSyncMs ? Date.now() - lastSyncMs : 0;
      // Janela offline grande → passada mais ampla.
      if (gapMs > 30 * 60 * 1000) { perChat = Math.max(perChat, 100); maxChats = Math.max(maxChats, 100); }

      await patchInstance(this.instanceId, { softResyncActive: true });
      if (this._softResyncTimer) clearTimeout(this._softResyncTimer);
      this._softResyncTimer = setTimeout(() => {
        this._softResyncTimer = null;
        patchInstance(this.instanceId, { softResyncActive: false }).catch(() => {});
      }, 90_000);
      this._softResyncTimer.unref?.();

      const anchors = [...this._newestSeenKeyByChat.entries()].slice(0, maxChats);
      const total = anchors.length;
      for (const [jid, seen] of anchors) {
        if (jidIsUnsupported(jid)) continue;
        const newest = (await listMessages(this.instanceId, jid, { limit: 1 }))[0];
        const storedTs = Number(newest?.timestamp) || 0;
        if (seen.ts <= storedTs) continue; // sem lacuna para este chat

        const anchorKey = { remoteJid: seen.remoteJid || jid, id: seen.id, fromMe: seen.fromMe };
        // A própria âncora não volta no fetch (que anda para trás): peça o reenvio.
        if (!seen.fromMe && this.sock?.requestPlaceholderResend) {
          Promise.resolve(this.sock.requestPlaceholderResend(anchorKey)).catch(() => {});
        }
        try {
          await this.sock.fetchMessageHistory(perChat, anchorKey, seen.ts * 1000);
          chatsChecked += 1;
        } catch (err) {
          console.warn(`${tag} fetchMessageHistory ${jid}: ${err.message}`);
        }
        this._emitIo("instance:sync-progress", { instanceId: this.instanceId, chatsDone: chatsChecked, chatsTotal: total });
      }
      await patchInstance(this.instanceId, { lastSync: new Date().toISOString() });
      this._emitIo("instance:sync-recent-done", { instanceId: this.instanceId, chatsChecked, ok: true });
      if (chatsChecked) console.log(`${tag} backfill de lacuna disparado para ${chatsChecked} chat(s)`);
    } catch (err) {
      console.error(`${tag} falhou:`, err.message);
      if (this._softResyncTimer) { clearTimeout(this._softResyncTimer); this._softResyncTimer = null; }
      await patchInstance(this.instanceId, { softResyncActive: false }).catch(() => {});
      this._emitIo("instance:sync-recent-done", { instanceId: this.instanceId, chatsChecked, ok: false });
    } finally {
      this._backfilling = false;
    }
  }

  // Teardown completo: remove listeners, encerra socket e libera memória.
  async stop({ logout = false } = {}) {
    this._setState("closing");
    if (this._softResyncTimer) { clearTimeout(this._softResyncTimer); this._softResyncTimer = null; }
    if (this._backfillTimer) { clearTimeout(this._backfillTimer); this._backfillTimer = null; }
    if (this.sock) {
      // Persiste o estado Signal mais recente antes de encerrar (menos falhas de
      // descriptografia das mensagens que chegarem enquanto estivermos offline).
      if (!logout) { try { await this.saveCreds?.(); } catch { /* ignora */ } }
      for (const [event, fn] of this._listeners) {
        try { this.sock.ev.off(event, fn); } catch {}
      }
      try {
        if (logout) await this.sock.logout();
        else this.sock.end(undefined);
      } catch {}
    }
    this._listeners = [];
    await this.resolver.flush().catch(() => {});
    this.resolver.dispose();
    this.mediaQueue.clear();
    for (const timer of this._retryTimers) clearTimeout(timer);
    this._retryTimers.clear();
    this.chatsById.clear();
    this.contactsByJid.clear();
    this._avatarInFlight.clear();
    this._newestSeenKeyByChat.clear();
    this._resendRequested.clear();
    this.sock = null;
    this._setState("closed");
  }
}
