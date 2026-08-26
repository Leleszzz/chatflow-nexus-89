import { Router } from "../lib/safe-router.js";
import { listConversations, listCrmOverlays, getConversation, findConversationByDealId, upsertConversation, archiveConversation, restoreConversation, patchConversationCrm } from "../storage/conversations-repo.js";
import { listMessages } from "../storage/messages-repo.js";
import { clampLimiteConversas } from "../storage/conversations-repo.js";
import { buildConversationId, formatPhone, isPlaceholderName } from "../whatsapp/message-mapper.js";
import { connectionManager } from "../whatsapp/ConnectionManager.js";
import { requireAuth } from "../middleware/require-auth.js";
import { getDeal } from "../storage/deals-repo.js";
import { canUserSeeDeal } from "../lib/deal-permissions.js";
import { allowedInstanceIdsForRequest, userCanUseInstance } from "../middleware/instance-access.js";
import { canUserSeeInstance } from "../lib/instance-permissions.js";
import { getInstance } from "../storage/instances-repo.js";

export const conversationsRouter = Router();

// Todas as rotas de conversas exigem usuário autenticado.
conversationsRouter.use(requireAuth());

/**
 * Carrega a conversa de `:id` em `req.conversation` e barra quem não tem acesso
 * à instância dela. 404 em vez de 403: quem não pode ver a instância não deve
 * nem descobrir que a conversa existe.
 */
function requireConversationAccess() {
  return async (req, res, next) => {
    const conv = await getConversation(req.params.id);
    if (!conv) return res.status(404).json({ error: "conversa não encontrada" });
    const inst = await getInstance(conv.instanceId);
    if (!inst || !canUserSeeInstance(req.user, inst)) {
      return res.status(404).json({ error: "conversa não encontrada" });
    }
    req.conversation = conv;
    next();
  };
}

function chatIdFromPhone(phone) {
  const raw = String(phone || "").trim();
  if (raw.endsWith("@s.whatsapp.net")) return raw;
  const digits = raw.replace(/\D/g, "");
  if (!/^\d{8,15}$/.test(digits)) return "";
  return `${digits}@s.whatsapp.net`;
}

conversationsRouter.get("/", async (req, res) => {
  const { instanceId, limit, offset, archived, q } = req.query;
  // Sem recorte por instância isto devolvia as conversas de TODAS as instâncias
  // para qualquer usuário logado.
  const permitidas = await allowedInstanceIdsForRequest(req);
  if (instanceId) {
    const pedida = String(instanceId);
    if (permitidas && !permitidas.includes(pedida)) return res.json([]);
  }
  const items = await listConversations({
    instanceId: instanceId ? String(instanceId) : undefined,
    instanceIds: instanceId ? undefined : permitidas ?? undefined,
    // clamp em vez de Number() cru: "?limit=abc" virava NaN, chegava no Mongo e
    // a exceção derrubava o processo inteiro.
    limit: clampLimiteConversas(limit),
    offset: offset ? Number(offset) : 0,
    archived: archived === "true" || archived === "1",
    // Termo de busca vai para o banco: filtrar no cliente só acharia o que
    // coube na página carregada.
    busca: typeof q === "string" ? q.slice(0, 100) : undefined,
  });
  res.json(items);
});

// Overlay de CRM de todas as conversas visíveis, sem o resto do documento.
// Precisa vir antes de GET /:id para não ser capturada por ele.
conversationsRouter.get("/crm-overlays", async (req, res) => {
  const permitidas = await allowedInstanceIdsForRequest(req);
  const linhas = await listCrmOverlays(permitidas ?? undefined);
  res.json(linhas);
});

// A conversa de um card do CRM. Duas rotas de dois segmentos não colidem com o
// GET /:id logo abaixo, mas esta precisa vir antes por clareza de leitura.
conversationsRouter.get("/by-deal/:dealId", async (req, res) => {
  const deal = await getDeal(req.params.dealId);
  if (!deal) return res.status(404).json({ error: "cliente não encontrado" });
  if (!canUserSeeDeal(req.user, deal)) return res.status(403).json({ error: "sem permissão para este cliente" });

  // `?instanceId=` fixa o número: é assim que a fila da secretaria garante que a
  // cobrança sai pelo WhatsApp da clínica, e não pelo pessoal do doutor. Sem o
  // parâmetro, vale o recorte de instâncias que o usuário pode usar — antes esta
  // rota não olhava instância nenhuma e podia entregar ao doutor a conversa da
  // secretária, num número em que ele nem consegue enviar.
  const permitidas = await allowedInstanceIdsForRequest(req);
  const pedida = req.query.instanceId ? String(req.query.instanceId) : "";
  if (pedida && !(await userCanUseInstance(req.user, pedida))) {
    return res.status(403).json({ error: "sem acesso a esta instância" });
  }
  const instanceIds = pedida ? [pedida] : (permitidas ?? undefined);

  const conv = await findConversationByDealId(deal.id, { phone: deal.phone, instanceIds });
  if (!conv) return res.status(404).json({ error: "este cliente ainda não tem conversa no WhatsApp" });
  res.json(conv);
});

conversationsRouter.get("/:id", requireConversationAccess(), async (req, res) => {
  res.json(req.conversation);
});

conversationsRouter.patch("/:id", requireConversationAccess(), async (req, res) => {
  const conv = req.conversation;
  const patch = {};
  if (typeof req.body?.customer === "string") {
    const trimmed = req.body.customer.trim();
    patch.customer = trimmed || conv.whatsappName || conv.customer;
  }
  if (Object.keys(patch).length === 0) return res.json(conv);
  const updated = await upsertConversation({ ...conv, ...patch });
  const io = req.app.get("io");
  if (io) io.to(`instance:${conv.instanceId}`).emit("conversation:update", { conversation: updated });
  res.json(updated);
});

conversationsRouter.post("/start", async (req, res) => {
  const instanceId = String(req.body?.instanceId || "").trim();
  let chatId = chatIdFromPhone(req.body?.phone || req.body?.chatId);
  const name = String(req.body?.customer || req.body?.name || "").trim();
  if (!instanceId) return res.status(400).json({ error: "instanceId é obrigatório" });
  if (!chatId) return res.status(400).json({ error: "telefone inválido" });
  if (!(await userCanUseInstance(req.user, instanceId))) {
    return res.status(403).json({ error: "sem acesso a esta instância" });
  }

  // Resolve o JID autoritativo via WhatsApp: corrige normalizações do servidor
  // (ex.: 9º dígito no Brasil) e aprende o LID do contato, para que a resposta
  // que chega via @lid caia NESTA conversa em vez de abrir uma duplicata.
  let resolvedName = "";
  const client = connectionManager.get(instanceId);
  if (client?.onWhatsApp) {
    try {
      const results = await client.onWhatsApp(chatId.split("@")[0]);
      const hit = Array.isArray(results) ? (results.find(r => r?.exists) || results[0]) : null;
      if (typeof hit?.jid === "string" && hit.jid.endsWith("@s.whatsapp.net")) chatId = hit.jid;
      const lid = typeof hit?.lid === "string" ? hit.lid : "";
      if (lid && lid.endsWith("@lid")) {
        client.rememberJidMapping?.(lid, chatId);
        await client.mergeKnownDuplicate?.(chatId); // funde duplicata @lid já existente
      }
    } catch { /* segue com o número digitado */ }
    try { resolvedName = client.knownNameFor?.(chatId) || ""; } catch { /* ignora */ }
  }

  const id = buildConversationId(instanceId, chatId);
  const prior = await getConversation(id);
  const phone = formatPhone(chatId.split("@")[0]);
  const now = new Date().toISOString();
  const conversation = await upsertConversation({
    id,
    instanceId,
    chatId,
    customer: (isPlaceholderName(prior?.customer) ? "" : prior.customer) || name || resolvedName || phone,
    whatsappName: (isPlaceholderName(prior?.whatsappName) ? "" : prior.whatsappName) || resolvedName || name || "",
    phone: prior?.phone || phone,
    isGroup: false,
    lastMessage: prior?.lastMessage || "",
    lastInteraction: prior?.lastInteraction || now,
    unread: prior?.unread || false,
    unreadCount: prior?.unreadCount || 0,
    ...(prior?.avatarUrl ? { avatarUrl: prior.avatarUrl } : {}),
    lastMessageId: prior?.lastMessageId,
    lastMessageFromMe: prior?.lastMessageFromMe,
    lastMessageAck: prior?.lastMessageAck,
  });

  // Sem isto a conversa só ganharia foto quando chegasse a primeira mensagem.
  if (!conversation.avatarUrl) client?.enqueueAvatar?.(chatId, id);

  const io = req.app.get("io");
  if (io) io.to(`instance:${instanceId}`).emit("conversation:update", { conversation });
  res.status(prior ? 200 : 201).json(conversation);
});

// Overlay de CRM da conversa: dono, etapa, tags, IA ligada, proposta de horário.
// Antes vivia no localStorage de cada navegador, o que fazia o time ver donos e
// etapas diferentes — e a IA responder ou não conforme a máquina aberta.
conversationsRouter.patch("/:id/crm", requireConversationAccess(), async (req, res) => {
  const updated = await patchConversationCrm(req.params.id, req.body || {});
  if (!updated) return res.status(404).json({ error: "conversa não encontrada" });
  const io = req.app.get("io");
  if (io) io.to(`instance:${updated.instanceId}`).emit("conversation:update", { conversation: updated });
  res.json(updated);
});

conversationsRouter.post("/:id/read", requireConversationAccess(), async (req, res) => {
  const conv = req.conversation;
  const unreadBefore = Number(conv.unreadCount) || 0;
  const next = await upsertConversation({ ...conv, unread: false, unreadCount: 0 });

  // Best-effort: envia os recibos de leitura (tick azul) ao WhatsApp para as
  // mensagens recebidas não lidas. Nunca falha a rota — instância offline ou
  // erro de envio apenas deixam de marcar como lida no telefone do contato.
  if (unreadBefore > 0) {
    try {
      const client = connectionManager.get(conv.instanceId);
      if (client?.isSocketOpen?.() && typeof client.readMessages === "function") {
        const cap = Math.min(unreadBefore, 100);
        // Busca mais que o cap porque mensagens enviadas (fromMe) se intercalam.
        const msgs = await listMessages(conv.instanceId, conv.chatId, { limit: cap + 30 });
        const keys = msgs
          .filter(m => !m.fromMe)
          .slice(-cap)
          .map(m => ({ remoteJid: conv.chatId, id: m.id, fromMe: false }));
        if (keys.length) await client.readMessages(keys);
      }
    } catch (err) {
      console.warn(`[conversations:read] recibo de leitura falhou: ${err.message}`);
    }
  }

  res.json(next);
});

// Arquivar/restaurar são exclusivos do admin. É soft delete: nada é apagado do
// banco, a conversa só deixa de aparecer na listagem padrão. O front já trata o
// evento `conversation:delete` removendo a conversa da lista.
conversationsRouter.delete("/:id", requireAuth({ admin: true }), async (req, res) => {
  const conv = await getConversation(req.params.id);
  if (!conv) return res.status(404).json({ error: "conversa não encontrada" });
  if (conv.archivedAt) return res.json({ conversation: conv, alreadyArchived: true });

  const archived = await archiveConversation(req.params.id, req.user?.id);
  const io = req.app.get("io");
  if (io) io.to(`instance:${conv.instanceId}`).emit("conversation:delete", { conversationId: req.params.id });
  res.json({ conversation: archived });
});

conversationsRouter.post("/:id/restore", requireAuth({ admin: true }), async (req, res) => {
  const conv = await getConversation(req.params.id);
  if (!conv) return res.status(404).json({ error: "conversa não encontrada" });

  const restored = await restoreConversation(req.params.id);
  const io = req.app.get("io");
  if (io) io.to(`instance:${conv.instanceId}`).emit("conversation:update", { conversation: restored });
  res.json({ conversation: restored });
});

conversationsRouter.get("/:id/messages", requireConversationAccess(), async (req, res) => {
  const conv = req.conversation;
  // Sem conversão crua: listMessages já normaliza limit e before.
  const messages = await listMessages(conv.instanceId, conv.chatId, {
    before: req.query.before,
    limit: req.query.limit,
  });
  res.json(messages);
});
