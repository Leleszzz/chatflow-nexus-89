import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { JidResolver } from "../src/whatsapp/connection/jid-resolver.js";

const LID = "111222333444@lid";
const PN = "5511999999999@s.whatsapp.net";

async function tmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "jid-resolver-test-"));
}

test("remember aprende par LID<->PN em qualquer ordem e canonicaliza", async t => {
  const dir = await tmpDir();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const r = new JidResolver({ instanceId: "t", authDir: dir });

  assert.equal(r.remember(LID, PN), true);
  assert.equal(r.canonical(LID), PN);
  assert.equal(r.canonical(PN), PN);
  assert.equal(r.pnFor(LID), PN);
  assert.equal(r.lidFor(PN), LID);

  // Ordem invertida e par já conhecido não re-aprendem.
  assert.equal(r.remember(PN, LID), false);
  // Dois PNs ou dois LIDs não formam par.
  assert.equal(r.remember(PN, "5511888888888@s.whatsapp.net"), false);
  r.dispose();
});

test("onLearn dispara apenas para par inédito", async t => {
  const dir = await tmpDir();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const learned = [];
  const r = new JidResolver({ instanceId: "t", authDir: dir, onLearn: (lid, pn) => learned.push([lid, pn]) });
  r.remember(LID, PN);
  r.remember(LID, PN);
  assert.deepEqual(learned, [[LID, PN]]);
  r.dispose();
});

test("flush persiste e um novo resolver (reconexão) carrega o mapa — corrida corrigida", async t => {
  const dir = await tmpDir();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  // Simula a sequência do teardown do ConnectionManager: remember -> flush ->
  // dispose da conexão antiga, depois load() da nova conexão.
  const oldConn = new JidResolver({ instanceId: "t", authDir: dir });
  oldConn.remember(LID, PN);
  await oldConn.flush();
  oldConn.dispose();

  const newConn = new JidResolver({ instanceId: "t", authDir: dir });
  await newConn.load();
  assert.equal(newConn.canonical(LID), PN, "mapeamento deve sobreviver à reconexão");
  newConn.dispose();
});

test("load com arquivo ausente não falha (primeira conexão)", async t => {
  const dir = await tmpDir();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const r = new JidResolver({ instanceId: "t", authDir: dir });
  await r.load();
  assert.equal(r.canonical(LID), LID); // sem mapa, devolve o próprio JID
  r.dispose();
});

test("flush é no-op sem mudanças (idempotente pós-dispose)", async t => {
  const dir = await tmpDir();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const r = new JidResolver({ instanceId: "t", authDir: dir });
  await r.flush(); // nada sujo — não deve criar arquivo
  await assert.rejects(fs.stat(path.join(dir, "lid-map.json")));
  r.dispose();
});
