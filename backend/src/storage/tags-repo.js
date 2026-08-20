import { getCol, collections } from "./mongo.js";

const col = () => getCol(collections.tags);
const PROJ = { projection: { _id: 0 } };

// Espelha src/banco-de-dados/tags.json. Semeado só quando a coleção está vazia,
// igual a stages-repo.
const DEFAULT_TAGS = [
  "Urgente",
  "Retornar hoje",
  "Cliente antigo",
  "Pedido grande",
  "Sem orçamento",
  "Aguardando pagamento",
  "Enviar proposta",
  "Pós-venda",
  "WhatsApp",
  "Instagram",
  "B2B",
  "Presencial",
];

let seedPromise = null;

async function ensureSeed() {
  if (seedPromise) return seedPromise;
  seedPromise = (async () => {
    const count = await col().countDocuments();
    if (count > 0) return;
    try {
      await col().insertMany(DEFAULT_TAGS.map((name, order) => ({ _id: name, name, order })), { ordered: false });
      console.log("[tags-repo] tags padrão semeadas");
    } catch (err) {
      console.warn(`[tags-repo] seed falhou (${err.message})`);
    }
  })();
  return seedPromise;
}

// A tag É o seu nome: ela aparece crua em Deal.tags e em user.allowedTags, então
// o _id ser o próprio texto é o que garante unicidade sem tabela de/para.
export function normalizeTagName(raw) {
  return String(raw || "").trim().replace(/\s+/g, " ");
}

export async function listTags() {
  await ensureSeed();
  const all = await col().find({}, PROJ).toArray();
  return all.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map(t => String(t.name));
}

export async function createTag(rawName) {
  await ensureSeed();
  const name = normalizeTagName(rawName);
  if (!name) throw new Error("nome da tag é obrigatório");
  if (name.length > 40) throw new Error("nome da tag é muito longo (máx. 40)");
  const existing = await col().findOne({ _id: name });
  if (existing) return listTags(); // idempotente: criar de novo não é erro
  const order = await col().countDocuments();
  await col().insertOne({ _id: name, name, order });
  return listTags();
}

export async function deleteTag(rawName) {
  await ensureSeed();
  const name = normalizeTagName(rawName);
  const res = await col().deleteOne({ _id: name });
  return { removed: res.deletedCount > 0, tags: await listTags() };
}
