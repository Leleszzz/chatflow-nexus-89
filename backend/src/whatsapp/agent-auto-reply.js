// Gatilho automático do agente de IA.
//
// ANTES isto vivia em src/hooks/useAgentAutoReply.ts — ou seja, NO NAVEGADOR de
// cada atendente. Três consequências, todas visíveis para o cliente final:
//
//   1. Fim do expediente, todo mundo fecha o CRM → o agente parava de
//      responder. Sem aviso, sem log, sem indicação na tela. O cliente mandava
//      mensagem à noite e ficava falando sozinho.
//   2. Cinco abas abertas → cinco gatilhos concorrentes para a mesma conversa.
//   3. Máquina lenta, aba em segundo plano ou internet ruim do atendente
//      atrasavam a resposta ao cliente.
//
// Agora o gatilho é o próprio pipeline de mensagens do backend: a resposta
// depende do servidor estar de pé, e nada mais.

import { getConversation } from "../storage/conversations-repo.js";
import { getDeal } from "../storage/deals-repo.js";
import { getAgent } from "../storage/agents-repo.js";
import { getAgentSchedule, isAgentScheduleActiveAt } from "../storage/settings-repo.js";
import { patchConversationCrm } from "../storage/conversations-repo.js";
import { acquireRespondLock, releaseRespondLock, respondLockKey } from "../routes/agent-dedupe.js";
import { responderComAgente } from "./agent-service.js";
import { connectionManager } from "./ConnectionManager.js";
import { finalizeOutgoingMessage } from "./outgoing.js";
import { emitToInstance } from "../socket/events.js";

// Espera antes de responder: o cliente costuma mandar três mensagens seguidas
// ("oi", "boa tarde", "queria saber sobre..."), e responder à primeira parece
// robótico e desperdiça chamada. Cada mensagem nova reinicia a contagem.
const DEBOUNCE_MS = Number(process.env.AGENT_DEBOUNCE_MS || 2500);

// Conversas com resposta agendada. Vive no processo porque é só o timer do
// debounce — a exclusão mútua de verdade é a trava no Mongo.
const timers = new Map();

const normalizar = raw =>
  String(raw || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** O texto contém alguma palavra que deve tirar a IA da conversa? */
export function casaPalavraDeBloqueio(texto, blockWords) {
  if (!Array.isArray(blockWords) || blockWords.length === 0) return false;
  const alvo = normalizar(texto);
  return blockWords.some(palavra => {
    const termo = normalizar(String(palavra || "").trim());
    return termo.length > 0 && alvo.includes(termo);
  });
}

/**
 * Resolve qual agente (se algum) responde por esta conversa.
 *
 * A configuração pode estar no card vinculado (fonte preferida) ou no overlay
 * de CRM da própria conversa — mesma precedência que o hook do front usava.
 */
async function resolverAgente(conversation) {
  const crm = conversation?.crm || {};
  const deal = crm.dealId ? await getDeal(crm.dealId).catch(() => null) : null;

  const aiEnabled = deal?.aiEnabled ?? crm.aiEnabled;
  const aiAgentId = deal?.aiAgentId ?? crm.aiAgentId;
  if (!aiEnabled || !aiAgentId) return null;

  const agente = await getAgent(aiAgentId).catch(() => null);
  if (!agente || !agente.active) return null;
  return { agente, deal };
}

/** Desliga a IA e manda a mensagem de transferência para o atendimento humano. */
async function transferirParaHumano({ io, conversation, agente, deal }) {
  try {
    await patchConversationCrm(conversation.id, { aiEnabled: false });
    if (deal) {
      const { patchDeal } = await import("../storage/deals-repo.js");
      await patchDeal(deal.id, { aiEnabled: false }).catch(() => {});
    }

    const texto = String(agente.handoffMessage || "").trim();
    if (texto) {
      const client = connectionManager.get(conversation.instanceId);
      if (client?.isSocketOpen?.()) {
        const result = await client.sendMessage(conversation.chatId, { text: texto });
        await finalizeOutgoingMessage({
          io, client,
          instanceId: conversation.instanceId,
          chatId: conversation.chatId,
          result,
          logLabel: "agent-auto-reply:handoff",
          message: { type: "chat", body: texto },
        });
      }
    }

    // O atendente precisa VER que a conversa voltou para ele — antes o aviso
    // era um toast que só aparecia para quem tivesse a aba aberta na hora.
    emitToInstance(io, conversation.instanceId, "agent:handoff", {
      conversationId: conversation.id,
      agentName: agente.name || "",
    });
    console.log(`[agent-auto-reply] ${conversation.id}: transferido para humano (palavra de bloqueio)`);
  } catch (err) {
    console.warn(`[agent-auto-reply] handoff falhou em ${conversation.id}: ${err.message}`);
  }
}

async function responder(io, conversationId) {
  // Relê a conversa: entre o agendamento e agora, o atendente pode ter
  // assumido, desligado a IA ou trocado o agente.
  const conversation = await getConversation(conversationId);
  if (!conversation) return;

  const resolvido = await resolverAgente(conversation);
  if (!resolvido) return;
  const { agente, deal } = resolvido;

  // Janela de horário do agente programado. Fora dela, quem atende é gente.
  try {
    const schedule = await getAgentSchedule();
    if (schedule?.enabled && schedule.agentId === agente.id && !isAgentScheduleActiveAt(schedule)) {
      return;
    }
  } catch (err) {
    console.warn(`[agent-auto-reply] agenda do agente indisponível: ${err.message}`);
  }

  const lockKey = respondLockKey(conversation.instanceId, conversation.chatId);
  if (!(await acquireRespondLock(lockKey))) return;

  try {
    const resultado = await responderComAgente({
      instanceId: conversation.instanceId,
      chatId: conversation.chatId,
      model: agente.model,
      temperature: agente.temperature,
      systemPrompt: agente.prompt,
      contextLimit: Number(process.env.AGENT_CONTEXT_LIMIT || 15),
      agentId: agente.id,
      nowIso: new Date().toISOString(),
      deal,
      io,
      logLabel: "agent-auto-reply",
    });

    if (resultado?.skipped) return;

    // Aviso de coleta: antes era um toast local da aba que disparou a resposta,
    // então só quem estava com aquela aba aberta via. Agora chega a todo mundo
    // que enxerga a instância.
    const coletados = Object.keys(resultado?.extracted || {});
    if (coletados.length) {
      emitToInstance(io, conversation.instanceId, "agent:extracted", {
        conversationId: conversation.id,
        campos: coletados,
      });
    }

    // Proposta de horário: desliga a IA e entrega o painel ao atendente, que é
    // quem confirma a agenda.
    if (resultado?.scheduling?.days?.length) {
      const atualizado = await patchConversationCrm(conversation.id, {
        aiEnabled: false,
        schedulingProposal: {
          baseDateIso: resultado.scheduling.baseDateIso,
          days: resultado.scheduling.days,
          createdAt: new Date().toISOString(),
        },
      });
      if (deal) {
        const { patchDeal } = await import("../storage/deals-repo.js");
        await patchDeal(deal.id, { aiEnabled: false }).catch(() => {});
      }
      if (atualizado) {
        emitToInstance(io, conversation.instanceId, "conversation:update", { conversation: atualizado });
      }
    }
  } catch (err) {
    // Falha do agente NUNCA pode derrubar o pipeline de mensagens: a mensagem
    // do cliente já foi recebida e persistida, e é isso que não pode se perder.
    console.warn(`[agent-auto-reply] ${conversationId} falhou: ${err.message}`);
  } finally {
    await releaseRespondLock(lockKey).catch(() => {});
  }
}

/**
 * Chamado pelo MessagePipeline a cada mensagem RECEBIDA. Não bloqueia o
 * pipeline: agenda e devolve na hora.
 */
export function aoReceberMensagem({ io, conversation, message }) {
  if (!conversation?.id || message?.fromMe) return;

  // Palavra de bloqueio age na hora, sem esperar o debounce: se o cliente pediu
  // atendente humano, cada segundo de IA respondendo por cima é ruim.
  (async () => {
    try {
      const resolvido = await resolverAgente(conversation);
      if (!resolvido) return;

      if (casaPalavraDeBloqueio(message?.body || "", resolvido.agente.blockWords)) {
        const t = timers.get(conversation.id);
        if (t) { clearTimeout(t); timers.delete(conversation.id); }
        await transferirParaHumano({ io, conversation, ...resolvido });
        return;
      }

      const anterior = timers.get(conversation.id);
      if (anterior) clearTimeout(anterior);
      const timer = setTimeout(() => {
        timers.delete(conversation.id);
        responder(io, conversation.id).catch(err =>
          console.warn(`[agent-auto-reply] ${conversation.id}: ${err.message}`));
      }, DEBOUNCE_MS);
      timer.unref?.();
      timers.set(conversation.id, timer);
    } catch (err) {
      console.warn(`[agent-auto-reply] agendamento falhou: ${err.message}`);
    }
  })();
}

/** Cancela tudo que está agendado (usado no shutdown). */
export function pararAutoReply() {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
}
