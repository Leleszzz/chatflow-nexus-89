import { Router } from "../lib/safe-router.js";
import {
  listTasks, getTask, createTask, patchTask, deleteTask,
} from "../storage/tasks-repo.js";
import { getDeal } from "../storage/deals-repo.js";
import { listUsers } from "../storage/users-repo.js";
import { canUserSeeDeal, permittedUserIds } from "../lib/deal-permissions.js";
import { podeVerTarefa, podeEscreverTarefa } from "../lib/task-permissions.js";
import { requireAuth } from "../middleware/require-auth.js";
import { isAdmin, seesAllDeals } from "../lib/roles.js";
import { emitToUsers } from "../socket/events.js";

export const tasksRouter = Router();
// Os três cargos usam: o doutor delega, a secretária executa, o admin vê tudo.
tasksRouter.use(requireAuth());

// A regra em si vive em lib/task-permissions.js (pura, testada, compartilhada
// com o assistente). Aqui fica só o que ela não pode fazer: ir ao banco buscar
// o card. Evita carregar o deal quando o cargo já decide sozinho.
async function podeVer(user, task) {
  if (podeVerTarefa(user, task, null)) return true;
  if (!task.dealId) return false;
  return podeVerTarefa(user, task, await getDeal(task.dealId));
}

const podeEscrever = podeEscreverTarefa;

/**
 * Para quem o evento vai.
 *
 * Nunca `io.emit`: a fila da clínica não pode chegar a todo socket conectado.
 * Mesmo cuidado de routes/appointments.js.
 */
async function destinatarios(task) {
  const usuarios = await listUsers();
  const ids = new Set();
  for (const u of usuarios) {
    if (u.active === false) continue;
    // Admin e secretária acompanham a fila inteira.
    if (isAdmin(u) || seesAllDeals(u)) ids.add(u.id);
  }
  if (task.assigneeId) ids.add(task.assigneeId);
  if (task.criadoPor) ids.add(task.criadoPor);
  if (task.dealId) {
    const deal = await getDeal(task.dealId);
    if (deal) for (const id of permittedUserIds(deal, usuarios)) ids.add(id);
  }
  return [...ids];
}

async function avisar(req, task, evento, payload) {
  const io = req.app.get("io");
  if (!io) return;
  emitToUsers(io, await destinatarios(task), evento, payload);
}

tasksRouter.get("/", async (req, res) => {
  try {
    const todas = await listTasks({
      status: req.query.status ? String(req.query.status) : undefined,
      assigneeId: req.query.assigneeId ? String(req.query.assigneeId) : undefined,
      dealId: req.query.dealId ? String(req.query.dealId) : undefined,
    });
    const visiveis = [];
    for (const task of todas) if (await podeVer(req.user, task)) visiveis.push(task);
    res.json(visiveis);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

tasksRouter.post("/", async (req, res) => {
  try {
    const body = { ...(req.body || {}) };
    // Não dá para criar tarefa em cliente que o usuário não enxerga — mesma
    // regra do POST de appointments.
    if (body.dealId) {
      const deal = await getDeal(String(body.dealId));
      if (!deal) return res.status(404).json({ error: "cliente não encontrado" });
      if (!canUserSeeDeal(req.user, deal)) {
        return res.status(403).json({ error: "sem permissão para este cliente" });
      }
    }
    body.criadoPor = req.user.id;

    const created = await createTask(body);
    await avisar(req, created, "task:update", { task: created });
    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

tasksRouter.patch("/:id", async (req, res) => {
  try {
    const atual = await getTask(req.params.id);
    if (!atual) return res.status(404).json({ error: "tarefa não encontrada" });
    if (!(await podeVer(req.user, atual))) return res.status(404).json({ error: "tarefa não encontrada" });
    if (!podeEscrever(req.user, atual)) return res.status(403).json({ error: "sem permissão para esta tarefa" });

    const patch = { ...(req.body || {}) };
    // Campos de procedência não se reescrevem por PATCH.
    delete patch.id;
    delete patch.criadoPor;
    delete patch.criadoEm;
    // Quem fechou é quem clicou, não quem o cliente mandar no corpo.
    if (patch.status && patch.status !== "aberta" && atual.status === "aberta") {
      patch.concluidaPor = req.user.id;
      patch.concluidaEm = new Date().toISOString();
    }

    const updated = await patchTask(req.params.id, patch);
    await avisar(req, updated, "task:update", { task: updated });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

tasksRouter.delete("/:id", async (req, res) => {
  try {
    const atual = await getTask(req.params.id);
    if (!atual) return res.status(404).json({ error: "tarefa não encontrada" });
    if (!(await podeVer(req.user, atual))) return res.status(404).json({ error: "tarefa não encontrada" });
    if (!podeEscrever(req.user, atual)) return res.status(403).json({ error: "sem permissão para esta tarefa" });

    await deleteTask(req.params.id);
    // O evento sai com a tarefa antiga para alcançar quem a enxergava.
    await avisar(req, atual, "task:delete", { taskId: atual.id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
