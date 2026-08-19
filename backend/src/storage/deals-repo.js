import { nanoid } from "nanoid";
import { getCol, collections } from "./mongo.js";

const col = () => getCol(collections.deals);
const PROJ = { projection: { _id: 0 } };

const VALID_TEMPS = new Set(["quente", "morno", "frio"]);

// Valores dos campos personalizados, chaveados pela `key` da definição
// (custom-fields-repo). Só string/number passam: a tipagem forte é aplicada por
// coerceFieldValue antes de chegar aqui, então este é o último filtro.
function sanitizeCustomFields(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === null || value === undefined || value === "") continue;
    if (typeof value === "number") {
      if (Number.isFinite(value)) out[String(key)] = value;
      continue;
    }
    out[String(key)] = String(value);
  }
  return out;
}

// Normaliza para o mesmo shape do tipo Deal do front (src/lib/mock-data.ts).
function normalize(record) {
  return {
    id: String(record.id),
    customer: String(record.customer || ""),
    phone: String(record.phone || ""),
    avatar: record.avatar ? String(record.avatar) : undefined,
    lastMessage: String(record.lastMessage || ""),
    interest: record.interest ? String(record.interest) : undefined,
    lastInteraction: record.lastInteraction || new Date().toISOString(),
    sellerId: String(record.sellerId || ""),
    assignedSellerIds: Array.isArray(record.assignedSellerIds) ? record.assignedSellerIds.map(String) : [],
    temperature: VALID_TEMPS.has(record.temperature) ? record.temperature : "morno",
    tags: Array.isArray(record.tags) ? record.tags.map(String) : [],
    unread: Boolean(record.unread),
    estimatedValue: typeof record.estimatedValue === "number" ? record.estimatedValue : undefined,
    stage: String(record.stage || ""),
    notes: record.notes ? String(record.notes) : undefined,
    aiEnabled: record.aiEnabled ?? undefined,
    aiAgentId: record.aiAgentId ? String(record.aiAgentId) : undefined,
    customFields: sanitizeCustomFields(record.customFields),
  };
}

export async function listAllDeals() {
  const all = await col().find({}, PROJ).toArray();
  return all
    .filter(d => d && d.id)
    .sort((a, b) => new Date(b.lastInteraction) - new Date(a.lastInteraction));
}

export async function getDeal(id) {
  return col().findOne({ _id: id }, PROJ);
}

// Cria ou atualiza por completo (id vem do cliente). Usado pelo POST.
export async function upsertDeal(record) {
  const stored = normalize({ ...record, id: record.id || `d${Date.now()}-${nanoid(6)}` });
  await col().updateOne({ _id: stored.id }, { $set: { ...stored } }, { upsert: true });
  return stored;
}

// Aplica um patch parcial sobre o deal existente. Retorna o deal atualizado ou null.
export async function patchDeal(id, patch) {
  const existing = await getDeal(id);
  if (!existing) return null;
  // customFields é MESCLADO, não substituído: quem edita um campo só manda
  // aquele campo, e um patch raso apagaria todos os outros valores coletados.
  // Para limpar um campo, mande-o como null/"" — sanitizeCustomFields descarta.
  const customFields = patch && "customFields" in patch
    ? { ...(existing.customFields || {}), ...(patch.customFields || {}) }
    : existing.customFields;
  const updated = normalize({ ...existing, ...patch, customFields, id });
  await col().updateOne({ _id: id }, { $set: updated });
  return updated;
}

export async function deleteDeal(id) {
  const res = await col().deleteOne({ _id: id });
  return res.deletedCount > 0;
}

// Move todos os deals de uma etapa para outra (usado ao remover uma etapa).
// Retorna os deals afetados (já atualizados) para emissão de eventos.
export async function reassignStage(fromStageId, toStageId) {
  const affected = await col().find({ stage: fromStageId }, PROJ).toArray();
  if (affected.length) {
    await col().updateMany({ stage: fromStageId }, { $set: { stage: toStageId } });
  }
  return affected.map(d => ({ ...normalize(d), stage: toStageId }));
}
