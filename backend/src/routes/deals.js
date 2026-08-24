import { Router } from "express";
import {
  listAllDeals,
  getDeal,
  upsertDeal,
  patchDeal,
  deleteDeal,
} from "../storage/deals-repo.js";
import { clearCrmDealLink } from "../storage/conversations-repo.js";
import { deleteAppointmentsByDeal } from "../storage/appointments-repo.js";
import { deleteOutcomesByDeal } from "../storage/deal-outcomes-repo.js";
import { deleteConsultationsByDeal } from "../storage/consultations-repo.js";
import { deleteProntuario } from "../storage/prontuarios-repo.js";
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
    // Este POST é um upsert: com o id de um card existente ele o sobrescreve
    // por inteiro. Sem esta checagem, bastaria usá-lo para contornar a
    // permissão do PATCH logo abaixo. Id novo não tem `existente` e passa
    // direto — é o caminho normal de criação.
    const existente = await getDeal(body.id);
    if (existente && !canUserSeeDeal(req.user, existente)) {
      return res.status(403).json({ error: "sem permissão para este card" });
    }
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
    // Só o GET filtrava por permissão: quem soubesse o id de um card de outro
    // vendedor conseguia editá-lo — inclusive reatribuir o responsável para si.
    if (!canUserSeeDeal(req.user, prior)) {
      return res.status(403).json({ error: "sem permissão para este card" });
    }
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
    if (!prior) return res.status(404).json({ error: "deal não encontrado" });
    // Checagem ANTES do delete: a exclusão arrasta agenda, fechamentos,
    // consultas e prontuários junto, e não há como desfazer.
    if (!canUserSeeDeal(req.user, prior)) {
      return res.status(403).json({ error: "sem permissão para este card" });
    }
    const removed = await deleteDeal(req.params.id);
    if (!removed) return res.status(404).json({ error: "deal não encontrado" });
    // Cascade no servidor (e não no cliente): agenda e fechamentos do card somem
    // junto para todo mundo, não só para quem clicou em excluir.
    const io = req.app.get("io");
    const [compromissos, , desvinculadas, consultas] = await Promise.all([
      deleteAppointmentsByDeal(req.params.id),
      deleteOutcomesByDeal(req.params.id),
      // Solta a conversa que apontava para este card, senão ela ficaria presa a
      // um id morto e sem como criar um card novo.
      clearCrmDealLink(req.params.id),
      deleteConsultationsByDeal(req.params.id),
    ]);
    // O anexo espelho de cada consulta some junto — o prontuário do cliente
    // inteiro é apagado pelo cliente logo em seguida, mas quem chama a API
    // direto não pode ficar com áudio órfão apontando para um card morto.
    await Promise.all(
      consultas.filter(c => c.prontuarioId).map(c => deleteProntuario(c.prontuarioId).catch(() => {})),
    );
    if (io && compromissos) io.emit("appointment:wipe", { dealId: req.params.id });
    for (const conversa of desvinculadas) {
      if (io) io.to(`instance:${conversa.instanceId}`).emit("conversation:update", { conversation: conversa });
    }
    if (prior) emitDealEvent(io, "deal:delete", prior);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
