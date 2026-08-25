import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { MongoClient } from "mongodb";
import { connectMongo, closeMongo } from "../src/storage/mongo.js";
import {
  respondLockKey,
  acquireRespondLock,
  releaseRespondLock,
  isAlreadyAnswered,
  _resetRespondLocks,
} from "../src/routes/agent-dedupe.js";

// A trava saiu de um Set em memória para um documento no Mongo com _id
// determinístico: só assim ela vale entre PROCESSOS, e não só entre abas. Com o
// Set, subir um segundo backend (ou `pm2 cluster`) fazia o cliente receber a
// resposta do agente duplicada.
//
// O teste precisa de um Mongo de verdade porque o que garante a exclusão mútua
// é a chave duplicada do banco, não lógica nossa. Sem Mongo local, pula.
let temMongo = false;

before(async () => {
  try {
    const sonda = new MongoClient(process.env.MONGODB_URI || "mongodb://127.0.0.1:27018", {
      serverSelectionTimeoutMS: 1500,
    });
    await sonda.connect();
    await sonda.close();
    process.env.MONGODB_DB = process.env.MONGODB_DB_TESTE || "chatflow_teste_dedupe";
    await connectMongo();
    temMongo = true;
  } catch {
    console.warn("[agent-dedupe.test] MongoDB indisponível — testes de trava pulados");
  }
});

after(async () => {
  if (temMongo) {
    await _resetRespondLocks();
    await closeMongo();
  }
});

beforeEach(async () => { if (temMongo) await _resetRespondLocks(); });

const msg = (fromMe, body = "oi") => ({ fromMe, body });

test("a segunda chamada concorrente para a mesma conversa é recusada", async t => {
  if (!temMongo) return t.skip("MongoDB indisponível");
  const key = respondLockKey("i1", "5527999@s.whatsapp.net");
  assert.equal(await acquireRespondLock(key), true, "a primeira aba deve conseguir a trava");
  assert.equal(await acquireRespondLock(key), false, "a segunda aba NÃO pode gerar outra resposta");
});

test("conversas diferentes não bloqueiam uma à outra", async t => {
  if (!temMongo) return t.skip("MongoDB indisponível");
  assert.equal(await acquireRespondLock(respondLockKey("i1", "a@s.whatsapp.net")), true);
  assert.equal(await acquireRespondLock(respondLockKey("i1", "b@s.whatsapp.net")), true);
  // Mesmo número em instâncias diferentes é outra conversa.
  assert.equal(await acquireRespondLock(respondLockKey("i2", "a@s.whatsapp.net")), true);
});

test("liberar a trava permite a próxima resposta", async t => {
  if (!temMongo) return t.skip("MongoDB indisponível");
  const key = respondLockKey("i1", "a@s.whatsapp.net");
  await acquireRespondLock(key);
  await releaseRespondLock(key);
  assert.equal(await acquireRespondLock(key), true);
});

test("duas chamadas simultâneas: exatamente uma ganha", async t => {
  if (!temMongo) return t.skip("MongoDB indisponível");
  // O caso que o Set em memória não cobria entre processos. Dispara em paralelo
  // para exercitar a atomicidade do insert, não a ordem das chamadas.
  const key = respondLockKey("i1", "corrida@s.whatsapp.net");
  const resultados = await Promise.all([
    acquireRespondLock(key), acquireRespondLock(key),
    acquireRespondLock(key), acquireRespondLock(key),
  ]);
  assert.equal(resultados.filter(Boolean).length, 1, "só uma chamada pode gerar resposta");
});

test("não responde quando a última mensagem já é nossa", () => {
  // Caso do bug: a outra aba terminou de responder antes desta começar.
  assert.equal(isAlreadyAnswered([msg(false, "vocês fazem lipo?"), msg(true, "Sim! Qual é o seu nome?")]), true);
});

test("responde quando a última mensagem é do cliente", () => {
  assert.equal(isAlreadyAnswered([msg(true, "Olá!"), msg(false, "vocês fazem lipo?")]), false);
  assert.equal(isAlreadyAnswered([msg(false, "oi")]), false);
});

test("não responde se um humano assumiu depois do cliente", () => {
  const historico = [msg(false, "quero agendar"), msg(true, "Aqui é a Ana, vou te ajudar")];
  assert.equal(isAlreadyAnswered(historico), true, "o agente não pode falar por cima do atendente");
});

test("histórico vazio ou inválido não bloqueia a primeira resposta", () => {
  assert.equal(isAlreadyAnswered([]), false);
  assert.equal(isAlreadyAnswered(undefined), false);
  assert.equal(isAlreadyAnswered(null), false);
});
