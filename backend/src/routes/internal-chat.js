import { Router } from "express";
import {
  listThreadsForUser,
  countUnreadForUser,
  getThread,
  getOrCreateDm,
  createGroup,
  updateGroup,
  leaveGroup,
  listMessages,
  appendMessage,
  markThreadRead,
  isMember,
} from "../storage/internal-chat-repo.js";
import { getUser } from "../storage/users-repo.js";
import { requireAuth } from "../middleware/require-auth.js";
import { emitToUsers } from "../socket/events.js";

export const internalChatRouter = Router();

// Chat interno é de qualquer usuário logado — não tem gate de admin.
internalChatRouter.use(requireAuth());

// Carrega a thread e recusa quem não é participante. Toda rota com :id passa
// por aqui, então não há como ler nem escrever numa conversa alheia.
async function loadThreadAsMember(req, res) {
  const thread = await getThread(req.params.id);
  if (!thread) {
    res.status(404).json({ error: "conversa não encontrada" });
    return null;
  }
  if (!isMember(thread, req.user.id)) {
    res.status(403).json({ error: "você não participa desta conversa" });
    return null;
  }
  return thread;
}

internalChatRouter.get("/threads", async (req, res) => {
  res.json(await listThreadsForUser(req.user.id));
});

internalChatRouter.get("/unread-count", async (req, res) => {
  res.json({ count: await countUnreadForUser(req.user.id) });
});

internalChatRouter.post("/threads/dm", async (req, res) => {
  const otherId = String(req.body?.userId || "").trim();
  if (!otherId) return res.status(400).json({ error: "userId é obrigatório" });
  if (otherId === req.user.id) return res.status(400).json({ error: "não dá para abrir uma conversa consigo mesmo" });

  const other = await getUser(otherId);
  if (!other || !other.active) return res.status(404).json({ error: "usuário não encontrado" });

  try {
    const thread = await getOrCreateDm(req.user.id, otherId);
    // Os dois lados recebem a thread na hora — quem foi chamado vê a conversa
    // aparecer sem precisar recarregar.
    emitToUsers(req.app.get("io"), thread.memberIds, "internal:thread", { thread });
    res.status(201).json(thread);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

internalChatRouter.post("/threads/group", async (req, res) => {
  try {
    const thread = await createGroup({
      name: req.body?.name,
      memberIds: Array.isArray(req.body?.memberIds) ? req.body.memberIds.map(String) : [],
      createdBy: req.user.id,
    });
    emitToUsers(req.app.get("io"), thread.memberIds, "internal:thread", { thread });
    res.status(201).json(thread);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

internalChatRouter.patch("/threads/:id", async (req, res) => {
  const thread = await loadThreadAsMember(req, res);
  if (!thread) return;
  if (thread.type !== "group") return res.status(400).json({ error: "só grupos podem ser editados" });

  try {
    const updated = await updateGroup(thread.id, { name: req.body?.name, memberIds: req.body?.memberIds });
    // Avisa a união dos membros antigos e novos: quem saiu precisa saber que
    // perdeu acesso, quem entrou precisa ver a conversa surgir.
    const reach = [...new Set([...thread.memberIds, ...(updated?.memberIds || [])])];
    emitToUsers(req.app.get("io"), reach, "internal:thread", { thread: updated });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

internalChatRouter.post("/threads/:id/leave", async (req, res) => {
  const thread = await loadThreadAsMember(req, res);
  if (!thread) return;
  if (thread.type !== "group") return res.status(400).json({ error: "só dá para sair de grupos" });

  const result = await leaveGroup(thread.id, req.user.id);
  emitToUsers(req.app.get("io"), thread.memberIds, "internal:thread", {
    thread: result.removed ? null : result.thread,
    threadId: thread.id,
    removed: result.removed,
    leftBy: req.user.id,
  });
  res.json({ ok: true, removed: result.removed });
});

internalChatRouter.get("/threads/:id/messages", async (req, res) => {
  const thread = await loadThreadAsMember(req, res);
  if (!thread) return;
  res.json(await listMessages(thread.id, {
    before: req.query.before ? String(req.query.before) : undefined,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
  }));
});

internalChatRouter.post("/threads/:id/messages", async (req, res) => {
  const thread = await loadThreadAsMember(req, res);
  if (!thread) return;

  try {
    const message = await appendMessage({ threadId: thread.id, senderId: req.user.id, body: req.body?.body });
    const updated = await getThread(thread.id);
    emitToUsers(req.app.get("io"), thread.memberIds, "internal:message", { message, thread: updated });
    res.status(201).json(message);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

internalChatRouter.post("/threads/:id/read", async (req, res) => {
  const thread = await loadThreadAsMember(req, res);
  if (!thread) return;
  const marked = await markThreadRead(thread.id, req.user.id);
  // Só o próprio leitor precisa saber — zera o badge nas outras abas dele.
  emitToUsers(req.app.get("io"), [req.user.id], "internal:read", { threadId: thread.id });
  res.json({ ok: true, marked });
});
