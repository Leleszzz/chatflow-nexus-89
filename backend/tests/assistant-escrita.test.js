import test from "node:test";
import assert from "node:assert/strict";
import { ESCRITA } from "../src/assistant/tools/escrita.js";
import { TOOL_DE_PROPOSTA } from "../src/assistant/propostas.js";

// A promessa central do assistente é "escrita nunca acontece sozinha". Estes
// testes cobram isso mecanicamente: montam um contexto que REGISTRA toda
// tentativa de escrever e verificam que `propose` não escreveu nada.

const DEAL = { id: "d-1", customer: "Lucas Prado", phone: "+55 27 99999-1111", stage: "novo", tags: [] };
const AGENDAMENTO = {
  id: "ap-1", title: "Consulta — Lucas Prado", dealId: "d-1", date: "2026-09-03",
  startTime: "14:00", endTime: "15:00", sellerId: "u-dr", status: "agendado", type: "retorno", description: "",
};

function contextoFalso(over = {}) {
  const escritas = [];
  const ctx = {
    user: { id: "u-dr", name: "Dr. Gustavo", role: "doutor" },
    agora: new Date("2026-08-28T17:00:00Z"),
    hojeKey: "2026-08-28",
    temAcessoClinico: true,
    appointments: async () => [AGENDAMENTO],
    dealsById: async () => new Map([[DEAL.id, DEAL]]),
    assertDeal: async id => {
      if (id !== DEAL.id) throw new Error("paciente não encontrado");
      return DEAL;
    },
    assertAgendamento: async id => {
      if (id !== AGENDAMENTO.id) throw new Error("agendamento não encontrado");
      return AGENDAMENTO;
    },
    usuario: async id => ({ id, name: "Ana Recepção", role: "secretaria" }),
    instanciaPara: async pref => ({ id: pref === "doutor" ? "wa-dr" : "wa-clinica", status: "ativa" }),
    instanciaConectada: () => true,
    conversaDoPaciente: async () => ({ id: "wa-clinica__551199@s.whatsapp.net", instanceId: "wa-clinica", chatId: "551199@s.whatsapp.net" }),
    criarAgendamento: async r => { escritas.push(["criarAgendamento", r]); return { ...AGENDAMENTO, ...r, id: "ap-novo" }; },
    atualizarAgendamento: async (id, p) => { escritas.push(["atualizarAgendamento", id, p]); return { ...AGENDAMENTO, ...p }; },
    criarTarefa: async r => { escritas.push(["criarTarefa", r]); return { ...r, id: "tk-novo" }; },
    enviarWhatsapp: async r => { escritas.push(["enviarWhatsapp", r]); return { messageId: "m-1" }; },
    programarWhatsapp: async r => { escritas.push(["programarWhatsapp", r]); return { ...r, id: "sch-1" }; },
    enviarMensagemInterna: async (id, texto) => {
      escritas.push(["enviarMensagemInterna", id, texto]);
      return { thread: { id: "dm-x" }, mensagem: { id: "im-1" } };
    },
    ...over,
  };
  return { ctx, escritas };
}

const ARGS_VALIDOS = {
  propor_agendamento: { paciente_id: "d-1", data: "2026-09-10", hora_inicio: "10:00" },
  propor_remarcacao: { agendamento_id: "ap-1", nova_data: "2026-09-04", nova_hora_inicio: "14:00" },
  propor_cancelamento: { agendamento_id: "ap-1" },
  propor_mensagem_whatsapp: { paciente_id: "d-1", texto: "Oi Lucas, tudo bem?" },
  propor_mensagem_agendada: { paciente_id: "d-1", texto: "Lembrete", data: "2026-09-09", hora: "09:00" },
  propor_tarefa: { titulo: "Cobrar retorno do Lucas" },
  propor_mensagem_interna: { usuario_id: "u-sec", texto: "Confirma o Lucas, por favor" },
};

test("propor NUNCA escreve — em nenhuma das ferramentas", async () => {
  for (const [nome, def] of Object.entries(ESCRITA)) {
    const { ctx, escritas } = contextoFalso();
    const proposta = await def.propose(def.normalize(ARGS_VALIDOS[nome]), ctx);
    assert.equal(escritas.length, 0, `${nome} escreveu durante o propose: ${JSON.stringify(escritas)}`);
    assert.equal(proposta.status, "pendente", `${nome} não nasceu pendente`);
    assert.ok(proposta.titulo, `${nome} sem título — o card ficaria anônimo`);
    assert.equal(TOOL_DE_PROPOSTA[proposta.tipo], nome, `${nome} devolveu tipo que aponta para outra ferramenta`);
  }
});

test("todo argumento de exemplo é aceito pelo normalize", async () => {
  // Blindagem contra o teste acima passar por acidente com argumentos que a
  // própria ferramenta recusaria.
  for (const [nome, def] of Object.entries(ESCRITA)) {
    assert.doesNotThrow(() => def.normalize(ARGS_VALIDOS[nome]), `${nome} recusou o exemplo`);
  }
});

test("agendamento acusa conflito de horário sem impedir a proposta", async () => {
  const { ctx } = contextoFalso();
  const def = ESCRITA.propor_agendamento;
  // Mesmo dia e hora do compromisso que já existe.
  const proposta = await def.propose(
    def.normalize({ paciente_id: "d-1", data: "2026-09-03", hora_inicio: "14:00" }),
    ctx,
  );
  const conflito = proposta.requisitos.find(r => r.chave === "sem_conflito");
  assert.equal(conflito.ok, false);
  assert.match(conflito.aviso, /já existe/i);
  // O card continua existindo: sumir deixaria o médico sem saber por que nada
  // apareceu depois de o assistente falar em marcar.
  assert.equal(proposta.status, "pendente");
});

test("remarcação não acusa conflito com o próprio compromisso", async () => {
  const { ctx } = contextoFalso();
  const def = ESCRITA.propor_remarcacao;
  const proposta = await def.propose(
    def.normalize({ agendamento_id: "ap-1", nova_data: "2026-09-03", nova_hora_inicio: "14:00" }),
    ctx,
  );
  assert.equal(proposta.requisitos.find(r => r.chave === "sem_conflito").ok, true);
});

test("instância desconectada vira requisito, não exceção", async () => {
  const { ctx } = contextoFalso({ instanciaConectada: () => false });
  const def = ESCRITA.propor_mensagem_whatsapp;
  const proposta = await def.propose(def.normalize(ARGS_VALIDOS.propor_mensagem_whatsapp), ctx);
  const req = proposta.requisitos.find(r => r.chave === "instancia_conectada");
  assert.equal(req.ok, false);
  assert.match(req.aviso, /desconectado/i);
});

test("paciente sem conversa no WhatsApp vira requisito", async () => {
  const { ctx } = contextoFalso({ conversaDoPaciente: async () => null });
  const def = ESCRITA.propor_mensagem_whatsapp;
  const proposta = await def.propose(def.normalize(ARGS_VALIDOS.propor_mensagem_whatsapp), ctx);
  assert.equal(proposta.requisitos.find(r => r.chave === "conversa_whatsapp").ok, false);
});

test("o padrão de envio é o WhatsApp da clínica", async () => {
  // Regra de negócio que a tela da Secretaria já aplica: cobrança e confirmação
  // não saem do número pessoal do doutor.
  const def = ESCRITA.propor_mensagem_whatsapp;
  assert.equal(def.normalize(ARGS_VALIDOS.propor_mensagem_whatsapp).instancia, "clinica");
  assert.equal(def.normalize({ ...ARGS_VALIDOS.propor_mensagem_whatsapp, instancia: "inventada" }).instancia, "clinica");
  assert.equal(def.normalize({ ...ARGS_VALIDOS.propor_mensagem_whatsapp, instancia: "doutor" }).instancia, "doutor");
});

test("mensagem programada para o passado é barrada", async () => {
  const { ctx } = contextoFalso();
  const def = ESCRITA.propor_mensagem_agendada;
  const proposta = await def.propose(
    def.normalize({ paciente_id: "d-1", texto: "x", data: "2026-08-01", hora: "09:00" }),
    ctx,
  );
  assert.equal(proposta.requisitos.find(r => r.chave === "no_futuro").ok, false);
});

test("mensagem interna para si mesmo é barrada", async () => {
  const { ctx } = contextoFalso({ usuario: async id => ({ id, name: "Eu", role: "doutor" }) });
  const def = ESCRITA.propor_mensagem_interna;
  const proposta = await def.propose(def.normalize({ usuario_id: "u-dr", texto: "oi" }), ctx);
  assert.equal(proposta.requisitos.find(r => r.chave === "nao_e_voce").ok, false);
});

// --- execução ---

test("remarcar altera a agenda e avisa o paciente", async () => {
  const { ctx, escritas } = contextoFalso();
  const def = ESCRITA.propor_remarcacao;
  const proposta = await def.propose(def.normalize(ARGS_VALIDOS.propor_remarcacao), ctx);
  const resultado = await def.execute(proposta.payload, ctx);

  const acoes = escritas.map(e => e[0]);
  assert.deepEqual(acoes, ["atualizarAgendamento", "enviarWhatsapp"], "ordem ou conjunto de efeitos mudou");
  assert.match(resultado.detalhe, /avisado/);
});

test("WhatsApp falhando não desfaz a agenda, e o resultado diz isso", async () => {
  // Decisão consciente: reverter o horário automaticamente seria pior — o médico
  // já viu a agenda nova e passaria a confiar num estado que voltou sozinho.
  const { ctx, escritas } = contextoFalso({
    enviarWhatsapp: async () => { throw new Error("instância desconectada"); },
  });
  const def = ESCRITA.propor_remarcacao;
  const proposta = await def.propose(def.normalize(ARGS_VALIDOS.propor_remarcacao), ctx);
  const resultado = await def.execute(proposta.payload, ctx);

  assert.equal(escritas[0][0], "atualizarAgendamento");
  assert.equal(resultado.parcial, true);
  assert.match(resultado.detalhe, /Agenda alterada/);
  assert.match(resultado.detalhe, /NÃO saiu/);
});

test("remarcar sem avisar não manda mensagem", async () => {
  const { ctx, escritas } = contextoFalso();
  const def = ESCRITA.propor_remarcacao;
  const proposta = await def.propose(
    def.normalize({ ...ARGS_VALIDOS.propor_remarcacao, avisar_paciente: false }),
    ctx,
  );
  await def.execute(proposta.payload, ctx);
  assert.deepEqual(escritas.map(e => e[0]), ["atualizarAgendamento"]);
});

test("cancelar marca como cancelado em vez de apagar", async () => {
  const { ctx, escritas } = contextoFalso();
  const def = ESCRITA.propor_cancelamento;
  const proposta = await def.propose(def.normalize(ARGS_VALIDOS.propor_cancelamento), ctx);
  await def.execute(proposta.payload, ctx);
  assert.equal(escritas[0][2].status, "cancelado");
});

test("tarefa criada guarda o vínculo com o paciente e a checklist", async () => {
  const { ctx, escritas } = contextoFalso();
  const def = ESCRITA.propor_tarefa;
  const proposta = await def.propose(
    def.normalize({ titulo: "Cobrar exames", paciente_id: "d-1", itens: ["Hemograma", "Raio-X"] }),
    ctx,
  );
  await def.execute(proposta.payload, ctx);
  const [, registro] = escritas[0];
  assert.equal(registro.dealId, "d-1");
  assert.deepEqual(registro.itens, ["Hemograma", "Raio-X"]);
  assert.equal(registro.status, "aberta");
});

test("revalidar recusa paciente que saiu do escopo entre propor e confirmar", async () => {
  // O card fica na tela; o acesso pode mudar no meio. Confirmar não pode confiar
  // no que era verdade quando a proposta foi montada.
  const def = ESCRITA.propor_mensagem_whatsapp;
  const { ctx } = contextoFalso();
  const proposta = await def.propose(def.normalize(ARGS_VALIDOS.propor_mensagem_whatsapp), ctx);

  const { ctx: depois } = contextoFalso({
    assertDeal: async () => { throw new Error("paciente não encontrado"); },
  });
  await assert.rejects(() => def.revalidar(proposta.payload, depois), /não encontrado/);
});

test("revalidar recusa texto esvaziado na edição", async () => {
  const { ctx } = contextoFalso();
  const def = ESCRITA.propor_mensagem_whatsapp;
  await assert.rejects(
    () => def.revalidar({ paciente_id: "d-1", texto: "   " }, ctx),
    /obrigatório/,
  );
});
