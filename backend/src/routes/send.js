import { Router } from "express";
import multer from "multer";
import fs from "node:fs/promises";
import { getClient } from "../whatsapp/instance-manager.js";
import { saveMedia } from "../storage/media-repo.js";
import { appendMessage, nextOutgoingTimestamp } from "../storage/messages-repo.js";
import { upsertConversation, getConversation } from "../storage/conversations-repo.js";
import { mapChatFromBaileys, mapBaileysStatusToAck, buildConversationId, previewFor } from "../whatsapp/message-mapper.js";
import { emitToInstance } from "../socket/events.js";
import { convertToOggOpus, isOggOpus } from "../whatsapp/audio-convert.js";

const upload = multer({ dest: "data/uploads", limits: { fileSize: 25 * 1024 * 1024 } });

function typeForOutgoing(kind) {
  if (kind === "audio") return "ptt";
  if (kind === "image") return "image";
  if (kind === "video") return "video";
  if (kind === "document") return "document";
  return "chat";
}

export const sendRouter = Router();

sendRouter.post("/:id/send", upload.single("file"), async (req, res) => {
  const instanceId = req.params.id;
  const client = getClient(instanceId);
  if (!client) return res.status(404).json({ error: "instância não conectada" });

  const chatId = String(req.body?.chatId || "").trim();
  const type = String(req.body?.type || "text").trim();
  const body = String(req.body?.body || "");

  if (!chatId) return res.status(400).json({ error: "chatId é obrigatório" });

  try {
    let result;
    let savedLocal = null;
    if (type === "text") {
      if (!body) return res.status(400).json({ error: "body é obrigatório para text" });
      result = await client.sendMessage(chatId, { text: body });
    } else if (type === "image" || type === "audio" || type === "document" || type === "video") {
      if (!req.file) return res.status(400).json({ error: "file é obrigatório" });
      let buffer = await fs.readFile(req.file.path);
      let mimeType = req.file.mimetype || "application/octet-stream";
      let filename = req.file.originalname || undefined;

      if (type === "audio" && !isOggOpus(mimeType)) {
        try {
          const converted = await convertToOggOpus(req.file.path);
          buffer = converted.buffer;
          mimeType = converted.mimeType;
          filename = (filename ? filename.replace(/\.[^.]+$/, "") : "audio") + ".ogg";
        } catch (err) {
          console.warn("[send] audio convert failed, sending original:", err.message);
        }
      }

      savedLocal = await saveMedia(buffer, mimeType);

      let payload;
      if (type === "image") {
        payload = { image: buffer, mimetype: mimeType };
        if (body) payload.caption = body;
      } else if (type === "audio") {
        payload = { audio: buffer, ptt: true, mimetype: "audio/ogg; codecs=opus" };
      } else if (type === "video") {
        payload = { video: buffer, mimetype: mimeType };
        if (body) payload.caption = body;
      } else if (type === "document") {
        payload = { document: buffer, mimetype: mimeType, fileName: filename };
        if (body) payload.caption = body;
      }
      result = await client.sendMessage(chatId, payload);
    } else {
      return res.status(400).json({ error: `tipo desconhecido: ${type}` });
    }

    const messageId = result?.key?.id || null;
    const baileysTs = Number(result?.messageTimestamp);
    const timestamp = await nextOutgoingTimestamp(instanceId, chatId, baileysTs);
    const initialAck = mapBaileysStatusToAck(result?.status);

    if (messageId) {
      const stored = {
        id: messageId,
        chatId,
        instanceId,
        fromMe: true,
        author: "",
        type: type === "text" ? "chat" : typeForOutgoing(type),
        body: type === "text" ? body : (body || ""),
        timestamp,
        mediaUrl: savedLocal?.url,
        mediaMime: savedLocal?.mimeType,
        ack: initialAck,
      };
      await appendMessage(instanceId, chatId, stored);

      try {
        const chatEntry = client.getChatById ? client.getChatById(chatId) : null;
        const conv = mapChatFromBaileys({
          jid: chatId,
          chatEntry,
          contact: null,
          instanceId,
          lastMessage: stored,
        });
        const prior = await getConversation(buildConversationId(instanceId, chatId));
        const merged = {
          ...conv,
          customer: prior?.customer || conv.customer,
          whatsappName: prior?.whatsappName || conv.whatsappName,
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
        emitToInstance(req.app.get("io"), instanceId, "message:new", { conversation: persisted, message: stored });
      } catch (err) {
        console.warn(`[send] could not enrich conversation: ${err.message}`);
      }
    }

    res.json({ ok: true, messageId, timestamp });
  } catch (err) {
    console.error("[send] failed:", err);
    res.status(500).json({ error: err.message });
  } finally {
    if (req.file) {
      fs.unlink(req.file.path).catch(() => {});
    }
  }
});
