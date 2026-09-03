// Geração e envio da resposta do agente de IA.
//
// Isto morava DENTRO do handler de POST /api/agents/respond, e o gatilho que o
// chamava vivia no NAVEGADOR (src/hooks/useAgentAutoReply.ts). A consequência
// prática: quando todo mundo fechava o CRM, o agente simplesmente parava de
// responder — sem aviso, sem log, sem nada na tela. O cliente ficava falando
// sozinho até alguém abrir uma aba. E com cinco abas abertas, cinco gatilhos
// concorriam pela mesma conversa.
//
// Com a lógica aqui, o pipeline de mensagens do backend chama direto
// (whatsapp/agent-auto-reply.js) e a rota HTTP virou um invólucro fino. Os dois
// caminhos se comportam igual porque é literalmente o mesmo código.
//
// Quem chama é responsável por (a) segurar a trava de dedupe e (b) garantir que
// o `deal` recebido é um card que o solicitante pode ver. A permissão não mora
// aqui porque o gatilho automático não tem usuário associado.

import { getOpenaiSettings } from "../storage/settings-repo.js";
import { connectionManager } from "./ConnectionManager.js";
import { listMessages } from "../storage/messages-repo.js";
import { finalizeOutgoingMessage } from "./outgoing.js";
import { addUsage } from "../storage/agent-usage-repo.js";
import { getAgent } from "../storage/agents-repo.js";
import { listCustomFields, applyCustomFieldValues } from "../storage/custom-fields-repo.js";
import { patchDeal } from "../storage/deals-repo.js";
import { emitDealEvent } from "../socket/events.js";
import { callOpenAI } from "../lib/openai.js";
import { MODEL_MAP, DEFAULT_OPENAI_MODEL, PRICING, priceFor } from "../lib/openai-pricing.js";
import { listConsultations } from "../storage/consultations-repo.js";
import { isAlreadyAnswered } from "../routes/agent-dedupe.js";
import { HttpError } from "../middleware/error-handler.js";

// Níveis de modelo e tabela de preço saíram para lib/openai-pricing.js quando o
// assistente do médico passou a precisar dos mesmos números. Reexportados aqui
// porque routes/agents.js já os importava deste arquivo.
export { MODEL_MAP, DEFAULT_OPENAI_MODEL, PRICING, priceFor };

// Teto de saída por resposta. A API não recebia limite nenhum: uma conversa que
// induzisse o modelo a divagar gerava (e cobrava) uma resposta gigante, que o
// WhatsApp nem entregaria inteira.
const MAX_TOKENS_RESPOSTA = Number(process.env.AGENT_MAX_TOKENS || 800);

// Resposta de "não fiz nada", com o mesmo formato do caminho normal para o
// cliente não precisar de tratamento especial nem exibir erro.
export const skippedRespond = model => ({
  ok: true,
  reply: "",
  messageId: null,
  model: MODEL_MAP[model] || DEFAULT_OPENAI_MODEL,
  usage: { promptTokens: 0, completionTokens: 0, costUsd: 0 },
  scheduling: null,
  extracted: null,
});

const SCHEDULING_REPLY =
  "Vou verificar os horários disponíveis na nossa agenda e te retorno com as opções em instantes.";

function mediaPlaceholder(type) {
  if (type === "image") return "[imagem]";
  if (type === "audio" || type === "ptt") return "[áudio]";
  if (type === "video") return "[vídeo]";
  if (type === "document") return "[documento]";
  if (type === "sticker") return "[figurinha]";
  if (type === "contact") return "[contato]";
  return "";
}

// Uma consulta de 1h tem ~13k tokens de transcrição: injetar isso em toda
// resposta encareceria cada mensagem e afogaria o prompt. Por isso o resumo
// clínico entra por padrão, e a transcrição crua só quando não há resumo — aí
// truncada pelo fim, que é onde ficam conduta e orientações.
export const TRANSCRICAO_MAX_CHARS = 6000;

const RESSALVA = "Use isso apenas para dar continuidade ao atendimento. Não invente informação clínica que não esteja aqui, não faça diagnóstico e não prescreva.";

/**
 * Monta o trecho de contexto a partir das consultas de um cliente. Separada do
 * acesso ao banco para poder ser testada — é ela que decide o que o agente
 * enxerga do prontuário.
 */
export function formatConsultationContext(consultas) {
  const ultima = (consultas || [])
    .filter(c => c?.status === "pronto" && (c.summary || c.transcriptText))
    .sort((a, b) => new Date(b.recordedAt) - new Date(a.recordedAt))[0];
  if (!ultima) return "";

  const quando = new Date(ultima.recordedAt).toLocaleDateString("pt-BR");

  if (ultima.summary) {
    const campos = [
      ["Queixa", ultima.summary.queixa],
      ["Histórico", ultima.summary.historico],
      ["Avaliação", ultima.summary.avaliacao],
      ["Conduta", ultima.summary.conduta],
    ].filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);
    if (campos.length) {
      return `Resumo da última consulta deste cliente (${quando}), registrado no prontuário:\n${campos.join("\n")}\n\n${RESSALVA}`;
    }
  }

  if (!ultima.transcriptText) return "";
  // Trunca pelo começo: conduta, prescrição e orientações ficam no fim da
  // consulta, e é isso que serve para dar continuidade ao atendimento.
  const texto = ultima.transcriptText.length > TRANSCRICAO_MAX_CHARS
    ? `[trecho inicial omitido]\n${ultima.transcriptText.slice(-TRANSCRICAO_MAX_CHARS)}`
    : ultima.transcriptText;
  return `Transcrição da última consulta deste cliente (${quando}), registrada no prontuário:\n${texto}\n\n${RESSALVA}`;
}

async function consultationContext(dealId) {
  try {
    return formatConsultationContext(await listConsultations({ dealId }));
  } catch (err) {
    // Contexto de consulta é um extra: sem ele o agente ainda responde.
    console.warn(`[agent-service] contexto de consulta indisponível: ${err.message}`);
    return "";
  }
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function dateKey(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseDateKey(raw) {
  if (typeof raw !== "string") return null;
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function nextBusinessDays(startDate, count = 5) {
  const out = [];
  const d = new Date(startDate);
  d.setHours(0, 0, 0, 0);
  while (out.length < count) {
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6) out.push(dateKey(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

function resolveBaseDate(rawBase, nowIso) {
  const now = nowIso ? new Date(nowIso) : new Date();
  const parsed = parseDateKey(rawBase);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  if (parsed && parsed.getTime() >= today.getTime()) return parsed;
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  while (tomorrow.getDay() === 0 || tomorrow.getDay() === 6) {
    tomorrow.setDate(tomorrow.getDate() + 1);
  }
  return tomorrow;
}

const SCHEDULING_TOOL = {
  type: "function",
  function: {
    name: "propose_scheduling",
    description:
      "Use APENAS quando o cliente sinalizar intenção de agendar, marcar, remarcar ou perguntar sobre horários disponíveis. Forneça base_date no formato YYYY-MM-DD se o cliente mencionar uma data ou referência relativa (ex.: 'semana que vem' → próxima segunda-feira). Caso contrário, omita base_date para usar amanhã. Esta ferramenta NÃO retorna horários ao cliente — apenas sinaliza para o atendente humano que o cliente quer agendar.",
    parameters: {
      type: "object",
      properties: {
        base_date: {
          type: "string",
          description: "Data base no formato YYYY-MM-DD (opcional).",
        },
      },
    },
  },
};

const SAVE_FIELDS_TOOL_NAME = "save_lead_fields";

// Descreve o campo para a IA no formato que ela precisa preencher. O tipo virou
// restrição de schema: "lista" usa enum, "data" exige YYYY-MM-DD, "numero" é
// number — assim a extração já chega validável em coerceFieldValue.
function fieldSchema(field) {
  const base = { description: field.label };
  switch (field.type) {
    case "numero":
      return { ...base, type: "number" };
    case "data":
      return { ...base, type: "string", description: `${field.label} (formato YYYY-MM-DD)` };
    case "lista":
      return { ...base, type: "string", enum: field.options };
    default:
      return { ...base, type: "string" };
  }
}

function buildSaveFieldsTool(pendentes) {
  const properties = {};
  for (const field of pendentes) properties[field.key] = fieldSchema(field);
  return {
    type: "function",
    function: {
      name: SAVE_FIELDS_TOOL_NAME,
      description:
        "Grava no cadastro do lead os dados que o cliente informou. Envie APENAS os campos cujo valor o cliente realmente disse nesta conversa — nunca invente, deduza ou preencha com exemplo. Se nenhum dado novo foi informado, não chame esta ferramenta.",
      parameters: { type: "object", properties },
    },
  };
}

// Instrução que faz o agente PERSEGUIR a meta, e não só extrair passivamente.
function collectionInstruction(pendentes) {
  const lista = pendentes.map(f => `- ${f.label} (${f.key})`).join("\n");
  return [
    "META DE COLETA — dados do lead que ainda faltam:",
    lista,
    `Conduza a conversa para obter esses dados, pedindo no máximo dois por mensagem e sempre de forma natural, sem soar como formulário. Não repita um pedido que o cliente já respondeu ou recusou. Assim que o cliente informar algum deles, chame ${SAVE_FIELDS_TOOL_NAME} para gravar. Nunca invente valores.`,
  ].join("\n");
}

/**
 * Gera e ENVIA a resposta do agente para uma conversa.
 *
 * Devolve `{ ok, reply, messageId, model, usage, scheduling, extracted }`, ou
 * um objeto com `skipped: <motivo>` quando decide não responder. Erros viram
 * `HttpError`, que a rota traduz em status e o worker apenas registra.
 */
export async function responderComAgente({
  instanceId,
  chatId,
  model,
  temperature,
  systemPrompt,
  contextLimit,
  agentId,
  nowIso,
  deal = null,
  io = null,
  logLabel = "agents:respond",
}) {
  const client = connectionManager.get(instanceId);
  if (!client) throw new HttpError(404, "instância não conectada", "INSTANCIA_OFFLINE");

  const { apiKey } = await getOpenaiSettings();
  if (!apiKey) throw new HttpError(400, "OpenAI key não configurada", "SEM_CHAVE_OPENAI");

  const openaiModel = MODEL_MAP[model] || DEFAULT_OPENAI_MODEL;
  const safeTemperature = Number.isFinite(temperature)
    ? Math.min(2, Math.max(0, Number(temperature)))
    : 0.7;
  const safeLimit = Math.min(50, Math.max(1, Number(contextLimit) || 15));

  const history = await listMessages(instanceId, chatId, { limit: safeLimit });

  // Trava do caso sequencial (outro gatilho terminou antes deste começar), que
  // também impede o agente de falar por cima de um humano que assumiu.
  if (isAlreadyAnswered(history)) {
    return { ...skippedRespond(model), skipped: "ultima-mensagem-ja-e-nossa" };
  }

  const effectiveNowIso = typeof nowIso === "string" && nowIso ? nowIso : new Date().toISOString();
  const baseSystem = typeof systemPrompt === "string" ? systemPrompt.trim() : "";

  // Meta de coleta: cruza os campos que ESTE agente deve extrair com os que o
  // lead ainda não tem preenchidos. Pedir o que já foi coletado irrita o
  // cliente e gasta token à toa.
  let camposPendentes = [];
  try {
    const agente = agentId ? await getAgent(agentId) : null;
    if (agente?.extractFields?.length) {
      const definicoes = await listCustomFields();
      const byKey = new Map(definicoes.map(f => [f.key, f]));
      const jaPreenchidos = deal?.customFields || {};
      camposPendentes = agente.extractFields
        .map(key => byKey.get(key))
        .filter(f => f && jaPreenchidos[f.key] === undefined);
    }
  } catch (err) {
    // Extração é um extra: se a meta não puder ser resolvida, o agente ainda responde.
    console.warn(`[${logLabel}] meta de campos indisponível: ${err.message}`);
  }
  // Sem deal vinculado não há onde gravar, então nem oferecemos a ferramenta.
  const podeExtrair = Boolean(deal) && camposPendentes.length > 0;

  const contextoConsulta = deal ? await consultationContext(deal.id) : "";

  const augmentedSystem = [
    baseSystem,
    `Data/hora atual (ISO): ${effectiveNowIso}.`,
    contextoConsulta,
    "Você tem acesso à ferramenta propose_scheduling. Chame-a APENAS quando o cliente quiser agendar, remarcar ou perguntar por horários. NÃO liste horários no texto da resposta — o painel de horários aparece para o atendente humano. Quando o cliente disser 'semana que vem', passe base_date como a próxima segunda-feira em YYYY-MM-DD.",
    podeExtrair ? collectionInstruction(camposPendentes) : "",
  ].filter(Boolean).join("\n\n");

  const chatMessages = [{ role: "system", content: augmentedSystem }];
  for (const m of history) {
    let content = typeof m.body === "string" ? m.body.trim() : "";
    if (!content) {
      content = mediaPlaceholder(m.type);
      if (!content) continue;
    }
    chatMessages.push({ role: m.fromMe ? "assistant" : "user", content });
  }

  if (chatMessages.length === 1) {
    throw new HttpError(400, "Nenhuma mensagem disponível para contexto", "SEM_CONTEXTO");
  }
  if (chatMessages[chatMessages.length - 1].role !== "user") {
    return { ...skippedRespond(model), skipped: "ultima-mensagem-ja-e-nossa" };
  }

  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalCostUsd = 0;
  let reply = "";
  let scheduling = null;
  let extracted = null;

  const tools = [SCHEDULING_TOOL];
  if (podeExtrair) tools.push(buildSaveFieldsTool(camposPendentes));

  const first = await callOpenAI({
    apiKey,
    model: openaiModel,
    temperature: safeTemperature,
    messages: chatMessages,
    tools,
    tool_choice: "auto",
    max_tokens: MAX_TOKENS_RESPOSTA,
  });

  if (first?.usage) {
    totalPromptTokens += Number(first.usage.prompt_tokens) || 0;
    totalCompletionTokens += Number(first.usage.completion_tokens) || 0;
    totalCostUsd += priceFor(openaiModel, first.usage);
  }

  const firstMsg = first?.choices?.[0]?.message;
  const toolCalls = Array.isArray(firstMsg?.tool_calls) ? firstMsg.tool_calls : [];
  const schedCall = toolCalls.find(c => c?.function?.name === "propose_scheduling");
  const saveCalls = toolCalls.filter(c => c?.function?.name === SAVE_FIELDS_TOOL_NAME);

  // Grava o que a IA extraiu ANTES de decidir a resposta: mesmo que a conversa
  // vire agendamento no mesmo turno, o dado coletado não se perde.
  if (saveCalls.length && deal) {
    const bruto = {};
    for (const call of saveCalls) {
      try { Object.assign(bruto, JSON.parse(call.function.arguments || "{}")); } catch {}
    }
    const definicoes = await listCustomFields();
    const { values, aplicados, rejeitados } = applyCustomFieldValues(definicoes, deal.customFields, bruto);
    if (rejeitados.length) {
      console.warn(`[${logLabel}] campos rejeitados: ${rejeitados.map(r => `${r.key} (${r.motivo})`).join(", ")}`);
    }
    if (aplicados.length) {
      const atualizado = await patchDeal(deal.id, { customFields: values });
      if (atualizado) {
        extracted = Object.fromEntries(aplicados.map(k => [k, values[k] ?? null]));
        emitDealEvent(io, "deal:update", atualizado, deal);
      }
    }
  }

  if (schedCall) {
    let args = {};
    try { args = JSON.parse(schedCall.function.arguments || "{}"); } catch {}
    const baseDate = resolveBaseDate(args.base_date, effectiveNowIso);
    const days = nextBusinessDays(baseDate, 5);
    scheduling = { baseDateIso: dateKey(baseDate), days };
    reply = SCHEDULING_REPLY;
  } else if (saveCalls.length) {
    // A chamada de ferramenta não produz texto para o cliente. Devolvemos o
    // resultado de cada tool_call (a API exige um por id) e pedimos a resposta
    // numa segunda passada, com tool_choice "none" para garantir texto.
    const second = await callOpenAI({
      apiKey,
      model: openaiModel,
      temperature: safeTemperature,
      messages: [
        ...chatMessages,
        firstMsg,
        ...toolCalls.map(call => ({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(
            call.function?.name === SAVE_FIELDS_TOOL_NAME
              ? { ok: true, salvos: extracted ? Object.keys(extracted) : [] }
              : { ok: true },
          ),
        })),
      ],
      tools,
      tool_choice: "none",
      max_tokens: MAX_TOKENS_RESPOSTA,
    });
    if (second?.usage) {
      totalPromptTokens += Number(second.usage.prompt_tokens) || 0;
      totalCompletionTokens += Number(second.usage.completion_tokens) || 0;
      totalCostUsd += priceFor(openaiModel, second.usage);
    }
    reply = second?.choices?.[0]?.message?.content?.trim() || "";
  } else {
    reply = firstMsg?.content?.trim() || "";
  }

  if (!reply) throw new HttpError(502, "OpenAI retornou resposta vazia", "RESPOSTA_VAZIA");

  if (agentId) {
    try {
      await addUsage(agentId, {
        promptTokens: totalPromptTokens,
        completionTokens: totalCompletionTokens,
        costUsd: totalCostUsd,
      });
    } catch (err) {
      console.warn(`[${logLabel}] usage persist failed: ${err.message}`);
    }
  }

  const result = await client.sendMessage(chatId, { text: reply });
  const { messageId } = await finalizeOutgoingMessage({
    io, client, instanceId, chatId, result, logLabel,
    message: { type: "chat", body: reply },
  });

  return {
    ok: true,
    reply,
    messageId,
    model: openaiModel,
    usage: {
      promptTokens: totalPromptTokens,
      completionTokens: totalCompletionTokens,
      costUsd: Number(totalCostUsd.toFixed(8)),
    },
    scheduling,
    extracted,
  };
}
