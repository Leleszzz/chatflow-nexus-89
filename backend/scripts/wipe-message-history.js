// Wipe all locally stored messages and conversation summaries.
// Keeps: instances.json, users.json, settings.json, .baileys_auth (no re-pairing).
// After running, restart the backend — Baileys will re-emit messaging-history.set
// and re-populate everything from WhatsApp.
//
// Run: node scripts/wipe-message-history.js
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../src/config.js";

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function rmIfExists(p, label) {
  if (await exists(p)) {
    await fs.rm(p, { recursive: true, force: true });
    console.log(`[wipe] removed ${label}: ${p}`);
  } else {
    console.log(`[wipe] skipped ${label} (not found): ${p}`);
  }
}

async function resetInstanceFlags(file) {
  if (!(await exists(file))) {
    console.log(`[wipe] no instances file at ${file}; skipping flag reset`);
    return;
  }
  const raw = await fs.readFile(file, "utf8");
  let instances;
  try {
    instances = JSON.parse(raw);
  } catch (err) {
    console.warn(`[wipe] could not parse ${file}: ${err.message}`);
    return;
  }
  if (!Array.isArray(instances)) return;
  let changed = false;
  for (const inst of instances) {
    if (inst.historySynced) { inst.historySynced = false; changed = true; }
    if (typeof inst.conversations === "number" && inst.conversations > 0) {
      inst.conversations = 0;
      changed = true;
    }
  }
  if (changed) {
    await fs.writeFile(file, JSON.stringify(instances, null, 2));
    console.log(`[wipe] reset historySynced/conversations on ${instances.length} instance(s)`);
  } else {
    console.log(`[wipe] instance flags already clean`);
  }
}

async function main() {
  console.log(`[wipe] data dir: ${config.paths.dataDir}`);
  await rmIfExists(config.paths.messagesDir, "messages dir");
  await rmIfExists(config.paths.conversationsFile, "conversations.json");
  await fs.mkdir(config.paths.messagesDir, { recursive: true });
  await resetInstanceFlags(config.paths.instancesFile);
  console.log(`[wipe] done. Start the backend; Baileys will re-sync history.`);
}

main().catch(err => {
  console.error("[wipe] fatal:", err);
  process.exit(1);
});
