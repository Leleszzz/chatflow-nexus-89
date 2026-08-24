import { Router } from "express";
import {
  listScheduled,
  getScheduled,
  createScheduled,
  updateScheduled,
  deleteScheduled,
} from "../storage/scheduled-messages-repo.js";
import { requireAuth } from "../middleware/require-auth.js";
import { allowedInstanceIdsForRequest, userCanUseInstance } from "../middleware/instance-access.js";

export const scheduledMessagesRouter = Router();

// Este router rodava sem autenticação nenhuma: qualquer um na rede agendava
// envio de WhatsApp em qualquer instância.
scheduledMessagesRouter.use(requireAuth());

// O agendamento herda a permissão da instância em que ele vai disparar.
async function podeMexer(req, registro) {
  return userCanUseInstance(req.user, registro?.instanceId);
}

scheduledMessagesRouter.get("/", async (req, res) => {
  try {
    const items = await listScheduled({
      conversationId: req.query.conversationId ? String(req.query.conversationId) : undefined,
      instanceId: req.query.instanceId ? String(req.query.instanceId) : undefined,
      chatId: req.query.chatId ? String(req.query.chatId) : undefined,
      status: req.query.status ? String(req.query.status) : undefined,
    });
    const permitidas = await allowedInstanceIdsForRequest(req);
    res.json(permitidas === null ? items : items.filter(i => permitidas.includes(i.instanceId)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

scheduledMessagesRouter.post("/", async (req, res) => {
  try {
    const { instanceId, chatId, conversationId, body, scheduledAt } = req.body || {};
    if (!instanceId || !chatId) return res.status(400).json({ error: "instanceId e chatId são obrigatórios" });
    if (!(await userCanUseInstance(req.user, String(instanceId)))) {
      return res.status(403).json({ error: "sem acesso a esta instância" });
    }
    if (!String(body || "").trim()) return res.status(400).json({ error: "mensagem é obrigatória" });
    const when = new Date(scheduledAt);
    if (!scheduledAt || Number.isNaN(when.getTime())) return res.status(400).json({ error: "data/hora inválida" });
    if (when.getTime() < Date.now() - 60_000) return res.status(400).json({ error: "a data/hora deve ser no futuro" });

    const record = await createScheduled({
      instanceId: String(instanceId),
      chatId: String(chatId),
      conversationId: conversationId ? String(conversationId) : null,
      body: String(body).trim(),
      scheduledAt: when.toISOString(),
      cancelIfClientReplies: Boolean(req.body?.cancelIfClientReplies),
      cancelIfAgentReplies: Boolean(req.body?.cancelIfAgentReplies),
      note: req.body?.note ? String(req.body.note) : "",
      createdBy: req.user.id,
    });
    res.status(201).json(record);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

scheduledMessagesRouter.patch("/:id", async (req, res) => {
  try {
    const existing = await getScheduled(req.params.id);
    if (!existing) return res.status(404).json({ error: "agendamento não encontrado" });
    if (!(await podeMexer(req, existing))) return res.status(404).json({ error: "agendamento não encontrado" });
    if (existing.status !== "pending") return res.status(400).json({ error: "apenas agendamentos pendentes podem ser editados" });

    const patch = {};
    if (typeof req.body?.body === "string") {
      if (!req.body.body.trim()) return res.status(400).json({ error: "mensagem é obrigatória" });
      patch.body = req.body.body.trim();
    }
    if (req.body?.scheduledAt) {
      const when = new Date(req.body.scheduledAt);
      if (Number.isNaN(when.getTime())) return res.status(400).json({ error: "data/hora inválida" });
      patch.scheduledAt = when.toISOString();
    }
    if (typeof req.body?.cancelIfClientReplies === "boolean") patch.cancelIfClientReplies = req.body.cancelIfClientReplies;
    if (typeof req.body?.cancelIfAgentReplies === "boolean") patch.cancelIfAgentReplies = req.body.cancelIfAgentReplies;
    if (typeof req.body?.note === "string") patch.note = req.body.note;

    const updated = await updateScheduled(req.params.id, patch);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cancela um agendamento pendente (mantém o histórico) ou remove definitivamente.
scheduledMessagesRouter.delete("/:id", async (req, res) => {
  try {
    const existing = await getScheduled(req.params.id);
    if (!existing) return res.status(404).json({ error: "agendamento não encontrado" });
    if (!(await podeMexer(req, existing))) return res.status(404).json({ error: "agendamento não encontrado" });
    if (existing.status === "pending" && req.query.purge !== "true") {
      const updated = await updateScheduled(req.params.id, { status: "cancelled", cancelledReason: "Cancelado manualmente" });
      return res.json(updated);
    }
    await deleteScheduled(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
