import { nanoid } from "nanoid";
import { getCol, collections } from "./mongo.js";

const col = () => getCol(collections.prontuarios);
const PROJ = { projection: { _id: 0 } };

const VALID_CATEGORIES = new Set(["foto", "video", "audio", "documento", "outro"]);
const VALID_SOURCES = new Set(["whatsapp", "upload"]);

function normalize(record) {
  return {
    id: record.id,
    dealId: String(record.dealId || ""),
    conversationId: record.conversationId ? String(record.conversationId) : undefined,
    messageId: record.messageId ? String(record.messageId) : undefined,
    instanceId: record.instanceId ? String(record.instanceId) : undefined,
    name: String(record.name || "Sem nome"),
    category: VALID_CATEGORIES.has(record.category) ? record.category : "outro",
    mediaUrl: String(record.mediaUrl || ""),
    mediaMime: record.mediaMime ? String(record.mediaMime) : undefined,
    fileSize: typeof record.fileSize === "number" ? record.fileSize : undefined,
    source: VALID_SOURCES.has(record.source) ? record.source : "upload",
    uploadedAt: record.uploadedAt || new Date().toISOString(),
    uploadedBy: record.uploadedBy ? String(record.uploadedBy) : undefined,
  };
}

export async function listProntuarios({ dealId } = {}) {
  const query = dealId ? { dealId } : {};
  const all = await col().find(query, PROJ).toArray();
  return all
    .filter(p => p && p.id && p.mediaUrl)
    .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
}

export async function getProntuario(id) {
  return col().findOne({ _id: id }, PROJ);
}

export async function createProntuario(record) {
  const stored = normalize({ ...record, id: record.id || nanoid() });
  if (!stored.dealId) throw new Error("dealId é obrigatório");
  if (!stored.mediaUrl) throw new Error("mediaUrl é obrigatório");
  await col().insertOne({ _id: stored.id, ...stored });
  return stored;
}

export async function updateProntuario(id, patch) {
  const existing = await getProntuario(id);
  if (!existing) return null;
  const updated = normalize({ ...existing, ...patch, id });
  await col().updateOne({ _id: id }, { $set: updated });
  return updated;
}

export async function deleteProntuario(id) {
  const res = await col().deleteOne({ _id: id });
  return res.deletedCount > 0;
}

export async function deleteProntuariosByDeal(dealId) {
  const res = await col().deleteMany({ dealId });
  return res.deletedCount || 0;
}
