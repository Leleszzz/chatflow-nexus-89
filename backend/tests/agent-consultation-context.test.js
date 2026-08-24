import { test } from "node:test";
import assert from "node:assert/strict";
import { formatConsultationContext, TRANSCRICAO_MAX_CHARS } from "../src/routes/agents.js";

const consulta = (patch = {}) => ({
  status: "pronto",
  recordedAt: "2026-08-20T14:00:00.000Z",
  transcriptText: "[00:00] Dra. Ana: Bom dia.\n[00:05] Paciente: Dor de cabeça.",
  ...patch,
});

test("sem consultas, nada é injetado no prompt", () => {
  assert.equal(formatConsultationContext([]), "");
  assert.equal(formatConsultationContext(undefined), "");
});

test("consulta ainda processando ou com erro não entra no prompt", () => {
  assert.equal(formatConsultationContext([consulta({ status: "processando" })]), "");
  assert.equal(formatConsultationContext([consulta({ status: "erro" })]), "");
});

test("o resumo clínico é preferido à transcrição crua", () => {
  const texto = formatConsultationContext([consulta({
    summary: { queixa: "Cefaleia", historico: "", avaliacao: "", conduta: "Hemograma" },
  })]);
  assert.match(texto, /Resumo da última consulta/);
  assert.match(texto, /Queixa: Cefaleia/);
  assert.match(texto, /Conduta: Hemograma/);
  // Campos vazios não viram linha em branco no prompt.
  assert.doesNotMatch(texto, /Histórico:/);
  assert.doesNotMatch(texto, /Dor de cabeça/);
});

test("sem resumo, cai para a transcrição", () => {
  const texto = formatConsultationContext([consulta()]);
  assert.match(texto, /Transcrição da última consulta/);
  assert.match(texto, /Dor de cabeça/);
});

test("resumo com todos os campos vazios não bloqueia a transcrição", () => {
  const texto = formatConsultationContext([consulta({
    summary: { queixa: "", historico: "", avaliacao: "", conduta: "" },
  })]);
  assert.match(texto, /Transcrição da última consulta/);
});

test("a consulta mais recente é a escolhida", () => {
  const texto = formatConsultationContext([
    consulta({ recordedAt: "2026-01-10T10:00:00.000Z", transcriptText: "consulta antiga" }),
    consulta({ recordedAt: "2026-08-20T10:00:00.000Z", transcriptText: "consulta recente" }),
  ]);
  assert.match(texto, /consulta recente/);
  assert.doesNotMatch(texto, /consulta antiga/);
});

test("transcrição longa é truncada pelo começo, preservando a conduta", () => {
  const conduta = "Retorno em 15 dias com o hemograma.";
  const transcriptText = "x".repeat(TRANSCRICAO_MAX_CHARS + 500) + conduta;
  const texto = formatConsultationContext([consulta({ transcriptText })]);
  assert.match(texto, /\[trecho inicial omitido\]/);
  assert.match(texto, new RegExp(conduta.replace(/\./g, "\\.")));
  assert.ok(texto.length < transcriptText.length, "o texto injetado deve ser menor que o original");
});

test("o prompt sempre carrega a ressalva de não diagnosticar", () => {
  for (const c of [consulta(), consulta({ summary: { queixa: "Cefaleia", historico: "", avaliacao: "", conduta: "" } })]) {
    assert.match(formatConsultationContext([c]), /não faça diagnóstico e não prescreva/);
  }
});
