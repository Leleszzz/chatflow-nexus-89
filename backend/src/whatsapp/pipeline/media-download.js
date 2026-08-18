import { downloadMediaMessage } from "@whiskeysockets/baileys";
import { saveMediaFromBuffer } from "../../storage/media-repo.js";
import { extractContent, isMediaMessage } from "../message-mapper.js";

const logger = { level: "fatal", child: () => logger, error() {}, warn() {}, info() {}, debug() {}, trace() {}, fatal() {} };

// Erros "normais" de mídia que não devem poluir o log: mídia expirada/removida
// no servidor (403/404/410) ou cuja chave não é mais recuperável (comum em
// mídia do histórico) — falha de descriptografia. Nesses casos a mensagem
// simplesmente fica sem o arquivo baixável.
function isExpectedMediaError(err) {
  const msg = String(err?.message || "").toLowerCase();
  if (!msg) return false;
  return msg.includes("empty media key")
    || msg.includes("status code 403")
    || msg.includes("status code 404")
    || msg.includes("status code 410")
    || msg.includes("unsupported state or unable to authenticate data")
    || msg.includes("unable to authenticate")
    || msg.includes("failed to decrypt")
    || msg.includes("bad mac")
    || msg.includes("no matching sessions");
}

// Baixa a mídia de uma mensagem e persiste o arquivo local. Retorna {mediaUrl, mediaMime} ou {}.
export async function downloadIfMedia(msg, sock) {
  if (!isMediaMessage(msg)) return {};
  try {
    const ctx = { logger };
    if (sock?.updateMediaMessage) ctx.reuploadRequest = sock.updateMediaMessage;
    const buffer = await downloadMediaMessage(msg, "buffer", {}, ctx);
    if (!buffer || !buffer.length) return {};
    // extractContent desembrulha ephemeral/viewOnce/edited — sem ele uma
    // figurinha efêmera caía em application/octet-stream, era salva como .bin e
    // o <img> recusava o Content-Type.
    const content = extractContent(msg);
    const inner =
      content.imageMessage ||
      content.videoMessage ||
      content.audioMessage ||
      content.documentMessage ||
      content.stickerMessage;
    const mimetype = inner?.mimetype || "application/octet-stream";
    const saved = await saveMediaFromBuffer(buffer, mimetype);
    return { mediaUrl: saved.url, mediaMime: saved.mimeType };
  } catch (err) {
    if (!isExpectedMediaError(err)) {
      console.warn("[media-download] falhou:", err.message);
    }
    return {};
  }
}
