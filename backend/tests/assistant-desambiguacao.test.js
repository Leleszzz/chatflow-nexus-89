import test from "node:test";
import assert from "node:assert/strict";
import {
  buscarPacientes, pontuacaoDoNome, normalizarNome, descreverQuando,
} from "../src/assistant/desambiguacao.js";

// O caso que motivou este arquivo veio do próprio pedido: dois Matheus na base,
// e o assistente tem de PERGUNTAR qual, com uma pista de cada. Chutar o mais
// recente é o comportamento que parece esperto e manda mensagem para o paciente
// errado.

const HOJE = "2026-08-28"; // uma sexta-feira

const deals = [
  { id: "d1", customer: "Matheus Soares", phone: "+55 27 99723-0505", lastInteraction: "2026-08-26T14:00:00Z" },
  { id: "d2", customer: "Matheus Leles", phone: "+55 27 98811-2233", lastInteraction: "2026-07-18T10:00:00Z" },
  { id: "d3", customer: "Júlio Prado", phone: "+55 27 98000-1111", lastInteraction: "2026-08-01T10:00:00Z" },
];
const ultimaConsultaPorDeal = new Map([["d1", "2026-08-26"], ["d2", "2026-07-18"], ["d3", "2026-08-01"]]);
const opcoes = { deals, ultimaConsultaPorDeal, hojeKey: HOJE };

test("dois homônimos voltam como dois candidatos, com pistas diferentes", () => {
  const r = buscarPacientes("matheus", opcoes);
  assert.equal(r.total, 2);
  assert.equal(r.candidatos.length, 2);
  const pistas = r.candidatos.map(c => c.pista);
  assert.notEqual(pistas[0], pistas[1], "as pistas não distinguem os dois — a pergunta ficaria inútil");
  assert.ok(pistas.some(p => p.includes("quarta")), "faltou o dia da semana da consulta recente");
  assert.ok(pistas.some(p => p.includes("mês passado")), "faltou a referência ao mês passado");
});

test("acento e caixa não atrapalham", () => {
  assert.equal(buscarPacientes("julio", opcoes).candidatos[0]?.nome, "Júlio Prado");
  assert.equal(buscarPacientes("JÚLIO", opcoes).candidatos[0]?.nome, "Júlio Prado");
  assert.equal(normalizarNome("Júlio Prado"), "julio prado");
});

test("nome único devolve um só candidato", () => {
  const r = buscarPacientes("leles", opcoes);
  assert.equal(r.total, 1);
  assert.equal(r.candidatos[0].paciente_id, "d2");
});

test("nome inexistente não chuta ninguém", () => {
  // O pior resultado possível aqui seria devolver "o mais parecido".
  const r = buscarPacientes("zeca", opcoes);
  assert.equal(r.total, 0);
  assert.deepEqual(r.candidatos, []);
});

test("não casa no meio da palavra", () => {
  // "teus" bateria com "Matheus" por substring, e produziria um candidato que o
  // médico não reconheceria como resposta à pergunta dele.
  assert.equal(buscarPacientes("teus", opcoes).total, 0);
  assert.equal(pontuacaoDoNome("Matheus Soares", "teus"), 0);
});

test("sobrenome sozinho e nome invertido funcionam", () => {
  assert.ok(pontuacaoDoNome("Matheus Leles", "leles") > 0);
  assert.ok(pontuacaoDoNome("Matheus Leles", "leles matheus") > 0);
});

test("telefone acha por trecho, sem DDI e completo", () => {
  for (const termo of ["98811", "5527988112233", "988112233"]) {
    const r = buscarPacientes(termo, opcoes);
    assert.equal(r.candidatos[0]?.paciente_id, "d2", `falhou para "${termo}"`);
  }
});

test("o candidato não expõe o telefone inteiro", () => {
  // Só o final: o suficiente para o médico reconhecer, sem despejar o número de
  // cada homônimo dentro do prompt.
  const c = buscarPacientes("matheus", opcoes).candidatos[0];
  assert.equal(c.telefone_final.length, 4);
  assert.equal(c.telefone, undefined);
});

test("paciente sem consulta ainda ganha uma pista", () => {
  const semConsulta = [{ id: "d9", customer: "Ana Nova", phone: "+55 27 97000-0000", lastInteraction: "2026-08-20T10:00:00Z" }];
  const c = buscarPacientes("ana", { deals: semConsulta, hojeKey: HOJE }).candidatos[0];
  assert.ok(c.pista.length > 0, "candidato sem pista nenhuma não dá para desempatar");
});

test("a lista é truncada mas o total conta o que foi filtrado", () => {
  const muitos = Array.from({ length: 12 }, (_, i) => ({
    id: `x${i}`, customer: `Carlos ${i}`, phone: "", lastInteraction: "2026-08-01T00:00:00Z",
  }));
  const r = buscarPacientes("carlos", { deals: muitos, hojeKey: HOJE, limite: 5 });
  assert.equal(r.candidatos.length, 5);
  assert.equal(r.total, 12);
  assert.equal(r.truncado, true);
});

test("descreverQuando fala como o médico fala", () => {
  assert.equal(descreverQuando("2026-08-28", HOJE), "veio hoje");
  assert.equal(descreverQuando("2026-08-27", HOJE), "veio ontem");
  assert.match(descreverQuando("2026-08-26", HOJE), /^veio na quarta \(26\/08\)$/);
  assert.match(descreverQuando("2026-08-20", HOJE), /semana passada/);
  assert.match(descreverQuando("2026-07-18", HOJE), /mês passado/);
  assert.match(descreverQuando("2026-01-10", HOJE), /^veio em 10\/01$/);
  // Data futura não é "veio".
  assert.match(descreverQuando("2026-09-03", HOJE), /^agendado para/);
});

test("o dia da semana sai sem o '-feira'", () => {
  // A pista existe para o médico reconhecer de ouvido, e ninguém fala
  // "veio na quarta-feira" no meio de uma pergunta.
  assert.ok(!descreverQuando("2026-08-26", HOJE).includes("-feira"));
});
