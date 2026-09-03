// Ferramentas de ESCRITA do assistente.
//
// Nenhuma delas executa. Todas devolvem uma proposta — o card que o médico
// confirma com um clique. Isso é decisão de segurança antes de ser de interface:
// mensagem de paciente e transcrição entram no contexto do modelo, e uma injeção
// bem-sucedida precisa parar em algum lugar. Para aqui: o pior que ela consegue
// é desenhar um card estranho na tela de quem lê antes de clicar.
//
// Cada ferramenta tem quatro partes:
//   normalize  valida os argumentos do modelo
//   propose    monta a proposta e avalia os pré-requisitos (não escreve nada)
//   revalidar  refaz as checagens NA HORA da confirmação — minutos depois, com o
//              payload possivelmente editado pelo médico no card
//   execute    finalmente age
//
// Mesma regra de leitura.js: nada importa de ../../storage/. Tudo passa por ctx.

import { AssistantToolError } from "../erros.js";
import { novaProposta } from "../propostas.js";
import { limparTexto } from "../sanitize.js";
import { exigirData, exigirHora, exigirId, exigirTexto, opcionalTexto } from "../validacao.js";
import { conflitosNoHorario, minutesFromTime, timeFromMinutes } from "../../lib/agenda-slots.js";

const TIPOS_AGENDAMENTO = [
  "retorno", "reuniao", "follow-up", "ligacao", "demonstracao", "pos-venda", "retorno-comercial", "outro",
];
const INSTANCIAS = ["clinica", "doutor"];

const dataBR = key => {
  const [ano, mes, dia] = String(key).split("-");
  return dia ? `${dia}/${mes}/${ano}` : String(key);
};

/** Fim padrão: uma hora depois do início, como a grade da agenda. */
const fimPadrao = inicio => timeFromMinutes(minutesFromTime(inicio) + 60);

const normalizarInstancia = valor => (INSTANCIAS.includes(valor) ? valor : "clinica");

/**
 * Pré-requisitos de qualquer envio ao paciente.
 *
 * Requisito falho NÃO impede a proposta de existir — o card mostra o aviso e
 * desabilita o botão. Sumir com o card deixaria o médico sem entender por que o
 * assistente falou em avisar o paciente e nada apareceu.
 */
async function requisitosDeEnvio(ctx, dealId, preferencia) {
  const requisitos = [];
  let instancia = null;
  let conversa = null;

  try {
    instancia = await ctx.instanciaPara(preferencia);
    requisitos.push({
      chave: "instancia_conectada",
      ok: ctx.instanciaConectada(instancia.id),
      aviso: `O WhatsApp ${preferencia === "doutor" ? "do doutor" : "da clínica"} está desconectado. Reconecte em Instâncias.`,
    });
  } catch (err) {
    requisitos.push({ chave: "instancia_configurada", ok: false, aviso: err.message });
  }

  conversa = await ctx.conversaDoPaciente(dealId);
  requisitos.push({
    chave: "conversa_whatsapp",
    ok: Boolean(conversa),
    aviso: "Este paciente ainda não tem conversa no WhatsApp. Abra a conversa em Conversas antes.",
  });

  return { requisitos, instancia, conversa };
}

/** O caminho de envio, revalidado. Usado no execute, nunca no propose. */
async function resolverEnvio(ctx, dealId, preferencia) {
  const instancia = await ctx.instanciaPara(preferencia);
  if (!ctx.instanciaConectada(instancia.id)) {
    throw new AssistantToolError("a instância de WhatsApp está desconectada", "INSTANCIA_OFFLINE");
  }
  const conversa = await ctx.conversaDoPaciente(dealId);
  if (!conversa) {
    throw new AssistantToolError("este paciente não tem conversa no WhatsApp", "SEM_CONVERSA");
  }
  return { instancia, conversa };
}

export const ESCRITA = {
  propor_agendamento: {
    tipo: "escrita",
    exigeAcessoClinico: false,
    descricao:
      "Propõe MARCAR uma consulta nova. Não marca nada: gera um card que o médico confirma. "
      + "Confira antes se o horário está livre com horarios_livres.",
    parameters: {
      type: "object",
      properties: {
        paciente_id: { type: "string" },
        data: { type: "string", description: "AAAA-MM-DD" },
        hora_inicio: { type: "string", description: "HH:MM" },
        hora_fim: { type: "string", description: "HH:MM (padrão: uma hora depois do início)" },
        titulo: { type: "string" },
        tipo: { type: "string", enum: TIPOS_AGENDAMENTO },
        descricao: { type: "string" },
      },
      required: ["paciente_id", "data", "hora_inicio"],
    },
    editaveis: ["data", "hora_inicio", "hora_fim", "titulo", "descricao", "tipo"],
    normalize(args) {
      const inicio = exigirHora(args?.hora_inicio, "hora_inicio");
      return {
        paciente_id: exigirId(args?.paciente_id, "paciente_id"),
        data: exigirData(args?.data, "data"),
        hora_inicio: inicio,
        hora_fim: args?.hora_fim ? exigirHora(args.hora_fim, "hora_fim") : fimPadrao(inicio),
        titulo: opcionalTexto(args?.titulo, 200),
        tipo: TIPOS_AGENDAMENTO.includes(args?.tipo) ? args.tipo : "retorno",
        descricao: opcionalTexto(args?.descricao, 500),
      };
    },
    async propose(payload, ctx) {
      const deal = await ctx.assertDeal(payload.paciente_id);
      const titulo = payload.titulo || `Consulta — ${deal.customer}`;
      const conflitos = conflitosNoHorario(await ctx.appointments(), {
        date: payload.data,
        startTime: payload.hora_inicio,
        endTime: payload.hora_fim,
        sellerId: ctx.user.id,
      });
      return novaProposta({
        tipo: "criar_agendamento",
        titulo: `Marcar consulta de ${deal.customer}`,
        resumo: `${dataBR(payload.data)} às ${payload.hora_inicio}`,
        payload: { ...payload, titulo },
        requisitos: [{
          chave: "sem_conflito",
          ok: conflitos.length === 0,
          aviso: conflitos.length ? `Já existe "${conflitos[0].title}" neste horário.` : "",
        }],
        preview: {
          linhas: [
            { rotulo: "Paciente", valor: deal.customer },
            { rotulo: "Quando", valor: `${dataBR(payload.data)} ${payload.hora_inicio}–${payload.hora_fim}` },
            { rotulo: "Tipo", valor: payload.tipo },
          ],
        },
      });
    },
    async revalidar(payload, ctx) {
      await ctx.assertDeal(payload.paciente_id);
      exigirData(payload.data, "data");
      exigirHora(payload.hora_inicio, "hora_inicio");
    },
    async execute(payload, ctx) {
      const deal = await ctx.assertDeal(payload.paciente_id);
      const criado = await ctx.criarAgendamento({
        title: payload.titulo || `Consulta — ${deal.customer}`,
        dealId: deal.id,
        date: payload.data,
        startTime: payload.hora_inicio,
        endTime: payload.hora_fim || fimPadrao(payload.hora_inicio),
        sellerId: ctx.user.id,
        description: payload.descricao,
        type: payload.tipo || "retorno",
        status: "agendado",
        origin: "Assistente",
      });
      return {
        refTipo: "appointment",
        refId: criado.id,
        detalhe: `Consulta marcada para ${dataBR(criado.date)} às ${criado.startTime}.`,
      };
    },
  },

  propor_remarcacao: {
    tipo: "escrita",
    exigeAcessoClinico: false,
    descricao:
      "Propõe REMARCAR uma consulta que já existe, avisando o paciente no WhatsApp no mesmo clique. "
      + "Use agenda_do_dia ou agenda_do_periodo antes para pegar o agendamento_id.",
    parameters: {
      type: "object",
      properties: {
        agendamento_id: { type: "string" },
        nova_data: { type: "string", description: "AAAA-MM-DD" },
        nova_hora_inicio: { type: "string", description: "HH:MM" },
        nova_hora_fim: { type: "string", description: "HH:MM" },
        avisar_paciente: { type: "boolean", description: "true (padrão) envia a mensagem junto" },
        mensagem: { type: "string", description: "O texto para o paciente, já pronto, tratando por você" },
        instancia: { type: "string", enum: INSTANCIAS, description: "De qual WhatsApp sai (padrão: clinica)" },
      },
      required: ["agendamento_id", "nova_data", "nova_hora_inicio"],
    },
    editaveis: ["nova_data", "nova_hora_inicio", "nova_hora_fim", "mensagem", "avisar_paciente", "instancia"],
    normalize(args) {
      const inicio = exigirHora(args?.nova_hora_inicio, "nova_hora_inicio");
      return {
        agendamento_id: exigirId(args?.agendamento_id, "agendamento_id"),
        nova_data: exigirData(args?.nova_data, "nova_data"),
        nova_hora_inicio: inicio,
        nova_hora_fim: args?.nova_hora_fim ? exigirHora(args.nova_hora_fim, "nova_hora_fim") : fimPadrao(inicio),
        avisar_paciente: args?.avisar_paciente !== false,
        mensagem: opcionalTexto(args?.mensagem, 1500),
        instancia: normalizarInstancia(args?.instancia),
      };
    },
    async propose(payload, ctx) {
      const antigo = await ctx.assertAgendamento(payload.agendamento_id);
      const deal = antigo.dealId ? await ctx.assertDeal(antigo.dealId) : null;
      const nome = deal?.customer || antigo.title;
      const mensagem = payload.mensagem
        || `Olá${deal ? `, ${String(deal.customer).split(" ")[0]}` : ""}! Sua consulta foi remarcada para `
          + `${dataBR(payload.nova_data)} às ${payload.nova_hora_inicio}. Qualquer coisa, é só avisar.`;

      const requisitos = [];
      const conflitos = conflitosNoHorario(await ctx.appointments(), {
        date: payload.nova_data,
        startTime: payload.nova_hora_inicio,
        endTime: payload.nova_hora_fim,
        sellerId: antigo.sellerId || ctx.user.id,
        ignorarId: antigo.id,
      });
      requisitos.push({
        chave: "sem_conflito",
        ok: conflitos.length === 0,
        aviso: conflitos.length ? `Já existe "${conflitos[0].title}" no novo horário.` : "",
      });

      if (payload.avisar_paciente && deal) {
        const envio = await requisitosDeEnvio(ctx, deal.id, payload.instancia);
        requisitos.push(...envio.requisitos);
      }

      return novaProposta({
        tipo: "remarcar_agendamento",
        titulo: `Remarcar a consulta de ${nome}`,
        resumo: `${dataBR(antigo.date)} ${antigo.startTime} → ${dataBR(payload.nova_data)} ${payload.nova_hora_inicio}`
          + (payload.avisar_paciente ? ", avisando pelo WhatsApp" : ""),
        payload: { ...payload, mensagem, paciente_id: deal?.id || "" },
        requisitos,
        preview: {
          texto: payload.avisar_paciente ? mensagem : "",
          linhas: [
            { rotulo: "Paciente", valor: nome },
            { rotulo: "De", valor: `${dataBR(antigo.date)} ${antigo.startTime}` },
            { rotulo: "Para", valor: `${dataBR(payload.nova_data)} ${payload.nova_hora_inicio}` },
          ],
        },
      });
    },
    async revalidar(payload, ctx) {
      await ctx.assertAgendamento(payload.agendamento_id);
      exigirData(payload.nova_data, "nova_data");
      exigirHora(payload.nova_hora_inicio, "nova_hora_inicio");
    },
    /**
     * Agenda primeiro, mensagem depois — e sem transação.
     *
     * Se o WhatsApp falhar, a agenda continua alterada e o resultado diz isso
     * com todas as letras. Reverter o horário automaticamente seria pior: o
     * médico já viu a agenda nova e passaria a confiar num estado que voltou
     * sozinho sem ninguém pedir.
     */
    async execute(payload, ctx) {
      const antigo = await ctx.assertAgendamento(payload.agendamento_id);
      const atualizado = await ctx.atualizarAgendamento(antigo.id, {
        date: payload.nova_data,
        startTime: payload.nova_hora_inicio,
        endTime: payload.nova_hora_fim || fimPadrao(payload.nova_hora_inicio),
      });
      const quando = `${dataBR(atualizado.date)} às ${atualizado.startTime}`;

      if (!payload.avisar_paciente || !payload.paciente_id) {
        return { refTipo: "appointment", refId: atualizado.id, detalhe: `Agenda alterada para ${quando}.` };
      }

      try {
        const { instancia, conversa } = await resolverEnvio(ctx, payload.paciente_id, payload.instancia);
        await ctx.enviarWhatsapp({
          instanceId: instancia.id, chatId: conversa.chatId, body: payload.mensagem,
        });
        return {
          refTipo: "appointment",
          refId: atualizado.id,
          detalhe: `Agenda alterada para ${quando} e paciente avisado.`,
        };
      } catch (err) {
        return {
          refTipo: "appointment",
          refId: atualizado.id,
          detalhe: `Agenda alterada para ${quando}. A mensagem NÃO saiu: ${err.message}.`,
          parcial: true,
        };
      }
    },
  },

  propor_cancelamento: {
    tipo: "escrita",
    exigeAcessoClinico: false,
    descricao:
      "Propõe CANCELAR uma consulta. O compromisso é marcado como cancelado, não apagado.",
    parameters: {
      type: "object",
      properties: {
        agendamento_id: { type: "string" },
        motivo: { type: "string" },
        avisar_paciente: { type: "boolean" },
        mensagem: { type: "string" },
        instancia: { type: "string", enum: INSTANCIAS },
      },
      required: ["agendamento_id"],
    },
    editaveis: ["motivo", "mensagem", "avisar_paciente", "instancia"],
    normalize(args) {
      return {
        agendamento_id: exigirId(args?.agendamento_id, "agendamento_id"),
        motivo: opcionalTexto(args?.motivo, 300),
        avisar_paciente: args?.avisar_paciente === true,
        mensagem: opcionalTexto(args?.mensagem, 1500),
        instancia: normalizarInstancia(args?.instancia),
      };
    },
    async propose(payload, ctx) {
      const alvo = await ctx.assertAgendamento(payload.agendamento_id);
      const deal = alvo.dealId ? await ctx.assertDeal(alvo.dealId) : null;
      const nome = deal?.customer || alvo.title;
      const mensagem = payload.mensagem
        || `Olá${deal ? `, ${String(deal.customer).split(" ")[0]}` : ""}! Precisamos cancelar a consulta de `
          + `${dataBR(alvo.date)} às ${alvo.startTime}. Vamos remarcar?`;

      const requisitos = [];
      if (payload.avisar_paciente && deal) {
        const envio = await requisitosDeEnvio(ctx, deal.id, payload.instancia);
        requisitos.push(...envio.requisitos);
      }

      return novaProposta({
        tipo: "cancelar_agendamento",
        titulo: `Cancelar a consulta de ${nome}`,
        resumo: `${dataBR(alvo.date)} às ${alvo.startTime}`,
        payload: { ...payload, mensagem, paciente_id: deal?.id || "" },
        requisitos,
        preview: {
          texto: payload.avisar_paciente ? mensagem : "",
          linhas: [
            { rotulo: "Paciente", valor: nome },
            { rotulo: "Quando", valor: `${dataBR(alvo.date)} ${alvo.startTime}` },
            ...(payload.motivo ? [{ rotulo: "Motivo", valor: payload.motivo }] : []),
          ],
        },
      });
    },
    async revalidar(payload, ctx) {
      await ctx.assertAgendamento(payload.agendamento_id);
    },
    async execute(payload, ctx) {
      const alvo = await ctx.assertAgendamento(payload.agendamento_id);
      const atualizado = await ctx.atualizarAgendamento(alvo.id, {
        status: "cancelado",
        description: [alvo.description, payload.motivo].filter(Boolean).join(" — "),
      });

      if (!payload.avisar_paciente || !payload.paciente_id) {
        return { refTipo: "appointment", refId: atualizado.id, detalhe: "Consulta cancelada." };
      }
      try {
        const { instancia, conversa } = await resolverEnvio(ctx, payload.paciente_id, payload.instancia);
        await ctx.enviarWhatsapp({ instanceId: instancia.id, chatId: conversa.chatId, body: payload.mensagem });
        return { refTipo: "appointment", refId: atualizado.id, detalhe: "Consulta cancelada e paciente avisado." };
      } catch (err) {
        return {
          refTipo: "appointment",
          refId: atualizado.id,
          detalhe: `Consulta cancelada. A mensagem NÃO saiu: ${err.message}.`,
          parcial: true,
        };
      }
    },
  },

  propor_mensagem_whatsapp: {
    tipo: "escrita",
    exigeAcessoClinico: false,
    descricao:
      "Propõe enviar uma mensagem de WhatsApp ao paciente. Escreva o texto pronto, em português, "
      + "tratando o paciente por 'você'. Por padrão sai pelo WhatsApp da clínica.",
    parameters: {
      type: "object",
      properties: {
        paciente_id: { type: "string" },
        texto: { type: "string", description: "A mensagem completa, pronta para enviar" },
        instancia: { type: "string", enum: INSTANCIAS },
      },
      required: ["paciente_id", "texto"],
    },
    editaveis: ["texto", "instancia"],
    normalize(args) {
      return {
        paciente_id: exigirId(args?.paciente_id, "paciente_id"),
        texto: exigirTexto(args?.texto, "texto", 1500),
        instancia: normalizarInstancia(args?.instancia),
      };
    },
    async propose(payload, ctx) {
      const deal = await ctx.assertDeal(payload.paciente_id);
      const { requisitos } = await requisitosDeEnvio(ctx, deal.id, payload.instancia);
      return novaProposta({
        tipo: "enviar_whatsapp",
        titulo: `Mensagem para ${deal.customer}`,
        resumo: payload.instancia === "doutor" ? "pelo seu WhatsApp" : "pelo WhatsApp da clínica",
        payload,
        requisitos,
        preview: {
          // O texto vem do modelo: limpo antes de virar preview, para um texto
          // com marcador forjado não sujar a tela nem o próximo prompt.
          texto: limparTexto(payload.texto, 1500),
          linhas: [{ rotulo: "Para", valor: deal.customer }],
        },
      });
    },
    async revalidar(payload, ctx) {
      await ctx.assertDeal(payload.paciente_id);
      exigirTexto(payload.texto, "texto", 1500);
    },
    async execute(payload, ctx) {
      const deal = await ctx.assertDeal(payload.paciente_id);
      const { instancia, conversa } = await resolverEnvio(ctx, deal.id, payload.instancia);
      const { messageId } = await ctx.enviarWhatsapp({
        instanceId: instancia.id, chatId: conversa.chatId, body: payload.texto,
      });
      return { refTipo: "message", refId: messageId || "", detalhe: `Mensagem enviada para ${deal.customer}.` };
    },
  },

  propor_mensagem_agendada: {
    tipo: "escrita",
    exigeAcessoClinico: false,
    descricao:
      "Propõe deixar uma mensagem programada para sair numa data e hora futuras — lembrete de consulta, "
      + "cobrança de retorno. Informe `quando` no formato AAAA-MM-DD e `hora` em HH:MM.",
    parameters: {
      type: "object",
      properties: {
        paciente_id: { type: "string" },
        texto: { type: "string" },
        data: { type: "string", description: "AAAA-MM-DD" },
        hora: { type: "string", description: "HH:MM" },
        instancia: { type: "string", enum: INSTANCIAS },
        cancelar_se_paciente_responder: { type: "boolean", description: "padrão true" },
      },
      required: ["paciente_id", "texto", "data", "hora"],
    },
    editaveis: ["texto", "data", "hora", "instancia"],
    normalize(args) {
      return {
        paciente_id: exigirId(args?.paciente_id, "paciente_id"),
        texto: exigirTexto(args?.texto, "texto", 1500),
        data: exigirData(args?.data, "data"),
        hora: exigirHora(args?.hora, "hora"),
        instancia: normalizarInstancia(args?.instancia),
        cancelar_se_paciente_responder: args?.cancelar_se_paciente_responder !== false,
      };
    },
    async propose(payload, ctx) {
      const deal = await ctx.assertDeal(payload.paciente_id);
      const { requisitos } = await requisitosDeEnvio(ctx, deal.id, payload.instancia);
      const quandoIso = `${payload.data}T${payload.hora}:00`;
      requisitos.push({
        chave: "no_futuro",
        ok: new Date(quandoIso).getTime() > ctx.agora.getTime(),
        aviso: "Esse horário já passou. Escolha uma data futura.",
      });
      return novaProposta({
        tipo: "agendar_whatsapp",
        titulo: `Mensagem programada para ${deal.customer}`,
        resumo: `sai em ${dataBR(payload.data)} às ${payload.hora}`,
        payload,
        requisitos,
        preview: {
          texto: limparTexto(payload.texto, 1500),
          linhas: [
            { rotulo: "Para", valor: deal.customer },
            { rotulo: "Quando", valor: `${dataBR(payload.data)} ${payload.hora}` },
          ],
        },
      });
    },
    async revalidar(payload, ctx) {
      await ctx.assertDeal(payload.paciente_id);
      exigirData(payload.data, "data");
      exigirHora(payload.hora, "hora");
    },
    async execute(payload, ctx) {
      const deal = await ctx.assertDeal(payload.paciente_id);
      const { instancia, conversa } = await resolverEnvio(ctx, deal.id, payload.instancia);
      const criada = await ctx.programarWhatsapp({
        instanceId: instancia.id,
        chatId: conversa.chatId,
        conversationId: conversa.id,
        body: payload.texto,
        scheduledAt: new Date(`${payload.data}T${payload.hora}:00`).toISOString(),
        cancelIfClientReplies: payload.cancelar_se_paciente_responder,
        note: "Programada pelo assistente",
      });
      return {
        refTipo: "scheduled",
        refId: criada.id,
        detalhe: `Mensagem programada para ${dataBR(payload.data)} às ${payload.hora}.`,
      };
    },
  },

  propor_tarefa: {
    tipo: "escrita",
    exigeAcessoClinico: false,
    descricao:
      "Propõe criar uma tarefa para a secretaria — cobrar retorno, marcar exame, ligar para o paciente. "
      + "Use listar_equipe se quiser atribuir a alguém específico; sem responsável, cai na fila geral.",
    parameters: {
      type: "object",
      properties: {
        titulo: { type: "string" },
        descricao: { type: "string" },
        paciente_id: { type: "string" },
        responsavel_id: { type: "string" },
        prazo: { type: "string", description: "AAAA-MM-DD" },
        itens: { type: "array", items: { type: "string" }, description: "Checklist, ex.: os exames a cobrar" },
        mensagem_sugerida: { type: "string", description: "Texto pronto para a secretaria mandar ao paciente" },
      },
      required: ["titulo"],
    },
    editaveis: ["titulo", "descricao", "responsavel_id", "prazo", "itens", "mensagem_sugerida"],
    normalize(args) {
      return {
        titulo: exigirTexto(args?.titulo, "titulo", 200),
        descricao: opcionalTexto(args?.descricao, 2000),
        paciente_id: String(args?.paciente_id ?? "").trim(),
        responsavel_id: String(args?.responsavel_id ?? "").trim(),
        prazo: args?.prazo ? exigirData(args.prazo, "prazo") : "",
        itens: Array.isArray(args?.itens)
          ? args.itens.map(i => opcionalTexto(i, 200)).filter(Boolean).slice(0, 30)
          : [],
        mensagem_sugerida: opcionalTexto(args?.mensagem_sugerida, 2000),
      };
    },
    async propose(payload, ctx) {
      const deal = payload.paciente_id ? await ctx.assertDeal(payload.paciente_id) : null;
      const responsavel = payload.responsavel_id ? await ctx.usuario(payload.responsavel_id) : null;
      return novaProposta({
        tipo: "criar_tarefa",
        titulo: payload.titulo,
        resumo: responsavel ? `para ${responsavel.name}` : "para a fila da secretaria",
        payload,
        requisitos: [],
        preview: {
          texto: payload.mensagem_sugerida ? limparTexto(payload.mensagem_sugerida, 2000) : "",
          linhas: [
            ...(deal ? [{ rotulo: "Paciente", valor: deal.customer }] : []),
            { rotulo: "Responsável", valor: responsavel?.name || "fila geral" },
            ...(payload.prazo ? [{ rotulo: "Prazo", valor: dataBR(payload.prazo) }] : []),
            ...(payload.itens.length ? [{ rotulo: "Itens", valor: payload.itens.join(", ") }] : []),
          ],
        },
      });
    },
    async revalidar(payload, ctx) {
      if (payload.paciente_id) await ctx.assertDeal(payload.paciente_id);
      if (payload.responsavel_id) await ctx.usuario(payload.responsavel_id);
      exigirTexto(payload.titulo, "titulo", 200);
    },
    async execute(payload, ctx) {
      const criada = await ctx.criarTarefa({
        titulo: payload.titulo,
        descricao: payload.descricao,
        dealId: payload.paciente_id,
        assigneeId: payload.responsavel_id,
        prazo: payload.prazo,
        itens: Array.isArray(payload.itens) ? payload.itens : [],
        mensagemSugerida: payload.mensagem_sugerida,
        origem: "manual",
        status: "aberta",
      });
      return { refTipo: "task", refId: criada.id, detalhe: "Tarefa criada para a secretaria." };
    },
  },

  propor_mensagem_interna: {
    tipo: "escrita",
    exigeAcessoClinico: false,
    descricao:
      "Propõe mandar uma mensagem para um funcionário no chat interno da clínica (não é WhatsApp). "
      + "Chame listar_equipe antes para pegar o usuario_id.",
    parameters: {
      type: "object",
      properties: {
        usuario_id: { type: "string" },
        texto: { type: "string" },
      },
      required: ["usuario_id", "texto"],
    },
    editaveis: ["texto"],
    normalize(args) {
      return {
        usuario_id: exigirId(args?.usuario_id, "usuario_id"),
        texto: exigirTexto(args?.texto, "texto", 2000),
      };
    },
    async propose(payload, ctx) {
      const destinatario = await ctx.usuario(payload.usuario_id);
      return novaProposta({
        tipo: "mensagem_interna",
        titulo: `Mensagem para ${destinatario.name}`,
        resumo: "pelo chat interno",
        payload,
        requisitos: [{
          chave: "nao_e_voce",
          ok: destinatario.id !== ctx.user.id,
          aviso: "Você não pode mandar mensagem interna para si mesmo.",
        }],
        preview: {
          texto: limparTexto(payload.texto, 2000),
          linhas: [{ rotulo: "Para", valor: destinatario.name }],
        },
      });
    },
    async revalidar(payload, ctx) {
      await ctx.usuario(payload.usuario_id);
      exigirTexto(payload.texto, "texto", 2000);
    },
    async execute(payload, ctx) {
      const destinatario = await ctx.usuario(payload.usuario_id);
      const { mensagem } = await ctx.enviarMensagemInterna(destinatario.id, payload.texto);
      return { refTipo: "internal", refId: mensagem.id, detalhe: `Mensagem enviada para ${destinatario.name}.` };
    },
  },
};
