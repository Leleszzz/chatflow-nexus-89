import path from "node:path";
import fs from "node:fs/promises";
import QRCode from "qrcode";
import pino from "pino";
import { Boom } from "@hapi/boom";
import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  downloadMediaMessage,
  Browsers,
  jidNormalizedUser,
} from "@whiskeysockets/baileys";
import { config } from "../config.js";
import { patchInstance, getInstance } from "../storage/instances-repo.js";
import { upsertConversation, getConversation, deleteConversation } from "../storage/conversations-repo.js";
import { appendMessage, bulkSaveMessages, updateMessageAck, updateMessageMedia, listMessages, removeMessagesForChat } from "../storage/messages-repo.js";
import { saveMediaFromBuffer, downloadAndSaveFromUrl } from "../storage/media-repo.js";
import {
  mapMessage,
  mapChatFromBaileys,
  mapBaileysStatusToAck,
  buildConversationId,
  previewFor,
  jidIsUnsupported,
  jidIsGroup,
  isMediaMessage,
  isDisplayableMessage,
} from "./message-mapper.js";
import { emitToInstance } from "../socket/events.js";
import { suppressLibsignalSessionLogs } from "./suppress-libsignal-logs.js";

suppressLibsignalSessionLogs();
const logger = pino({ level: process.env.BAILEYS_LOG_LEVEL || "fatal" });

function looksLikeJid(s) {
  return typeof s === "string" && /@(s\.whatsapp\.net|lid|c\.us)$/.test(s);
}
function looksLikeRawDigits(s) {
  return typeof s === "string" && /^\d{8,}$/.test(s);
}
function isPlaceholderName(s) {
  return !s || looksLikeJid(s) || looksLikeRawDigits(s);
}

function isExpectedMediaError(err) {
  const msg = String(err?.message || "");
  if (!msg) return false;
  if (msg.includes("empty media key")) return true;
  if (msg.includes("status code 403")) return true;
  if (msg.includes("status code 404")) return true;
  if (msg.includes("status code 410")) return true;
  return false;
}

async function downloadIfMedia(msg, sock) {
  if (!isMediaMessage(msg)) return {};
  try {
    const ctx = { logger };
    if (sock?.updateMediaMessage) ctx.reuploadRequest = sock.updateMediaMessage;
    const buffer = await downloadMediaMessage(msg, "buffer", {}, ctx);
    if (!buffer || !buffer.length) return {};
    const content = msg.message || {};
    const inner =
      content.imageMessage ||
      content.videoMessage ||
      content.audioMessage ||
      content.documentMessage ||
      content.stickerMessage ||
      content.ephemeralMessage?.message?.imageMessage ||
      content.ephemeralMessage?.message?.videoMessage ||
      content.ephemeralMessage?.message?.audioMessage ||
      content.ephemeralMessage?.message?.documentMessage;
    const mimetype = inner?.mimetype || "application/octet-stream";
    const saved = await saveMediaFromBuffer(buffer, mimetype);
    return { mediaUrl: saved.url, mediaMime: saved.mimeType };
  } catch (err) {
    if (!isExpectedMediaError(err)) {
      console.warn("[client-factory] downloadMediaMessage failed:", err.message);
    }
    return {};
  }
}

const avatarInFlight = new Set();

function scheduleAvatarFetch(client, jid, instanceId, conversationId) {
  if (avatarInFlight.has(conversationId)) return;
  avatarInFlight.add(conversationId);
  (async () => {
    try {
      const url = await client.getProfilePicUrl(jid);
      if (!url) return;
      const saved = await downloadAndSaveFromUrl(url);
      if (!saved) return;
      const prior = await getConversation(conversationId);
      if (!prior) return;
      const updated = await upsertConversation({ id: conversationId, avatarUrl: saved.url });
      emitToInstance(client._io, instanceId, "conversation:update", { conversation: updated });
    } catch (err) {
      console.warn(`[avatar] background fetch failed for ${jid}:`, err.message);
    } finally {
      avatarInFlight.delete(conversationId);
    }
  })();
}

export async function createClient({ instanceId, io, onConnectionClose }) {
  const authDir = path.join(config.paths.baileysAuthDir, instanceId);
  await fs.mkdir(authDir, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    printQRInTerminal: false,
    syncFullHistory: true,
    markOnlineOnConnect: false,
    browser: Browsers.appropriate("Chrome"),
    generateHighQualityLinkPreview: false,
    getMessage: async (key) => {
      try {
        const jid = key?.remoteJid;
        const id = key?.id;
        if (!jid || !id) return undefined;
        const msgs = await listMessages(instanceId, jid, { limit: 200 });
        const hit = msgs.find(m => m.id === id);
        if (!hit) return undefined;
        if (hit.type === "chat") return { conversation: hit.body || "" };
        return { conversation: hit.body || "" };
      } catch {
        return undefined;
      }
    },
  });

  const chatsById = new Map();
  const contactsByJid = new Map();
  let lastQrDataUrl = null;
  let historyTotal = 0;
  let historyDone = 0;
  let ownJid = null;

  function isSelfJid(jid) {
    if (!jid || !ownJid) return false;
    try { return jidNormalizedUser(jid) === ownJid; } catch { return false; }
  }

  const lidToPn = new Map();
  const pnToLid = new Map();
  const mergedLids = new Set();

  function rememberJidMapping(a, b) {
    if (!a || !b || a === b) return;
    const aLid = a.endsWith("@lid"), aPn = a.endsWith("@s.whatsapp.net");
    const bLid = b.endsWith("@lid"), bPn = b.endsWith("@s.whatsapp.net");
    let lid = null, pn = null;
    if (aLid && bPn) { lid = a; pn = b; }
    else if (aPn && bLid) { lid = b; pn = a; }
    if (!lid || !pn) return;
    const isNew = !lidToPn.has(lid);
    lidToPn.set(lid, pn);
    pnToLid.set(pn, lid);
    if (isNew && !mergedLids.has(lid)) {
      mergedLids.add(lid);
      mergeLidIntoPn(lid, pn).catch(err => console.warn(`[lid-merge] ${lid}→${pn} failed:`, err.message));
    }
  }

  async function mergeLidIntoPn(lid, pn) {
    const lidConvId = buildConversationId(instanceId, lid);
    const pnConvId = buildConversationId(instanceId, pn);
    const lidConv = await getConversation(lidConvId);
    if (!lidConv) return;

    const lidMsgs = await listMessages(instanceId, lid, { limit: 10000 });
    if (lidMsgs.length) {
      const remapped = lidMsgs.map(m => ({ ...m, chatId: pn }));
      await bulkSaveMessages(instanceId, pn, remapped);
    }

    const pnConv = await getConversation(pnConvId);
    const lidTs = lidConv.lastInteraction ? new Date(lidConv.lastInteraction).getTime() : 0;
    const pnTs = pnConv?.lastInteraction ? new Date(pnConv.lastInteraction).getTime() : 0;
    const newer = lidTs > pnTs ? lidConv : (pnConv || lidConv);
    const merged = {
      ...(pnConv || lidConv),
      id: pnConvId,
      instanceId,
      chatId: pn,
      isGroup: false,
      customer: isPlaceholderName(pnConv?.customer) ? lidConv.customer : pnConv?.customer || lidConv.customer,
      whatsappName: isPlaceholderName(pnConv?.whatsappName) ? lidConv.whatsappName : pnConv?.whatsappName || lidConv.whatsappName,
      phone: pnConv?.phone || lidConv.phone || "",
      avatarUrl: pnConv?.avatarUrl || lidConv.avatarUrl,
      unreadCount: Math.max(pnConv?.unreadCount || 0, lidConv.unreadCount || 0),
      unread: (pnConv?.unread || lidConv.unread) ? true : false,
      lastMessage: newer.lastMessage,
      lastMessageId: newer.lastMessageId,
      lastMessageFromMe: newer.lastMessageFromMe,
      lastMessageAck: newer.lastMessageAck,
      lastInteraction: newer.lastInteraction,
    };
    const persisted = await upsertConversation(merged);

    await deleteConversation(lidConvId);
    await removeMessagesForChat(instanceId, lid);

    emitToInstance(io, instanceId, "conversation:update", { conversation: persisted });
    emitToInstance(io, instanceId, "conversation:delete", { conversationId: lidConvId });
    console.log(`[lid-merge] ${lid} → ${pn} (msgs: ${lidMsgs.length})`);
  }

  function canonicalJid(jid) {
    if (!jid || typeof jid !== "string") return jid;
    if (jid.endsWith("@lid")) {
      const pn = lidToPn.get(jid);
      if (pn) return pn;
    }
    return jid;
  }

  function collectJidAliasesFromMsg(msg) {
    if (!msg) return;
    const k = msg.key || {};
    const candidates = [
      k.remoteJid, k.remoteJidAlt,
      k.participant, k.participantPn, k.participantAlt,
      k.senderLid, k.senderPn,
      msg.participant, msg.participantAlt, msg.participantPn,
      msg.senderLid, msg.senderPn,
    ].filter(s => typeof s === "string");
    const lids = candidates.filter(s => s.endsWith("@lid"));
    const pns = candidates.filter(s => s.endsWith("@s.whatsapp.net"));
    for (const lid of lids) for (const pn of pns) rememberJidMapping(lid, pn);
  }

  function collectJidAliasesFromContact(c) {
    if (!c) return;
    const id = c.id;
    const alt = c.lid || c.phoneNumber || c.jid || c.pn;
    if (typeof id === "string" && typeof alt === "string") rememberJidMapping(id, alt);
  }

  let mediaQueueRunning = false;
  const mediaQueue = [];

  function scheduleHistoryMediaDownloads(items) {
    for (const it of items) mediaQueue.push(it);
    if (mediaQueueRunning) return;
    mediaQueueRunning = true;
    (async () => {
      const concurrency = 3;
      while (mediaQueue.length) {
        const batch = mediaQueue.splice(0, concurrency);
        await Promise.allSettled(batch.map(async ({ msg, jid, messageId }) => {
          const mediaInfo = await downloadIfMedia(msg, sock);
          if (!mediaInfo.mediaUrl) return;
          try {
            await updateMessageMedia(instanceId, jid, messageId, mediaInfo);
            emitToInstance(io, instanceId, "message:media", {
              messageId, chatId: jid,
              mediaUrl: mediaInfo.mediaUrl,
              mediaMime: mediaInfo.mediaMime,
            });
          } catch (err) {
            console.warn(`[media-queue] persist failed for ${messageId}:`, err.message);
          }
        }));
        await new Promise(r => setTimeout(r, 50));
      }
      mediaQueueRunning = false;
    })().catch(err => {
      console.error(`[media-queue] worker crashed:`, err);
      mediaQueueRunning = false;
    });
  }

  const client = {
    sock,
    _io: io,
    instanceId,
    getQrDataUrl: () => lastQrDataUrl,
    sendMessage: (jid, content, options) => sock.sendMessage(jid, content, options),
    getChatById: (jid) => chatsById.get(jid) || null,
    getProfilePicUrl: async (jid) => {
      try {
        return await sock.profilePictureUrl(jid, "image");
      } catch {
        return null;
      }
    },
    destroy: async () => {
      try { sock.end(undefined); } catch {}
    },
    logout: async () => {
      try { await sock.logout(); } catch {}
      try { sock.end(undefined); } catch {}
    },
  };

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      try {
        const dataUrl = await QRCode.toDataURL(qr);
        lastQrDataUrl = dataUrl;
        await patchInstance(instanceId, { status: "qr-pendente" });
        emitToInstance(io, instanceId, "instance:qr", { instanceId, qr: dataUrl });
        emitToInstance(io, instanceId, "instance:status", { instanceId, status: "qr-pendente" });
      } catch (err) {
        console.error(`[${instanceId}] qr handler failed:`, err);
      }
    }
    if (connection === "open") {
      try {
        const userId = sock.user?.id || "";
        try { ownJid = jidNormalizedUser(userId); } catch { ownJid = null; }
        const phoneDigits = userId.split(":")[0].split("@")[0];
        const phone = phoneDigits ? `+${phoneDigits}` : "";
        const stored = await getInstance(instanceId);
        const firstConnectedAt = stored?.firstConnectedAt || new Date().toISOString();
        const isFreshPair = !stored?.firstConnectedAt;
        await patchInstance(instanceId, {
          status: "ativa",
          phone,
          firstConnectedAt,
          lastSync: stored?.lastSync || firstConnectedAt,
        });
        emitToInstance(io, instanceId, "instance:ready", { instanceId, phone });
        emitToInstance(io, instanceId, "instance:status", { instanceId, status: "ativa", phone });
        lastQrDataUrl = null;
        console.log(`[${instanceId}] connection open, phone=${phone}${isFreshPair ? " (fresh pair — full history sync incoming)" : ""}`);
      } catch (err) {
        console.error(`[${instanceId}] open handler crashed:`, err);
      }
    }
    if (connection === "close") {
      const err = lastDisconnect?.error;
      const statusCode = (err instanceof Boom ? err.output?.statusCode : err?.output?.statusCode) || 0;
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      console.warn(`[${instanceId}] connection closed: statusCode=${statusCode} loggedOut=${loggedOut}`);
      await patchInstance(instanceId, { status: "desconectada" });
      emitToInstance(io, instanceId, "instance:status", { instanceId, status: "desconectada" });
      if (typeof onConnectionClose === "function") {
        try { onConnectionClose({ loggedOut, statusCode }); } catch (e) { console.error(e); }
      }
    }
  });

  sock.ev.on("chats.phoneNumberShare", (ev) => {
    try {
      const lid = ev?.lid;
      const jid = ev?.jid;
      if (lid && jid) rememberJidMapping(lid, jid);
    } catch (err) {
      console.warn("[chats.phoneNumberShare] failed:", err.message);
    }
  });

  sock.ev.on("chats.upsert", (chats) => {
    for (const c of chats) {
      if (!c?.id) continue;
      const cid = canonicalJid(c.id);
      chatsById.set(cid, { ...(chatsById.get(cid) || {}), ...c, id: cid });
    }
  });
  sock.ev.on("chats.update", (chats) => {
    for (const c of chats) {
      if (!c?.id) continue;
      const cid = canonicalJid(c.id);
      chatsById.set(cid, { ...(chatsById.get(cid) || {}), ...c, id: cid });
    }
  });

  async function refreshConversationFromContact(jid) {
    try {
      const convId = buildConversationId(instanceId, jid);
      const prior = await getConversation(convId);
      if (!prior) return;
      const conv = mapChatFromBaileys({
        jid,
        chatEntry: chatsById.get(jid),
        contact: contactsByJid.get(jid),
        instanceId,
      });
      const needsNameUpdate = isPlaceholderName(prior.customer) || isPlaceholderName(prior.whatsappName);
      if (!needsNameUpdate && prior.whatsappName === conv.whatsappName) return;
      const merged = {
        ...prior,
        customer: needsNameUpdate ? conv.customer : prior.customer,
        whatsappName: conv.whatsappName || prior.whatsappName,
        phone: prior.phone || conv.phone,
      };
      const persisted = await upsertConversation(merged);
      emitToInstance(io, instanceId, "conversation:update", { conversation: persisted });
    } catch (err) {
      console.warn(`[contacts] refresh failed for ${jid}:`, err.message);
    }
  }

  sock.ev.on("contacts.upsert", async (contacts) => {
    for (const c of contacts) {
      if (c?.id) contactsByJid.set(c.id, { ...(contactsByJid.get(c.id) || {}), ...c });
      collectJidAliasesFromContact(c);
    }
    for (const c of contacts) {
      const cjid = c?.id ? canonicalJid(c.id) : null;
      if (cjid && !jidIsUnsupported(cjid)) await refreshConversationFromContact(cjid);
    }
  });
  sock.ev.on("contacts.update", async (contacts) => {
    for (const c of contacts) {
      if (c?.id) contactsByJid.set(c.id, { ...(contactsByJid.get(c.id) || {}), ...c });
      collectJidAliasesFromContact(c);
    }
    for (const c of contacts) {
      const cjid = c?.id ? canonicalJid(c.id) : null;
      if (cjid && !jidIsUnsupported(cjid)) await refreshConversationFromContact(cjid);
    }
  });

  sock.ev.on("messaging-history.set", async ({ chats, contacts, messages, isLatest }) => {
    const batchStart = Date.now();
    const batchTag = `[${instanceId}][history]`;
    try {
      console.log(`${batchTag} batch received: chats=${chats?.length || 0} contacts=${contacts?.length || 0} messages=${messages?.length || 0} isLatest=${Boolean(isLatest)}`);

      for (const c of contacts || []) {
        if (c?.id) contactsByJid.set(c.id, { ...(contactsByJid.get(c.id) || {}), ...c });
        collectJidAliasesFromContact(c);
      }
      // primeiro passa pra coletar mapeamentos LID↔PN antes de canonicalizar JIDs
      for (const m of messages || []) collectJidAliasesFromMsg(m);

      const supportedChats = (chats || [])
        .filter(c => c?.id && !jidIsUnsupported(c.id) && !isSelfJid(c.id))
        .map(c => ({ ...c, id: canonicalJid(c.id) }));
      const skippedChats = (chats?.length || 0) - supportedChats.length;
      for (const c of supportedChats) chatsById.set(c.id, { ...(chatsById.get(c.id) || {}), ...c });

      const inst = await getInstance(instanceId);
      const fullHistory = Boolean(inst?.fullHistoryRequested);
      const firstAtMs = fullHistory ? 0 : (inst?.firstConnectedAt ? new Date(inst.firstConnectedAt).getTime() : Date.now());
      if (fullHistory) console.log(`${batchTag} fullHistoryRequested=true — timestamp filter DISABLED for this resync`);

      let droppedUnsupported = 0;
      let droppedSelf = 0;
      let droppedUndisplay = 0;
      let droppedOldTs = 0;
      const byChat = new Map();
      for (const m of messages || []) {
        const rawJid = m?.key?.remoteJid;
        const jid = canonicalJid(rawJid);
        if (!jid || jidIsUnsupported(jid)) { droppedUnsupported += 1; continue; }
        if (isSelfJid(jid)) { droppedSelf += 1; continue; }
        if (!isDisplayableMessage(m)) { droppedUndisplay += 1; continue; }
        const tsMs = Number(m.messageTimestamp) * 1000;
        if (!tsMs || tsMs < firstAtMs) { droppedOldTs += 1; continue; }
        if (!byChat.has(jid)) byChat.set(jid, []);
        byChat.get(jid).push(m);
      }
      const kept = Array.from(byChat.values()).reduce((s, a) => s + a.length, 0);
      console.log(`${batchTag} filtered messages: kept=${kept} dropped=${droppedUnsupported + droppedSelf + droppedUndisplay + droppedOldTs} (unsupported=${droppedUnsupported} self=${droppedSelf} undisplay=${droppedUndisplay} olderThanFirstConnected=${droppedOldTs}) — firstConnectedAt=${inst?.firstConnectedAt || "(none, using now)"}`);
      if (skippedChats > 0) console.log(`${batchTag} skipped ${skippedChats} unsupported/self chats`);

      let createdHere = 0;
      const pendingMedia = []; // { msg, jid, messageId }
      for (const chat of supportedChats) {
        const jid = chat.id;
        const msgs = byChat.get(jid) || [];
        if (!msgs.length) continue;

        const mapped = [];
        let lastStored = null;
        for (const m of msgs) {
          const stored = mapMessage(m, { instanceId });
          mapped.push(stored);
          if (!lastStored || stored.timestamp > lastStored.timestamp) lastStored = stored;
          if (isMediaMessage(m)) pendingMedia.push({ msg: m, jid, messageId: stored.id });
        }
        await bulkSaveMessages(instanceId, jid, mapped);

        for (const m of msgs) {
          if (m.pushName && !m.key?.fromMe) {
            const senderJid = m.key?.participant || m.key?.remoteJid;
            if (senderJid) {
              const cur = contactsByJid.get(senderJid) || {};
              if (!cur.notify) contactsByJid.set(senderJid, { ...cur, id: senderJid, notify: m.pushName });
            }
          }
        }
        const conv = mapChatFromBaileys({
          jid,
          chatEntry: chat,
          contact: contactsByJid.get(jid),
          instanceId,
          lastMessage: lastStored ? { ...lastStored } : undefined,
        });
        const prior = await getConversation(conv.id);
        const merged = {
          ...conv,
          customer: isPlaceholderName(prior?.customer) ? conv.customer : prior.customer,
          whatsappName: isPlaceholderName(prior?.whatsappName) ? conv.whatsappName : prior.whatsappName,
          phone: prior?.phone || conv.phone,
          avatarUrl: prior?.avatarUrl,
          lastMessage: previewFor(lastStored) || conv.lastMessage,
          lastMessageId: lastStored?.id,
          lastMessageFromMe: lastStored?.fromMe,
          lastMessageAck: lastStored?.ack ?? 0,
          lastInteraction: lastStored ? new Date(lastStored.timestamp * 1000).toISOString() : conv.lastInteraction,
        };
        const persisted = await upsertConversation(merged);
        createdHere += 1;
        historyDone += 1;
        if (!persisted.avatarUrl) scheduleAvatarFetch(client, jid, instanceId, persisted.id);
        if (historyDone % config.sync.progressEveryNChats === 0) {
          emitToInstance(io, instanceId, "instance:sync-progress", { instanceId, chatsDone: historyDone, chatsTotal: historyTotal + createdHere });
        }
      }

      if (pendingMedia.length) {
        scheduleHistoryMediaDownloads(pendingMedia);
      }

      historyTotal += createdHere;
      emitToInstance(io, instanceId, "instance:sync-progress", { instanceId, chatsDone: historyDone, chatsTotal: historyTotal });

      console.log(`${batchTag} batch persisted: chats=${createdHere} pendingMediaDownloads=${pendingMedia.length} elapsedMs=${Date.now() - batchStart} runningTotal=${historyTotal}`);

      if (isLatest) {
        await patchInstance(instanceId, {
          historySynced: true,
          lastSync: new Date().toISOString(),
          conversations: historyTotal,
          fullHistoryRequested: false,
        });
        console.log(`[${instanceId}] ===== history sync FINISHED: ${historyTotal} chats persisted (fullHistoryRequested=${fullHistory}) =====`);
      }
    } catch (err) {
      console.error(`[${instanceId}] messaging-history.set failed:`, err);
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify" && type !== "append") return;
    const inst = await getInstance(instanceId);
    const firstAt = inst?.firstConnectedAt ? new Date(inst.firstConnectedAt).getTime() : 0;
    for (const m of messages) collectJidAliasesFromMsg(m);
    for (const msg of messages) {
      try {
        const rawJid = msg.key?.remoteJid;
        const jid = canonicalJid(rawJid);
        if (!jid || jidIsUnsupported(jid)) continue;
        if (isSelfJid(jid)) continue;
        if (!isDisplayableMessage(msg)) continue;
        const ts = Number(msg.messageTimestamp) * 1000;
        if (firstAt && ts && ts < firstAt) continue;

        if (msg.pushName && !msg.key?.fromMe) {
          const senderRaw = msg.key?.participant || msg.key?.remoteJid;
          const senderJid = canonicalJid(senderRaw);
          if (senderJid) {
            const cur = contactsByJid.get(senderJid) || {};
            const next = { ...cur, id: senderJid, notify: msg.pushName };
            contactsByJid.set(senderJid, next);
          }
        }

        const mediaInfo = await downloadIfMedia(msg, sock);
        const stored = mapMessage(msg, { instanceId, ...mediaInfo });
        stored.chatId = jid;
        const added = await appendMessage(instanceId, jid, stored);
        if (!added) {
          // já persistida (provavelmente pelo send.js); sincroniza ack se mudou
          if (stored.ack > 0) {
            await updateMessageAck(instanceId, jid, stored.id, stored.ack);
            emitToInstance(io, instanceId, "message:ack", { messageId: stored.id, chatId: jid, ack: stored.ack });
            const convPrior = await getConversation(buildConversationId(instanceId, jid));
            if (convPrior && convPrior.lastMessageId === stored.id && (convPrior.lastMessageAck ?? 0) < stored.ack) {
              const updated = await upsertConversation({ ...convPrior, lastMessageAck: stored.ack });
              emitToInstance(io, instanceId, "conversation:update", { conversation: updated });
            }
          }
          continue;
        }

        const conv = mapChatFromBaileys({
          jid,
          chatEntry: chatsById.get(jid),
          contact: contactsByJid.get(jid),
          instanceId,
          lastMessage: stored,
        });
        const prior = await getConversation(buildConversationId(instanceId, jid));
        const merged = {
          ...conv,
          customer: isPlaceholderName(prior?.customer) ? conv.customer : prior.customer,
          whatsappName: isPlaceholderName(prior?.whatsappName) ? conv.whatsappName : prior.whatsappName,
          phone: prior?.phone || conv.phone,
          avatarUrl: prior?.avatarUrl,
          lastMessage: previewFor(stored),
          lastMessageId: stored.id,
          lastMessageFromMe: stored.fromMe,
          lastMessageAck: stored.ack,
          lastInteraction: new Date(stored.timestamp * 1000).toISOString(),
          unreadCount: stored.fromMe ? 0 : ((prior?.unreadCount || 0) + 1),
          unread: stored.fromMe ? false : true,
        };
        const persisted = await upsertConversation(merged);

        emitToInstance(io, instanceId, "message:new", { conversation: persisted, message: stored });
        if (!persisted.avatarUrl) scheduleAvatarFetch(client, jid, instanceId, persisted.id);
      } catch (err) {
        console.error(`[${instanceId}] messages.upsert item failed:`, err);
      }
    }
  });

  sock.ev.on("messages.update", async (updates) => {
    for (const u of updates) {
      try {
        const messageId = u.key?.id;
        const jid = u.key?.remoteJid;
        if (!messageId || !jid) continue;
        const statusRaw = u.update?.status;
        if (typeof statusRaw !== "number") continue;
        const ack = mapBaileysStatusToAck(statusRaw);
        await updateMessageAck(instanceId, jid, messageId, ack);
        emitToInstance(io, instanceId, "message:ack", { messageId, chatId: jid, ack });

        const conv = await getConversation(buildConversationId(instanceId, jid));
        if (conv && conv.lastMessageId === messageId) {
          const updated = await upsertConversation({ ...conv, lastMessageAck: ack });
          emitToInstance(io, instanceId, "conversation:update", { conversation: updated });
        }
      } catch (err) {
        console.error(`[${instanceId}] messages.update item failed:`, err);
      }
    }
  });

  return client;
}
