import test from "node:test";
import assert from "node:assert/strict";
import {
  exigirData, exigirHora, exigirTexto, exigirId, inteiro, intervaloDeDatas, somarDias,
} from "../src/assistant/validacao.js";
import { chaveDoDia } from "../src/assistant/contexto.js";

// O modelo erra formato o tempo todo — manda 28/08/2026 onde o schema pede
// 2026-08-28, e "9h" onde se espera "09:00". Coagir o que dá e recusar o resto
// com uma mensagem que ENSINA o formato é o que faz o turno se recuperar em vez
// de morrer.

test("aceita o formato certo", () => {
  assert.equal(exigirData("2026-08-28"), "2026-08-28");
});

test("converte a data escrita à brasileira", () => {
  assert.equal(exigirData("28/08/2026"), "2026-08-28");
});

test("recusa data que não existe no calendário", () => {
  // "2026-02-31" passa no regex e viraria 03/03 se fosse construída sem conferir.
  assert.throws(() => exigirData("2026-02-31"), /não existe no calendário/);
  assert.throws(() => exigirData("2026-13-01"), /DATA_INVALIDA|não/);
});

test("a mensagem de erro ensina o formato ao modelo", () => {
  try {
    exigirData("amanhã", "data");
    assert.fail("devia ter lançado");
  } catch (err) {
    assert.match(err.message, /AAAA-MM-DD/);
    assert.equal(err.codigo, "DATA_INVALIDA");
  }
});

test("hora aceita o que sai de uma fala transcrita", () => {
  assert.equal(exigirHora("14:00"), "14:00");
  assert.equal(exigirHora("9:00"), "09:00");
  assert.equal(exigirHora("9"), "09:00");
  assert.equal(exigirHora("9h"), "09:00");
  assert.equal(exigirHora("14h30"), "14:30");
});

test("hora impossível é recusada", () => {
  assert.throws(() => exigirHora("25:00"), /HH:MM/);
  assert.throws(() => exigirHora("14:99"), /HH:MM/);
});

test("texto e id obrigatórios reclamam quando faltam", () => {
  assert.throws(() => exigirTexto("", "titulo"), /titulo é obrigatório/);
  assert.throws(() => exigirTexto("   ", "titulo"), /obrigatório/);
  assert.throws(() => exigirId(undefined, "paciente_id"), /paciente_id é obrigatório/);
});

test("inteiro respeita padrão e limites", () => {
  assert.equal(inteiro(undefined, { padrao: 20, min: 1, max: 50 }), 20);
  assert.equal(inteiro("abc", { padrao: 20 }), 20);
  assert.equal(inteiro(999, { padrao: 20, min: 1, max: 50 }), 50);
  assert.equal(inteiro(0, { padrao: 20, min: 1, max: 50 }), 1);
});

test("intervalo longo demais é recusado com o número de dias", () => {
  // "me mostre a agenda do ano" carregaria centenas de compromissos para dentro
  // do prompt e produziria uma resposta que ninguém lê.
  try {
    intervaloDeDatas("2026-01-01", "2026-12-31");
    assert.fail("devia ter lançado");
  } catch (err) {
    assert.match(err.message, /365 dias/);
    assert.equal(err.codigo, "INTERVALO_LONGO");
  }
});

test("intervalo invertido é recusado", () => {
  assert.throws(() => intervaloDeDatas("2026-08-30", "2026-08-28"), /anterior/);
});

test("intervalo de uma semana passa e conta os dias inclusive", () => {
  const r = intervaloDeDatas("2026-08-31", "2026-09-06");
  assert.equal(r.dias, 7);
  assert.equal(r.inicio, "2026-08-31");
});

test("somarDias atravessa a virada de mês", () => {
  assert.equal(somarDias("2026-08-31", 1), "2026-09-01");
  assert.equal(somarDias("2026-01-01", -1), "2025-12-31");
});

// --- fuso ---

test("hoje sai no fuso da clínica, não no do processo", () => {
  // Este é o bug silencioso mais provável de toda a entrega: num contêiner em
  // UTC, toISOString().slice(0,10) devolve o dia seguinte depois das 21h, e o
  // médico pergunta "quais consultas tenho hoje" e recebe as de amanhã.
  const noiteDeBrasilia = new Date("2026-08-29T02:30:00Z"); // 23:30 de 28/08 em SP
  assert.equal(chaveDoDia(noiteDeBrasilia, "America/Sao_Paulo"), "2026-08-28");
  assert.equal(noiteDeBrasilia.toISOString().slice(0, 10), "2026-08-29");
});

test("de manhã os dois coincidem", () => {
  const manha = new Date("2026-08-28T13:00:00Z");
  assert.equal(chaveDoDia(manha, "America/Sao_Paulo"), "2026-08-28");
});
