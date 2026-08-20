import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  respondLockKey,
  acquireRespondLock,
  releaseRespondLock,
  isAlreadyAnswered,
  _resetRespondLocks,
} from "../src/routes/agent-dedupe.js";

beforeEach(() => _resetRespondLocks());

const msg = (fromMe, body = "oi") => ({ fromMe, body });

test("a segunda chamada concorrente para a mesma conversa é recusada", () => {
  const key = respondLockKey("i1", "5527999@s.whatsapp.net");
  assert.equal(acquireRespondLock(key), true, "a primeira aba deve conseguir a trava");
  assert.equal(acquireRespondLock(key), false, "a segunda aba NÃO pode gerar outra resposta");
});

test("conversas diferentes não bloqueiam uma à outra", () => {
  assert.equal(acquireRespondLock(respondLockKey("i1", "a@s.whatsapp.net")), true);
  assert.equal(acquireRespondLock(respondLockKey("i1", "b@s.whatsapp.net")), true);
  // Mesmo número em instâncias diferentes é outra conversa.
  assert.equal(acquireRespondLock(respondLockKey("i2", "a@s.whatsapp.net")), true);
});

test("liberar a trava permite a próxima resposta", () => {
  const key = respondLockKey("i1", "a@s.whatsapp.net");
  acquireRespondLock(key);
  releaseRespondLock(key);
  assert.equal(acquireRespondLock(key), true);
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
