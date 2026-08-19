import { nanoid } from "nanoid";
import { getCol, collections } from "./mongo.js";

const col = () => getCol(collections.customFields);
const PROJ = { projection: { _id: 0 } };

export const FIELD_TYPES = ["texto", "numero", "data", "lista"];

// A `key` é o identificador estável usado nos valores gravados em cada lead
// (deal.customFields) e como nome da propriedade no schema que a IA preenche.
// Por isso ela é derivada do rótulo UMA vez, na criação, e nunca muda — renomear
// a key órfãaria todos os valores já coletados. O `label` é livre.
export function keyFromLabel(label) {
  const base = String(label || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return base || "CAMPO";
}

function normalize(record) {
  const type = FIELD_TYPES.includes(record?.type) ? record.type : "texto";
  return {
    id: String(record.id),
    key: String(record.key),
    label: String(record.label || ""),
    type,
    // `options` só faz sentido em "lista"; guardar em outros tipos só confunde
    // o schema entregue à IA.
    options: type === "lista" && Array.isArray(record.options)
      ? record.options.map(o => String(o).trim()).filter(Boolean)
      : [],
    required: Boolean(record.required),
    order: Number.isFinite(record.order) ? Number(record.order) : 0,
    createdAt: record.createdAt || new Date().toISOString(),
    updatedAt: record.updatedAt || new Date().toISOString(),
  };
}

export async function listCustomFields() {
  const all = await col().find({}, PROJ).sort({ order: 1, createdAt: 1 }).toArray();
  return all.filter(f => f?.id && f?.key).map(normalize);
}

async function uniqueKey(desired) {
  const existentes = new Set((await listCustomFields()).map(f => f.key));
  if (!existentes.has(desired)) return desired;
  for (let i = 2; i < 100; i += 1) {
    const candidato = `${desired}_${i}`;
    if (!existentes.has(candidato)) return candidato;
  }
  return `${desired}_${nanoid(4).toUpperCase()}`;
}

export async function createCustomField({ label, type, options, required }) {
  const total = await col().countDocuments();
  const field = normalize({
    id: `cf-${nanoid(8)}`,
    key: await uniqueKey(keyFromLabel(label)),
    label,
    type,
    options,
    required,
    order: total,
  });
  await col().insertOne({ _id: field.id, ...field });
  return field;
}

// A `key` nunca entra no patch de propósito (ver comentário no topo).
export async function updateCustomField(id, patch) {
  const atual = await col().findOne({ _id: id }, PROJ);
  if (!atual) return null;
  const merged = normalize({
    ...atual,
    ...(typeof patch.label === "string" ? { label: patch.label } : {}),
    ...(FIELD_TYPES.includes(patch.type) ? { type: patch.type } : {}),
    ...(Array.isArray(patch.options) ? { options: patch.options } : {}),
    ...(typeof patch.required === "boolean" ? { required: patch.required } : {}),
    id,
    key: atual.key,
    updatedAt: new Date().toISOString(),
  });
  await col().updateOne({ _id: id }, { $set: merged });
  return merged;
}

// Remover a definição NÃO apaga os valores já gravados nos leads: eles apenas
// param de ser exibidos. Assim, recriar um campo com a mesma key recupera o
// histórico em vez de destruí-lo.
export async function deleteCustomField(id) {
  const res = await col().deleteOne({ _id: id });
  return res.deletedCount > 0;
}

export async function reorderCustomFields(orderedIds) {
  if (!Array.isArray(orderedIds) || !orderedIds.length) return listCustomFields();
  const ops = orderedIds.map((id, index) => ({
    updateOne: { filter: { _id: String(id) }, update: { $set: { order: index } } },
  }));
  await col().bulkWrite(ops, { ordered: false });
  return listCustomFields();
}

/**
 * Converte um valor cru para o tipo do campo. Devolve `undefined` quando o
 * valor não serve (número não-numérico, data fora de YYYY-MM-DD, opção fora da
 * lista) — quem chama decide entre ignorar ou reportar. Usado tanto na edição
 * manual quanto na gravação feita pela IA, para os dois caminhos concordarem.
 */
export function coerceFieldValue(field, raw) {
  if (raw === null || raw === undefined || raw === "") return null;
  const texto = String(raw).trim();
  if (!texto) return null;
  switch (field.type) {
    case "numero": {
      // Aceita "1.234,56" (pt-BR) e "1234.56".
      const limpo = texto.replace(/\s/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", ".");
      const n = Number(limpo);
      return Number.isFinite(n) ? n : undefined;
    }
    case "data": {
      if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
        return Number.isNaN(new Date(`${texto}T00:00:00`).getTime()) ? undefined : texto;
      }
      // A IA e o usuário costumam mandar dd/mm/aaaa.
      const br = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (br) {
        const iso = `${br[3]}-${br[2]}-${br[1]}`;
        return Number.isNaN(new Date(`${iso}T00:00:00`).getTime()) ? undefined : iso;
      }
      return undefined;
    }
    case "lista":
      return field.options.includes(texto) ? texto : undefined;
    default:
      return texto;
  }
}

/**
 * Aplica um mapa {key: valor} sobre os valores atuais, validando contra as
 * definições. Retorna { values, aplicados, rejeitados }.
 */
export function applyCustomFieldValues(definicoes, atuais, entrada) {
  const byKey = new Map(definicoes.map(f => [f.key, f]));
  const values = { ...(atuais || {}) };
  const aplicados = [];
  const rejeitados = [];
  for (const [key, raw] of Object.entries(entrada || {})) {
    const field = byKey.get(key);
    if (!field) { rejeitados.push({ key, motivo: "campo inexistente" }); continue; }
    const valor = coerceFieldValue(field, raw);
    if (valor === undefined) { rejeitados.push({ key, motivo: `valor inválido para tipo ${field.type}` }); continue; }
    if (valor === null) { delete values[key]; aplicados.push(key); continue; }
    values[key] = valor;
    aplicados.push(key);
  }
  return { values, aplicados, rejeitados };
}
