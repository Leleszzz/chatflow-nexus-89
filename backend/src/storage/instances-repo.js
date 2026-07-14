import { getCol, collections } from "./mongo.js";

const col = () => getCol(collections.instances);

export async function listInstances() {
  return col().find({}, { projection: { _id: 0 } }).toArray();
}

export async function getInstance(id) {
  return col().findOne({ _id: id }, { projection: { _id: 0 } });
}

export async function upsertInstance(instance) {
  const res = await col().findOneAndUpdate(
    { _id: instance.id },
    { $set: { ...instance, id: instance.id } },
    { upsert: true, returnDocument: "after", projection: { _id: 0 } },
  );
  return res?.value ?? res;
}

// No-op se a instância não existir (igual ao comportamento anterior).
export async function patchInstance(id, patch) {
  await col().updateOne({ _id: id }, { $set: patch });
}

export async function removeInstance(id) {
  await col().deleteOne({ _id: id });
}
