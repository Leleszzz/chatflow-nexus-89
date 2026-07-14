import { getCol, collections } from "./mongo.js";
import { reassignStage } from "./deals-repo.js";

const col = () => getCol(collections.stages);
const PROJ = { projection: { _id: 0 } };

// Etapas padrão (espelham src/banco-de-dados/stages.json). `fechado`/`perdido`
// são especiais e não podem ser removidas.
const DEFAULT_STAGES = [
  { id: "novo-lead", title: "Novo lead", color: "bg-info" },
  { id: "primeiro-contato", title: "Primeiro contato", color: "bg-info" },
  { id: "em-atendimento", title: "Em atendimento", color: "bg-primary" },
  { id: "proposta-enviada", title: "Proposta enviada", color: "bg-primary" },
  { id: "negociacao", title: "Negociação", color: "bg-warning" },
  { id: "aguardando-resposta", title: "Aguardando resposta", color: "bg-warning" },
  { id: "fechado", title: "Fechado", color: "bg-success" },
  { id: "perdido", title: "Perdido", color: "bg-destructive" },
];

const PROTECTED_IDS = new Set(["fechado", "perdido"]);

let seedPromise = null;

async function ensureSeed() {
  if (seedPromise) return seedPromise;
  seedPromise = (async () => {
    const count = await col().countDocuments();
    if (count > 0) return;
    const docs = DEFAULT_STAGES.map((s, i) => ({ _id: s.id, ...s, order: i }));
    try {
      await col().insertMany(docs, { ordered: false });
      console.log("[stages-repo] etapas padrão semeadas");
    } catch (err) {
      console.warn(`[stages-repo] seed falhou (${err.message})`);
    }
  })();
  return seedPromise;
}

function normalize(stage) {
  return { id: String(stage.id), title: String(stage.title || ""), color: String(stage.color || "bg-primary") };
}

export async function listStages() {
  await ensureSeed();
  const all = await col().find({}, PROJ).toArray();
  return all.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map(normalize);
}

function slugify(title) {
  return String(title || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export async function createStage({ title, color }) {
  await ensureSeed();
  const clean = String(title || "").trim();
  if (!clean) throw new Error("título é obrigatório");
  const base = slugify(clean) || `etapa-${Date.now()}`;
  const exists = await col().findOne({ _id: base });
  const id = exists ? `${base}-${Date.now()}` : base;
  // Insere antes de fechado/perdido (no fim, mas acima dos protegidos).
  const closing = await col().findOne({ _id: "fechado" }, { projection: { order: 1 } });
  const order = closing?.order ?? (await col().countDocuments());
  // Empurra fechado/perdido para baixo.
  await col().updateMany({ order: { $gte: order } }, { $inc: { order: 1 } });
  const stage = { id, title: clean, color: color || "bg-primary", order };
  await col().insertOne({ _id: id, ...stage });
  return normalize(stage);
}

export async function updateStage(id, patch) {
  await ensureSeed();
  const set = {};
  if (typeof patch.title === "string") set.title = patch.title;
  if (typeof patch.color === "string") set.color = patch.color;
  if (Object.keys(set).length === 0) {
    const cur = await col().findOne({ _id: id }, PROJ);
    return cur ? normalize(cur) : null;
  }
  const res = await col().findOneAndUpdate({ _id: id }, { $set: set }, { returnDocument: "after", projection: { _id: 0 } });
  const updated = res?.value ?? res;
  return updated ? normalize(updated) : null;
}

export async function reorderStages(orderedIds) {
  await ensureSeed();
  if (!Array.isArray(orderedIds) || !orderedIds.length) return listStages();
  const ops = orderedIds.map((id, i) => ({
    updateOne: { filter: { _id: id }, update: { $set: { order: i } } },
  }));
  await col().bulkWrite(ops, { ordered: false });
  return listStages();
}

// Remove a etapa e reatribui os deals dela para a primeira etapa restante.
// Retorna { stages, reassigned } — reassigned são os deals movidos.
export async function removeStage(id) {
  await ensureSeed();
  if (PROTECTED_IDS.has(id)) throw new Error("Esta etapa não pode ser removida");
  const remaining = (await listStages()).filter(s => s.id !== id);
  const fallback = remaining.find(s => !PROTECTED_IDS.has(s.id))?.id || remaining[0]?.id || "novo-lead";
  const reassigned = await reassignStage(id, fallback);
  await col().deleteOne({ _id: id });
  return { stages: await listStages(), reassigned };
}
