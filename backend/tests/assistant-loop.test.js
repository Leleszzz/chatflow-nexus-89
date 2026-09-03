import test from "node:test";
import assert from "node:assert/strict";
import {
  runAssistantTurn, historicoParaOpenAI, recorte, MAX_RODADAS, MAX_TOKENS_RESPOSTA,
} from "../src/assistant/index.js";

// O laço é testado com uma função `chamar` de mentira. Este backend não tem mock
// de rede em lugar nenhum — o padrão da casa é extrair a lógica e exercitá-la
// sem tocar no provedor. Por isso `chamar`, `apiKey` e `registrarUso` são
// injetáveis.

const ctxFalso = {
  temAcessoClinico: true,
  user: { id: "u-dr", name: "Dr. Gustavo", role: "doutor" },
  hojeKey: "2026-08-28",
  hojeExtenso: "sexta-feira, 28 de agosto de 2026",
  horaAgora: "14:30",
  fuso: "America/Sao_Paulo",
  // As ferramentas de leitura precisam disso; nos casos abaixo só agenda_do_dia
  // é chamada de verdade.
  appointments: async () => [],
  dealsById: async () => new Map(),
  deals: async () => [],
};

const base = {
  ctx: ctxFalso,
  texto: "quais consultas tenho hoje?",
  apiKey: "sk-teste",
  registrarUso: async () => {},
};

const respostaTexto = conteudo => ({
  choices: [{ message: { role: "assistant", content: conteudo } }],
  usage: { prompt_tokens: 100, completion_tokens: 20 },
});

const respostaComTool = (nome, args = {}) => ({
  choices: [{
    message: {
      role: "assistant",
      content: null,
      tool_calls: [{ id: `call-${Math.random().toString(36).slice(2, 8)}`, type: "function", function: { name: nome, arguments: JSON.stringify(args) } }],
    },
  }],
  usage: { prompt_tokens: 100, completion_tokens: 20 },
});

test("resposta sem ferramenta termina numa rodada", async () => {
  let chamadas = 0;
  const r = await runAssistantTurn({
    ...base,
    chamar: async () => { chamadas += 1; return respostaTexto("Você tem 3 consultas hoje."); },
  });
  assert.equal(chamadas, 1);
  assert.equal(r.reply, "Você tem 3 consultas hoje.");
  assert.equal(r.passos.length, 0);
  assert.equal(r.interrompido, false);
});

test("ferramentas encadeadas: a rodada seguinte à última chamada é texto", async () => {
  const roteiro = [
    respostaComTool("agenda_do_dia", { data: "2026-08-28" }),
    respostaComTool("agenda_do_dia", { data: "2026-08-29" }),
    respostaComTool("agenda_do_dia", { data: "2026-08-30" }),
    respostaTexto("Resumo dos três dias."),
  ];
  let i = 0;
  const r = await runAssistantTurn({ ...base, chamar: async () => roteiro[i++] });
  assert.equal(i, 4);
  assert.equal(r.reply, "Resumo dos três dias.");
  assert.equal(r.passos.length, 3);
  assert.ok(r.passos.every(p => p.ok), "algum passo falhou sem motivo");
});

test("ferramenta desconhecida vira erro de conteúdo e o laço segue", async () => {
  // O modelo às vezes inventa nome de ferramenta. Derrubar o turno faria o
  // médico perder a pergunta; devolver o erro deixa o modelo se corrigir.
  const roteiro = [respostaComTool("ferramenta_que_nao_existe"), respostaTexto("Deixa comigo.")];
  let i = 0;
  const r = await runAssistantTurn({ ...base, chamar: async () => roteiro[i++] });
  assert.equal(r.reply, "Deixa comigo.");
  assert.equal(r.passos.length, 1);
  assert.equal(r.passos[0].ok, false);
  assert.match(r.passos[0].resumo, /desconhecida/);
});

test("argumento inválido não derruba o turno", async () => {
  // agenda_do_dia exige AAAA-MM-DD; a validação devolve a mensagem ao modelo.
  const roteiro = [respostaComTool("agenda_do_dia", { data: "28/13/2026" }), respostaTexto("Qual dia exatamente?")];
  let i = 0;
  const r = await runAssistantTurn({ ...base, chamar: async () => roteiro[i++] });
  assert.equal(r.passos[0].ok, false);
  assert.equal(r.reply, "Qual dia exatamente?");
});

test("JSON quebrado nos argumentos também é recuperável", async () => {
  const quebrada = {
    choices: [{
      message: {
        role: "assistant", content: null,
        tool_calls: [{ id: "c1", type: "function", function: { name: "agenda_do_dia", arguments: "{data:" } }],
      },
    }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  };
  const roteiro = [quebrada, respostaTexto("Reformulando.")];
  let i = 0;
  const r = await runAssistantTurn({ ...base, chamar: async () => roteiro[i++] });
  assert.equal(r.passos[0].ok, false);
  assert.match(r.passos[0].resumo, /JSON/);
  assert.equal(r.reply, "Reformulando.");
});

test("ferramenta clínica é recusada para quem não tem acesso", async () => {
  const roteiro = [respostaComTool("ler_consulta", { consulta_id: "c1" }), respostaTexto("Não posso ver isso.")];
  let i = 0;
  const r = await runAssistantTurn({
    ...base,
    ctx: { ...ctxFalso, temAcessoClinico: false },
    chamar: async () => roteiro[i++],
  });
  assert.equal(r.passos[0].ok, false);
  assert.match(r.passos[0].resumo, /cargo/);
});

test("estourar as rodadas ainda produz texto e marca interrompido", async () => {
  // Modelo teimoso: só chama ferramenta, nunca responde. Sair sem resposta faria
  // o chat parecer travado.
  let chamadas = 0;
  const r = await runAssistantTurn({
    ...base,
    chamar: async ({ tool_choice }) => {
      chamadas += 1;
      // A última rodada vai com tool_choice "none": aí o modelo responde texto.
      if (tool_choice === "none") return respostaTexto("Consegui ver só parte.");
      return respostaComTool("agenda_do_dia", { data: "2026-08-28" });
    },
  });
  assert.ok(chamadas <= MAX_RODADAS + 1, `chamou ${chamadas} vezes, acima do teto`);
  assert.equal(r.reply, "Consegui ver só parte.");
  assert.equal(r.interrompido, true);
});

test("modelo que nunca responde nada ainda devolve uma frase honesta", async () => {
  const r = await runAssistantTurn({ ...base, chamar: async () => respostaTexto("   ") });
  assert.ok(r.reply.length > 0, "ficou sem resposta");
  assert.equal(r.interrompido, true);
});

test("o teto de custo interrompe o turno", async () => {
  // Uma chamada absurda de cara: o teto tem de morder na primeira verificação.
  let chamadas = 0;
  const r = await runAssistantTurn({
    ...base,
    chamar: async ({ tool_choice }) => {
      chamadas += 1;
      if (tool_choice === "none") return respostaTexto("Parei por aqui.");
      return {
        ...respostaComTool("agenda_do_dia", { data: "2026-08-28" }),
        usage: { prompt_tokens: 10_000_000, completion_tokens: 10_000 },
      };
    },
  });
  assert.equal(r.interrompido, true);
  assert.ok(chamadas <= 3, `custo não conteve o laço: ${chamadas} chamadas`);
  assert.ok(r.usage.costUsd > 0);
});

test("o custo é somado em todas as rodadas", async () => {
  const roteiro = [respostaComTool("agenda_do_dia", { data: "2026-08-28" }), respostaTexto("ok")];
  let i = 0;
  const r = await runAssistantTurn({ ...base, chamar: async () => roteiro[i++] });
  assert.equal(r.usage.promptTokens, 200);
  assert.equal(r.usage.completionTokens, 40);
  assert.ok(r.usage.costUsd > 0, "custo ficou zerado");
});

test("onPasso é chamado a cada ferramenta e um erro nele não derruba o turno", async () => {
  const vistos = [];
  const roteiro = [respostaComTool("agenda_do_dia", { data: "2026-08-28" }), respostaTexto("ok")];
  let i = 0;
  const r = await runAssistantTurn({
    ...base,
    chamar: async () => roteiro[i++],
    onPasso: p => { vistos.push(p.tool); throw new Error("socket caiu"); },
  });
  assert.deepEqual(vistos, ["agenda_do_dia"]);
  assert.equal(r.reply, "ok");
});

test("o teto de saída é repassado à API", async () => {
  let recebido = null;
  await runAssistantTurn({
    ...base,
    chamar: async args => { recebido = args; return respostaTexto("ok"); },
  });
  assert.equal(recebido.max_tokens, MAX_TOKENS_RESPOSTA);
  assert.equal(recebido.tool_choice, "auto");
  assert.ok(recebido.tools.length > 0);
  assert.equal(recebido.messages[0].role, "system");
  assert.equal(recebido.messages.at(-1).content, "quais consultas tenho hoje?");
});

// --- funções puras ---

test("o histórico não refaz o replay das tool calls antigas", () => {
  const convertido = historicoParaOpenAI([
    { role: "user", body: "oi" },
    { role: "assistant", body: "olá", propostas: [{ tipo: "criar_tarefa", status: "recusada" }] },
  ]);
  assert.equal(convertido.length, 2);
  // A ação vira nota curta: o modelo precisa saber que já propôs e foi recusado,
  // mas o tool_call cru custaria token e exigiria o `role:"tool"` par.
  assert.match(convertido[1].content, /criar_tarefa — recusada/);
  assert.ok(!("tool_calls" in convertido[1]));
});

test("mensagem de assistente sem texto nem proposta é descartada", () => {
  const convertido = historicoParaOpenAI([{ role: "assistant", body: "", propostas: [] }]);
  assert.equal(convertido.length, 0);
});

test("o histórico respeita o limite", () => {
  const muitas = Array.from({ length: 40 }, (_, i) => ({ role: "user", body: `p${i}` }));
  const convertido = historicoParaOpenAI(muitas, 5);
  assert.equal(convertido.length, 5);
  assert.equal(convertido.at(-1).content, "p39");
});

test("resultado grande é cortado com aviso, não em silêncio", () => {
  const enorme = { itens: Array.from({ length: 5000 }, (_, i) => `item ${i}`) };
  const json = JSON.parse(recorte(enorme, 500));
  assert.equal(json.truncado, true);
  assert.match(json.aviso, /cortado/);
});

test("resultado pequeno passa inteiro", () => {
  assert.deepEqual(JSON.parse(recorte({ total: 2 })), { total: 2 });
});
