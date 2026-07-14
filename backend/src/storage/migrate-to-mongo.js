import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { getCol, collections } from "./mongo.js";

async function readJsonFile(file) {
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

// Lê do arquivo primário; se não existir, tenta o .bak (recuperação de migração
// anterior que renomeou o arquivo mas não preencheu o Mongo).
async function readJsonOrBak(file) {
  const primary = await readJsonFile(file);
  if (primary != null) return { data: primary, fromPrimary: true };
  const bakData = await readJsonFile(`${file}.bak`);
  return { data: bakData, fromPrimary: false };
}

async function bak(file) {
  try {
    await fs.rename(file, `${file}.bak`);
  } catch (err) {
    if (err.code !== "ENOENT") console.warn(`[migrate] não consegui renomear ${file}: ${err.message}`);
  }
}

// Upsert idempotente: nunca sobrescreve documentos já existentes.
async function importArray(colName, arr, idOf) {
  if (!Array.isArray(arr) || arr.length === 0) return 0;
  const ops = arr
    .filter(doc => doc && idOf(doc) != null)
    .map(doc => ({
      updateOne: {
        filter: { _id: idOf(doc) },
        update: { $setOnInsert: { ...doc, _id: idOf(doc) } },
        upsert: true,
      },
    }));
  if (!ops.length) return 0;
  const res = await getCol(colName).bulkWrite(ops, { ordered: false });
  return res.upsertedCount || 0;
}

// Importa um array para a coleção SOMENTE se ela estiver vazia (idempotente),
// lendo do JSON primário ou do .bak. Renomeia o primário para .bak ao final.
async function importCollection(colName, file, idOf) {
  const col = getCol(colName);
  const count = await col.countDocuments();
  if (count > 0) { await bak(file); return 0; }
  const { data, fromPrimary } = await readJsonOrBak(file);
  const n = await importArray(colName, data, idOf);
  if (fromPrimary) await bak(file);
  return n;
}

export async function migrateJsonToMongo() {
  const p = config.paths;
  let total = 0;

  total += await importCollection(collections.conversations, p.conversationsFile, d => d.id);
  total += await importCollection(collections.instances, p.instancesFile, d => d.id);
  total += await importCollection(collections.prontuarios, p.prontuariosFile, d => d.id);
  total += await importCollection(collections.scheduledMessages, p.scheduledMessagesFile, d => d.id);
  total += await importCollection(collections.users, p.usersFile, d => d.id);

  // settings: documento único { _id: "app" }
  if (await getCol(collections.settings).countDocuments() === 0) {
    const { data: settings, fromPrimary } = await readJsonOrBak(p.settingsFile);
    if (settings && typeof settings === "object") {
      await getCol(collections.settings).updateOne(
        { _id: "app" }, { $setOnInsert: { ...settings, _id: "app" } }, { upsert: true },
      );
    }
    if (fromPrimary) await bak(p.settingsFile);
  } else {
    await bak(p.settingsFile);
  }

  // agent-usage: objeto { agentId: entry }
  if (await getCol(collections.agentUsage).countDocuments() === 0) {
    const { data: usage, fromPrimary } = await readJsonOrBak(p.agentUsageFile);
    if (usage && typeof usage === "object") {
      const ops = Object.entries(usage).map(([agentId, entry]) => ({
        updateOne: { filter: { _id: agentId }, update: { $setOnInsert: { ...entry, _id: agentId } }, upsert: true },
      }));
      if (ops.length) await getCol(collections.agentUsage).bulkWrite(ops, { ordered: false });
    }
    if (fromPrimary) await bak(p.agentUsageFile);
  } else {
    await bak(p.agentUsageFile);
  }

  // messages: shards data/messages/<instanceId>/<chatId>.json (ou .bak do diretório)
  let msgCount = 0;
  if (await getCol(collections.messages).countDocuments() === 0) {
    let dir = p.messagesDir;
    let exists = await fs.stat(dir).then(() => true).catch(() => false);
    let fromPrimary = exists;
    if (!exists) { dir = `${p.messagesDir}.bak`; exists = await fs.stat(dir).then(() => true).catch(() => false); fromPrimary = false; }
    if (exists) {
      msgCount = await importMessagesDir(dir);
      if (fromPrimary) await fs.rename(dir, `${p.messagesDir}.bak`).catch(() => {});
    }
  }

  if (total + msgCount > 0) {
    console.log(`[migrate] importados ${total} documentos + ${msgCount} mensagens dos JSON legados para o MongoDB`);
  }

  await reconcileOrphanInstances();
}

// Recupera instâncias que possuem conversas no banco mas perderam o registro na
// coleção `instances` (ex.: migração anterior que importou conversas mas não as
// instâncias). Só toca em instanceIds com dados — nunca ressuscita instâncias
// realmente apagadas (essas não têm mais conversas).
async function reconcileOrphanInstances() {
  const convInstanceIds = await getCol(collections.conversations).distinct("instanceId");
  if (!convInstanceIds.length) return 0;
  const existing = new Set(
    (await getCol(collections.instances).find({}, { projection: { _id: 1 } }).toArray()).map(d => d._id),
  );
  const missing = convInstanceIds.filter(id => id && !existing.has(id));
  if (!missing.length) return 0;

  const { data: bakInstances } = await readJsonOrBak(config.paths.instancesFile);
  const byId = new Map((Array.isArray(bakInstances) ? bakInstances : []).map(i => [i.id, i]));
  const ops = missing.map(id => {
    const src = byId.get(id);
    const doc = src
      ? { ...src, id, status: "desconectada" }
      : { id, name: id, status: "desconectada", phone: "", conversations: 0, historySynced: true, createdAt: new Date().toISOString() };
    return { updateOne: { filter: { _id: id }, update: { $setOnInsert: { ...doc, _id: id } }, upsert: true } };
  });
  const res = await getCol(collections.instances).bulkWrite(ops, { ordered: false });
  if (res.upsertedCount) {
    console.log(`[migrate] recuperadas ${res.upsertedCount} instância(s) órfã(s) que tinham conversas sem registro: ${missing.join(", ")}`);
  }
  return res.upsertedCount || 0;
}

async function importMessagesDir(dir) {
  let msgCount = 0;
  const msgCol = getCol(collections.messages);
  const instDirs = await fs.readdir(dir, { withFileTypes: true });
  for (const d of instDirs) {
    if (!d.isDirectory()) continue;
    const instanceId = d.name;
    const files = await fs.readdir(path.join(dir, instanceId));
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const msgs = await readJsonFile(path.join(dir, instanceId, file));
      if (!Array.isArray(msgs) || !msgs.length) continue;
      const ops = msgs
        .filter(m => m && m.id && m.chatId)
        .map(m => ({
          updateOne: {
            filter: { _id: `${instanceId}__${m.chatId}__${m.id}` },
            update: { $setOnInsert: { ...m, instanceId, _id: `${instanceId}__${m.chatId}__${m.id}` } },
            upsert: true,
          },
        }));
      if (ops.length) {
        const res = await msgCol.bulkWrite(ops, { ordered: false });
        msgCount += res.upsertedCount || 0;
      }
    }
  }
  return msgCount;
}
