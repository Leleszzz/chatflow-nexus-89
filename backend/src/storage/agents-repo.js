import fs from "node:fs/promises";
import { nanoid } from "nanoid";
import { config } from "../config.js";
import { getCol, collections } from "./mongo.js";

const col = () => getCol(collections.agents);
const PROJ = { projection: { _id: 0 } };

// Semente na árvore do frontend, por herança do scaffold — mesma convenção do
// usersSeedFile. Só é lida quando a coleção está vazia.
const SEED_FILE = config.paths.agentsSeedFile;

const VALID_MODELS = new Set(["econom", "balanced", "premium"]);

let seedPromise = null;

async function ensureSeed() {
  if (seedPromise) return seedPromise;
  seedPromise = (async () => {
    const count = await col().countDocuments();
    if (count > 0) return;
    try {
      const seed = JSON.parse(await fs.readFile(SEED_FILE, "utf8"));
      if (Array.isArray(seed) && seed.length) {
        const docs = seed.map(a => { const n = normalize(a); return { _id: n.id, ...n }; });
        await col().insertMany(docs, { ordered: false });
        console.log(`[agents-repo] semeado a partir de ${SEED_FILE}`);
      }
    } catch (err) {
      console.warn(`[agents-repo] semente falhou (${err.message}); começando sem agentes`);
    }
  })();
  return seedPromise;
}

// Mesmo shape do tipo Agent do front (src/lib/mock-data.ts).
function normalize(record) {
  return {
    id: String(record.id || `a${Date.now()}-${nanoid(4)}`),
    name: String(record.name || ""),
    description: String(record.description || ""),
    prompt: String(record.prompt || ""),
    model: VALID_MODELS.has(record.model) ? record.model : "balanced",
    temperature: Number.isFinite(Number(record.temperature)) ? Number(record.temperature) : 0.7,
    active: record.active !== false,
    conversations: Number(record.conversations) || 0,
    updatedAt: String(record.updatedAt || new Date().toISOString()),
    channel: String(record.channel || "WhatsApp Principal"),
    triggerTags: Array.isArray(record.triggerTags) ? record.triggerTags.map(String) : [],
    blockWords: Array.isArray(record.blockWords) ? record.blockWords.map(String) : [],
    handoffMessage: String(record.handoffMessage || "Vou te transferir para um especialista."),
    fallbackMessage: record.fallbackMessage ? String(record.fallbackMessage) : undefined,
    objective: record.objective ? String(record.objective) : undefined,
    tone: record.tone ? String(record.tone) : undefined,
    // Meta de coleta: `key`s de campos personalizados que este agente deve
    // extrair da conversa (custom-fields-repo).
    extractFields: Array.isArray(record.extractFields) ? record.extractFields.map(String) : [],
  };
}

export async function listAgents() {
  await ensureSeed();
  const all = await col().find({}, PROJ).toArray();
  return all.filter(a => a?.id).map(normalize);
}

export async function getAgent(id) {
  await ensureSeed();
  const found = await col().findOne({ _id: String(id) }, PROJ);
  return found ? normalize(found) : null;
}

export async function createAgent(input) {
  await ensureSeed();
  const agent = normalize({ ...input, id: `a${Date.now()}-${nanoid(4)}`, updatedAt: new Date().toISOString() });
  await col().insertOne({ _id: agent.id, ...agent });
  return agent;
}

export async function updateAgent(id, patch) {
  await ensureSeed();
  const atual = await col().findOne({ _id: String(id) }, PROJ);
  if (!atual) return null;
  const { id: _ignored, ...rest } = patch || {};
  const merged = normalize({ ...atual, ...rest, id: String(id), updatedAt: new Date().toISOString() });
  await col().updateOne({ _id: String(id) }, { $set: merged });
  return merged;
}

export async function deleteAgent(id) {
  const res = await col().deleteOne({ _id: String(id) });
  return res.deletedCount > 0;
}
