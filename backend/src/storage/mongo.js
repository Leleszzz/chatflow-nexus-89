import { MongoClient } from "mongodb";
import { config } from "../config.js";

let client = null;
let db = null;

// Conecta ao MongoDB local (singleton). Chamado uma vez no boot.
export async function connectMongo() {
  if (db) return db;
  client = new MongoClient(config.mongo.uri, {
    serverSelectionTimeoutMS: 8000,
    maxPoolSize: 20,
  });
  await client.connect();
  db = client.db(config.mongo.db);
  console.log(`[mongo] conectado em ${config.mongo.uri} (db: ${config.mongo.db})`);
  await ensureIndexes();
  return db;
}

export function getDb() {
  if (!db) throw new Error("MongoDB não conectado — chame connectMongo() primeiro");
  return db;
}

export function getCol(name) {
  return getDb().collection(name);
}

export async function closeMongo() {
  if (client) {
    try { await client.close(); } catch {}
  }
  client = null;
  db = null;
}

// Coleções usadas pela aplicação.
export const collections = {
  conversations: "conversations",
  messages: "messages",
  instances: "instances",
  prontuarios: "prontuarios",
  consultations: "consultations",
  scheduledMessages: "scheduled_messages",
  settings: "settings",
  agentUsage: "agent_usage",
  users: "users",
  deals: "deals",
  stages: "stages",
  leadList: "lead_list",
  quickReplies: "quick_replies",
  internalThreads: "internal_threads",
  internalMessages: "internal_messages",
  campaigns: "campaigns",
  campaignTargets: "campaign_targets",
  customFields: "custom_fields",
  agents: "agents",
  tags: "tags",
  appointments: "appointments",
  tasks: "tasks",
  dealOutcomes: "deal_outcomes",
  auditoria: "auditoria",
  agentLocks: "agent_locks",
  assistantThreads: "assistant_threads",
  assistantMessages: "assistant_messages",
  assistantUsage: "assistant_usage",
};

async function ensureIndexes() {
  await Promise.all([
    getCol(collections.conversations).createIndex({ instanceId: 1, lastInteraction: -1 }),
    // A caixa de entrada sempre filtra por arquivadas + não-grupo e ordena por
    // interação. Sem este composto, a listagem paginada volta a varrer a coleção.
    getCol(collections.conversations).createIndex({ archivedAt: 1, isGroup: 1, lastInteraction: -1 }),
    getCol(collections.conversations).createIndex({ instanceId: 1, archivedAt: 1, lastInteraction: -1 }),
    // Vínculo conversa -> card (findConversationByDealId, clearCrmDealLink).
    getCol(collections.conversations).createIndex({ "crm.dealId": 1 }),
    // Distribuição de leads conta conversas por responsável.
    getCol(collections.conversations).createIndex({ "crm.sellerId": 1, archivedAt: 1 }),
    // Login e unicidade de identificador. `sparse` porque documento antigo pode
    // não ter o campo; sem ele o índice único rejeitaria o segundo nulo.
    getCol(collections.users).createIndex({ username: 1 }, { unique: true, sparse: true }),
    getCol(collections.users).createIndex({ email: 1 }, { sparse: true }),
    // leadStats ordena por data de importação a cada carregamento da tela.
    getCol(collections.leadList).createIndex({ importadoEm: -1 }),
    // Kanban e agenda ordenam/filtram por última interação.
    getCol(collections.deals).createIndex({ lastInteraction: -1 }),
    // Fila da secretaria: a tela abre em "abertas" e filtra por responsável.
    getCol(collections.tasks).createIndex({ status: 1, criadoEm: -1 }),
    getCol(collections.tasks).createIndex({ assigneeId: 1, status: 1 }),
    // Cascade ao excluir um card.
    getCol(collections.tasks).createIndex({ dealId: 1 }),
    // Trilha de auditoria: consulta por usuario e por acao, com expiracao
    // automatica em 2 anos para o log nao crescer sem fim.
    getCol(collections.auditoria).createIndex({ em: -1 }),
    getCol(collections.auditoria).createIndex({ usuarioId: 1, em: -1 }),
    getCol(collections.auditoria).createIndex({ acao: 1, em: -1 }),
    getCol(collections.auditoria).createIndex({ em: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 730 }),
    // Trava do agente: expira sozinha se o processo morrer no meio de uma
    // geracao, senao a conversa ficaria travada para sempre.
    getCol(collections.agentLocks).createIndex(
      { em: 1 },
      { expireAfterSeconds: Number(process.env.AGENT_LOCK_TTL_S || 120) },
    ),
    getCol(collections.messages).createIndex({ instanceId: 1, chatId: 1, timestamp: 1 }),
    getCol(collections.prontuarios).createIndex({ dealId: 1 }),
    // Consultas gravadas: a lista por cliente é sempre a mais recente primeiro,
    // e o filtro por status acha as que ficaram penduradas em "processando".
    getCol(collections.consultations).createIndex({ dealId: 1, recordedAt: -1 }),
    getCol(collections.consultations).createIndex({ status: 1 }),
    getCol(collections.scheduledMessages).createIndex({ conversationId: 1 }),
    getCol(collections.scheduledMessages).createIndex({ status: 1, scheduledAt: 1 }),
    getCol(collections.deals).createIndex({ stage: 1 }),
    getCol(collections.deals).createIndex({ sellerId: 1 }),
    getCol(collections.stages).createIndex({ order: 1 }),
    getCol(collections.customFields).createIndex({ order: 1 }),
    getCol(collections.tags).createIndex({ order: 1 }),
    // Agenda: cascade ao excluir o card, e a visão por vendedor/dia do calendário.
    getCol(collections.appointments).createIndex({ dealId: 1 }),
    getCol(collections.appointments).createIndex({ sellerId: 1, date: 1 }),
    getCol(collections.dealOutcomes).createIndex({ dealId: 1 }),
    getCol(collections.dealOutcomes).createIndex({ operatorId: 1, finishedAt: -1 }),
    getCol(collections.internalThreads).createIndex({ memberIds: 1, lastMessageAt: -1 }),
    getCol(collections.internalMessages).createIndex({ threadId: 1, createdAt: 1 }),
    // Contagem de não-lidas: filtra por remetente diferente e ausência do leitor.
    getCol(collections.internalMessages).createIndex({ threadId: 1, senderId: 1, readBy: 1 }),
    getCol(collections.campaigns).createIndex({ status: 1, createdAt: -1 }),
    getCol(collections.campaignTargets).createIndex({ campaignId: 1, status: 1 }),
    // Marcar resposta do cliente: busca pela conversa que acabou de responder.
    getCol(collections.campaignTargets).createIndex({ conversationId: 1, status: 1 }),
    // Assistente do medico: a lista lateral e sempre "minhas conversas, recentes
    // primeiro", e as mensagens sao lidas em ordem cronologica dentro da thread.
    getCol(collections.assistantThreads).createIndex({ userId: 1, lastMessageAt: -1 }),
    getCol(collections.assistantMessages).createIndex({ threadId: 1, createdAt: 1 }),
  ]);
}
