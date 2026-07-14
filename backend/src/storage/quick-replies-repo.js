import { nanoid } from "nanoid";
import { getCol, collections } from "./mongo.js";

const col = () => getCol(collections.quickReplies);

// Mensagens pré-configuradas usadas no chat. O corpo pode conter {{variaveis}},
// resolvidas no front na hora de inserir no compositor.
export async function listQuickReplies() {
  return col().find({}, { projection: { _id: 0 } }).sort({ ordem: 1, criadoEm: 1 }).toArray();
}

export async function createQuickReply({ titulo, corpo, criadoPor = "" }) {
  const agora = new Date().toISOString();
  const total = await col().countDocuments();
  const reply = {
    id: `qr-${nanoid(8)}`,
    titulo,
    corpo,
    ordem: total,
    criadoPor,
    criadoEm: agora,
    atualizadoEm: agora,
  };
  await col().insertOne({ _id: reply.id, ...reply });
  return reply;
}

export async function updateQuickReply(id, patch) {
  const set = { atualizadoEm: new Date().toISOString() };
  if (typeof patch.titulo === "string") set.titulo = patch.titulo;
  if (typeof patch.corpo === "string") set.corpo = patch.corpo;
  if (Number.isFinite(patch.ordem)) set.ordem = patch.ordem;
  const res = await col().findOneAndUpdate(
    { _id: id },
    { $set: set },
    { returnDocument: "after", projection: { _id: 0 } },
  );
  return res?.value ?? res ?? null;
}

export async function deleteQuickReply(id) {
  const res = await col().deleteOne({ _id: id });
  return res.deletedCount > 0;
}
