import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTask, validateTask } from "../src/storage/tasks-repo.js";

test("campo fora da whitelist é descartado em silêncio", () => {
  const t = normalizeTask({ titulo: "Cobrar exames", prioridade: "urgentíssima", foo: 1 });
  assert.equal(t.prioridade, undefined);
  assert.equal(t.foo, undefined);
});

test("status desconhecido cai para aberta", () => {
  assert.equal(normalizeTask({ titulo: "x", status: "fazendo" }).status, "aberta");
  assert.equal(normalizeTask({ titulo: "x" }).status, "aberta");
  assert.equal(normalizeTask({ titulo: "x", status: "concluida" }).status, "concluida");
});

test("origem desconhecida cai para manual", () => {
  assert.equal(normalizeTask({ titulo: "x", origem: "email" }).origem, "manual");
  assert.equal(normalizeTask({ titulo: "x", origem: "consulta" }).origem, "consulta");
});

test("prazo fora do formato vira vazio em vez de data inventada", () => {
  assert.equal(normalizeTask({ titulo: "x", prazo: "26/08/2026" }).prazo, "");
  assert.equal(normalizeTask({ titulo: "x", prazo: "amanhã" }).prazo, "");
  assert.equal(normalizeTask({ titulo: "x", prazo: "2026-08-26" }).prazo, "2026-08-26");
});

test("checklist limpa vazios e duplicatas, e aceita string solta", () => {
  const t = normalizeTask({
    titulo: "x",
    itens: ["  Hemograma  ", "hemograma", "", "   ", { texto: "TSH", feito: true }, null],
  });
  assert.deepEqual(t.itens, [
    { texto: "Hemograma", feito: false },
    { texto: "TSH", feito: true },
  ]);
});

test("reabrir uma tarefa limpa quem concluiu", () => {
  const fechada = normalizeTask({
    titulo: "x", status: "concluida", concluidaPor: "u1", concluidaEm: "2026-08-20T10:00:00.000Z",
  });
  assert.equal(fechada.concluidaPor, "u1");

  const reaberta = normalizeTask({ ...fechada, status: "aberta" });
  assert.equal(reaberta.concluidaPor, "");
  assert.equal(reaberta.concluidaEm, "");
});

test("concluir sem informar quem ainda marca a data", () => {
  const t = normalizeTask({ titulo: "x", status: "concluida" });
  assert.ok(t.concluidaEm);
  assert.equal(t.concluidaPor, "");
});

test("id e criadoEm são preservados na re-normalização", () => {
  const original = normalizeTask({ titulo: "x" });
  const denovo = normalizeTask(original);
  assert.equal(denovo.id, original.id);
  assert.equal(denovo.criadoEm, original.criadoEm);
});

test("só o título é obrigatório", () => {
  assert.equal(validateTask(normalizeTask({ titulo: "Cobrar exames" })), null);
  assert.equal(validateTask(normalizeTask({ titulo: "   " })), "título é obrigatório");
  // Tarefa avulsa, sem paciente e sem responsável, é válida: entra na fila geral.
  const avulsa = normalizeTask({ titulo: "Ligar para o convênio" });
  assert.equal(validateTask(avulsa), null);
  assert.equal(avulsa.dealId, "");
  assert.equal(avulsa.assigneeId, "");
});
