import { getCol, collections } from "./mongo.js";

// Recupera instâncias que possuem conversas no banco mas perderam o registro na
// coleção `instances`. Só toca em instanceIds com dados — nunca ressuscita
// instâncias realmente apagadas (essas não têm mais conversas).
//
// Roda no boot. Sobrou da migração JSON→Mongo, mas continua valendo como
// self-heal: se a coleção `instances` for perdida e as conversas sobreviverem,
// a instância volta (desconectada) em vez de as conversas ficarem órfãs.
export async function reconcileOrphanInstances() {
  const convInstanceIds = await getCol(collections.conversations).distinct("instanceId");
  if (!convInstanceIds.length) return 0;

  const existing = new Set(
    (await getCol(collections.instances).find({}, { projection: { _id: 1 } }).toArray()).map(d => d._id),
  );
  const missing = convInstanceIds.filter(id => id && !existing.has(id));
  if (!missing.length) return 0;

  const ops = missing.map(id => {
    const doc = {
      id,
      name: id,
      status: "desconectada",
      phone: "",
      ownerId: null,
      conversations: 0,
      historySynced: true,
      createdAt: new Date().toISOString(),
    };
    return { updateOne: { filter: { _id: id }, update: { $setOnInsert: { ...doc, _id: id } }, upsert: true } };
  });

  const res = await getCol(collections.instances).bulkWrite(ops, { ordered: false });
  if (res.upsertedCount) {
    console.log(`[instances] recuperadas ${res.upsertedCount} instância(s) órfã(s) que tinham conversas sem registro: ${missing.join(", ")}`);
  }
  return res.upsertedCount || 0;
}
