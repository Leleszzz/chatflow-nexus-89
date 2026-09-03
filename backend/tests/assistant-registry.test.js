import test from "node:test";
import assert from "node:assert/strict";
import { TOOLS, getTool, toolSchemas, buildToolsPrompt, toolsVisiveis } from "../src/assistant/tools/registry.js";

// Teste meta, no mesmo espírito de consultation-suggestions.test.js: itera o
// registro inteiro em vez de listar ferramenta por ferramenta. Ferramenta nova
// entra nestas asserções sozinha — que é justamente o ponto, porque o jeito de
// quebrar este assistente é adicionar uma capacidade e esquecer de um detalhe.

const doutor = { temAcessoClinico: true };
const secretaria = { temAcessoClinico: false };

test("toda ferramenta tem descrição e schema de objeto", () => {
  for (const [nome, def] of Object.entries(TOOLS)) {
    assert.ok(def.descricao && def.descricao.length > 20, `${nome}: descrição curta demais`);
    assert.equal(def.parameters?.type, "object", `${nome}: parameters precisa ser type object`);
    assert.equal(typeof def.normalize, "function", `${nome}: falta normalize`);
    assert.ok(["leitura", "escrita"].includes(def.tipo), `${nome}: tipo inválido`);
  }
});

test("todo campo obrigatório existe em properties", () => {
  // Um `required` apontando para propriedade inexistente faz a OpenAI recusar a
  // chamada inteira — e o erro sai do lado dela, difícil de ligar à causa.
  for (const [nome, def] of Object.entries(TOOLS)) {
    for (const campo of def.parameters.required || []) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(def.parameters.properties || {}, campo),
        `${nome}: required "${campo}" não está em properties`,
      );
    }
  }
});

test("ferramenta de leitura executa, ferramenta de escrita propõe", () => {
  for (const [nome, def] of Object.entries(TOOLS)) {
    if (def.tipo === "leitura") {
      assert.equal(typeof def.run, "function", `${nome}: leitura precisa de run`);
      // A separação é a regra de segurança inteira: leitura que soubesse
      // executar seria escrita disfarçada, sem passar pelo card de confirmação.
      assert.equal(def.execute, undefined, `${nome}: leitura não pode ter execute`);
    } else {
      assert.equal(typeof def.propose, "function", `${nome}: escrita precisa de propose`);
      assert.equal(typeof def.execute, "function", `${nome}: escrita precisa de execute`);
      assert.equal(typeof def.revalidar, "function", `${nome}: escrita precisa de revalidar`);
      assert.ok(Array.isArray(def.editaveis), `${nome}: escrita precisa declarar editaveis`);
      assert.equal(def.run, undefined, `${nome}: escrita não pode ter run`);
    }
  }
});

test("o prompt cita todas as ferramentas disponíveis", () => {
  // Se este teste falhar, alguém adicionou ferramenta e o modelo não vai saber
  // que ela existe. É o mesmo teste que suggestions.js tem sobre SUGGESTION_TYPES.
  const texto = buildToolsPrompt(doutor);
  for (const nome of Object.keys(TOOLS)) {
    assert.ok(texto.includes(nome), `${nome} não aparece no prompt derivado`);
  }
});

test("a secretária não enxerga nenhuma ferramenta clínica", () => {
  const nomes = toolSchemas(secretaria).map(s => s.function.name);
  for (const nome of nomes) {
    assert.equal(TOOLS[nome].exigeAcessoClinico, false, `${nome} é clínica e vazou para a secretária`);
  }
  // E o prompt dela também não pode citar o que ela não tem: o modelo tentaria
  // usar e gastaria uma rodada para descobrir que a ferramenta não existe.
  const texto = buildToolsPrompt(secretaria);
  const clinicas = Object.entries(TOOLS).filter(([, d]) => d.exigeAcessoClinico).map(([n]) => n);
  for (const nome of clinicas) {
    assert.ok(!texto.includes(nome), `${nome} apareceu no prompt da secretária`);
  }
  assert.ok(clinicas.length > 0, "o teste perde o sentido se nenhuma ferramenta for clínica");
});

test("o doutor enxerga tudo", () => {
  assert.equal(toolSchemas(doutor).length, Object.keys(TOOLS).length);
});

test("getTool não confunde herança com ferramenta", () => {
  assert.equal(getTool("buscar_paciente")?.tipo, "leitura");
  assert.equal(getTool("nao_existe"), null);
  // Sem hasOwnProperty, "constructor" e "toString" voltariam como ferramenta.
  assert.equal(getTool("constructor"), null);
  assert.equal(getTool("toString"), null);
});

test("buscar_paciente existe e é o ponto de entrada obrigatório", () => {
  // Toda ferramenta que pede paciente_id depende dela; se ela sumir do registro,
  // o modelo passa a inventar id.
  const def = getTool("buscar_paciente");
  assert.ok(def, "buscar_paciente sumiu do registro");
  const pedemPaciente = Object.entries(TOOLS)
    .filter(([, d]) => (d.parameters.required || []).includes("paciente_id"));
  assert.ok(pedemPaciente.length > 0);
  for (const [nome, d] of pedemPaciente) {
    assert.ok(d.parameters.properties.paciente_id, `${nome}: paciente_id sem descrição no schema`);
  }
});

test("toolsVisiveis separa leitura de escrita", () => {
  const { leitura, escrita } = toolsVisiveis(doutor);
  assert.equal(leitura.length + escrita.length, Object.keys(TOOLS).length);
  assert.ok(leitura.includes("agenda_do_dia"));
});
