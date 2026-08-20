import { Router } from "express";
import {
  listAllDeals,
  getDeal,
  upsertDeal,
  patchDeal,
  deleteDeal,
} from "../storage/deals-repo.js";
import { deleteAppointmentsByDeal } from "../storage/appointments-repo.js";
import { deleteOutcomesByDeal } from "../storage/deal-outcomes-repo.js";
import { canUserSeeDeal } from "../lib/deal-permissions.js";
import { emitDealEvent } from "../socket/events.js";
import { requireAuth } from "../middleware/require-auth.js";

export const dealsRouter = Router();

// Lista apenas os deals visíveis ao usuário autenticado (filtro no servidor).
dealsRouter.get("/", requireAuth(), async (req, res) => {
  try {
    const all = await listAllDeals();
    res.json(all.filter(deal => canUserSeeDeal(req.user, deal)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cria/atualiza um deal por completo (id vem do cliente).
dealsRouter.post("/", requireAuth(), async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.id) return res.status(400).json({ error: "id é obrigatório" });
    const deal = await upsertDeal(body);
    emitDealEvent(req.app.get("io"), "deal:new", deal);
    res.status(201).json(deal);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Patch parcial (cobre mover de etapa, finalizar venda, editar campos).
dealsRouter.patch("/:id", requireAuth(), async (req, res) => {
  try {
    const prior = await getDeal(req.params.id);
    if (!prior) return res.status(404).json({ error: "deal não encontrado" });
    const patch = { ...(req.body || {}) };
    delete patch.id;
    const updated = await patchDeal(req.params.id, patch);
    // Inclui o estado anterior para alcançar quem deixou de ter acesso (ex.: troca de responsável).
    emitDealEvent(req.app.get("io"), "deal:update", updated, prior);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

dealsRouter.delete("/:id", requireAuth(), async (req, res) => {
  try {
    const prior = await getDeal(req.params.id);
    const removed = await deleteDeal(req.params.id);
    if (!removed) return res.status(404).json({ error: "deal não encontrado" });
    // Cascade no servidor (e não no cliente): agenda e fechamentos do card somem
    // junto para todo mundo, não só para quem clicou em excluir.
    const io = req.app.get("io");
    const [compromissos] = await Promise.all([
      deleteAppointmentsByDeal(req.params.id),
      deleteOutcomesByDeal(req.params.id),
    ]);
    if (io && compromissos) io.emit("appointment:wipe", { dealId: req.params.id });
    if (prior) emitDealEvent(io, "deal:delete", prior);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
