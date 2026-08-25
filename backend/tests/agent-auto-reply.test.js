import test from "node:test";
import assert from "node:assert/strict";
import { casaPalavraDeBloqueio } from "../src/whatsapp/agent-auto-reply.js";

// O gatilho do agente saiu do navegador (useAgentAutoReply) e veio para o
// backend. Enquanto morava no cliente, o agente parava de responder quando todo
// mundo fechava o CRM — e com várias abas abertas disparava a mesma resposta
// várias vezes. Aqui garantimos que a regra de transferência para humano
// atravessou a mudança com o mesmo comportamento.

test("acha a palavra de bloqueio ignorando acento e caixa", () => {
  assert.equal(casaPalavraDeBloqueio("Quero falar com um ATENDENTE", ["atendente"]), true);
  assert.equal(casaPalavraDeBloqueio("preciso de um médico", ["medico"]), true);
  assert.equal(casaPalavraDeBloqueio("preciso de um medico", ["médico"]), true);
});

test("acha a palavra no meio da frase", () => {
  assert.equal(casaPalavraDeBloqueio("boa tarde, quero cancelar minha consulta", ["cancelar"]), true);
});

test("não dispara sem palavra configurada", () => {
  assert.equal(casaPalavraDeBloqueio("qualquer coisa", []), false);
  assert.equal(casaPalavraDeBloqueio("qualquer coisa", undefined), false);
  assert.equal(casaPalavraDeBloqueio("qualquer coisa", null), false);
});

test("não dispara quando nenhuma palavra casa", () => {
  assert.equal(casaPalavraDeBloqueio("bom dia, tudo bem?", ["atendente", "humano"]), false);
});

test("palavra vazia na configuração não casa com tudo", () => {
  // Uma string vazia na lista faria `includes("")` devolver true para QUALQUER
  // mensagem, desligando a IA de todas as conversas de uma vez.
  assert.equal(casaPalavraDeBloqueio("bom dia", ["", "   "]), false);
});

test("texto vazio não quebra", () => {
  assert.equal(casaPalavraDeBloqueio("", ["atendente"]), false);
  assert.equal(casaPalavraDeBloqueio(null, ["atendente"]), false);
});
