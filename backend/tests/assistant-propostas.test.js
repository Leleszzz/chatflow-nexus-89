import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeProposal, novaProposta, aplicarEdicao, requisitosPendentes, podeConfirmar,
  TIPOS_PROPOSTA, TOOL_DE_PROPOSTA,
} from "../src/assistant/propostas.js";

// A proposta é o que impede o assistente de agir sozinho. O teste mais
// importante deste arquivo é o da lista branca de edição: é ali que uma injeção
// de prompt tentaria trocar o destinatário depois que o card já foi desenhado —
// o médico leria "avisar o Lucas" e confirmaria um envio para outra pessoa.

const exemplo = () => novaProposta({
  tipo: "enviar_whatsapp",
  titulo: "Avisar o Lucas",
  resumo: "Mensagem sobre a remarcação",
  payload: { paciente_id: "d-1", texto: "Oi Lucas, sua consulta mudou.", instancia: "clinica" },
  preview: { texto: "Oi Lucas, sua consulta mudou.", linhas: [{ rotulo: "Paciente", valor: "Lucas" }] },
});

test("edição só aceita os campos declarados como editáveis", () => {
  const p = exemplo();
  const payload = aplicarEdicao(p, ["texto"], {
    texto: "Oi Lucas, mudou para quinta.",
    paciente_id: "d-999",
  });
  assert.equal(payload.texto, "Oi Lucas, mudou para quinta.");
  // O destinatário é imutável depois do card: este assert é a defesa.
  assert.equal(payload.paciente_id, "d-1", "o destinatário foi trocado pela edição");
});

test("campo inventado pelo cliente não entra no payload", () => {
  const payload = aplicarEdicao(exemplo(), ["texto"], { instancia_id: "wa-hacker", admin: true });
  assert.equal(payload.instancia_id, undefined);
  assert.equal(payload.admin, undefined);
});

test("edição ausente ou inválida devolve o payload original", () => {
  const p = exemplo();
  assert.deepEqual(aplicarEdicao(p, ["texto"], undefined), p.payload);
  assert.deepEqual(aplicarEdicao(p, ["texto"], null), p.payload);
  assert.deepEqual(aplicarEdicao(p, ["texto"], "texto novo"), p.payload);
});

test("undefined não apaga campo do payload", () => {
  const payload = aplicarEdicao(exemplo(), ["texto"], { texto: undefined });
  assert.equal(payload.texto, "Oi Lucas, sua consulta mudou.");
});

test("lista de editáveis vazia congela o payload inteiro", () => {
  const p = exemplo();
  assert.deepEqual(aplicarEdicao(p, [], { texto: "outro" }), p.payload);
  assert.deepEqual(aplicarEdicao(p, undefined, { texto: "outro" }), p.payload);
});

test("tipo desconhecido não vira proposta", () => {
  assert.equal(normalizeProposal({ tipo: "apagar_prontuario" }), null);
  assert.equal(normalizeProposal({}), null);
  assert.throws(() => novaProposta({ tipo: "nao_existe" }), /desconhecido/);
});

test("status inválido cai em pendente", () => {
  const p = normalizeProposal({ tipo: "criar_tarefa", status: "executada_ja_pode_ir" });
  assert.equal(p.status, "pendente");
});

test("proposta pendente nasce sem decisão registrada", () => {
  const p = exemplo();
  assert.equal(p.status, "pendente");
  assert.equal(p.decididoEm, "");
  assert.equal(p.resultado, null);
  assert.match(p.id, /^pr-/);
});

test("campo fora da whitelist é descartado no normalize", () => {
  const p = normalizeProposal({ tipo: "criar_tarefa", titulo: "x", executarAgora: true });
  assert.equal(p.executarAgora, undefined);
});

test("requisito não atendido bloqueia a confirmação mas não some com a proposta", () => {
  // Sumir com o card deixaria o médico sem entender por que o assistente falou
  // em remarcar e nada apareceu.
  const p = novaProposta({
    tipo: "remarcar_agendamento",
    titulo: "Remarcar",
    payload: {},
    requisitos: [
      { chave: "conversa_whatsapp", ok: true },
      { chave: "instancia_conectada", ok: false, aviso: "O WhatsApp da clínica está desconectado." },
    ],
  });
  assert.equal(p.requisitos.length, 2);
  assert.equal(requisitosPendentes(p).length, 1);
  assert.equal(podeConfirmar(p), false);
});

test("proposta sem pendência e ainda pendente pode ser confirmada", () => {
  assert.equal(podeConfirmar(exemplo()), true);
});

test("proposta já decidida não pode ser confirmada de novo", () => {
  const p = normalizeProposal({ ...exemplo(), status: "confirmada" });
  assert.equal(podeConfirmar(p), false);
});

test("todo tipo de proposta tem uma ferramenta que sabe executá-lo", () => {
  // Sem isso, o card apareceria na tela e o botão de confirmar não teria o que
  // chamar — falha que só surgiria no clique do médico.
  for (const tipo of TIPOS_PROPOSTA) {
    assert.ok(TOOL_DE_PROPOSTA[tipo], `tipo "${tipo}" não tem ferramenta associada`);
  }
});
