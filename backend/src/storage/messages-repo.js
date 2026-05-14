import path from "node:path";
import fs from "node:fs/promises";
import { config } from "../config.js";
import { readJson, updateJson } from "./json-store.js";

function chatFilePath(instanceId, chatId) {
  const safeChatId = chatId.replace(/[^a-zA-Z0-9._@-]/g, "_");
  return path.join(config.paths.messagesDir, instanceId, `${safeChatId}.json`);
}

export async function listMessages(instanceId, chatId, { before, limit = 50 } = {}) {
  const file = chatFilePath(instanceId, chatId);
  const all = await readJson(file, []);
  const filtered = before ? all.filter(m => m.timestamp < Number(before)) : all;
  return filtered.slice(-limit);
}

export async function nextOutgoingTimestamp(instanceId, chatId, candidate) {
  const file = chatFilePath(instanceId, chatId);
  const all = await readJson(file, []);
  const nowSec = Math.floor(Date.now() / 1000);
  const candidateSec = Number.isFinite(candidate) && candidate > 0 ? Math.floor(candidate) : nowSec;
  if (!all.length) return candidateSec;
  let lastTs = 0;
  for (const m of all) {
    const t = Number(m.timestamp) || 0;
    if (t > lastTs) lastTs = t;
  }
  return Math.max(candidateSec, lastTs + 1);
}

export async function appendMessage(instanceId, chatId, message) {
  const file = chatFilePath(instanceId, chatId);
  let added = false;
  await updateJson(file, [], current => {
    if (current.some(m => m.id === message.id)) return current;
    added = true;
    const next = [...current, message];
    next.sort((a, b) => a.timestamp - b.timestamp);
    return next;
  });
  return added;
}

export async function bulkSaveMessages(instanceId, chatId, messages) {
  const file = chatFilePath(instanceId, chatId);
  await updateJson(file, [], current => {
    const seen = new Set(current.map(m => m.id));
    const merged = current.slice();
    for (const m of messages) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      merged.push(m);
    }
    merged.sort((a, b) => a.timestamp - b.timestamp);
    return merged;
  });
}

export async function updateMessageAck(instanceId, chatId, messageId, ack) {
  const file = chatFilePath(instanceId, chatId);
  let updated = false;
  await updateJson(file, [], current => {
    const idx = current.findIndex(m => m.id === messageId);
    if (idx === -1) return current;
    const next = current.slice();
    const currentAck = Number(next[idx].ack) || 0;
    const nextAck = Math.max(currentAck, Number(ack) || 0);
    if (nextAck === currentAck) return current;
    next[idx] = { ...next[idx], ack: nextAck };
    updated = true;
    return next;
  });
  return updated;
}

export async function updateMessageMedia(instanceId, chatId, messageId, { mediaUrl, mediaMime }) {
  const file = chatFilePath(instanceId, chatId);
  await updateJson(file, [], current => {
    const idx = current.findIndex(m => m.id === messageId);
    if (idx === -1) return current;
    const next = current.slice();
    next[idx] = { ...next[idx], mediaUrl, mediaMime };
    return next;
  });
}

export async function removeMessagesByInstance(instanceId) {
  const dir = path.join(config.paths.messagesDir, instanceId);
  await fs.rm(dir, { recursive: true, force: true });
}

export async function removeMessagesForChat(instanceId, chatId) {
  const file = chatFilePath(instanceId, chatId);
  await fs.rm(file, { force: true });
}
