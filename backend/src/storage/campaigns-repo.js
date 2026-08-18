import { nanoid } from "nanoid";
import { getCol, collections } from "./mongo.js";

// Campanhas de REMARKETING. A regra que define esta feature: só é possível
// enviar para quem já tem uma conversa no CRM — ou seja, quem já falou com a
// empresa. Não existe caminho para disparar para uma lista de números
// arbitrários; o público é sempre derivado da coleção `conversations`.
//
// Isso é validado no servidor (ver `buildAudience` e `createCampaign`), não só
// na interface.

const campaignsCol = () => getCol(collections.campaigns);
const targetsCol = () => getCol(collections.campaignTargets);
const PROJ = { projection: { _id: 0 } };

/** Intervalo entre envios. O piso protege o número de ser banido por flood. */
export const MIN_THROTTLE_MS = 15_000;
export const DEFAULT_THROTTLE_MS = 40_000;

export const CAMPAIGN_STATUSES = ["rascunho", "rodando", "pausada", "finalizada", "cancelada"];

/**
 * Monta o público a partir das conversas existentes.
 *
 * Filtros suportados são só os que a conversa realmente carrega no banco —
 * etapa do funil e temperatura vivem no deal/localStorage e não são
 * confiáveis no servidor, então não entram aqui.
 */
export async function buildAudience({
  instanceIds = [],
  inactiveDays = 0,
  onlyClientLast = false,
  onlyUnread = false,
  limit = 1000,
} = {}) {
  const query = {
    isGroup: false,
    archivedAt: null,
    // Sem telefone não há para quem enviar.
    phone: { $nin: ["", null] },
  };
  if (instanceIds.length) query.instanceId = { $in: instanceIds };
  if (onlyClientLast) query.lastMessageFromMe = false;
  if (onlyUnread) query.unread = true;
  if (inactiveDays > 0) {
    const cutoff = new Date(Date.now() - inactiveDays * 86400000).toISOString();
    query.lastInteraction = { $lte: cutoff };
  }

  return campaignsAudienceQuery(query, limit);
}

async function campaignsAudienceQuery(query, limit) {
  const conversations = getCol(collections.conversations);
  return conversations
    .find(query, { projection: { _id: 0, id: 1, instanceId: 1, chatId: 1, customer: 1, whatsappName: 1, phone: 1, lastInteraction: 1 } })
    .sort({ lastInteraction: -1 })
    .limit(Math.min(Number(limit) || 1000, 5000))
    .toArray();
}

/** Resolve ids de conversa informados manualmente, descartando os inválidos. */
export async function resolveConversations(conversationIds) {
  if (!conversationIds?.length) return [];
  return getCol(collections.conversations)
    .find(
      { _id: { $in: conversationIds }, isGroup: false, archivedAt: null, phone: { $nin: ["", null] } },
      { projection: { _id: 0, id: 1, instanceId: 1, chatId: 1, customer: 1, whatsappName: 1, phone: 1, lastInteraction: 1 } },
    )
    .toArray();
}

export async function listCampaigns() {
  return campaignsCol().find({}, PROJ).sort({ createdAt: -1 }).toArray();
}

export async function getCampaign(id) {
  return campaignsCol().findOne({ _id: id }, PROJ);
}

export async function listTargets(campaignId) {
  return targetsCol().find({ campaignId }, PROJ).sort({ createdAt: 1 }).toArray();
}

/**
 * Cria a campanha já com a lista de alvos materializada. Congelar o público no
 * momento da criação evita que o conjunto mude no meio do envio (uma conversa
 * nova entraria no filtro e receberia a mensagem sem revisão).
 */
export async function createCampaign({ name, message, audience, throttleMs, createdBy }) {
  const clean = String(name || "").trim();
  if (!clean) throw new Error("nome da campanha é obrigatório");
  const body = String(message || "").trim();
  if (!body) throw new Error("mensagem é obrigatória");
  if (!audience?.length) throw new Error("nenhum contato no público selecionado");

  const now = new Date().toISOString();
  const campaign = {
    id: `cmp-${nanoid(8)}`,
    name: clean,
    message: body,
    status: "rascunho",
    throttleMs: Math.max(Number(throttleMs) || DEFAULT_THROTTLE_MS, MIN_THROTTLE_MS),
    total: audience.length,
    sent: 0,
    failed: 0,
    replied: 0,
    createdBy: createdBy || null,
    createdAt: now,
    startedAt: null,
    finishedAt: null,
    lastSentAt: null,
  };
  await campaignsCol().insertOne({ _id: campaign.id, ...campaign });

  const targets = audience.map(conv => ({
    _id: `${campaign.id}__${conv.id}`,
    id: `${campaign.id}__${conv.id}`,
    campaignId: campaign.id,
    conversationId: conv.id,
    instanceId: conv.instanceId,
    chatId: conv.chatId,
    customer: conv.customer || conv.whatsappName || conv.phone,
    whatsappName: conv.whatsappName || "",
    phone: conv.phone,
    status: "pendente",
    createdAt: now,
    sentAt: null,
    messageId: null,
    repliedAt: null,
    error: null,
  }));
  // ordered:false + _id determinístico: se o mesmo contato aparecer duas vezes
  // no público, entra uma vez só em vez de estourar a criação.
  await targetsCol().insertMany(targets, { ordered: false }).catch(err => {
    if (err.code !== 11000) throw err;
  });

  return campaign;
}

export async function updateCampaignStatus(id, status) {
  if (!CAMPAIGN_STATUSES.includes(status)) throw new Error(`status inválido: ${status}`);
  const set = { status };
  if (status === "rodando") set.startedAt = new Date().toISOString();
  if (status === "finalizada" || status === "cancelada") set.finishedAt = new Date().toISOString();
  const res = await campaignsCol().findOneAndUpdate({ _id: id }, { $set: set }, { returnDocument: "after", projection: { _id: 0 } });
  return res?.value ?? res ?? null;
}

export async function deleteCampaign(id) {
  await targetsCol().deleteMany({ campaignId: id });
  const res = await campaignsCol().deleteOne({ _id: id });
  return res.deletedCount > 0;
}

/** Campanhas que o worker deve processar agora. */
export async function listRunningCampaigns() {
  return campaignsCol().find({ status: "rodando" }, PROJ).toArray();
}

/** Próximo alvo pendente de uma campanha. */
export async function nextPendingTarget(campaignId) {
  return targetsCol().findOne({ campaignId, status: "pendente" }, PROJ);
}

export async function countPending(campaignId) {
  return targetsCol().countDocuments({ campaignId, status: "pendente" });
}

/**
 * Marca o alvo como enviado. O filtro inclui `status: "pendente"` para que dois
 * ticks concorrentes não enviem a mesma mensagem duas vezes — quem perder a
 * corrida recebe modifiedCount 0 e desiste.
 */
export async function markTargetSent(targetId, { messageId }) {
  const res = await targetsCol().updateOne(
    { _id: targetId, status: "pendente" },
    { $set: { status: "enviado", sentAt: new Date().toISOString(), messageId: messageId || null } },
  );
  return res.modifiedCount > 0;
}

export async function markTargetFailed(targetId, error) {
  const res = await targetsCol().updateOne(
    { _id: targetId, status: "pendente" },
    { $set: { status: "falhou", error: String(error || "").slice(0, 300) } },
  );
  return res.modifiedCount > 0;
}

export async function bumpCampaign(campaignId, { sent = 0, failed = 0, touchLastSent = false }) {
  const inc = {};
  if (sent) inc.sent = sent;
  if (failed) inc.failed = failed;
  const update = {};
  if (Object.keys(inc).length) update.$inc = inc;
  if (touchLastSent) update.$set = { lastSentAt: new Date().toISOString() };
  if (!Object.keys(update).length) return;
  await campaignsCol().updateOne({ _id: campaignId }, update);
}

/**
 * Registra que o contato respondeu depois de receber a campanha. Chamado do
 * pipeline quando chega mensagem do cliente — é o que dá sentido à taxa de
 * resposta do relatório.
 */
export async function markRepliedByConversation(conversationId) {
  const now = new Date().toISOString();
  const pendentes = await targetsCol()
    .find({ conversationId, status: "enviado", repliedAt: null }, PROJ)
    .toArray();
  if (!pendentes.length) return 0;

  await targetsCol().updateMany(
    { conversationId, status: "enviado", repliedAt: null },
    { $set: { repliedAt: now } },
  );
  // Uma resposta pode contar para mais de uma campanha que atingiu o contato.
  for (const alvo of pendentes) {
    await campaignsCol().updateOne({ _id: alvo.campaignId }, { $inc: { replied: 1 } });
  }
  return pendentes.length;
}
