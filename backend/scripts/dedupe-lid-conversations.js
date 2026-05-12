import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../src/config.js";
import { readJson, updateJson } from "../src/storage/json-store.js";

const CONV_FILE = config.paths.conversationsFile;

function isPlaceholderName(s) {
  if (!s) return true;
  if (typeof s !== "string") return true;
  if (/^\d{8,}$/.test(s)) return true;
  if (/@(s\.whatsapp\.net|lid|c\.us)$/.test(s)) return true;
  return false;
}

function chatFile(instanceId, chatId) {
  const safe = chatId.replace(/[^a-zA-Z0-9._@-]/g, "_");
  return path.join(config.paths.messagesDir, instanceId, `${safe}.json`);
}

async function loadMessages(instanceId, chatId) {
  try {
    return await readJson(chatFile(instanceId, chatId), []);
  } catch {
    return [];
  }
}

async function mergePair(lidConv, pnConv) {
  const lidMsgs = await loadMessages(lidConv.instanceId, lidConv.chatId);
  const pnMsgs = await loadMessages(pnConv.instanceId, pnConv.chatId);

  const seen = new Set(pnMsgs.map(m => m.id));
  const remapped = lidMsgs
    .filter(m => !seen.has(m.id))
    .map(m => ({ ...m, chatId: pnConv.chatId }));

  if (remapped.length) {
    const merged = [...pnMsgs, ...remapped].sort((a, b) => a.timestamp - b.timestamp);
    await updateJson(chatFile(pnConv.instanceId, pnConv.chatId), [], () => merged);
  }

  const lidTs = lidConv.lastInteraction ? new Date(lidConv.lastInteraction).getTime() : 0;
  const pnTs = pnConv.lastInteraction ? new Date(pnConv.lastInteraction).getTime() : 0;
  const newer = lidTs > pnTs ? lidConv : pnConv;

  const mergedConv = {
    ...pnConv,
    customer: isPlaceholderName(pnConv.customer) ? lidConv.customer : pnConv.customer,
    whatsappName: isPlaceholderName(pnConv.whatsappName) ? lidConv.whatsappName : pnConv.whatsappName,
    phone: pnConv.phone || lidConv.phone || "",
    avatarUrl: pnConv.avatarUrl || lidConv.avatarUrl,
    unreadCount: Math.max(pnConv.unreadCount || 0, lidConv.unreadCount || 0),
    unread: Boolean(pnConv.unread || lidConv.unread),
    lastMessage: newer.lastMessage,
    lastMessageId: newer.lastMessageId,
    lastMessageFromMe: newer.lastMessageFromMe,
    lastMessageAck: newer.lastMessageAck,
    lastInteraction: newer.lastInteraction,
  };

  await updateJson(CONV_FILE, [], current => {
    const next = current
      .filter(c => c.id !== lidConv.id)
      .map(c => (c.id === pnConv.id ? mergedConv : c));
    return next;
  });

  try { await fs.rm(chatFile(lidConv.instanceId, lidConv.chatId), { force: true }); } catch {}

  return { lid: lidConv.id, pn: pnConv.id, movedMessages: remapped.length };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const all = await readJson(CONV_FILE, []);
  const lids = all.filter(c => c?.chatId?.endsWith("@lid"));
  const pns = all.filter(c => c?.chatId?.endsWith("@s.whatsapp.net"));

  const pairs = [];
  const PROXIMITY_MS = 24 * 3600 * 1000;
  for (const lid of lids) {
    if (!lid.lastMessage) continue;
    const candidates = pns.filter(p =>
      p.instanceId === lid.instanceId &&
      p.lastMessage === lid.lastMessage,
    );
    if (!candidates.length) continue;
    const lidTs = lid.lastInteraction ? new Date(lid.lastInteraction).getTime() : 0;
    const best = candidates.find(p => {
      const pTs = p.lastInteraction ? new Date(p.lastInteraction).getTime() : 0;
      if (!lidTs || !pTs) return true;
      return Math.abs(pTs - lidTs) <= PROXIMITY_MS;
    });
    if (best) pairs.push({ lid, pn: best });
  }

  console.log(`Total conversations: ${all.length}`);
  console.log(`LID conversations: ${lids.length}`);
  console.log(`PN conversations: ${pns.length}`);
  console.log(`Matched pairs to merge: ${pairs.length}`);
  for (const { lid, pn } of pairs) {
    console.log(`  ${lid.chatId}  -->  ${pn.chatId}  (${pn.customer})`);
  }

  if (dryRun) {
    console.log("\n[dry-run] no changes written. Re-run without --dry-run to apply.");
    return;
  }

  for (const { lid, pn } of pairs) {
    const res = await mergePair(lid, pn);
    console.log(`merged ${res.lid} → ${res.pn} (moved ${res.movedMessages} messages)`);
  }
  console.log("\nDone.");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
