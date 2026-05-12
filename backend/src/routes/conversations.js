import { Router } from "express";
import { listConversations, getConversation, upsertConversation } from "../storage/conversations-repo.js";
import { listMessages } from "../storage/messages-repo.js";
import { buildConversationId, formatPhone } from "../whatsapp/message-mapper.js";

export const conversationsRouter = Router();

function chatIdFromPhone(phone) {
  const raw = String(phone || "").trim();
  if (raw.endsWith("@s.whatsapp.net")) return raw;
  const digits = raw.replace(/\D/g, "");
  if (!/^\d{8,15}$/.test(digits)) return "";
  return `${digits}@s.whatsapp.net`;
}

conversationsRouter.get("/", async (req, res) => {
  const { instanceId, limit, offset } = req.query;
  const items = await listConversations({
    instanceId: instanceId ? String(instanceId) : undefined,
    limit: limit ? Number(limit) : undefined,
    offset: offset ? Number(offset) : 0,
  });
  res.json(items);
});

conversationsRouter.get("/:id", async (req, res) => {
  const conv = await getConversation(req.params.id);
  if (!conv) return res.status(404).json({ error: "conversa não encontrada" });
  res.json(conv);
});

conversationsRouter.patch("/:id", async (req, res) => {
  const conv = await getConversation(req.params.id);
  if (!conv) return res.status(404).json({ error: "conversa não encontrada" });
  const patch = {};
  if (typeof req.body?.customer === "string") {
    const trimmed = req.body.customer.trim();
    patch.customer = trimmed || conv.whatsappName || conv.customer;
  }
  if (Object.keys(patch).length === 0) return res.json(conv);
  const updated = await upsertConversation({ ...conv, ...patch });
  const io = req.app.get("io");
  if (io) io.to(`instance:${conv.instanceId}`).emit("conversation:update", { conversation: updated });
  res.json(updated);
});

conversationsRouter.post("/start", async (req, res) => {
  const instanceId = String(req.body?.instanceId || "").trim();
  const chatId = chatIdFromPhone(req.body?.phone || req.body?.chatId);
  const name = String(req.body?.customer || req.body?.name || "").trim();
  if (!instanceId) return res.status(400).json({ error: "instanceId é obrigatório" });
  if (!chatId) return res.status(400).json({ error: "telefone inválido" });

  const id = buildConversationId(instanceId, chatId);
  const prior = await getConversation(id);
  const phone = formatPhone(chatId.split("@")[0]);
  const now = new Date().toISOString();
  const conversation = await upsertConversation({
    id,
    instanceId,
    chatId,
    customer: prior?.customer || name || phone || chatId,
    whatsappName: prior?.whatsappName || name || "",
    phone: prior?.phone || phone,
    isGroup: false,
    lastMessage: prior?.lastMessage || "",
    lastInteraction: prior?.lastInteraction || now,
    unread: prior?.unread || false,
    unreadCount: prior?.unreadCount || 0,
    avatarUrl: prior?.avatarUrl,
    lastMessageId: prior?.lastMessageId,
    lastMessageFromMe: prior?.lastMessageFromMe,
    lastMessageAck: prior?.lastMessageAck,
  });

  const io = req.app.get("io");
  if (io) io.to(`instance:${instanceId}`).emit("conversation:update", { conversation });
  res.status(prior ? 200 : 201).json(conversation);
});

conversationsRouter.post("/:id/read", async (req, res) => {
  const conv = await getConversation(req.params.id);
  if (!conv) return res.status(404).json({ error: "conversa não encontrada" });
  const next = await upsertConversation({ ...conv, unread: false, unreadCount: 0 });
  res.json(next);
});

conversationsRouter.get("/:id/messages", async (req, res) => {
  const conv = await getConversation(req.params.id);
  if (!conv) return res.status(404).json({ error: "conversa não encontrada" });
  const limit = req.query.limit ? Number(req.query.limit) : 50;
  const before = req.query.before ? Number(req.query.before) : undefined;
  const messages = await listMessages(conv.instanceId, conv.chatId, { before, limit });
  res.json(messages);
});
