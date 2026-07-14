// Testa o MESMO arquivo que o front usa (src/lib/message-template.js), sem cópia
// nem transformação — se a lógica mudar lá, estes testes pegam.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  renderTemplate,
  variaveisDesconhecidas,
  saudacaoAgora,
  TEMPLATE_VARIABLES,
} from "../../src/lib/message-template.js";

const CTX = {
  nome: "Maria Silva Santos",
  nomeWhatsapp: "Maria 🌻",
  telefone: "+55 27 99723-0505",
  listaNome: "MARIA SILVA SANTOS",
  listaCpf: "34615783809",
  listaTelefone: "27997230505",
  atendente: "Matheus",
};

test("troca variáveis vindas do WhatsApp", () => {
  assert.equal(renderTemplate("Olá {{nome}}", CTX), "Olá Maria Silva Santos");
  assert.equal(renderTemplate("Oi {{primeiro_nome}}!", CTX), "Oi Maria!");
  assert.equal(renderTemplate("{{nome_whatsapp}}", CTX), "Maria 🌻");
  assert.equal(renderTemplate("{{telefone}}", CTX), "+55 27 99723-0505");
});

test("troca variáveis da lista importada e formata o CPF", () => {
  assert.equal(renderTemplate("{{lista.nome}}", CTX), "MARIA SILVA SANTOS");
  assert.equal(renderTemplate("{{lista.primeiro_nome}}", CTX), "MARIA");
  assert.equal(renderTemplate("CPF {{lista.cpf}}", CTX), "CPF 346.157.838-09");
  assert.equal(renderTemplate("{{lista.telefone}}", CTX), "27997230505");
});

test("variável sem valor vira vazio — nunca vaza {{...}} para o cliente", () => {
  // Lead que NÃO está na lista importada: as variáveis de lista ficam sem valor.
  const semLista = { nome: "João", atendente: "Matheus" };
  const saida = renderTemplate("Oi {{primeiro_nome}}, o CPF {{lista.cpf}} confere?", semLista);
  assert.ok(!saida.includes("{{"), `vazou template cru: ${saida}`);
  assert.equal(saida, "Oi João, o CPF confere?");
});

test("variável inexistente também não vaza", () => {
  assert.ok(!renderTemplate("Oi {{nao_existe}}", CTX).includes("{{"));
});

test("aceita espaços dentro das chaves", () => {
  assert.equal(renderTemplate("Oi {{ primeiro_nome }}", CTX), "Oi Maria");
});

test("saudação acompanha o horário", () => {
  assert.equal(saudacaoAgora(new Date(2026, 0, 1, 9, 0)), "Bom dia");
  assert.equal(saudacaoAgora(new Date(2026, 0, 1, 14, 0)), "Boa tarde");
  assert.equal(saudacaoAgora(new Date(2026, 0, 1, 21, 0)), "Boa noite");
});

test("variaveisDesconhecidas aponta o que não existe", () => {
  assert.deepEqual(variaveisDesconhecidas("{{nome}} {{lista.cpf}}"), []);
  assert.deepEqual(variaveisDesconhecidas("{{nome}} {{inventada}} {{outra}}"), ["inventada", "outra"]);
});

test("toda variável oferecida na interface realmente resolve", () => {
  for (const v of TEMPLATE_VARIABLES) {
    const saida = renderTemplate(`{{${v.chave}}}`, CTX);
    assert.ok(!saida.includes("{{"), `variável oferecida não resolve: ${v.chave}`);
    assert.ok(saida.length > 0, `variável oferecida resolve vazio mesmo com contexto completo: ${v.chave}`);
  }
});

test("mensagem realista de abordagem sai limpa", () => {
  const modelo = "{{saudacao}}, {{primeiro_nome}}!\nAqui é {{atendente}}. Confirma pra mim o CPF {{lista.cpf}}?";
  const saida = renderTemplate(modelo, CTX);
  assert.ok(saida.startsWith("Bom dia") || saida.startsWith("Boa tarde") || saida.startsWith("Boa noite"));
  assert.ok(saida.includes("Maria!"));
  assert.ok(saida.includes("346.157.838-09"));
  assert.ok(!saida.includes("{{"));
});
