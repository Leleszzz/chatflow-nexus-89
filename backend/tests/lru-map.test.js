import test from "node:test";
import assert from "node:assert/strict";
import { LruMap } from "../src/lib/lru-map.js";

// chatsById e contactsByJid recebiam todo o histórico sincronizado e nunca eram
// podados: memória que só subia até o processo morrer, levando junto todas as
// conexões de WhatsApp.

test("respeita o teto descartando o mais antigo", () => {
  const m = new LruMap(3);
  m.set("a", 1); m.set("b", 2); m.set("c", 3); m.set("d", 4);
  assert.equal(m.size, 3);
  assert.equal(m.has("a"), false, "o mais antigo deveria ter saído");
  assert.deepEqual([...m.keys()], ["b", "c", "d"]);
});

test("ler uma chave renova a idade dela", () => {
  const m = new LruMap(3);
  m.set("a", 1); m.set("b", 2); m.set("c", 3);
  m.get("a");             // "a" volta a ser a mais recente
  m.set("d", 4);          // quem sai agora é "b", não "a"
  assert.equal(m.has("a"), true);
  assert.equal(m.has("b"), false);
});

test("regravar não duplica nem infla o tamanho", () => {
  const m = new LruMap(2);
  m.set("a", 1); m.set("a", 2); m.set("a", 3);
  assert.equal(m.size, 1);
  assert.equal(m.get("a"), 3);
});

test("serve como Map nos usos do WhatsAppConnection", () => {
  const m = new LruMap(10);
  m.set("x", { nome: "Ana" });
  assert.deepEqual(m.get("x"), { nome: "Ana" });
  assert.equal(m.get("inexistente"), undefined);
  assert.equal(m.delete("x"), true);
  m.set("y", 1);
  m.clear();
  assert.equal(m.size, 0);
  assert.deepEqual([...m], []);
});

test("teto mínimo de 1 mesmo se configurado com zero", () => {
  const m = new LruMap(0);
  m.set("a", 1); m.set("b", 2);
  assert.equal(m.size, 1);
});
