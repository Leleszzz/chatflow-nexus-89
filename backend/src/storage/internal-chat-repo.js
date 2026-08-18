import { nanoid } from "nanoid";
import { getCol, collections } from "./mongo.js";

// Chat interno da equipe. Nada aqui passa pelo WhatsApp/Baileys — é conversa
// entre usuários do CRM.
//
// Uma thread é 1:1 ("dm") ou grupo ("group"); a diferença é só o `type` e o
// `name`. A permissão é sempre a mesma regra: você só enxerga a thread se o seu
// id está em `memberIds`.
const threadsCol = () => getCol(collections.internalThreads);
const messagesCol = () => getCol(collections.internalMessages);
const PROJ = { projection: { _id: 0 } };

/** Id determinístico da DM a partir do par de usuários — evita thread duplicada
 *  quando os dois lados abrem a conversa ao mesmo tempo. */
export function dmIdFor(userA, userB) {
  return `dm-${[String(userA), String(userB)].sort().join("--")}`;
}

export function isMember(thread, userId) {
  return Boolean(thread?.memberIds?.includes(userId));
}

export async function getThread(id) {
  return threadsCol().findOne({ _id: id }, PROJ);
}

/** Não-lidas por thread, numa consulta só. Uma mensagem conta como não lida
 *  quando não foi você que mandou e o seu id não está em `readBy`. */
async function unreadCountsFor(userId, threadIds) {
  if (!threadIds.length) return new Map();
  const rows = await messagesCol().aggregate([
    { $match: { threadId: { $in: threadIds }, senderId: { $ne: userId }, readBy: { $ne: userId } } },
    { $group: { _id: "$threadId", count: { $sum: 1 } } },
  ]).toArray();
  return new Map(rows.map(r => [r._id, r.count]));
}

export async function listThreadsForUser(userId) {
  const threads = await threadsCol()
    .find({ memberIds: userId }, PROJ)
    .sort({ lastMessageAt: -1, createdAt: -1 })
    .toArray();
  const unread = await unreadCountsFor(userId, threads.map(t => t.id));
  return threads.map(t => ({ ...t, unreadCount: unread.get(t.id) || 0 }));
}

export async function countUnreadForUser(userId) {
  const threads = await threadsCol().find({ memberIds: userId }, { projection: { id: 1, _id: 0 } }).toArray();
  const unread = await unreadCountsFor(userId, threads.map(t => t.id));
  let total = 0;
  for (const count of unread.values()) total += count;
  return total;
}

/** Abre a DM entre dois usuários, criando só se ainda não existir. */
export async function getOrCreateDm(userA, userB) {
  if (!userA || !userB || userA === userB) throw new Error("DM exige dois usuários distintos");
  const id = dmIdFor(userA, userB);
  const now = new Date().toISOString();
  // upsert com $setOnInsert: se dois clientes abrirem ao mesmo tempo, um cria e
  // o outro recebe a existente, sem duplicar.
  await threadsCol().updateOne(
    { _id: id },
    {
      $setOnInsert: {
        id,
        type: "dm",
        name: "",
        memberIds: [userA, userB].sort(),
        createdBy: userA,
        createdAt: now,
        lastMessage: null,
        lastMessageAt: null,
      },
    },
    { upsert: true },
  );
  return getThread(id);
}

export async function createGroup({ name, memberIds, createdBy }) {
  const clean = String(name || "").trim();
  if (!clean) throw new Error("nome do grupo é obrigatório");
  // O criador sempre entra no grupo, mesmo que não venha na lista.
  const members = [...new Set([createdBy, ...(memberIds || [])].filter(Boolean))];
  if (members.length < 2) throw new Error("um grupo precisa de pelo menos 2 participantes");

  const now = new Date().toISOString();
  const thread = {
    id: `grp-${nanoid(8)}`,
    type: "group",
    name: clean,
    memberIds: members,
    createdBy,
    createdAt: now,
    lastMessage: null,
    lastMessageAt: null,
  };
  await threadsCol().insertOne({ _id: thread.id, ...thread });
  return thread;
}

export async function updateGroup(id, { name, memberIds }) {
  const set = {};
  if (typeof name === "string" && name.trim()) set.name = name.trim();
  if (Array.isArray(memberIds)) {
    const members = [...new Set(memberIds.filter(Boolean))];
    if (members.length < 2) throw new Error("um grupo precisa de pelo menos 2 participantes");
    set.memberIds = members;
  }
  if (!Object.keys(set).length) return getThread(id);
  const res = await threadsCol().findOneAndUpdate({ _id: id }, { $set: set }, { returnDocument: "after", projection: { _id: 0 } });
  return res?.value ?? res ?? null;
}

/** Sai do grupo. A thread é removida quando fica com menos de 2 participantes. */
export async function leaveGroup(id, userId) {
  const thread = await getThread(id);
  if (!thread || thread.type !== "group") return null;
  const members = thread.memberIds.filter(memberId => memberId !== userId);
  if (members.length < 2) {
    await threadsCol().deleteOne({ _id: id });
    await messagesCol().deleteMany({ threadId: id });
    return { removed: true, thread: { ...thread, memberIds: members } };
  }
  const res = await threadsCol().findOneAndUpdate(
    { _id: id },
    { $set: { memberIds: members } },
    { returnDocument: "after", projection: { _id: 0 } },
  );
  return { removed: false, thread: res?.value ?? res };
}

export async function listMessages(threadId, { before, limit = 50 } = {}) {
  const query = { threadId };
  if (before) query.createdAt = { $lt: before };
  const rows = await messagesCol()
    .find(query, PROJ)
    .sort({ createdAt: -1 })
    .limit(Math.min(Number(limit) || 50, 200))
    .toArray();
  return rows.reverse(); // devolve em ordem cronológica
}

export async function appendMessage({ threadId, senderId, body }) {
  const clean = String(body || "").trim();
  if (!clean) throw new Error("mensagem vazia");
  const now = new Date().toISOString();
  const message = {
    id: `im-${nanoid(10)}`,
    threadId,
    senderId,
    body: clean,
    createdAt: now,
    // Quem escreveu já leu a própria mensagem.
    readBy: [senderId],
  };
  await messagesCol().insertOne({ _id: message.id, ...message });
  await threadsCol().updateOne(
    { _id: threadId },
    { $set: { lastMessage: { body: clean, senderId, createdAt: now }, lastMessageAt: now } },
  );
  return message;
}

/** Marca como lidas todas as mensagens da thread que o usuário ainda não leu. */
export async function markThreadRead(threadId, userId) {
  const res = await messagesCol().updateMany(
    { threadId, senderId: { $ne: userId }, readBy: { $ne: userId } },
    { $addToSet: { readBy: userId } },
  );
  return res.modifiedCount;
}

/** Limpa as threads de um usuário removido, para não sobrar DM órfã. */
export async function removeUserFromThreads(userId) {
  const threads = await threadsCol().find({ memberIds: userId }, PROJ).toArray();
  for (const thread of threads) {
    const members = thread.memberIds.filter(id => id !== userId);
    if (thread.type === "dm" || members.length < 2) {
      await threadsCol().deleteOne({ _id: thread.id });
      await messagesCol().deleteMany({ threadId: thread.id });
    } else {
      await threadsCol().updateOne({ _id: thread.id }, { $set: { memberIds: members } });
    }
  }
  return threads.length;
}
