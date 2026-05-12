import { nanoid } from "nanoid";
import { config } from "../config.js";
import { readJson, updateJson } from "./json-store.js";

const FILE = config.paths.prontuariosFile;

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
  const all = await readJson(FILE, []);
  const filtered = dealId ? all.filter(p => p && p.dealId === dealId) : all;
  return filtered
    .filter(p => p && p.id && p.mediaUrl)
    .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
}

export async function getProntuario(id) {
  const all = await readJson(FILE, []);
  return all.find(p => p && p.id === id) || null;
}

export async function createProntuario(record) {
  const stored = normalize({ ...record, id: record.id || nanoid() });
  if (!stored.dealId) throw new Error("dealId é obrigatório");
  if (!stored.mediaUrl) throw new Error("mediaUrl é obrigatório");
  await updateJson(FILE, [], current => [...current, stored]);
  return stored;
}

export async function updateProntuario(id, patch) {
  let updated = null;
  await updateJson(FILE, [], current => {
    const idx = current.findIndex(p => p && p.id === id);
    if (idx === -1) return current;
    updated = normalize({ ...current[idx], ...patch, id });
    const next = current.slice();
    next[idx] = updated;
    return next;
  });
  return updated;
}

export async function deleteProntuario(id) {
  let removed = false;
  await updateJson(FILE, [], current => {
    const next = current.filter(p => p && p.id !== id);
    removed = next.length !== current.length;
    return next;
  });
  return removed;
}

export async function deleteProntuariosByDeal(dealId) {
  let removedCount = 0;
  await updateJson(FILE, [], current => {
    const next = current.filter(p => p && p.dealId !== dealId);
    removedCount = current.length - next.length;
    return next;
  });
  return removedCount;
}
