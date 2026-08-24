import { Router } from "express";
import multer from "multer";
import fs from "node:fs/promises";
import { connectionManager } from "../whatsapp/ConnectionManager.js";
import { saveMedia } from "../storage/media-repo.js";
import { finalizeOutgoingMessage } from "../whatsapp/outgoing.js";
import { convertToOggOpus, isOggOpus } from "../whatsapp/audio-convert.js";
import { cancelDueToAgentReply } from "../storage/scheduled-messages-repo.js";
import { emitToInstance } from "../socket/events.js";
import { requireAuth } from "../middleware/require-auth.js";
import { requireInstanceAccess } from "../middleware/instance-access.js";

const upload = multer({ dest: "data/uploads", limits: { fileSize: 25 * 1024 * 1024 } });

function typeForOutgoing(kind) {
  if (kind === "image") return "image";
  if (kind === "video") return "video";
  if (kind === "document") return "document";
  return "chat";
}

export const sendRouter = Router();

// Auth e permissão da instância ANTES do multer: requisição sem acesso não
// grava arquivo em disco. É este gate que deixa o doutor enviar pela instância
// da secretária (liberada em /usuarios) e impede o caminho inverso.
sendRouter.post("/:id/send", requireAuth(), requireInstanceAccess(), upload.single("file"), async (req, res) => {
  const instanceId = req.params.id;
  const client = connectionManager.get(instanceId);
  if (!client) return res.status(404).json({ error: "instância não conectada" });

  const chatId = String(req.body?.chatId || "").trim();
  const type = String(req.body?.type || "text").trim();
  const body = String(req.body?.body || "");

  if (!chatId) return res.status(400).json({ error: "chatId é obrigatório" });

  try {
    let result;
    let savedLocal = null;
    let isVoiceNote = false; // áudio como nota de voz (ptt) vs arquivo de áudio comum
    if (type === "text") {
      if (!body) return res.status(400).json({ error: "body é obrigatório para text" });
      result = await client.sendMessage(chatId, { text: body });
    } else if (type === "image" || type === "audio" || type === "document" || type === "video") {
      if (!req.file) return res.status(400).json({ error: "file é obrigatório" });
      let buffer = await fs.readFile(req.file.path);
      let mimeType = req.file.mimetype || "application/octet-stream";
      let filename = req.file.originalname || undefined;

      if (type === "audio") {
        isVoiceNote = isOggOpus(mimeType);
        if (!isVoiceNote) {
          try {
            const converted = await convertToOggOpus(req.file.path);
            buffer = converted.buffer;
            mimeType = converted.mimeType;
            filename = (filename ? filename.replace(/\.[^.]+$/, "") : "audio") + ".ogg";
            isVoiceNote = true;
          } catch (err) {
            // Sem conversão: envia o buffer original como áudio comum com o mime
            // verdadeiro — rotular como ogg/ptt geraria nota de voz que não toca.
            console.warn("[send] audio convert failed, sending original as regular audio:", err.message);
          }
        }
      }

      savedLocal = await saveMedia(buffer, mimeType);

      let payload;
      if (type === "image") {
        payload = { image: buffer, mimetype: mimeType };
        if (body) payload.caption = body;
      } else if (type === "audio") {
        payload = isVoiceNote
          ? { audio: buffer, ptt: true, mimetype: "audio/ogg; codecs=opus" }
          : { audio: buffer, ptt: false, mimetype: mimeType };
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

    const { messageId, timestamp } = await finalizeOutgoingMessage({
      io: req.app.get("io"),
      client,
      instanceId,
      chatId,
      result,
      logLabel: "send",
      message: {
        type: type === "audio" ? (isVoiceNote ? "ptt" : "audio") : typeForOutgoing(type),
        body: type === "text" ? body : (body || ""),
        mediaUrl: savedLocal?.url,
        mediaMime: savedLocal?.mimeType,
      },
    });

    try {
      const cancelled = await cancelDueToAgentReply(instanceId, chatId);
      for (const sch of cancelled) emitToInstance(req.app.get("io"), instanceId, "scheduled:update", { scheduled: sch });
    } catch (cancelErr) {
      console.warn("[send] cancel scheduled on agent reply failed:", cancelErr.message);
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
