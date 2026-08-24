import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSpeakers, renderTranscript } from "../src/lib/transcription/render.js";

const seg = (speaker, start, text) => ({ speaker, start, end: start + 2, text });

test("buildSpeakers cria um rótulo por falante, na ordem em que aparecem", () => {
  const speakers = buildSpeakers([seg("B", 0, "oi"), seg("A", 3, "olá"), seg("B", 6, "tudo bem")]);
  assert.deepEqual(speakers, [
    { key: "B", label: "Pessoa 1", role: "outro" },
    { key: "A", label: "Pessoa 2", role: "outro" },
  ]);
});

test("buildSpeakers preserva o rótulo que o médico já deu", () => {
  const anteriores = [{ key: "A", label: "Dr. Ana", role: "medico" }];
  const speakers = buildSpeakers([seg("A", 0, "bom dia"), seg("B", 2, "bom dia")], anteriores);
  assert.deepEqual(speakers[0], { key: "A", label: "Dr. Ana", role: "medico" });
  // Falante novo entra com o rótulo genérico, sem apagar o que já existia.
  assert.equal(speakers[1].key, "B");
  assert.equal(speakers[1].label, "Pessoa 2");
});

test("renderTranscript usa os nomes reais dos falantes", () => {
  const segments = [seg("A", 0, "Qual é a queixa?"), seg("B", 5, "Dor de cabeça.")];
  const speakers = [
    { key: "A", label: "Dr. Ana", role: "medico" },
    { key: "B", label: "Paciente", role: "paciente" },
  ];
  assert.equal(
    renderTranscript(segments, speakers),
    "[00:00] Dr. Ana: Qual é a queixa?\n[00:05] Paciente: Dor de cabeça.",
  );
});

test("falas seguidas do mesmo falante viram um parágrafo só", () => {
  // O Whisper corta a cada pausa; sem a fusão a transcrição vira uma lista de
  // fragmentos de três palavras, ruim de ler para humano e para a IA.
  const segments = [seg("A", 0, "Bom dia."), seg("A", 2, "Sente dor?"), seg("B", 6, "Sinto.")];
  const speakers = buildSpeakers(segments);
  const linhas = renderTranscript(segments, speakers).split("\n");
  assert.equal(linhas.length, 2);
  assert.equal(linhas[0], "[00:00] Pessoa 1: Bom dia. Sente dor?");
  assert.equal(linhas[1], "[00:06] Pessoa 2: Sinto.");
});

test("timecode passa a mostrar a hora em consultas longas", () => {
  const segments = [seg("A", 3725, "última orientação")];
  assert.match(renderTranscript(segments, buildSpeakers(segments)), /^\[1:02:05\]/);
});

test("segmentos vazios são descartados em vez de virarem linha em branco", () => {
  const segments = [seg("A", 0, "oi"), seg("A", 1, "   "), seg("B", 2, "olá")];
  const linhas = renderTranscript(segments, buildSpeakers(segments)).split("\n");
  assert.equal(linhas.length, 2);
});

test("renderTranscript aguenta lista vazia sem quebrar", () => {
  assert.equal(renderTranscript([], []), "");
  assert.equal(renderTranscript(undefined, undefined), "");
  assert.deepEqual(buildSpeakers(undefined), []);
});
