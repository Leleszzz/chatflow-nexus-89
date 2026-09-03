// O contexto de um turno do assistente — e o único lugar onde a permissão é
// avaliada.
//
// A regra de arquitetura que este arquivo existe para sustentar: NENHUM arquivo
// de assistant/tools/ importa de storage/. Toda ferramenta recebe `ctx` e lê
// daqui. Sem isso, cada ferramenta nova seria uma chance de esquecer o filtro de
// `canUserSeeDeal` e deixar o assistente responder sobre paciente de outro
// médico — e o vazamento seria invisível, porque a resposta viria em prosa.
// backend/tests/assistant-escopo.test.js faz valer a regra lendo os arquivos.
//
// As listas são memoizadas POR TURNO: listAllDeals() e listAppointments()
// carregam a coleção inteira, e uma pergunta que aciona cinco ferramentas faria
// cinco varreduras iguais.

import { listAllDeals, getDeal } from "../storage/deals-repo.js";
import { listAppointments, createAppointment, patchAppointment } from "../storage/appointments-repo.js";
import { listUsers } from "../storage/users-repo.js";
import { listInstances } from "../storage/instances-repo.js";
import { listConsultations, getConsultation } from "../storage/consultations-repo.js";
import { listProntuarios } from "../storage/prontuarios-repo.js";
import { listTasks, createTask } from "../storage/tasks-repo.js";
import { findConversationByDealId } from "../storage/conversations-repo.js";
import { listMessages as listWhatsappMessages } from "../storage/messages-repo.js";
import { createScheduled } from "../storage/scheduled-messages-repo.js";
import {
  getOrCreateDm, appendMessage as appendInternalMessage, getThread as getInternalThread,
} from "../storage/internal-chat-repo.js";
import { canUserSeeDeal, permittedUserIds } from "../lib/deal-permissions.js";
import { canUserSeeInstance } from "../lib/instance-permissions.js";
import { userCanUseInstance } from "../middleware/instance-access.js";
import { instanciaDaSecretaria, instanciaPropria } from "../lib/instance-kinds.js";
import { podeVerTarefa } from "../lib/task-permissions.js";
import { ROLES, normalizeRole, seesAllDeals, isAdmin } from "../lib/roles.js";
import { registrarAsync } from "../lib/auditoria.js";
import { emitToUsers } from "../socket/events.js";
import { connectionManager } from "../whatsapp/ConnectionManager.js";
import { enviarTexto } from "../whatsapp/enviar-texto.js";
import { AssistantToolError } from "./erros.js";

// Reexportado: as ferramentas ja recebem `ctx` deste arquivo, e obrigar cada
// uma a importar de dois lugares so criaria import esquecido.
export { AssistantToolError };


/** Fuso da clínica. Ver o risco de fuso no plano: derivar "hoje" de
 *  toISOString() dá o dia errado depois das 21h num processo em UTC. */
export const FUSO = process.env.ASSISTANT_TZ || "America/Sao_Paulo";

/** "AAAA-MM-DD" no fuso da clínica, não no do processo. */
export function chaveDoDia(data = new Date(), fuso = FUSO) {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(data);
  const get = tipo => partes.find(p => p.type === tipo)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Data por extenso em pt-BR, para o modelo resolver "terça que vem". */
export function dataPorExtenso(data = new Date(), fuso = FUSO) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: fuso, weekday: "long", day: "2-digit", month: "long", year: "numeric",
  }).format(data);
}

/** "HH:MM" no fuso da clínica. */
export function horaDoDia(data = new Date(), fuso = FUSO) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: fuso, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(data);
}

// Memoiza uma função assíncrona sem argumento pela duração do turno.
function umaVezPorTurno(carregar) {
  let promessa = null;
  return () => {
    if (!promessa) promessa = carregar();
    return promessa;
  };
}

/**
 * Monta o contexto de um turno.
 *
 * `agora` é injetável para os testes poderem fixar "hoje" sem depender do
 * relógio da máquina.
 */
export async function criarContexto(req, { agora = new Date() } = {}) {
  const user = req.user;
  const role = normalizeRole(user?.role);

  const deals = umaVezPorTurno(async () => {
    const todos = await listAllDeals();
    return todos.filter(d => canUserSeeDeal(user, d));
  });

  const dealsById = umaVezPorTurno(async () => {
    const visiveis = await deals();
    return new Map(visiveis.map(d => [d.id, d]));
  });

  const appointments = umaVezPorTurno(async () => {
    const [todos, mapa] = await Promise.all([listAppointments(), dealsById()]);
    // Mesmo recorte de GET /api/appointments: o compromisso é visível quando o
    // card é visível, ou quando é o próprio usuário o responsável. Compromisso
    // sem card e sem responsável só aparece para quem enxerga todos os cards.
    return todos.filter(a => {
      if (a.dealId) return mapa.has(a.dealId);
      if (a.sellerId) return a.sellerId === user.id || role === ROLES.ADMIN;
      return role === ROLES.ADMIN;
    });
  });

  const usuarios = umaVezPorTurno(async () => (await listUsers()).filter(u => u.active !== false));

  const instancias = umaVezPorTurno(async () => {
    const todas = await listInstances();
    return todas.filter(i => canUserSeeInstance(user, i));
  });

  const ctx = {
    req,
    user,
    role,
    io: req.app?.get?.("io") || null,
    agora,
    nowIso: agora.toISOString(),
    hojeKey: chaveDoDia(agora),
    hojeExtenso: dataPorExtenso(agora),
    horaAgora: horaDoDia(agora),
    fuso: FUSO,

    // Dado clínico (consulta, transcrição, prontuário) é do médico e do admin —
    // mesmo gate de /api/consultations e /api/prontuarios, onde a secretária já
    // é barrada. A ferramenta que exige isto some do schema, em vez de existir e
    // recusar: o modelo não pode oferecer o que não pode entregar.
    temAcessoClinico: role === ROLES.ADMIN || role === ROLES.DOUTOR,

    deals,
    dealsById,
    appointments,
    usuarios,
    instancias,

    /**
     * O card, ou erro. Consulta o mapa JÁ FILTRADO, então paciente fora do
     * escopo do médico produz exatamente a mesma mensagem que paciente
     * inexistente — sem isso, tentar um id qualquer viraria um oráculo de
     * "este paciente existe na clínica".
     */
    async assertDeal(dealId) {
      const id = String(dealId || "").trim();
      if (!id) throw new AssistantToolError("informe o paciente", "PACIENTE_NAO_INFORMADO");
      const mapa = await dealsById();
      const deal = mapa.get(id);
      if (!deal) {
        throw new AssistantToolError(
          "paciente não encontrado — use buscar_paciente para achar o id certo",
          "PACIENTE_NAO_ENCONTRADO",
        );
      }
      return deal;
    },

    /** Consultas de um paciente, já com a permissão conferida. */
    async consultasDoPaciente(dealId) {
      const deal = await ctx.assertDeal(dealId);
      return listConsultations({ dealId: deal.id });
    },

    /** Uma consulta específica, conferindo o card dela. */
    async consulta(consultaId) {
      const achada = await getConsultation(String(consultaId || ""));
      if (!achada) throw new AssistantToolError("consulta não encontrada", "CONSULTA_NAO_ENCONTRADA");
      await ctx.assertDeal(achada.dealId);
      return achada;
    },

    /** Todas as consultas visíveis — a base de "minhas consultas de hoje". */
    async consultasVisiveis() {
      const visiveis = await deals();
      const listas = await Promise.all(visiveis.map(d => listConsultations({ dealId: d.id })));
      return listas.flat();
    },

    async anexosDoPaciente(dealId) {
      const deal = await ctx.assertDeal(dealId);
      return listProntuarios({ dealId: deal.id });
    },

    async tarefas({ status, assigneeId, dealId } = {}) {
      if (dealId) await ctx.assertDeal(dealId);
      const todas = await listTasks({ status, assigneeId, dealId });
      const mapa = await dealsById();
      return todas.filter(t => podeVerTarefa(user, t, t.dealId ? mapa.get(t.dealId) || null : null));
    },

    /**
     * Por onde falar com o paciente no WhatsApp.
     *
     * O recorte de instância é passado de verdade — até a Fase 0 desta entrega,
     * findConversationByDealId aceitava `instanceIds` e o ignorava, o que aqui
     * significaria ler a conversa de um número que o médico nem pode usar.
     */
    async conversaDoPaciente(dealId) {
      const deal = await ctx.assertDeal(dealId);
      const permitidas = await instancias();
      return findConversationByDealId(deal.id, {
        phone: deal.phone,
        instanceIds: permitidas.map(i => i.id),
      });
    },

    async mensagensDoPaciente(dealId, { limit = 20 } = {}) {
      const conversa = await ctx.conversaDoPaciente(dealId);
      if (!conversa) return { conversa: null, mensagens: [] };
      const mensagens = await listWhatsappMessages(conversa.instanceId, conversa.chatId, { limit });
      return { conversa, mensagens };
    },

    // --- escrita ---
    //
    // Também passam por aqui, e não por import direto nas ferramentas, para a
    // regra do teste de escopo valer inteira: nenhuma ferramenta fala com
    // storage/. Cada uma destas confere a permissão de novo, porque são
    // chamadas na CONFIRMAÇÃO — minutos depois da proposta ter sido montada, e
    // com o payload podendo ter sido editado pelo médico no card.

    /** Um compromisso que este usuário enxerga, ou erro. */
    async assertAgendamento(id) {
      const alvo = String(id || "").trim();
      if (!alvo) throw new AssistantToolError("informe o agendamento", "PARAMETRO_FALTANDO");
      const visiveis = await appointments();
      const achado = visiveis.find(a => a.id === alvo);
      if (!achado) {
        throw new AssistantToolError(
          "agendamento não encontrado — consulte a agenda para pegar o agendamento_id",
          "AGENDAMENTO_NAO_ENCONTRADO",
        );
      }
      return achado;
    },

    /**
     * Quem recebe o evento de um compromisso.
     *
     * Mesma regra de routes/appointments.js: nunca io.emit, senão a agenda da
     * clínica inteira chega a todo socket conectado e desfaz o filtro do GET.
     */
    async destinatariosDoCompromisso(appointment) {
      const equipe = await usuarios();
      const ids = new Set();
      if (appointment?.sellerId) ids.add(appointment.sellerId);
      for (const u of equipe) if (isAdmin(u)) ids.add(u.id);
      if (appointment?.dealId) {
        const mapa = await dealsById();
        const deal = mapa.get(appointment.dealId);
        if (deal) for (const id of permittedUserIds(deal, equipe)) ids.add(id);
      }
      ids.add(user.id);
      return [...ids];
    },

    async criarAgendamento(record) {
      const criado = await createAppointment(record);
      emitToUsers(ctx.io, await ctx.destinatariosDoCompromisso(criado), "appointment:update", { appointment: criado });
      return criado;
    },

    async atualizarAgendamento(id, patch) {
      const atualizado = await patchAppointment(id, patch);
      if (!atualizado) throw new AssistantToolError("agendamento não encontrado", "AGENDAMENTO_NAO_ENCONTRADO");
      emitToUsers(ctx.io, await ctx.destinatariosDoCompromisso(atualizado), "appointment:update", { appointment: atualizado });
      return atualizado;
    },

    async criarTarefa(record) {
      const criada = await createTask({ ...record, criadoPor: user.id });
      // A fila é da recepção: quem trabalha nela precisa ver a tarefa aparecer.
      const equipe = await usuarios();
      const destinatarios = new Set([user.id, criada.assigneeId].filter(Boolean));
      for (const u of equipe) if (seesAllDeals(u)) destinatarios.add(u.id);
      emitToUsers(ctx.io, [...destinatarios], "task:update", { task: criada });
      return criada;
    },

    /**
     * Qual número usar para falar com o paciente.
     *
     * O padrão é o da clínica — mesma regra de negócio que a tela da Secretaria
     * já aplica: cobrança e confirmação saem do número da recepção, não do
     * WhatsApp pessoal do doutor.
     */
    async instanciaPara(preferencia = "clinica") {
      const permitidas = await instancias();
      const escolhida = preferencia === "doutor"
        ? instanciaPropria(permitidas, user.id)
        : instanciaDaSecretaria(permitidas);
      if (!escolhida) {
        throw new AssistantToolError(
          preferencia === "doutor"
            ? "você não tem um WhatsApp pessoal configurado"
            : "não há WhatsApp da clínica configurado",
          "SEM_INSTANCIA",
        );
      }
      if (!(await userCanUseInstance(user, escolhida.id))) {
        throw new AssistantToolError("você não pode enviar por este número", "SEM_ACESSO_INSTANCIA");
      }
      return escolhida;
    },

    /** A instância está de fato conectada agora? Vira requisito no card. */
    instanciaConectada(instanceId) {
      return Boolean(connectionManager.get(instanceId));
    },

    async enviarWhatsapp({ instanceId, chatId, body }) {
      return enviarTexto({ io: ctx.io, instanceId, chatId, body, logLabel: "assistente" });
    },

    async programarWhatsapp(record) {
      return createScheduled({ ...record, createdBy: user.id });
    },

    async usuario(id) {
      const equipe = await usuarios();
      const achado = equipe.find(u => u.id === String(id || ""));
      if (!achado) {
        throw new AssistantToolError(
          "funcionário não encontrado — use listar_equipe para pegar o usuario_id",
          "USUARIO_NAO_ENCONTRADO",
        );
      }
      return achado;
    },

    async enviarMensagemInterna(destinatarioId, body) {
      const thread = await getOrCreateDm(user.id, destinatarioId);
      const mensagem = await appendInternalMessage({ threadId: thread.id, senderId: user.id, body });
      const atualizada = await getInternalThread(thread.id);
      emitToUsers(ctx.io, thread.memberIds, "internal:message", { message: mensagem, thread: atualizada });
      return { thread, mensagem };
    },

    /** Registra na trilha. Melhor esforço, nunca derruba o turno. */
    auditar(acao, detalhe = {}) {
      registrarAsync(req, acao, { origem: "assistente", ...detalhe });
    },
  };

  // Reexpostas para as ferramentas de escrita, que precisam do card cru quando
  // vão gravar. Continua passando pelo filtro: getDeal só é chamada depois de
  // assertDeal aprovar o id.
  ctx.getDealCru = getDeal;

  return ctx;
}
