import { config } from "../config.js";
import { readJson, updateJson } from "./json-store.js";

const FILE = config.paths.agentUsageFile;

const emptyEntry = () => ({
  promptTokens: 0,
  completionTokens: 0,
  costUsd: 0,
  calls: 0,
  lastUpdatedAt: null,
});

export async function getAllUsage() {
  return readJson(FILE, {});
}

export async function addUsage(agentId, { promptTokens = 0, completionTokens = 0, costUsd = 0 } = {}) {
  if (!agentId) return null;
  let updated;
  await updateJson(FILE, {}, current => {
    const prev = current[agentId] || emptyEntry();
    const next = {
      promptTokens: (prev.promptTokens || 0) + (Number(promptTokens) || 0),
      completionTokens: (prev.completionTokens || 0) + (Number(completionTokens) || 0),
      costUsd: Number(((prev.costUsd || 0) + (Number(costUsd) || 0)).toFixed(8)),
      calls: (prev.calls || 0) + 1,
      lastUpdatedAt: new Date().toISOString(),
    };
    updated = next;
    return { ...current, [agentId]: next };
  });
  return updated;
}

export async function resetUsage(agentId) {
  if (!agentId) return;
  await updateJson(FILE, {}, current => {
    if (!(agentId in current)) return current;
    const next = { ...current };
    delete next[agentId];
    return next;
  });
}
