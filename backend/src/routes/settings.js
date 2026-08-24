import { Router } from "express";
import {
  getOpenaiSettings,
  setOpenaiSettings,
  clearOpenaiKey,
  getLeadDistribution,
  setLeadDistribution,
  getAgentSchedule,
  setAgentSchedule,
  nextAssignCursor,
  rememberLastAssigned,
  getTranscriptionSettings,
  setTranscriptionSettings,
  clearTranscriptionKey,
} from "../storage/settings-repo.js";
import { getConversation, patchConversationCrm, countConversationsAssignedTo } from "../storage/conversations-repo.js";
import { listUsers } from "../storage/users-repo.js";
import { requireAuth } from "../middleware/require-auth.js";
import { ROLES } from "../lib/roles.js";

export const settingsRouter = Router();

// Configurações de equipe: todos leem (a automação roda no cliente de cada um),
// só admin escreve. Mesma divisão de /api/stages.
function broadcast(req, event, payload) {
  const io = req.app.get("io");
  if (io) io.emit(event, payload);
}

settingsRouter.get("/lead-distribution", requireAuth(), async (_req, res) => {
  res.json(await getLeadDistribution());
});

settingsRouter.put("/lead-distribution", requireAuth({ admin: true }), async (req, res) => {
  const updated = await setLeadDistribution(req.body || {});
  broadcast(req, "lead-distribution:update", { leadDistribution: updated });
  res.json(updated);
});

// Escolhe o próximo vendedor do rodízio e já atribui à conversa.
//
// Isto roda no SERVIDOR de propósito: com o cursor no navegador, cada aba
// rodava seu próprio rodízio e o mesmo vendedor recebia repetido. O contador é
// um $inc atômico, então duas chamadas simultâneas pegam posições diferentes.
settingsRouter.post("/lead-distribution/next-seller", requireAuth(), async (req, res) => {
  const conversationId = String(req.body?.conversationId || "");
  if (!conversationId) return res.status(400).json({ error: "conversationId é obrigatório" });

  const distribution = await getLeadDistribution();
  if (!distribution.enabled) return res.json({ assigned: null, reason: "distribuicao-desligada" });

  const conversa = await getConversation(conversationId);
  if (!conversa) return res.status(404).json({ error: "conversa não encontrada" });
  // Já tem dono: não reatribui (é o mesmo guard do cliente, agora confiável).
  if (conversa.crm?.sellerId) return res.json({ assigned: null, reason: "ja-atribuida" });

  const users = await listUsers();
  // Lead novo cai com a secretária: é ela quem atende, agenda e encaminha.
  const elegiveis = users.filter(u =>
    u.active && u.receivesNewLeads && u.role === ROLES.SECRETARIA
    && (!distribution.eligibleUserIds.length || distribution.eligibleUserIds.includes(u.id)));
  if (!elegiveis.length) return res.json({ assigned: null, reason: "sem-vendedor-elegivel" });

  let escolhido;
  if (distribution.strategy === "load-balanced") {
    const cargas = await Promise.all(elegiveis.map(async u => ({
      user: u,
      carga: await countConversationsAssignedTo(u.id),
    })));
    cargas.sort((a, b) => a.carga - b.carga);
    escolhido = cargas[0].user;
  } else {
    const cursor = await nextAssignCursor();
    escolhido = elegiveis[(cursor - 1) % elegiveis.length];
  }

  const updated = await patchConversationCrm(conversationId, { sellerId: escolhido.id });
  await rememberLastAssigned(escolhido.id);
  const io = req.app.get("io");
  if (io && updated) io.to(`instance:${updated.instanceId}`).emit("conversation:update", { conversation: updated });
  res.json({ assigned: escolhido.id, conversation: updated });
});

settingsRouter.get("/agent-schedule", requireAuth(), async (_req, res) => {
  res.json(await getAgentSchedule());
});

settingsRouter.put("/agent-schedule", requireAuth({ admin: true }), async (req, res) => {
  const updated = await setAgentSchedule(req.body || {});
  broadcast(req, "agent-schedule:update", { agentSchedule: updated });
  res.json(updated);
});

settingsRouter.get("/openai", requireAuth(), async (_req, res) => {
  const openai = await getOpenaiSettings();
  res.json({
    configured: Boolean(openai.apiKey),
    defaultModel: openai.defaultModel || "",
  });
});

settingsRouter.put("/openai", requireAuth({ admin: true }), async (req, res) => {
  const apiKey = typeof req.body?.apiKey === "string" ? req.body.apiKey.trim() : "";
  if (!apiKey) return res.status(400).json({ error: "apiKey é obrigatório" });
  const patch = { apiKey };
  if (typeof req.body?.defaultModel === "string") patch.defaultModel = req.body.defaultModel.trim();
  await setOpenaiSettings(patch);
  res.json({ configured: true, defaultModel: patch.defaultModel || "" });
});

settingsRouter.delete("/openai", requireAuth({ admin: true }), async (_req, res) => {
  await clearOpenaiKey();
  res.json({ configured: false });
});

// Transcrição de consultas. Mesma divisão do bloco da OpenAI: todos leem o
// status (a página /consultas precisa saber se dá para gravar), só admin grava,
// e as chaves nunca saem daqui.
function publicTranscription(t) {
  return {
    provider: t.provider,
    groqConfigured: Boolean(t.groqApiKey),
    assemblyaiConfigured: Boolean(t.assemblyaiApiKey),
    autoSummary: t.autoSummary,
  };
}

settingsRouter.get("/transcription", requireAuth(), async (_req, res) => {
  res.json(publicTranscription(await getTranscriptionSettings()));
});

settingsRouter.put("/transcription", requireAuth({ admin: true }), async (req, res) => {
  const patch = {};
  if (typeof req.body?.provider === "string") patch.provider = req.body.provider;
  if (typeof req.body?.groqApiKey === "string") patch.groqApiKey = req.body.groqApiKey.trim();
  if (typeof req.body?.assemblyaiApiKey === "string") patch.assemblyaiApiKey = req.body.assemblyaiApiKey.trim();
  if (typeof req.body?.autoSummary === "boolean") patch.autoSummary = req.body.autoSummary;
  const updated = await setTranscriptionSettings(patch);
  broadcast(req, "transcription:update", { transcription: publicTranscription(updated) });
  res.json(publicTranscription(updated));
});

settingsRouter.delete("/transcription/:provider", requireAuth({ admin: true }), async (req, res) => {
  const updated = await clearTranscriptionKey(req.params.provider);
  broadcast(req, "transcription:update", { transcription: publicTranscription(updated) });
  res.json(publicTranscription(updated));
});
