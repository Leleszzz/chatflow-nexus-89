import { getCol, collections } from "./mongo.js";
import { reassignChat } from "./messages-repo.js";
import { buildConversationId, isPlaceholderName, formatPhone, phoneFromChatId } from "../whatsapp/message-mapper.js";

const col = () => getCol(collections.conversations);

function isLidChat(c) {
  return typeof c?.chatId === "string" && c.chatId.endsWith("@lid");
}

function isPnChat(c) {
  return typeof c?.chatId === "string" && c.chatId.endsWith("@s.whatsapp.net");
}

// Parte de usuário do JID (telefone), sem o sufixo de servidor nem o ":device".
function baseUser(chatId) {
  return String(chatId || "").split("@")[0].split(":")[0];
}

// Esconde apenas conversas @lid que já têm um par @s.whatsapp.net REAL na mesma
// instância (mesmo "user base"), ou seja, o lid comprovadamente resolve para um
// PN conhecido. Nunca descarta um @lid que seja o único registro de um contato
// para sua instância. Rede de segurança de leitura — a mesclagem autoritativa é
// feita no pipeline.
function dropOrphanLidDuplicates(convs) {
  const pnUsersByInstance = new Map(); // instanceId -> Set(baseUser)
  for (const c of convs) {
    if (!isPnChat(c)) continue;
    const set = pnUsersByInstance.get(c.instanceId) || new Set();
    set.add(baseUser(c.chatId));
    pnUsersByInstance.set(c.instanceId, set);
  }
  return convs.filter(c => {
    if (!isLidChat(c)) return true;
    const peers = pnUsersByInstance.get(c.instanceId);
    return !(peers && peers.has(baseUser(c.chatId)));
  });
}

// `archived: true` lista só as arquivadas; o padrão esconde as arquivadas.
// `{ archivedAt: null }` casa tanto com o campo ausente quanto com null, que é
// o que queremos para as conversas que nunca foram arquivadas.
export async function listConversations({ instanceId, limit, offset = 0, archived = false } = {}) {
  const query = instanceId ? { instanceId } : {};
  query.archivedAt = archived ? { $ne: null } : null;
  const all = await col().find(query, { projection: { _id: 0 } }).toArray();
  const filtered = all.filter(c =>
    c &&
    typeof c.id === "string" &&
    typeof c.chatId === "string" &&
    c.isGroup === false &&
    !c.chatId.endsWith("@g.us") &&
    !c.chatId.endsWith("@broadcast") &&
    !c.chatId.endsWith("@newsletter")
  );
  const deduped = dropOrphanLidDuplicates(filtered);
  const sorted = deduped.sort((a, b) => new Date(b.lastInteraction) - new Date(a.lastInteraction));
  if (limit == null) return sorted;
  return sorted.slice(offset, offset + limit);
}

export async function getConversation(id) {
  return col().findOne({ _id: id }, { projection: { _id: 0 } });
}

export async function getConversationsByIds(ids) {
  if (!ids?.length) return [];
  return col().find({ _id: { $in: ids } }, { projection: { _id: 0 } }).toArray();
}

// Contagem de conversas (não-grupo) de uma instância — usado no dashboard.
// Arquivadas não entram na conta, para bater com o que a lista mostra.
export async function countConversations(instanceId) {
  return col().countDocuments({ instanceId, isGroup: false, archivedAt: null });
}

// Campos do overlay de CRM da conversa (antes: localStorage
// "crm-wa-conversation-patches"). Ficam num sub-documento `crm` para não se
// misturarem com os metadados que vêm do WhatsApp.
const CRM_FIELDS = new Set([
  "dealId", "customer", "sellerId", "assignedSellerIds",
  "temperature", "tags", "stage", "notes",
  "aiEnabled", "aiAgentId", "schedulingProposal",
]);

/**
 * Aplica um patch parcial em `conversations.crm`.
 *
 * Usa $set por chave (`crm.sellerId`) em vez de gravar o objeto inteiro: quem
 * liga a IA manda só `aiEnabled`, e substituir o sub-documento apagaria o
 * vendedor e a etapa. Mesma lição do customFields em patchDeal.
 *
 * `schedulingProposal: null` REMOVE a chave — é assim que o front sinaliza
 * "proposta de horário consumida".
 */
export async function patchConversationCrm(id, patch) {
  const set = {};
  const unset = {};
  for (const [key, value] of Object.entries(patch || {})) {
    if (!CRM_FIELDS.has(key)) continue;
    if (value === null || value === undefined) unset[`crm.${key}`] = "";
    else set[`crm.${key}`] = value;
  }
  if (!Object.keys(set).length && !Object.keys(unset).length) return getConversation(id);

  const update = {};
  if (Object.keys(set).length) update.$set = set;
  if (Object.keys(unset).length) update.$unset = unset;
  const res = await col().findOneAndUpdate(
    { _id: id },
    update,
    { returnDocument: "after", projection: { _id: 0 } },
  );
  return res?.value ?? res ?? null;
}

// Contagem de conversas atribuídas a um usuário — alimenta a estratégia
// "load-balanced" da distribuição de leads, que antes contava no navegador.
export async function countConversationsAssignedTo(userId) {
  if (!userId) return 0;
  return col().countDocuments({
    archivedAt: null,
    $or: [{ "crm.sellerId": userId }, { "crm.assignedSellerIds": userId }],
  });
}

// Mescla os campos informados sobre o documento existente (upsert).
export async function upsertConversation(conversation) {
  const id = conversation.id;
  const res = await col().findOneAndUpdate(
    { _id: id },
    { $set: { ...conversation, id } },
    { upsert: true, returnDocument: "after", projection: { _id: 0 } },
  );
  return res?.value ?? res;
}

// Funde a conversa `fromChatId` na conversa `toChatId` (mesma instância): move as
// mensagens, mescla os metadados (preferindo nome real e a interação mais
// recente) e remove a conversa de origem. Usado para unificar o par @lid/@s.whatsapp.net
// do mesmo contato. Retorna { merged, removedId } ou null se nada foi fundido.
export async function mergeConversations(instanceId, fromChatId, toChatId) {
  if (!instanceId || !fromChatId || !toChatId || fromChatId === toChatId) return null;
  const fromId = buildConversationId(instanceId, fromChatId);
  const toId = buildConversationId(instanceId, toChatId);
  const [from, to] = await Promise.all([
    col().findOne({ _id: fromId }, { projection: { _id: 0 } }),
    col().findOne({ _id: toId }, { projection: { _id: 0 } }),
  ]);
  if (!from) return null; // nada de origem para fundir

  await reassignChat(instanceId, fromChatId, toChatId);

  // Prefere um nome "de verdade" (não vazio/JID/só-dígitos) entre os dois.
  const pickName = (primary, secondary) => {
    if (!isPlaceholderName(primary)) return primary;
    if (!isPlaceholderName(secondary)) return secondary;
    return primary || secondary || "";
  };
  const tsOf = c => (c?.lastInteraction ? new Date(c.lastInteraction).getTime() : 0) || 0;
  const newer = tsOf(from) >= tsOf(to) ? from : (to || from);
  const totalUnread = (to?.unreadCount || 0) + (from?.unreadCount || 0);

  const merged = {
    id: toId,
    instanceId,
    chatId: toChatId,
    isGroup: false,
    customer: pickName(to?.customer, from?.customer),
    whatsappName: pickName(to?.whatsappName, from?.whatsappName),
    // A conversa de origem (@lid) não tem telefone. Se o destino ainda não
    // existe, o número precisa sair do próprio JID de destino — senão a conversa
    // fundida ficaria sem telefone mesmo tendo o número no chatId.
    phone: to?.phone || from?.phone || phoneFromChatId(toChatId),
    avatarUrl: to?.avatarUrl || from?.avatarUrl,
    lastMessage: newer?.lastMessage || "",
    lastMessageId: newer?.lastMessageId,
    lastMessageFromMe: newer?.lastMessageFromMe,
    lastMessageAck: newer?.lastMessageAck ?? 0,
    lastInteraction: newer?.lastInteraction || "",
    unreadCount: totalUnread,
    unread: totalUnread > 0,
  };

  const res = await col().findOneAndUpdate(
    { _id: toId },
    { $set: merged },
    { upsert: true, returnDocument: "after", projection: { _id: 0 } },
  );
  await col().deleteOne({ _id: fromId });
  return { merged: res?.value ?? res ?? merged, removedId: fromId };
}

// Preenche o telefone de conversas cujo chatId é um número (@s.whatsapp.net) mas
// que ficaram com o campo vazio — o número sempre pode ser derivado do JID.
// Devolve as conversas corrigidas para que o front seja atualizado.
export async function repairMissingPhones(instanceId) {
  const pendentes = await col()
    .find({ instanceId, $or: [{ phone: "" }, { phone: null }, { phone: { $exists: false } }] }, { projection: { _id: 0 } })
    .toArray();
  const corrigidas = [];
  for (const conv of pendentes) {
    const phone = phoneFromChatId(conv.chatId);
    if (!phone) continue; // @lid: o WhatsApp não revela o número
    const res = await col().findOneAndUpdate(
      { _id: conv.id },
      { $set: { phone } },
      { returnDocument: "after", projection: { _id: 0 } },
    );
    corrigidas.push(res?.value ?? res);
  }
  return corrigidas;
}

// Conversas que ainda não têm foto de perfil. Alimenta o backfill de avatares
// ao reconectar — sem ele, uma conversa que falhou em baixar a foto só tentaria
// de novo quando chegasse uma mensagem nova.
export async function listConversationsMissingAvatar(instanceId, limit = 500) {
  return col()
    .find(
      {
        instanceId,
        isGroup: false,
        archivedAt: null,
        $or: [{ avatarUrl: null }, { avatarUrl: "" }, { avatarUrl: { $exists: false } }],
      },
      { projection: { _id: 0, id: 1, chatId: 1 } },
    )
    .sort({ lastInteraction: -1 })
    .limit(limit)
    .toArray();
}

export async function removeConversationsByInstance(instanceId) {
  await col().deleteMany({ instanceId });
}

// Arquivamento é soft delete: a conversa some das listagens mas o documento e
// todas as mensagens continuam no banco, então dá para restaurar sem perda.
export async function archiveConversation(id, userId) {
  const res = await col().findOneAndUpdate(
    { _id: id },
    { $set: { archivedAt: new Date().toISOString(), archivedBy: userId || null } },
    { returnDocument: "after", projection: { _id: 0 } },
  );
  return res?.value ?? res;
}

export async function restoreConversation(id) {
  const res = await col().findOneAndUpdate(
    { _id: id },
    { $unset: { archivedAt: "", archivedBy: "" } },
    { returnDocument: "after", projection: { _id: 0 } },
  );
  return res?.value ?? res;
}

// Chamado quando chega mensagem nova: uma conversa arquivada que volta a
// receber mensagem reaparece na lista, senão o atendimento se perderia.
export async function unarchiveOnActivity(id) {
  const res = await col().updateOne(
    { _id: id, archivedAt: { $exists: true, $ne: null } },
    { $unset: { archivedAt: "", archivedBy: "" } },
  );
  return res.modifiedCount > 0;
}
