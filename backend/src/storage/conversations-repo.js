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

/**
 * Conversas @lid que já têm um par @s.whatsapp.net REAL na mesma instância —
 * ou seja, o LID comprovadamente resolve para um número conhecido. Rede de
 * segurança de leitura; a mesclagem autoritativa é feita no pipeline.
 *
 * Antes isto rodava sobre a coleção INTEIRA carregada em memória. Agora só a
 * página que vai ser devolvida é examinada: no máximo `limit` conversas @lid
 * geram UMA consulta extra, em vez de materializar tudo para descobrir o mesmo.
 */
async function idsLidComParPn(pagina) {
  const lids = pagina.filter(isLidChat);
  if (!lids.length) return new Set();

  // Um OR de (instância, número base) por @lid da página. Casa com o índice
  // { instanceId, ... } e devolve só o chatId.
  const condicoes = lids.map(c => ({
    instanceId: c.instanceId,
    chatId: { $in: [`${baseUser(c.chatId)}@s.whatsapp.net`] },
  }));
  const pares = await col()
    .find({ $or: condicoes }, { projection: { _id: 0, instanceId: 1, chatId: 1 } })
    .toArray();

  const conhecidos = new Set(pares.map(p => `${p.instanceId}|${baseUser(p.chatId)}`));
  return new Set(
    lids.filter(c => conhecidos.has(`${c.instanceId}|${baseUser(c.chatId)}`)).map(c => c.id),
  );
}

// Teto de segurança. Sem `limit`, a rota devolvia TODAS as conversas: com 20 mil
// no banco isso eram centenas de MB materializados no Node a cada abertura da
// tela, por usuário. O teto é generoso para não mudar o comportamento de quem
// tem pouca conversa, mas impede o caso patológico.
export const LIMITE_PADRAO_CONVERSAS = 500;
export const LIMITE_MAXIMO_CONVERSAS = 2000;

/** Normaliza `limit` vindo da query: descarta NaN, negativo e valor absurdo. */
export function clampLimiteConversas(bruto) {
  const n = Number(bruto);
  if (!Number.isFinite(n) || n <= 0) return LIMITE_PADRAO_CONVERSAS;
  return Math.min(Math.floor(n), LIMITE_MAXIMO_CONVERSAS);
}

// Grupos/broadcast/newsletter nunca aparecem na caixa de entrada. `isGroup` é o
// campo indexável; os sufixos são o resíduo defensivo para documentos antigos
// gravados antes do campo existir.
const SUFIXOS_IGNORADOS = /@(g\.us|broadcast|newsletter)$/;

/**
 * `archived: true` lista só as arquivadas; o padrão esconde as arquivadas.
 * `{ archivedAt: null }` casa tanto com o campo ausente quanto com null.
 * `instanceIds` (array) recorta pelas instâncias que o usuário pode ver; array
 * vazio devolve nada, que é o correto para quem não tem instância liberada.
 *
 * Filtro, ordenação e paginação acontecem NO MONGO. Antes era
 * `.find(query).toArray()` seguido de filter/sort/slice em JavaScript: o índice
 * { instanceId, lastInteraction } criado no boot nunca era usado, porque a
 * ordenação real acontecia fora do banco.
 */
// Metacaracteres de regex, listados como caracteres em vez de escritos dentro
// de um literal — assim nao ha backslash para escapar errado.
const META_REGEX = new Set([
  ".", "*", "+", "?", "^", "$", "{", "}", "(", ")", "|", "[", "]", String.fromCharCode(92),
]);

/**
 * Transforma o termo digitado em texto LITERAL para o regex.
 *
 * Sem isto, um cliente chamado "Ana (mae)" quebraria a consulta, e um termo
 * como "(a+)+$" viraria um regex catastrofico que trava o banco (ReDoS).
 */
export function escaparRegex(texto) {
  let saida = "";
  for (const ch of String(texto)) saida += META_REGEX.has(ch) ? String.fromCharCode(92) + ch : ch;
  return saida;
}

export async function listConversations({ instanceId, instanceIds, limit, offset = 0, archived = false, busca } = {}) {
  const query = {
    isGroup: false,
    chatId: { $not: SUFIXOS_IGNORADOS },
    archivedAt: archived ? { $ne: null } : null,
  };
  if (instanceId) query.instanceId = instanceId;
  else if (Array.isArray(instanceIds)) query.instanceId = { $in: instanceIds };

  // Busca NO SERVIDOR. Antes o front carregava todas as conversas e filtrava em
  // memória — o que funcionava, mas só porque tudo estava carregado. Com a
  // listagem paginada, filtrar no cliente encontraria apenas o que coube na
  // primeira página, e o atendente concluiria que o contato "não existe".
  const termo = String(busca || "").trim();
  if (termo) {
    const alvo = new RegExp(escaparRegex(termo), "i");
    const somenteDigitos = termo.replace(/\D/g, "");
    query.$or = [
      { customer: alvo },
      { whatsappName: alvo },
      { phone: alvo },
      { lastMessage: alvo },
      ...(somenteDigitos.length >= 4 ? [{ chatId: new RegExp(escaparRegex(somenteDigitos)) }] : []),
    ];
  }

  const teto = clampLimiteConversas(limit);
  const inicio = Number.isFinite(Number(offset)) && Number(offset) > 0 ? Math.floor(Number(offset)) : 0;

  // Busca um pouco além do teto para conseguir repor o que a deduplicação de
  // @lid remover, sem precisar de uma segunda rodada.
  const folga = Math.min(teto + 50, LIMITE_MAXIMO_CONVERSAS + 50);
  const pagina = await col()
    .find(query, { projection: { _id: 0 } })
    .sort({ lastInteraction: -1 })
    .skip(inicio)
    .limit(folga)
    .toArray();

  const descartar = await idsLidComParPn(pagina);
  return pagina.filter(c => c && typeof c.id === "string" && !descartar.has(c.id)).slice(0, teto);
}

/**
 * Só o overlay de CRM de cada conversa (dono, etapa, tags, IA vinculada).
 *
 * Existe para o store do front parar de baixar a LISTA INTEIRA de conversas só
 * para reindexar esse pedacinho — o que, além de desperdício, passou a perder
 * dados quando a listagem virou paginada. Aqui a projeção é mínima e o filtro
 * descarta quem não tem overlay nenhum.
 */
export async function listCrmOverlays(instanceIds) {
  const query = { crm: { $exists: true, $ne: null } };
  if (Array.isArray(instanceIds)) query.instanceId = { $in: instanceIds };
  return col().find(query, { projection: { _id: 0, id: 1, crm: 1 } }).toArray();
}

export async function getConversation(id) {
  return col().findOne({ _id: id }, { projection: { _id: 0 } });
}

/**
 * Últimos 8 dígitos — a mesma chave que o front usa em src/lib/telefone.ts.
 * Ignora DDI, DDD e o nono dígito, que aparecem de jeitos diferentes no número
 * que o WhatsApp devolve e no que foi digitado no cadastro do lead.
 */
function ultimos8(valor) {
  const digitos = String(valor || "").replace(/\D/g, "");
  return digitos.length >= 8 ? digitos.slice(-8) : "";
}

/** Chave do JID, sem o sufixo de servidor nem o ":device". */
const chaveDoChat = chatId => ultimos8(baseUser(chatId));

// Entre várias conversas do mesmo contato vence a de interação mais recente, e
// um chat @s.whatsapp.net ganha de um @lid — é o par com telefone de verdade.
function maisRelevante(convs) {
  return convs.sort((a, b) => {
    if (isPnChat(a) !== isPnChat(b)) return isPnChat(a) ? -1 : 1;
    return new Date(b.lastInteraction) - new Date(a.lastInteraction);
  })[0];
}

/**
 * Aplica o recorte de instâncias a um filtro do Mongo.
 *
 * `null`/`undefined` é "sem recorte" — é o que `allowedInstanceIdsForRequest`
 * devolve para admin, que enxerga todas. Uma lista restringe; a lista vazia é
 * tratada pelo chamador, porque um `$in: []` silencioso esconde a intenção.
 *
 * Pura e exportada para poder ser testada: até esta função existir,
 * findConversationByDealId ACEITAVA `instanceIds` e o ignorava, e a rota
 * /by-deal passava o recorte achando que ele valia.
 */
export function comRecorteDeInstancia(filtro, instanceIds) {
  if (!Array.isArray(instanceIds)) return filtro;
  return { ...filtro, instanceId: { $in: instanceIds } };
}

/**
 * A conversa de WhatsApp de um card do CRM.
 *
 * Existe porque uma consulta gravada só guarda `dealId`, e mandar mensagem exige
 * `instanceId` + `chatId`. O caminho normal é o vínculo em `crm.dealId` (o mesmo
 * campo que `clearCrmDealLink` desfaz).
 *
 * O `phone` é a rede de segurança para a conversa que nunca teve o vínculo
 * gravado — importada antes de o vínculo existir, ou criada fora do fluxo do
 * Kanban. A tela de Conversas já casa card e conversa assim (`dealByPhone`), e
 * sem isto a consulta de um cliente que claramente tem conversa dizia que não
 * tinha.
 */
export async function findConversationByDealId(dealId, { phone, instanceIds } = {}) {
  if (!dealId) return null;
  // Recorte vazio é "nenhuma instância permitida", não "todas": devolver a
  // conversa aqui entregaria ao doutor o número da secretária.
  if (Array.isArray(instanceIds) && instanceIds.length === 0) return null;

  const vinculadas = await col()
    .find(comRecorteDeInstancia({ "crm.dealId": String(dealId), archivedAt: null }, instanceIds), { projection: { _id: 0 } })
    .toArray();
  if (vinculadas.length) return maisRelevante(vinculadas);

  const chave = ultimos8(phone);
  if (!chave) return null;

  // Regex ANCORADO no fim do número, e não solto no meio da string: sem a
  // âncora, o Mongo varria a coleção inteira comparando substring. `chave` são
  // 8 dígitos, então escapar não é necessário — mas a âncora é.
  const candidatas = await col()
    .find(
      comRecorteDeInstancia(
        { archivedAt: null, isGroup: false, chatId: { $regex: `${chave}(:[0-9]+)?@` } },
        instanceIds,
      ),
      { projection: { _id: 0 } },
    )
    .limit(200)
    .toArray();
  const casadas = candidatas.filter(c => chaveDoChat(c.chatId) === chave || ultimos8(c.phone) === chave);
  return casadas.length ? maisRelevante(casadas) : null;
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

/**
 * Desfaz o vínculo conversa→card quando o card é excluído.
 *
 * Sem isto a conversa continuava apontando para um dealId morto: como a tela de
 * Conversas resolve o card por `linkedDeal?.id || crm.dealId`, ela caía no id
 * fantasma, escondia o botão de criar card e o atendimento ficava preso sem
 * jeito de voltar para o Kanban.
 *
 * Só o vínculo sai — etapa, tags e responsável seguem valendo para a conversa.
 * Devolve as conversas afetadas para o caller emitir os eventos.
 */
export async function clearCrmDealLink(dealId) {
  if (!dealId) return [];
  const afetadas = await col().find({ "crm.dealId": String(dealId) }, { projection: { _id: 0, id: 1 } }).toArray();
  if (!afetadas.length) return [];
  await col().updateMany({ "crm.dealId": String(dealId) }, { $unset: { "crm.dealId": "" } });
  return getConversationsByIds(afetadas.map(c => c.id));
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
