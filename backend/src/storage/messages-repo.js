import { getCol, collections } from "./mongo.js";

const col = () => getCol(collections.messages);

function docId(instanceId, chatId, msgId) {
  return `${instanceId}__${chatId}__${msgId}`;
}

export async function listMessages(instanceId, chatId, { before, limit = 50 } = {}) {
  const query = { instanceId, chatId };
  if (before) query.timestamp = { $lt: Number(before) };
  // Pega as `limit` mensagens mais recentes e devolve em ordem cronológica asc.
  const docs = await col()
    .find(query, { projection: { _id: 0 } })
    .sort({ timestamp: -1 })
    .limit(limit)
    .toArray();
  return docs.reverse();
}

export async function nextOutgoingTimestamp(instanceId, chatId, candidate) {
  const nowSec = Math.floor(Date.now() / 1000);
  const candidateSec = Number.isFinite(candidate) && candidate > 0 ? Math.floor(candidate) : nowSec;
  const newest = await col().findOne(
    { instanceId, chatId },
    { sort: { timestamp: -1 }, projection: { timestamp: 1, _id: 0 } },
  );
  if (!newest) return candidateSec;
  const lastTs = Number(newest.timestamp) || 0;
  return Math.max(candidateSec, lastTs + 1);
}

// Idempotente: insere apenas se ainda não existir (por _id determinístico).
export async function appendMessage(instanceId, chatId, message) {
  const id = docId(instanceId, chatId, message.id);
  const res = await col().updateOne(
    { _id: id },
    { $setOnInsert: { ...message, instanceId, chatId } },
    { upsert: true },
  );
  return res.upsertedCount === 1;
}

// Retorna os índices (na ordem de `messages`) que foram realmente inseridos —
// mensagens já existentes (re-sync) não contam.
export async function bulkSaveMessages(instanceId, chatId, messages) {
  if (!messages?.length) return [];
  const ops = messages.map(m => ({
    updateOne: {
      filter: { _id: docId(instanceId, chatId, m.id) },
      update: { $setOnInsert: { ...m, instanceId, chatId } },
      upsert: true,
    },
  }));
  const res = await col().bulkWrite(ops, { ordered: false });
  return Object.keys(res.upsertedIds || {}).map(Number);
}

// Só aumenta o ack (nunca regride). Retorna true se houve mudança.
export async function updateMessageAck(instanceId, chatId, messageId, ack) {
  const nextAck = Number(ack) || 0;
  const res = await col().updateOne(
    { _id: docId(instanceId, chatId, messageId), ack: { $lt: nextAck } },
    { $set: { ack: nextAck } },
  );
  return res.modifiedCount > 0;
}

// Marca a mensagem como apagada (revoke). O body original é mantido para
// auditoria; o front exibe o placeholder. Idempotente: retorna null se a
// mensagem não existe ou já estava apagada.
export async function markMessageDeleted(instanceId, chatId, messageId) {
  const res = await col().findOneAndUpdate(
    { _id: docId(instanceId, chatId, messageId), deleted: { $ne: true } },
    { $set: { deleted: true } },
    { returnDocument: "after", projection: { _id: 0 } },
  );
  return res?.value ?? res ?? null;
}

// Substitui o body por uma edição vinda do WhatsApp. Retorna o doc atualizado
// ou null se a mensagem não existe.
export async function updateMessageBody(instanceId, chatId, messageId, body) {
  const res = await col().findOneAndUpdate(
    { _id: docId(instanceId, chatId, messageId) },
    { $set: { body, edited: true } },
    { returnDocument: "after", projection: { _id: 0 } },
  );
  return res?.value ?? res ?? null;
}

export async function updateMessageMedia(instanceId, chatId, messageId, { mediaUrl, mediaMime }) {
  await col().updateOne(
    { _id: docId(instanceId, chatId, messageId) },
    { $set: { mediaUrl, mediaMime } },
  );
}

// Move todas as mensagens de `fromChatId` para `toChatId` (mesma instância),
// re-chaveando o _id determinístico. Idempotente: não duplica mensagens que já
// existam no destino. Retorna quantas mensagens foram movidas.
export async function reassignChat(instanceId, fromChatId, toChatId) {
  if (!instanceId || !fromChatId || !toChatId || fromChatId === toChatId) return 0;
  const docs = await col().find({ instanceId, chatId: fromChatId }, { projection: { _id: 0 } }).toArray();
  if (!docs.length) return 0;
  const ops = docs.map(m => ({
    updateOne: {
      filter: { _id: docId(instanceId, toChatId, m.id) },
      update: { $setOnInsert: { ...m, instanceId, chatId: toChatId } },
      upsert: true,
    },
  }));
  await col().bulkWrite(ops, { ordered: false });
  await col().deleteMany({ instanceId, chatId: fromChatId });
  return docs.length;
}

export async function removeMessagesByInstance(instanceId) {
  await col().deleteMany({ instanceId });
}
