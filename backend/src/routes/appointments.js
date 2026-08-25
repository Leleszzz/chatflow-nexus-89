import { Router } from "../lib/safe-router.js";
import {
  listAppointments,
  getAppointment,
  createAppointment,
  patchAppointment,
  deleteAppointment,
  deleteAppointmentsByDeal,
} from "../storage/appointments-repo.js";
import { listAllDeals, getDeal } from "../storage/deals-repo.js";
import { listUsers } from "../storage/users-repo.js";
import { canUserSeeDeal, permittedUserIds } from "../lib/deal-permissions.js";
import { requireAuth } from "../middleware/require-auth.js";
import { isAdmin } from "../lib/roles.js";
import { emitToUsers } from "../socket/events.js";

export const appointmentsRouter = Router();
appointmentsRouter.use(requireAuth());

/**
 * Quem pode receber o evento deste compromisso.
 *
 * Antes as rotas usavam `io.emit`, que transmite para TODOS os sockets
 * conectados: o `GET` filtrava por permissão com capricho e o socket entregava
 * a agenda inteira da clínica para qualquer usuário logado, desfazendo o filtro
 * na linha seguinte. `emitToUsers` já existia em socket/events.js para
 * exatamente este caso.
 */
async function destinatarios(appointment) {
  const usuarios = await listUsers();
  const ids = new Set();
  // O responsável pelo compromisso sempre sabe do próprio compromisso, mesmo
  // que o card seja de outra pessoa.
  if (appointment?.sellerId) ids.add(appointment.sellerId);
  for (const u of usuarios) if (u.active !== false && isAdmin(u)) ids.add(u.id);

  if (appointment?.dealId) {
    const deal = await getDeal(appointment.dealId);
    if (deal) for (const id of permittedUserIds(deal, usuarios)) ids.add(id);
  }
  return [...ids];
}

async function avisar(req, appointment, evento, payload) {
  const io = req.app.get("io");
  if (!io) return;
  emitToUsers(io, await destinatarios(appointment), evento, payload);
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

/**
 * Pode escrever neste compromisso?
 *
 * Esta checagem simplesmente NÃO EXISTIA: `PATCH /:id`, `DELETE /:id` e
 * `DELETE /by-deal/:dealId` aceitavam qualquer usuário autenticado. Dava para
 * remarcar a consulta de outro médico, apagar um compromisso qualquer da
 * clínica, ou limpar a agenda inteira de um paciente sabendo só o id.
 *
 * A regra segue a do card (o mesmo padrão de routes/deals.js): admin pode
 * tudo, o responsável pelo próprio compromisso pode, e quem enxerga o lead
 * pode. Compromisso órfão (sem lead) fica com o responsável e o admin.
 */
async function podeEscrever(user, appointment) {
  if (!appointment) return false;
  if (isAdmin(user)) return true;
  if (appointment.sellerId && appointment.sellerId === user.id) return true;
  if (!appointment.dealId) return false;
  const deal = await getDeal(appointment.dealId);
  if (!deal) return false;
  return canUserSeeDeal(user, deal);
}

appointmentsRouter.get("/", async (req, res) => {
  const [all, canSee] = await Promise.all([listAppointments(), visibilityFilter(req.user)]);
  res.json(all.filter(canSee));
});

appointmentsRouter.post("/", async (req, res) => {
  const body = { ...(req.body || {}) };
  // O criador não escolhe livremente para qual card o compromisso aponta: só
  // pode agendar em cliente que ele mesmo enxerga.
  if (body.dealId) {
    const deal = await getDeal(String(body.dealId));
    if (!deal) return res.status(404).json({ error: "cliente não encontrado" });
    if (!canUserSeeDeal(req.user, deal)) {
      return res.status(403).json({ error: "sem permissão para este cliente" });
    }
  }
  // Sem card para ancorar a permissão, o compromisso é do próprio usuário —
  // só o admin agenda em nome de outra pessoa.
  if (!body.dealId && body.sellerId && body.sellerId !== req.user.id && !isAdmin(req.user)) {
    return res.status(403).json({ error: "sem permissão para agendar em nome de outro usuário" });
  }
  if (!body.sellerId) body.sellerId = req.user.id;

  const created = await createAppointment(body);
  await avisar(req, created, "appointment:update", { appointment: created });
  res.status(201).json(created);
});

appointmentsRouter.patch("/:id", async (req, res) => {
  const atual = await getAppointment(req.params.id);
  if (!atual) return res.status(404).json({ error: "compromisso não encontrado" });
  if (!(await podeEscrever(req.user, atual))) {
    return res.status(403).json({ error: "sem permissão para este compromisso" });
  }

  const patch = { ...(req.body || {}) };
  delete patch.id;
  // Mover o compromisso para outro card exige permissão no card de DESTINO
  // também — senão daria para "adotar" o compromisso de outra pessoa.
  if (patch.dealId && patch.dealId !== atual.dealId) {
    const destino = await getDeal(String(patch.dealId));
    if (!destino) return res.status(404).json({ error: "cliente de destino não encontrado" });
    if (!canUserSeeDeal(req.user, destino)) {
      return res.status(403).json({ error: "sem permissão para o cliente de destino" });
    }
  }

  const updated = await patchAppointment(req.params.id, patch);
  if (!updated) return res.status(404).json({ error: "compromisso não encontrado" });
  // Avisa a união de antes e depois: quem perdeu acesso precisa ver o
  // compromisso sumir da tela dele.
  await avisar(req, atual, "appointment:update", { appointment: updated });
  await avisar(req, updated, "appointment:update", { appointment: updated });
  res.json(updated);
});

appointmentsRouter.delete("/:id", async (req, res) => {
  const prior = await getAppointment(req.params.id);
  if (!prior) return res.status(404).json({ error: "compromisso não encontrado" });
  if (!(await podeEscrever(req.user, prior))) {
    return res.status(403).json({ error: "sem permissão para este compromisso" });
  }
  const removed = await deleteAppointment(req.params.id);
  if (!removed) return res.status(404).json({ error: "compromisso não encontrado" });
  await avisar(req, prior, "appointment:delete", { appointmentId: prior.id || req.params.id });
  res.json({ ok: true });
});

// Cascade chamado quando o card é excluído.
appointmentsRouter.delete("/by-deal/:dealId", async (req, res) => {
  const deal = await getDeal(req.params.dealId);
  // Card já excluído: sem nada para ancorar a permissão, só admin limpa o resto.
  if (deal ? !canUserSeeDeal(req.user, deal) : !isAdmin(req.user)) {
    return res.status(403).json({ error: "sem permissão para este cliente" });
  }
  const removed = await deleteAppointmentsByDeal(req.params.dealId);
  const io = req.app.get("io");
  if (io && removed) {
    const usuarios = await listUsers();
    const alcance = deal
      ? permittedUserIds(deal, usuarios)
      : usuarios.filter(u => isAdmin(u)).map(u => u.id);
    emitToUsers(io, alcance, "appointment:wipe", { dealId: req.params.dealId });
  }
  res.json({ ok: true, removed });
});
