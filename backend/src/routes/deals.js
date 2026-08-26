import { Router } from "../lib/safe-router.js";
import {
  listAllDeals,
  getDeal,
  upsertDeal,
  patchDeal,
  deleteDeal,
} from "../storage/deals-repo.js";
import { clearCrmDealLink } from "../storage/conversations-repo.js";
import { deleteAppointmentsByDeal } from "../storage/appointments-repo.js";
import { deleteTasksByDeal } from "../storage/tasks-repo.js";
import { deleteOutcomesByDeal } from "../storage/deal-outcomes-repo.js";
import { deleteConsultationsByDeal } from "../storage/consultations-repo.js";
import { deleteProntuario, deleteProntuariosByDeal } from "../storage/prontuarios-repo.js";
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
    const [compromissos, , desvinculadas, consultas, tarefas] = await Promise.all([
      deleteAppointmentsByDeal(req.params.id),
      deleteOutcomesByDeal(req.params.id),
      // Solta a conversa que apontava para este card, senão ela ficaria presa a
      // um id morto e sem como criar um card novo.
      clearCrmDealLink(req.params.id),
      deleteConsultationsByDeal(req.params.id),
      deleteTasksByDeal(req.params.id),
    ]);
    // Cascata COMPLETA aqui, e não no navegador. Antes o front chamava
    // DELETE /api/prontuarios/by-deal logo depois — o que deixava anexo órfão
    // sempre que a chamada falhasse, e passou a dar 403 quando prontuário
    // virou rota restrita a admin/doutor (a secretária também exclui card).
    // Aqui a permissão do card já foi verificada acima, então a limpeza é
    // legítima independentemente do cargo de quem apagou.
    await Promise.all(
      consultas.filter(c => c.prontuarioId).map(c => deleteProntuario(c.prontuarioId).catch(() => {})),
    );
    await deleteProntuariosByDeal(req.params.id).catch(err =>
      console.warn(`[deals] limpeza de prontuário falhou: ${err.message}`));
    if (io && compromissos) io.emit("appointment:wipe", { dealId: req.params.id });
    // A fila da secretaria não pode ficar cobrando exame de um paciente que
    // não existe mais. Um evento por tarefa, para casar com o `task:delete`
    // que a tela já escuta.
    for (const tarefa of tarefas) {
      if (io) io.emit("task:delete", { taskId: tarefa.id });
    }
    for (const conversa of desvinculadas) {
      if (io) io.to(`instance:${conversa.instanceId}`).emit("conversation:update", { conversation: conversa });
    }
    if (prior) emitDealEvent(io, "deal:delete", prior);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
