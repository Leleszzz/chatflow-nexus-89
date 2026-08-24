import { nanoid } from "nanoid";
import { getCol, collections } from "./mongo.js";
import { renderTranscript, buildSpeakers } from "../lib/transcription/render.js";
import { normalizeSuggestions } from "../lib/transcription/suggestions.js";

const col = () => getCol(collections.consultations);
const PROJ = { projection: { _id: 0 } };

const VALID_STATUS = new Set(["processando", "pronto", "erro"]);
const VALID_ROLES = new Set(["medico", "paciente", "acompanhante", "outro"]);
const VALID_PROVIDERS = new Set(["groq", "assemblyai"]);

function normalizeSegments(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(s => ({
      speaker: String(s?.speaker || "A"),
      start: Number(s?.start) || 0,
      end: Number(s?.end) || 0,
      text: String(s?.text || "").trim(),
    }))
    .filter(s => s.text);
}

function normalizeSpeakers(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(s => s && s.key)
    .map(s => ({
      key: String(s.key),
      label: String(s.label || s.key).trim() || String(s.key),
      role: VALID_ROLES.has(s.role) ? s.role : "outro",
    }));
}

function normalizeSummary(raw) {
  if (!raw || typeof raw !== "object") return undefined;
  return {
    queixa: String(raw.queixa || ""),
    historico: String(raw.historico || ""),
    avaliacao: String(raw.avaliacao || ""),
    conduta: String(raw.conduta || ""),
    geradoEm: raw.geradoEm || new Date().toISOString(),
  };
}

// Descarta silenciosamente qualquer campo fora desta lista — mesmo contrato de
// deals-repo.js e prontuarios-repo.js.
function normalize(record) {
  const segments = normalizeSegments(record.segments);
  const speakers = normalizeSpeakers(record.speakers);
  return {
    id: record.id,
    dealId: String(record.dealId || ""),
    title: String(record.title || "Consulta"),
    recordedAt: record.recordedAt || new Date().toISOString(),
    durationSec: Number(record.durationSec) || 0,
    audioUrl: String(record.audioUrl || ""),
    audioMime: record.audioMime ? String(record.audioMime) : undefined,
    fileSize: typeof record.fileSize === "number" ? record.fileSize : undefined,
    prontuarioId: record.prontuarioId ? String(record.prontuarioId) : undefined,
    status: VALID_STATUS.has(record.status) ? record.status : "processando",
    error: record.error ? String(record.error) : undefined,
    provider: VALID_PROVIDERS.has(record.provider) ? record.provider : undefined,
    language: record.language ? String(record.language) : undefined,
    speakers,
    segments,
    transcriptText: String(record.transcriptText || ""),
    edited: Boolean(record.edited),
    summary: normalizeSummary(record.summary),
    suggestions: normalizeSuggestions(record.suggestions),
    createdBy: record.createdBy ? String(record.createdBy) : undefined,
    createdAt: record.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export async function listConsultations({ dealId } = {}) {
  const query = dealId ? { dealId } : {};
  const all = await col().find(query, PROJ).toArray();
  return all
    .filter(c => c && c.id)
    .sort((a, b) => new Date(b.recordedAt) - new Date(a.recordedAt));
}

export async function getConsultation(id) {
  return col().findOne({ _id: id }, PROJ);
}

export async function createConsultation(record) {
  const stored = normalize({ ...record, id: record.id || nanoid() });
  if (!stored.dealId) throw new Error("dealId é obrigatório");
  if (!stored.audioUrl) throw new Error("audioUrl é obrigatório");
  await col().insertOne({ _id: stored.id, ...stored });
  return stored;
}

/**
 * Patch parcial. Sempre que `segments` ou `speakers` mudam, o `transcriptText` é
 * re-renderizado a partir deles — é esse texto que os agentes de IA leem, e
 * deixá-lo desatualizado em relação aos rótulos seria pior do que não ter.
 * A exceção é a correção manual do médico, que manda `transcriptText` direto.
 */
export async function patchConsultation(id, patch) {
  const existing = await getConsultation(id);
  if (!existing) return null;

  const merged = { ...existing, ...patch, id };
  const mudouEstrutura = "segments" in patch || "speakers" in patch;
  const textoManual = typeof patch?.transcriptText === "string";

  if (mudouEstrutura) {
    const segments = normalizeSegments(merged.segments);
    // Falante novo entra na lista; rótulo já dado pelo médico é preservado.
    merged.speakers = buildSpeakers(segments, normalizeSpeakers(merged.speakers));
    merged.segments = segments;
    if (!textoManual) merged.transcriptText = renderTranscript(segments, merged.speakers);
  }

  const updated = normalize(merged);
  await col().updateOne({ _id: id }, { $set: updated });
  return updated;
}

export async function deleteConsultation(id) {
  const res = await col().deleteOne({ _id: id });
  return res.deletedCount > 0;
}

export async function deleteConsultationsByDeal(dealId) {
  const afetadas = await col().find({ dealId }, PROJ).toArray();
  if (afetadas.length) await col().deleteMany({ dealId });
  return afetadas;
}
