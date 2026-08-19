import { Router } from "express";
import { getOpenaiSettings } from "../storage/settings-repo.js";
import { requireAuth } from "../middleware/require-auth.js";
import { connectionManager } from "../whatsapp/ConnectionManager.js";
import { listMessages } from "../storage/messages-repo.js";
import { finalizeOutgoingMessage } from "../whatsapp/outgoing.js";
import { addUsage, getAllUsage, resetUsage } from "../storage/agent-usage-repo.js";
import { listAgents, getAgent, createAgent, updateAgent, deleteAgent } from "../storage/agents-repo.js";
import { listCustomFields, applyCustomFieldValues } from "../storage/custom-fields-repo.js";
import { getDeal, patchDeal } from "../storage/deals-repo.js";
import { emitDealEvent } from "../socket/events.js";

export const agentsRouter = Router();

const MODEL_MAP = {
  econom: "gpt-4o-mini",
  balanced: "gpt-4o",
  premium: "gpt-4-turbo",
};

const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";

const PRICING = {
  "gpt-4o-mini": { in: 0.15 / 1e6, out: 0.60 / 1e6 },
  "gpt-4o":      { in: 2.50 / 1e6, out: 10.00 / 1e6 },
  "gpt-4-turbo": { in: 10.00 / 1e6, out: 30.00 / 1e6 },
};

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

function priceFor(model, usage) {
  const p = PRICING[model];
  if (!p || !usage) return 0;
  const pIn = Number(usage.prompt_tokens) || 0;
  const pOut = Number(usage.completion_tokens) || 0;
  return pIn * p.in + pOut * p.out;
}

async function callOpenAI({ apiKey, model, temperature, messages, tools, tool_choice }) {
  const body = { model, temperature, messages };
  if (tools) body.tools = tools;
  if (tool_choice) body.tool_choice = tool_choice;
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    let detail = text;
    try {
      detail = JSON.parse(text)?.error?.message || text;
    } catch {}
    const err = new Error(`OpenAI ${response.status}: ${detail}`);
    err.status = response.status;
    throw err;
  }
  return response.json();
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

agentsRouter.post("/test", requireAuth(), async (req, res) => {
  const { model, temperature, systemPrompt, userMessage } = req.body || {};
  const userText = typeof userMessage === "string" ? userMessage.trim() : "";
  if (!userText) return res.status(400).json({ error: "userMessage é obrigatório" });

  const { apiKey } = await getOpenaiSettings();
  if (!apiKey) return res.status(400).json({ error: "OpenAI key não configurada" });

  const openaiModel = MODEL_MAP[model] || DEFAULT_OPENAI_MODEL;
  const safeTemperature = Number.isFinite(temperature) ? Math.min(2, Math.max(0, Number(temperature))) : 0.7;

  const messages = [];
  if (typeof systemPrompt === "string" && systemPrompt.trim()) {
    messages.push({ role: "system", content: systemPrompt.trim() });
  }
  messages.push({ role: "user", content: userText });

  try {
    const data = await callOpenAI({
      apiKey,
      model: openaiModel,
      temperature: safeTemperature,
      messages,
    });
    const reply = data?.choices?.[0]?.message?.content?.trim() || "";
    res.json({ reply, model: openaiModel });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error("[agents:test] fetch failed", err);
    res.status(502).json({ error: `Falha ao contatar OpenAI: ${err.message}` });
  }
});

// ---- CRUD dos agentes (compartilhado entre o time via Mongo) ----
// Todos leem; só admin escreve. O broadcast "agents:update" reconcilia os
// clientes, igual ao que etapas já fazem.
function broadcastAgents(req, agents) {
  const io = req.app.get("io");
  if (io) io.emit("agents:update", { agents });
}

agentsRouter.get("/", requireAuth(), async (_req, res) => {
  res.json(await listAgents());
});

agentsRouter.post("/", requireAuth({ admin: true }), async (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "name é obrigatório" });
  const agent = await createAgent({ ...(req.body || {}), name });
  broadcastAgents(req, await listAgents());
  res.status(201).json(agent);
});

agentsRouter.patch("/:id", requireAuth({ admin: true }), async (req, res) => {
  const updated = await updateAgent(req.params.id, req.body || {});
  if (!updated) return res.status(404).json({ error: "agente não encontrado" });
  broadcastAgents(req, await listAgents());
  res.json(updated);
});

agentsRouter.delete("/:id", requireAuth({ admin: true }), async (req, res) => {
  const removed = await deleteAgent(req.params.id);
  if (!removed) return res.status(404).json({ error: "agente não encontrado" });
  const agents = await listAgents();
  broadcastAgents(req, agents);
  res.json({ ok: true, agents });
});

agentsRouter.get("/usage", requireAuth(), async (_req, res) => {
  const all = await getAllUsage();
  res.json(all);
});

agentsRouter.delete("/usage/:agentId", requireAuth(), async (req, res) => {
  await resetUsage(req.params.agentId);
  res.json({ ok: true });
});

agentsRouter.post("/respond", requireAuth(), async (req, res) => {
  const {
    instanceId,
    chatId,
    model,
    temperature,
    systemPrompt,
    contextLimit,
    agentId,
    nowIso,
    dealId,
  } = req.body || {};

  if (!instanceId || !chatId) {
    return res.status(400).json({ error: "instanceId e chatId são obrigatórios" });
  }

  const client = connectionManager.get(instanceId);
  if (!client) return res.status(404).json({ error: "instância não conectada" });

  const { apiKey } = await getOpenaiSettings();
  if (!apiKey) return res.status(400).json({ error: "OpenAI key não configurada" });

  const openaiModel = MODEL_MAP[model] || DEFAULT_OPENAI_MODEL;
  const safeTemperature = Number.isFinite(temperature)
    ? Math.min(2, Math.max(0, Number(temperature)))
    : 0.7;
  const safeLimit = Math.min(50, Math.max(1, Number(contextLimit) || 15));

  const history = await listMessages(instanceId, chatId, { limit: safeLimit });

  const effectiveNowIso = typeof nowIso === "string" && nowIso ? nowIso : new Date().toISOString();
  const baseSystem = typeof systemPrompt === "string" ? systemPrompt.trim() : "";
  // Meta de coleta: cruza os campos que ESTE agente deve extrair (definidos no
  // agente, em Mongo) com os que o lead ainda não tem preenchidos. Só entram na
  // ferramenta e no prompt os que faltam — pedir o que já foi coletado irrita o
  // cliente e gasta token à toa.
  let camposPendentes = [];
  let deal = null;
  try {
    const agente = agentId ? await getAgent(agentId) : null;
    if (agente?.extractFields?.length) {
      deal = dealId ? await getDeal(dealId) : null;
      const definicoes = await listCustomFields();
      const byKey = new Map(definicoes.map(f => [f.key, f]));
      const jaPreenchidos = deal?.customFields || {};
      camposPendentes = agente.extractFields
        .map(key => byKey.get(key))
        .filter(f => f && jaPreenchidos[f.key] === undefined);
    }
  } catch (err) {
    // Extração é um extra: se a meta não puder ser resolvida, o agente ainda responde.
    console.warn(`[agents:respond] meta de campos indisponível: ${err.message}`);
  }
  // Sem deal vinculado não há onde gravar, então nem oferecemos a ferramenta.
  const podeExtrair = Boolean(deal) && camposPendentes.length > 0;

  const augmentedSystem = [
    baseSystem,
    `Data/hora atual (ISO): ${effectiveNowIso}.`,
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
    return res.status(400).json({ error: "Nenhuma mensagem disponível para contexto" });
  }
  if (chatMessages[chatMessages.length - 1].role !== "user") {
    return res.status(409).json({ error: "Última mensagem já é do agente" });
  }

  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalCostUsd = 0;
  let reply = "";
  let scheduling = null;
  let extracted = null;

  try {
    const tools = [SCHEDULING_TOOL];
    if (podeExtrair) tools.push(buildSaveFieldsTool(camposPendentes));

    const first = await callOpenAI({
      apiKey,
      model: openaiModel,
      temperature: safeTemperature,
      messages: chatMessages,
      tools,
      tool_choice: "auto",
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
        console.warn(`[agents:respond] campos rejeitados: ${rejeitados.map(r => `${r.key} (${r.motivo})`).join(", ")}`);
      }
      if (aplicados.length) {
        const atualizado = await patchDeal(deal.id, { customFields: values });
        if (atualizado) {
          extracted = Object.fromEntries(aplicados.map(k => [k, values[k] ?? null]));
          emitDealEvent(req.app.get("io"), "deal:update", atualizado, deal);
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
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error("[agents:respond] OpenAI failed", err);
    return res.status(502).json({ error: `Falha ao contatar OpenAI: ${err.message}` });
  }

  if (!reply) return res.status(502).json({ error: "OpenAI retornou resposta vazia" });

  if (agentId) {
    try {
      await addUsage(agentId, {
        promptTokens: totalPromptTokens,
        completionTokens: totalCompletionTokens,
        costUsd: totalCostUsd,
      });
    } catch (err) {
      console.warn(`[agents:respond] usage persist failed: ${err.message}`);
    }
  }

  let result;
  try {
    result = await client.sendMessage(chatId, { text: reply });
  } catch (err) {
    console.error("[agents:respond] send failed", err);
    return res.status(500).json({ error: `Falha ao enviar mensagem: ${err.message}` });
  }

  const { messageId } = await finalizeOutgoingMessage({
    io: req.app.get("io"),
    client,
    instanceId,
    chatId,
    result,
    logLabel: "agents:respond",
    message: { type: "chat", body: reply },
  });

  res.json({
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
  });
});
