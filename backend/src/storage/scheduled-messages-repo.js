import { getCol, collections } from "./mongo.js";

const col = () => getCol(collections.scheduledMessages);
const PROJ = { projection: { _id: 0 } };

export async function listScheduled({ conversationId, instanceId, chatId, status } = {}) {
  const query = {};
  if (conversationId) query.conversationId = conversationId;
  if (instanceId) query.instanceId = instanceId;
  if (chatId) query.chatId = chatId;
  if (status) query.status = status;
  return col().find(query, PROJ).sort({ scheduledAt: 1 }).toArray();
}

export async function getScheduled(id) {
  return col().findOne({ _id: id }, PROJ);
}

export async function createScheduled(data) {
  const record = {
    id: `sch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    instanceId: data.instanceId,
    chatId: data.chatId,
    conversationId: data.conversationId || null,
    body: data.body,
    scheduledAt: data.scheduledAt,
    status: "pending",
    cancelIfClientReplies: Boolean(data.cancelIfClientReplies),
    cancelIfAgentReplies: Boolean(data.cancelIfAgentReplies),
    note: data.note || "",
    createdBy: data.createdBy || null,
    createdAt: new Date().toISOString(),
    sentAt: null,
    sentMessageId: null,
    cancelledReason: null,
    error: null,
  };
  await col().insertOne({ _id: record.id, ...record });
  return record;
}

export async function updateScheduled(id, patch) {
  const res = await col().findOneAndUpdate(
    { _id: id },
    { $set: patch },
    { returnDocument: "after", projection: { _id: 0 } },
  );
  return res?.value ?? res ?? null;
}

export async function deleteScheduled(id) {
  const res = await col().deleteOne({ _id: id });
  return res.deletedCount > 0;
}

// Retorna as mensagens pendentes cujo horário já chegou.
export async function listDueScheduled(nowIso = new Date().toISOString()) {
  return col().find({ status: "pending", scheduledAt: { $lte: nowIso } }, PROJ).toArray();
}

// Cancela agendamentos pendentes do chat conforme a flag indicada.
async function cancelPendingByFlag(instanceId, chatId, flag, reason) {
  const query = { status: "pending", instanceId, chatId, [flag]: true };
  const docs = await col().find(query, PROJ).toArray();
  if (docs.length) {
    await col().updateMany(query, { $set: { status: "cancelled", cancelledReason: reason } });
  }
  return docs.map(d => ({ ...d, status: "cancelled", cancelledReason: reason }));
}

export function cancelDueToClientReply(instanceId, chatId) {
  return cancelPendingByFlag(instanceId, chatId, "cancelIfClientReplies", "Cliente enviou uma mensagem");
}

export function cancelDueToAgentReply(instanceId, chatId) {
  return cancelPendingByFlag(instanceId, chatId, "cancelIfAgentReplies", "Atendente enviou uma mensagem");
}
