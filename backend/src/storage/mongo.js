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
};

async function ensureIndexes() {
  await Promise.all([
    getCol(collections.conversations).createIndex({ instanceId: 1, lastInteraction: -1 }),
    getCol(collections.messages).createIndex({ instanceId: 1, chatId: 1, timestamp: 1 }),
    getCol(collections.prontuarios).createIndex({ dealId: 1 }),
    getCol(collections.scheduledMessages).createIndex({ conversationId: 1 }),
    getCol(collections.scheduledMessages).createIndex({ status: 1, scheduledAt: 1 }),
    getCol(collections.deals).createIndex({ stage: 1 }),
    getCol(collections.deals).createIndex({ sellerId: 1 }),
    getCol(collections.stages).createIndex({ order: 1 }),
    getCol(collections.internalThreads).createIndex({ memberIds: 1, lastMessageAt: -1 }),
    getCol(collections.internalMessages).createIndex({ threadId: 1, createdAt: 1 }),
    // Contagem de não-lidas: filtra por remetente diferente e ausência do leitor.
    getCol(collections.internalMessages).createIndex({ threadId: 1, senderId: 1, readBy: 1 }),
    getCol(collections.campaigns).createIndex({ status: 1, createdAt: -1 }),
    getCol(collections.campaignTargets).createIndex({ campaignId: 1, status: 1 }),
    // Marcar resposta do cliente: busca pela conversa que acabou de responder.
    getCol(collections.campaignTargets).createIndex({ conversationId: 1, status: 1 }),
  ]);
}
