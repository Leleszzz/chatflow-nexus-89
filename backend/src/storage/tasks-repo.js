import { nanoid } from "nanoid";
import { getCol, collections } from "./mongo.js";

const col = () => getCol(collections.tasks);
const PROJ = { projection: { _id: 0 } };

const VALID_STATUS = new Set(["aberta", "concluida", "cancelada"]);
const VALID_ORIGENS = new Set(["consulta", "conversa", "kanban", "manual"]);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ITENS = 30;

const texto = (valor, max = 2000) => String(valor ?? "").trim().slice(0, max);

/**
 * Checklist da tarefa — é aqui que moram os exames a cobrar.
 *
 * Item sem texto sai fora: caixa de marcar vazia não diz à secretária o que
 * fazer. Duplicata some (ignorando caixa) porque a lista costuma vir da
 * transcrição, onde o mesmo exame aparece falado duas vezes.
 */
function normalizeItens(raw) {
  if (!Array.isArray(raw)) return [];
  const vistos = new Set();
  const saida = [];
  for (const item of raw) {
    // Aceita tanto a forma completa quanto uma string solta, que é como o
    // diálogo de criação manda a lista digitada.
    const label = texto(typeof item === "string" ? item : item?.texto, 200);
    if (!label) continue;
    const chave = label.toLowerCase();
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    saida.push({ texto: label, feito: Boolean(typeof item === "object" && item?.feito) });
    if (saida.length >= MAX_ITENS) break;
  }
  return saida;
}

// Descarta em silêncio qualquer campo fora desta lista — mesmo contrato de
// appointments-repo.js e consultations-repo.js.
export function normalizeTask(record) {
  const status = VALID_STATUS.has(record?.status) ? record.status : "aberta";
  return {
    id: String(record?.id || `tk-${nanoid(8)}`),
    titulo: texto(record?.titulo, 200),
    descricao: texto(record?.descricao),
    dealId: String(record?.dealId || ""),
    consultationId: String(record?.consultationId || ""),
    assigneeId: String(record?.assigneeId || ""),
    status,
    // Prazo fora do formato vira vazio em vez de virar uma data qualquer: uma
    // tarefa sem prazo é honesta, uma com prazo errado aparece vencida em
    // vermelho sem motivo.
    prazo: ISO_DATE.test(record?.prazo) ? record.prazo : "",
    itens: normalizeItens(record?.itens),
    mensagemSugerida: texto(record?.mensagemSugerida),
    origem: VALID_ORIGENS.has(record?.origem) ? record.origem : "manual",
    criadoPor: String(record?.criadoPor || ""),
    criadoEm: record?.criadoEm || new Date().toISOString(),
    atualizadoEm: new Date().toISOString(),
    // Só faz sentido em tarefa fechada. Reabrir limpa os dois, senão a tela
    // mostraria "concluída por Ana" numa tarefa que voltou para a fila.
    concluidaEm: status === "aberta" ? "" : (record?.concluidaEm || new Date().toISOString()),
    concluidaPor: status === "aberta" ? "" : String(record?.concluidaPor || ""),
  };
}

export function validateTask(task) {
  if (!task.titulo) return "título é obrigatório";
  return null;
}

export async function listTasks({ status, assigneeId, dealId } = {}) {
  const query = {};
  if (status) query.status = status;
  if (assigneeId) query.assigneeId = assigneeId;
  if (dealId) query.dealId = String(dealId);
  const all = await col().find(query, PROJ).toArray();
  return all
    .map(normalizeTask)
    // Aberta primeiro, e dentro de cada grupo a mais recente no topo: a fila da
    // secretária é lida de cima para baixo.
    .sort((a, b) => {
      if ((a.status === "aberta") !== (b.status === "aberta")) return a.status === "aberta" ? -1 : 1;
      return String(b.criadoEm).localeCompare(String(a.criadoEm));
    });
}

export async function getTask(id) {
  const found = await col().findOne({ _id: id }, PROJ);
  return found ? normalizeTask(found) : null;
}

export async function createTask(record) {
  const task = normalizeTask(record);
  const invalid = validateTask(task);
  if (invalid) throw new Error(invalid);
  await col().updateOne({ _id: task.id }, { $set: task }, { upsert: true });
  return task;
}

export async function patchTask(id, patch) {
  const existing = await getTask(id);
  if (!existing) return null;
  const updated = normalizeTask({ ...existing, ...patch, id });
  const invalid = validateTask(updated);
  if (invalid) throw new Error(invalid);
  await col().updateOne({ _id: id }, { $set: updated });
  return updated;
}

export async function deleteTask(id) {
  const res = await col().deleteOne({ _id: id });
  return res.deletedCount > 0;
}

// Cascade ao excluir um card, como deleteAppointmentsByDeal. Devolve as tarefas
// afetadas para o caller emitir os eventos de socket.
export async function deleteTasksByDeal(dealId) {
  if (!dealId) return [];
  const afetadas = await col().find({ dealId: String(dealId) }, PROJ).toArray();
  if (afetadas.length) await col().deleteMany({ dealId: String(dealId) });
  return afetadas.map(normalizeTask);
}
