import { getCol, collections } from "./mongo.js";

const col = () => getCol(collections.agentUsage);

const emptyEntry = () => ({
  promptTokens: 0,
  completionTokens: 0,
  costUsd: 0,
  calls: 0,
  lastUpdatedAt: null,
});

export async function getAllUsage() {
  const docs = await col().find({}).toArray();
  const out = {};
  for (const d of docs) {
    const { _id, ...rest } = d;
    out[_id] = rest;
  }
  return out;
}

export async function addUsage(agentId, { promptTokens = 0, completionTokens = 0, costUsd = 0 } = {}) {
  if (!agentId) return null;
  const prev = (await col().findOne({ _id: agentId }, { projection: { _id: 0 } })) || emptyEntry();
  const next = {
    promptTokens: (prev.promptTokens || 0) + (Number(promptTokens) || 0),
    completionTokens: (prev.completionTokens || 0) + (Number(completionTokens) || 0),
    costUsd: Number(((prev.costUsd || 0) + (Number(costUsd) || 0)).toFixed(8)),
    calls: (prev.calls || 0) + 1,
    lastUpdatedAt: new Date().toISOString(),
  };
  await col().updateOne({ _id: agentId }, { $set: next }, { upsert: true });
  return next;
}

export async function resetUsage(agentId) {
  if (!agentId) return;
  await col().deleteOne({ _id: agentId });
}
