import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeSuggestions,
  mergeSuggestions,
  buildSuggestionsPrompt,
  SUGGESTION_TYPES,
} from "../src/lib/transcription/suggestions.js";

test("descarta tipo que não está no registro", () => {
  const out = normalizeSuggestions([
    { tipo: "mandar_boleto", payload: { texto: "oi" } },
    { tipo: "exames", payload: { itens: ["TSH"] } },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].tipo, "exames");
});

test("data e hora inválidas viram string vazia em vez de chute", () => {
  const [s] = normalizeSuggestions([
    { tipo: "agendar_retorno", payload: { data: "03/09/2026", hora: "25:00", motivo: "reavaliar pressão" } },
  ]);
  assert.equal(s.payload.data, "");
  assert.equal(s.payload.hora, "");
  assert.equal(s.payload.motivo, "reavaliar pressão");
});

test("data e hora válidas passam intactas", () => {
  const [s] = normalizeSuggestions([
    { tipo: "agendar_retorno", payload: { data: "2026-09-03", hora: "14:00" } },
  ]);
  assert.equal(s.payload.data, "2026-09-03");
  assert.equal(s.payload.hora, "14:00");
});

test("retorno sem data sobrevive — o médico escolhe a data no diálogo", () => {
  const out = normalizeSuggestions([{ tipo: "agendar_retorno", payload: {} }]);
  assert.equal(out.length, 1);
});

test("lista de exames é limpa, deduplicada e limitada", () => {
  const [s] = normalizeSuggestions([
    { tipo: "exames", payload: { itens: ["  Hemograma  ", "hemograma", "", "  ", "TSH", null] } },
  ]);
  assert.deepEqual(s.payload.itens, ["Hemograma", "TSH"]);
});

test("sugestão sem conteúdo é descartada", () => {
  const out = normalizeSuggestions([
    { tipo: "exames", payload: { itens: [] } },
    { tipo: "orientacoes", payload: { texto: "   " } },
    { tipo: "confirmacao", payload: {} },
  ]);
  assert.deepEqual(out, []);
});

test("só uma sugestão por tipo — a primeira vence", () => {
  const out = normalizeSuggestions([
    { tipo: "exames", payload: { itens: ["TSH"] } },
    { tipo: "exames", payload: { itens: ["Hemograma"] } },
  ]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].payload.itens, ["TSH"]);
});

test("id, status e concluidoEm sobrevivem à re-normalização", () => {
  const gravado = [{
    id: "sg-fixo",
    tipo: "exames",
    payload: { itens: ["TSH"] },
    status: "feito",
    geradoEm: "2026-08-01T10:00:00.000Z",
    concluidoEm: "2026-08-01T10:05:00.000Z",
  }];
  const [s] = normalizeSuggestions(gravado);
  assert.equal(s.id, "sg-fixo");
  assert.equal(s.status, "feito");
  assert.equal(s.geradoEm, "2026-08-01T10:00:00.000Z");
  assert.equal(s.concluidoEm, "2026-08-01T10:05:00.000Z");
});

test("status desconhecido cai para pendente", () => {
  const [s] = normalizeSuggestions([{ tipo: "exames", payload: { itens: ["TSH"] }, status: "enviado" }]);
  assert.equal(s.status, "pendente");
});

test("entrada que não é array vira lista vazia", () => {
  assert.deepEqual(normalizeSuggestions(undefined), []);
  assert.deepEqual(normalizeSuggestions("acoes"), []);
});

test("regerar mantém o que já foi executado e não duplica o tipo", () => {
  const anteriores = [
    { id: "sg-1", tipo: "exames", payload: { itens: ["TSH"] }, status: "feito" },
    { id: "sg-2", tipo: "confirmacao", payload: { texto: "antigo" }, status: "pendente" },
  ];
  const novas = [
    { tipo: "exames", payload: { itens: ["Hemograma"] } },
    { tipo: "confirmacao", payload: { texto: "novo" } },
  ];
  const out = mergeSuggestions(novas, anteriores);

  const porTipo = Object.fromEntries(out.map(s => [s.tipo, s]));
  assert.equal(out.length, 2);
  // O exame já enviado fica como estava — reaparecer como pendente faria o
  // médico mandar a lista duas vezes.
  assert.equal(porTipo.exames.id, "sg-1");
  assert.deepEqual(porTipo.exames.payload.itens, ["TSH"]);
  // A confirmação ainda pendente é substituída pela leitura nova.
  assert.equal(porTipo.confirmacao.payload.texto, "novo");
});

test("o prompt cita todos os tipos do registro", () => {
  const prompt = buildSuggestionsPrompt();
  for (const tipo of Object.keys(SUGGESTION_TYPES)) {
    assert.ok(prompt.includes(`"${tipo}"`), `prompt não cita ${tipo}`);
  }
});
