import { getCol, collections } from "./mongo.js";
import { normalizeInstanceKind } from "../lib/instance-kinds.js";

const col = () => getCol(collections.instances);

// Instância gravada antes de o tipo existir sai daqui já classificada, para
// nenhuma tela precisar tratar `tipo` ausente. Mesma ideia do sanitize de
// users-repo com os cargos legados.
const sanitize = inst => (inst ? { ...inst, tipo: normalizeInstanceKind(inst.tipo) } : inst);

// Sem argumento devolve todas (comportamento antigo); `filter` permite recortar
// por dono ou por lista de ids sem trazer tudo para a memória.
export async function listInstances(filter = {}) {
  const all = await col().find(filter, { projection: { _id: 0 } }).toArray();
  return all.map(sanitize);
}

export async function getInstance(id) {
  return sanitize(await col().findOne({ _id: id }, { projection: { _id: 0 } }));
}

export async function upsertInstance(instance) {
  const res = await col().findOneAndUpdate(
    { _id: instance.id },
    { $set: { ...instance, id: instance.id } },
    { upsert: true, returnDocument: "after", projection: { _id: 0 } },
  );
  return sanitize(res?.value ?? res);
}

// No-op se a instância não existir (igual ao comportamento anterior).
export async function patchInstance(id, patch) {
  await col().updateOne({ _id: id }, { $set: patch });
}

export async function removeInstance(id) {
  await col().deleteOne({ _id: id });
}
