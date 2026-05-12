// One-shot migration: bump timestamps of outgoing (fromMe) messages whose
// timestamp is <= the maximum timestamp seen earlier in the same chat file.
// Restores chronological ordering for chats where the agent reply landed on
// the same second as (or before) the user message it was answering.
//
// Run: node scripts/fix-message-order.js
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../src/config.js";

async function readJson(file, fallback) {
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function listChatFiles(messagesDir) {
  const out = [];
  let instances;
  try {
    instances = await fs.readdir(messagesDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of instances) {
    if (!entry.isDirectory()) continue;
    const instanceDir = path.join(messagesDir, entry.name);
    const files = await fs.readdir(instanceDir);
    for (const f of files) {
      if (f.endsWith(".json")) out.push({ instance: entry.name, file: path.join(instanceDir, f) });
    }
  }
  return out;
}

function fixMessages(messages) {
  let maxTs = 0;
  let bumped = 0;
  for (const m of messages) {
    const ts = Number(m.timestamp) || 0;
    if (m.fromMe && ts <= maxTs) {
      m.timestamp = maxTs + 1;
      bumped += 1;
    }
    if ((m.timestamp || 0) > maxTs) maxTs = m.timestamp;
  }
  if (bumped > 0) messages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  return bumped;
}

async function updateConversationFromMessages(conversationsFile, instanceId, chatId, lastMessage) {
  if (!lastMessage) return false;
  const all = await readJson(conversationsFile, []);
  const id = `${instanceId}__${chatId}`;
  const idx = all.findIndex(c => c.id === id);
  if (idx === -1) return false;
  const cur = all[idx];
  const next = {
    ...cur,
    lastMessageId: lastMessage.id,
    lastMessageFromMe: Boolean(lastMessage.fromMe),
    lastMessageAck: lastMessage.ack ?? cur.lastMessageAck ?? 0,
    lastInteraction: new Date((lastMessage.timestamp || 0) * 1000).toISOString(),
  };
  if (
    next.lastMessageId === cur.lastMessageId &&
    next.lastMessageFromMe === cur.lastMessageFromMe &&
    next.lastMessageAck === cur.lastMessageAck &&
    next.lastInteraction === cur.lastInteraction
  ) {
    return false;
  }
  all[idx] = next;
  await fs.writeFile(conversationsFile, JSON.stringify(all, null, 2));
  return true;
}

async function main() {
  const messagesDir = config.paths.messagesDir;
  const conversationsFile = config.paths.conversationsFile;
  console.log(`[fix-message-order] scanning ${messagesDir}`);

  const chats = await listChatFiles(messagesDir);
  console.log(`[fix-message-order] found ${chats.length} chat files`);

  let totalBumped = 0;
  let chatsTouched = 0;
  let conversationsUpdated = 0;

  for (const { instance, file } of chats) {
    const messages = await readJson(file, []);
    if (!Array.isArray(messages) || messages.length === 0) continue;
    const bumped = fixMessages(messages);
    if (bumped === 0) continue;
    chatsTouched += 1;
    totalBumped += bumped;
    await fs.writeFile(file, JSON.stringify(messages, null, 2));
    const last = messages[messages.length - 1];
    const chatId = last?.chatId || messages.find(m => m?.chatId)?.chatId;
    if (!chatId) {
      console.warn(`[fix-message-order] no chatId found in ${file}; conversation summary not updated`);
      continue;
    }
    const updated = await updateConversationFromMessages(conversationsFile, instance, chatId, last);
    if (updated) conversationsUpdated += 1;
    console.log(`[fix-message-order] ${instance}/${path.basename(file)} → ${bumped} message(s) bumped`);
  }

  console.log(
    `[fix-message-order] done: ${totalBumped} message(s) bumped across ${chatsTouched} chat(s); ` +
      `${conversationsUpdated} conversation summary(ies) updated.`,
  );
}

main().catch(err => {
  console.error("[fix-message-order] fatal:", err);
  process.exit(1);
});
