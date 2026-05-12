import { Router } from "express";
import { getOpenaiSettings } from "../storage/settings-repo.js";
import { requireAuth } from "../middleware/require-auth.js";
import { getClient } from "../whatsapp/instance-manager.js";
import { listMessages, appendMessage, nextOutgoingTimestamp } from "../storage/messages-repo.js";
import { upsertConversation, getConversation } from "../storage/conversations-repo.js";
import {
  mapChatFromBaileys,
  mapBaileysStatusToAck,
  buildConversationId,
  previewFor,
} from "../whatsapp/message-mapper.js";
import { emitToInstance } from "../socket/events.js";
import { addUsage, getAllUsage, resetUsage } from "../storage/agent-usage-repo.js";

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
  } = req.body || {};

  if (!instanceId || !chatId) {
    return res.status(400).json({ error: "instanceId e chatId são obrigatórios" });
  }

  const client = getClient(instanceId);
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
  const augmentedSystem = [
    baseSystem,
    `Data/hora atual (ISO): ${effectiveNowIso}.`,
    "Você tem acesso à ferramenta propose_scheduling. Chame-a APENAS quando o cliente quiser agendar, remarcar ou perguntar por horários. NÃO liste horários no texto da resposta — o painel de horários aparece para o atendente humano. Quando o cliente disser 'semana que vem', passe base_date como a próxima segunda-feira em YYYY-MM-DD.",
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

  try {
    const first = await callOpenAI({
      apiKey,
      model: openaiModel,
      temperature: safeTemperature,
      messages: chatMessages,
      tools: [SCHEDULING_TOOL],
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

    if (schedCall) {
      let args = {};
      try { args = JSON.parse(schedCall.function.arguments || "{}"); } catch {}
      const baseDate = resolveBaseDate(args.base_date, effectiveNowIso);
      const days = nextBusinessDays(baseDate, 5);
      scheduling = { baseDateIso: dateKey(baseDate), days };
      reply = SCHEDULING_REPLY;
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

  const messageId = result?.key?.id || null;
  const baileysTs = Number(result?.messageTimestamp);
  const timestamp = await nextOutgoingTimestamp(instanceId, chatId, baileysTs);
  const initialAck = mapBaileysStatusToAck(result?.status);

  if (messageId) {
    const stored = {
      id: messageId,
      chatId,
      instanceId,
      fromMe: true,
      author: "",
      type: "chat",
      body: reply,
      timestamp,
      ack: initialAck,
    };
    await appendMessage(instanceId, chatId, stored);

    try {
      const chatEntry = client.getChatById ? client.getChatById(chatId) : null;
      const conv = mapChatFromBaileys({
        jid: chatId,
        chatEntry,
        contact: null,
        instanceId,
        lastMessage: stored,
      });
      const prior = await getConversation(buildConversationId(instanceId, chatId));
      const merged = {
        ...conv,
        customer: prior?.customer || conv.customer,
        whatsappName: prior?.whatsappName || conv.whatsappName,
        phone: prior?.phone || conv.phone,
        avatarUrl: prior?.avatarUrl,
        lastMessage: previewFor(stored),
        lastMessageId: stored.id,
        lastMessageFromMe: true,
        lastMessageAck: initialAck,
        lastInteraction: new Date(stored.timestamp * 1000).toISOString(),
        unreadCount: 0,
        unread: false,
      };
      const persisted = await upsertConversation(merged);
      emitToInstance(req.app.get("io"), instanceId, "message:new", {
        conversation: persisted,
        message: stored,
      });
    } catch (err) {
      console.warn(`[agents:respond] could not enrich conversation: ${err.message}`);
    }
  }

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
  });
});
