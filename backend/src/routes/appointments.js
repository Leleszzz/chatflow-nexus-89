import { Router } from "express";
import {
  listAppointments,
  getAppointment,
  createAppointment,
  patchAppointment,
  deleteAppointment,
  deleteAppointmentsByDeal,
} from "../storage/appointments-repo.js";
import { listAllDeals } from "../storage/deals-repo.js";
import { canUserSeeDeal } from "../lib/deal-permissions.js";
import { requireAuth } from "../middleware/require-auth.js";

export const appointmentsRouter = Router();

function broadcast(req, event, payload) {
  const io = req.app.get("io");
  if (io) io.emit(event, payload);
}

// Um compromisso é visível a quem enxerga o lead dele — ou a quem é o
// responsável pelo compromisso, que pode ser diferente do dono do card.
async function visibilityFilter(user) {
  const deals = await listAllDeals();
  const visibleDealIds = new Set(deals.filter(d => canUserSeeDeal(user, d)).map(d => d.id));
  return appointment =>
    appointment.sellerId === user.id
    || visibleDealIds.has(appointment.dealId)
    // Compromisso sem lead vinculado não tem como ser filtrado por permissão de
    // card; fica visível para quem é dono e para quem vê tudo.
    || (!appointment.dealId && canUserSeeDeal(user, { sellerId: appointment.sellerId, tags: [] }));
}

appointmentsRouter.get("/", requireAuth(), async (req, res) => {
  try {
    const [all, canSee] = await Promise.all([listAppointments(), visibilityFilter(req.user)]);
    res.json(all.filter(canSee));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

appointmentsRouter.post("/", requireAuth(), async (req, res) => {
  try {
    const created = await createAppointment(req.body || {});
    broadcast(req, "appointment:update", { appointment: created });
    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

appointmentsRouter.patch("/:id", requireAuth(), async (req, res) => {
  try {
    const patch = { ...(req.body || {}) };
    delete patch.id;
    const updated = await patchAppointment(req.params.id, patch);
    if (!updated) return res.status(404).json({ error: "compromisso não encontrado" });
    broadcast(req, "appointment:update", { appointment: updated });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

appointmentsRouter.delete("/:id", requireAuth(), async (req, res) => {
  try {
    const prior = await getAppointment(req.params.id);
    const removed = await deleteAppointment(req.params.id);
    if (!removed) return res.status(404).json({ error: "compromisso não encontrado" });
    broadcast(req, "appointment:delete", { appointmentId: prior?.id || req.params.id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cascade chamado quando o card é excluído.
appointmentsRouter.delete("/by-deal/:dealId", requireAuth(), async (req, res) => {
  try {
    const removed = await deleteAppointmentsByDeal(req.params.dealId);
    broadcast(req, "appointment:wipe", { dealId: req.params.dealId });
    res.json({ ok: true, removed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
