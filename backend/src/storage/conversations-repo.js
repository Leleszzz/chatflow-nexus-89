import { config } from "../config.js";
import { readJson, updateJson } from "./json-store.js";

const FILE = config.paths.conversationsFile;

function isLidChat(c) {
  return typeof c?.chatId === "string" && c.chatId.endsWith("@lid");
}

function isPnChat(c) {
  return typeof c?.chatId === "string" && c.chatId.endsWith("@s.whatsapp.net");
}

function dropOrphanLidDuplicates(convs) {
  const pnByKey = new Map();
  for (const c of convs) {
    if (!isPnChat(c) || !c.lastMessage) continue;
    const key = `${c.instanceId}::${c.lastMessage}`;
    const arr = pnByKey.get(key) || [];
    arr.push(c);
    pnByKey.set(key, arr);
  }
  const PROXIMITY_MS = 24 * 3600 * 1000;
  return convs.filter(c => {
    if (!isLidChat(c) || !c.lastMessage) return true;
    const peers = pnByKey.get(`${c.instanceId}::${c.lastMessage}`);
    if (!peers || peers.length === 0) return true;
    const lidTs = c.lastInteraction ? new Date(c.lastInteraction).getTime() : 0;
    return !peers.some(p => {
      const pTs = p.lastInteraction ? new Date(p.lastInteraction).getTime() : 0;
      if (!lidTs || !pTs) return true;
      return Math.abs(pTs - lidTs) <= PROXIMITY_MS;
    });
  });
}

export async function listConversations({ instanceId, limit, offset = 0 } = {}) {
  const all = await readJson(FILE, []);
  const filtered = all.filter(c =>
    c &&
    typeof c.id === "string" &&
    typeof c.chatId === "string" &&
    c.isGroup === false &&
    !c.chatId.endsWith("@g.us") &&
    !c.chatId.endsWith("@broadcast") &&
    !c.chatId.endsWith("@newsletter") &&
    (instanceId ? c.instanceId === instanceId : true)
  );
  const deduped = dropOrphanLidDuplicates(filtered);
  const sorted = deduped.sort((a, b) => new Date(b.lastInteraction) - new Date(a.lastInteraction));
  if (limit == null) return sorted;
  return sorted.slice(offset, offset + limit);
}

export async function getConversation(id) {
  const all = await readJson(FILE, []);
  return all.find(c => c.id === id) || null;
}

export async function upsertConversation(conversation) {
  let stored;
  await updateJson(FILE, [], current => {
    const idx = current.findIndex(c => c.id === conversation.id);
    if (idx === -1) {
      stored = conversation;
      return [...current, conversation];
    }
    stored = { ...current[idx], ...conversation };
    const next = current.slice();
    next[idx] = stored;
    return next;
  });
  return stored;
}

export async function removeConversationsByInstance(instanceId) {
  return updateJson(FILE, [], current => current.filter(c => c.instanceId !== instanceId));
}

export async function deleteConversation(id) {
  let removed = false;
  await updateJson(FILE, [], current => {
    const next = current.filter(c => c.id !== id);
    removed = next.length !== current.length;
    return next;
  });
  return removed;
}
