import { Router } from "../lib/safe-router.js";
import { getOpenaiSettings } from "../storage/settings-repo.js";
import { requireAuth } from "../middleware/require-auth.js";
import { userCanUseInstance } from "../middleware/instance-access.js";
import { acquireRespondLock, releaseRespondLock, respondLockKey } from "./agent-dedupe.js";
import { getAllUsage, resetUsage } from "../storage/agent-usage-repo.js";
import { listAgents, createAgent, updateAgent, deleteAgent } from "../storage/agents-repo.js";
import { getDeal } from "../storage/deals-repo.js";
import { callOpenAI } from "../lib/openai.js";
import { canUserSeeDeal } from "../lib/deal-permissions.js";
import { iaLimiter } from "../middleware/rate-limit.js";
import {
  responderComAgente,
  skippedRespond,
  MODEL_MAP,
  DEFAULT_OPENAI_MODEL,
} from "../whatsapp/agent-service.js";

// A geração da resposta vive em whatsapp/agent-service.js. Saiu daqui porque o
// gatilho automático precisava do MESMO caminho, e esse gatilho agora roda no
// backend (whatsapp/agent-auto-reply.js) em vez de no navegador de cada
// atendente. Reexportado para os testes que já apontavam para este módulo.
export { formatConsultationContext, TRANSCRICAO_MAX_CHARS } from "../whatsapp/agent-service.js";

export const agentsRouter = Router();

// Restrito a admin: aceita systemPrompt e userMessage arbitrários e gasta a
// chave da OpenAI da empresa. Aberto a qualquer cargo, era um proxy de LLM
// gratuito — e um jeito de torrar a fatura. A tela que usa isto (/agentes) já
// é exclusiva do admin no front.
agentsRouter.post("/test", requireAuth({ admin: true }), iaLimiter, async (req, res) => {
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
      max_tokens: Number(process.env.AGENT_MAX_TOKENS || 800),
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

// Zerar o contador de consumo apaga o rastro de quem gastou quanto — é ação
// de administração, não de atendimento.
agentsRouter.delete("/usage/:agentId", requireAuth({ admin: true }), async (req, res) => {
  await resetUsage(req.params.agentId);
  res.json({ ok: true });
});

/**
 * Disparo MANUAL do agente para uma conversa (botão "responder com IA").
 *
 * O disparo automático não passa mais por aqui: ele roda no backend, dentro do
 * pipeline de mensagens, para não depender de alguém estar com o CRM aberto.
 */
agentsRouter.post("/respond", requireAuth(), iaLimiter, async (req, res) => {
  const {
    instanceId, chatId, model, temperature, systemPrompt,
    contextLimit, agentId, nowIso, dealId,
  } = req.body || {};

  if (!instanceId || !chatId) {
    return res.status(400).json({ error: "instanceId e chatId são obrigatórios" });
  }
  if (!(await userCanUseInstance(req.user, String(instanceId)))) {
    return res.status(403).json({ error: "sem acesso a esta instância" });
  }

  // O `dealId` vem do CORPO da requisição e não passava por checagem nenhuma.
  // Duas consequências, as duas exploráveis:
  //   leitura — o contexto de consulta injeta o resumo clínico ou a transcrição
  //             DESTE paciente no prompt, e a resposta gerada vai por WhatsApp;
  //   escrita — patchDeal grava campos no card informado.
  // Sem permissão, seguimos como se o dealId não tivesse vindo: o agente ainda
  // responde, só não enxerga nem grava no card alheio.
  let deal = dealId ? await getDeal(dealId).catch(() => null) : null;
  if (deal && !canUserSeeDeal(req.user, deal)) {
    console.warn(`[agents:respond] usuário ${req.user.id} pediu dealId ${dealId} sem permissão — ignorado`);
    deal = null;
  }

  // Dois gatilhos para a mesma conversa (duas abas, ou uma aba mais o gatilho
  // automático do backend) gerariam duas respostas. A trava vive no Mongo,
  // então vale também entre processos.
  const lockKey = respondLockKey(instanceId, chatId);
  if (!(await acquireRespondLock(lockKey))) {
    return res.json({ ...skippedRespond(model), skipped: "resposta-em-andamento" });
  }

  try {
    const resultado = await responderComAgente({
      instanceId, chatId, model, temperature, systemPrompt,
      contextLimit, agentId, nowIso, deal,
      io: req.app.get("io"),
      logLabel: "agents:respond",
    });
    res.json(resultado);
  } finally {
    // `finally`, e não `res.on("close")`: a trava precisa sair mesmo quando o
    // navegador desiste no meio da geração.
    await releaseRespondLock(lockKey).catch(() => {});
  }
});
