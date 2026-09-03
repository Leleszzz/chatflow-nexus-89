// Conversas do assistente do médico.
//
// Duas coleções, como o chat interno: a thread guarda o cabeçalho e a última
// mensagem (é o que a lista lateral precisa), as mensagens ficam à parte porque
// crescem sem limite. Diferente do chat interno, thread aqui tem UM dono e nunca
// é compartilhada — nem com admin: ela guarda recorte de prontuário em texto
// plano, e "o admin vê tudo" não vale para a conversa clínica de outro médico.
//
// Sem TTL, por decisão: consultations e prontuarios também não expiram, e o
// médico volta num resumo de três meses atrás. A exclusão é manual.

import { nanoid } from "nanoid";
import { getCol, collections } from "./mongo.js";
import { normalizeProposal } from "../assistant/propostas.js";

const threads = () => getCol(collections.assistantThreads);
const mensagens = () => getCol(collections.assistantMessages);
const usage = () => getCol(collections.assistantUsage);
const PROJ = { projection: { _id: 0 } };

const LIMITE_PADRAO_MENSAGENS = 50;
const LIMITE_MAXIMO_MENSAGENS = 200;
const MAX_PROPOSTAS_POR_MENSAGEM = 5;

const texto = (valor, max = 8000) => String(valor ?? "").trim().slice(0, max);

function normalizeUsage(raw) {
  return {
    promptTokens: Number(raw?.promptTokens) || 0,
    completionTokens: Number(raw?.completionTokens) || 0,
    costUsd: Number(raw?.costUsd) || 0,
    calls: Number(raw?.calls) || 0,
  };
}

/**
 * Título da conversa, derivado da primeira pergunta.
 *
 * Corta na palavra para não terminar no meio de "remarc". Pergunta vazia não
 * acontece (a rota valida), mas o padrão existe para thread criada em branco
 * pelo botão "Nova conversa".
 */
export function tituloDaPergunta(pergunta, max = 60) {
  const limpo = String(pergunta ?? "").replace(/\s+/g, " ").trim();
  if (!limpo) return "Nova conversa";
  if (limpo.length <= max) return limpo;
  const cortado = limpo.slice(0, max);
  const ultimoEspaco = cortado.lastIndexOf(" ");
  const base = ultimoEspaco > 20 ? cortado.slice(0, ultimoEspaco) : cortado;
  return `${base.trim()}…`;
}

export function normalizeThread(record) {
  return {
    id: String(record?.id || `at-${nanoid(8)}`),
    userId: String(record?.userId || ""),
    titulo: texto(record?.titulo, 80) || "Nova conversa",
    createdAt: record?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastMessageAt: record?.lastMessageAt || null,
    totalMensagens: Number(record?.totalMensagens) || 0,
    usage: normalizeUsage(record?.usage),
    arquivadoEm: record?.arquivadoEm || null,
  };
}

function normalizePassos(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(p => p && p.tool)
    .map(p => ({
      tool: texto(p.tool, 60),
      resumo: texto(p.resumo, 200),
      ok: p.ok !== false,
      ms: Number(p.ms) || 0,
    }))
    .slice(0, 32);
}

export function normalizeAssistantMessage(record) {
  const role = record?.role === "assistant" ? "assistant" : "user";
  const base = {
    id: String(record?.id || `am-${nanoid(8)}`),
    threadId: String(record?.threadId || ""),
    // Desnormalizado: permite auditar escopo sem carregar a thread junto.
    userId: String(record?.userId || ""),
    role,
    body: texto(record?.body, 32000),
    createdAt: record?.createdAt || new Date().toISOString(),
  };
  if (role === "user") {
    return { ...base, entrada: record?.entrada === "voz" ? "voz" : "texto" };
  }
  return {
    ...base,
    modelo: texto(record?.modelo, 60),
    passos: normalizePassos(record?.passos),
    propostas: (Array.isArray(record?.propostas) ? record.propostas : [])
      .map(normalizeProposal)
      .filter(Boolean)
      .slice(0, MAX_PROPOSTAS_POR_MENSAGEM),
    usage: normalizeUsage(record?.usage),
    interrompido: Boolean(record?.interrompido),
    erro: texto(record?.erro, 500),
  };
}

// --- threads ---

export async function listThreads(userId, { limit = 30 } = {}) {
  if (!userId) return [];
  const achadas = await threads()
    .find({ userId: String(userId), arquivadoEm: null }, PROJ)
    .sort({ lastMessageAt: -1, createdAt: -1 })
    .limit(Math.min(100, Math.max(1, Number(limit) || 30)))
    .toArray();
  return achadas.map(normalizeThread);
}

export async function getThread(id) {
  if (!id) return null;
  const achada = await threads().findOne({ _id: String(id) }, PROJ);
  return achada ? normalizeThread(achada) : null;
}

export async function createThread({ userId, titulo } = {}) {
  if (!userId) throw new Error("userId é obrigatório");
  const thread = normalizeThread({ userId, titulo });
  await threads().insertOne({ _id: thread.id, ...thread });
  return thread;
}

export async function patchThread(id, patch) {
  const atual = await getThread(id);
  if (!atual) return null;
  // userId e createdAt são procedência: não se reescrevem por patch.
  const atualizada = normalizeThread({
    ...atual, ...patch, id: atual.id, userId: atual.userId, createdAt: atual.createdAt,
  });
  await threads().updateOne({ _id: atual.id }, { $set: atualizada });
  return atualizada;
}

export async function deleteThread(id) {
  if (!id) return false;
  const res = await threads().deleteOne({ _id: String(id) });
  // As mensagens vão junto: thread órfã seria prontuário solto no banco.
  await mensagens().deleteMany({ threadId: String(id) });
  return res.deletedCount > 0;
}

// --- mensagens ---

export function clampLimiteMensagens(bruto) {
  const n = Number(bruto);
  if (!Number.isFinite(n) || n <= 0) return LIMITE_PADRAO_MENSAGENS;
  return Math.min(LIMITE_MAXIMO_MENSAGENS, Math.floor(n));
}

/**
 * As `limit` mensagens mais recentes da thread, devolvidas em ordem cronológica.
 *
 * Mesma inversão de messages-repo: pagina para trás (`before`), exibe para
 * frente. Ler ao contrário quebraria o encadeamento pergunta/resposta.
 */
export async function listMessages(threadId, { before, limit } = {}) {
  if (!threadId) return [];
  const query = { threadId: String(threadId) };
  if (before) query.createdAt = { $lt: String(before) };
  const achadas = await mensagens()
    .find(query, PROJ)
    .sort({ createdAt: -1 })
    .limit(clampLimiteMensagens(limit))
    .toArray();
  return achadas.reverse().map(normalizeAssistantMessage);
}

export async function getMessage(id) {
  if (!id) return null;
  const achada = await mensagens().findOne({ _id: String(id) }, PROJ);
  return achada ? normalizeAssistantMessage(achada) : null;
}

/**
 * Grava a mensagem e atualiza o cabeçalho da thread na mesma operação.
 *
 * O contador e o lastMessageAt vão por $inc/$set direto, sem reler a thread:
 * duas mensagens gravadas quase juntas (a pergunta e a resposta) não podem
 * perder uma contagem por leitura desatualizada.
 */
export async function appendMessage(record) {
  const mensagem = normalizeAssistantMessage(record);
  if (!mensagem.threadId) throw new Error("threadId é obrigatório");
  await mensagens().insertOne({ _id: mensagem.id, ...mensagem });
  await threads().updateOne(
    { _id: mensagem.threadId },
    {
      $set: { lastMessageAt: mensagem.createdAt, updatedAt: new Date().toISOString() },
      $inc: { totalMensagens: 1 },
    },
  );
  return mensagem;
}

/**
 * Decide uma proposta — confirmada, recusada ou falhou.
 *
 * Atômica e idempotente de propósito: o filtro exige que a proposta ainda esteja
 * pendente, então duplo clique, duas abas ou um retry de rede produzem UM efeito
 * só. Devolve false quando a proposta já tinha sido decidida — a rota traduz
 * isso em 409, e não em "executei de novo".
 */
export async function marcarProposta(messageId, propostaId, patch = {}) {
  if (!messageId || !propostaId) return false;
  const set = {
    "propostas.$.status": patch.status || "confirmada",
    "propostas.$.decididoEm": new Date().toISOString(),
    "propostas.$.erro": texto(patch.erro, 500),
  };
  if (patch.resultado !== undefined) set["propostas.$.resultado"] = patch.resultado;
  // O payload efetivamente executado (com a edição do médico aplicada) fica
  // gravado: sem isso, a auditoria mostraria o texto que a IA propôs, não o que
  // saiu.
  if (patch.payload !== undefined) set["propostas.$.payload"] = patch.payload;

  const res = await mensagens().updateOne(
    { _id: String(messageId), propostas: { $elemMatch: { id: String(propostaId), status: "pendente" } } },
    { $set: set },
  );
  return res.modifiedCount === 1;
}

// --- custo ---

/**
 * Acumula o gasto do assistente por usuário.
 *
 * Coleção própria, e não a chave "assistant" dentro de agent_usage: aquele
 * documento é lido por GET /api/agents/usage, chaveado por agentId, e uma linha
 * sem agente correspondente apareceria na tela de Agentes.
 */
export async function addAssistantUsage(userId, { promptTokens = 0, completionTokens = 0, costUsd = 0 } = {}) {
  if (!userId) return;
  await usage().updateOne(
    { _id: String(userId) },
    {
      $inc: {
        promptTokens: Number(promptTokens) || 0,
        completionTokens: Number(completionTokens) || 0,
        costUsd: Number(costUsd) || 0,
        calls: 1,
      },
      $set: { lastUpdatedAt: new Date().toISOString() },
    },
    { upsert: true },
  );
}

export async function getAssistantUsage(userId) {
  if (!userId) return normalizeUsage(null);
  const achado = await usage().findOne({ _id: String(userId) });
  return normalizeUsage(achado);
}
