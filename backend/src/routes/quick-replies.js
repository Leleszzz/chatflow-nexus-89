import { Router } from "../lib/safe-router.js";
import { requireAuth } from "../middleware/require-auth.js";
import {
  listQuickReplies,
  createQuickReply,
  updateQuickReply,
  deleteQuickReply,
} from "../storage/quick-replies-repo.js";

export const quickRepliesRouter = Router();
quickRepliesRouter.use(requireAuth());

// Qualquer usuário autenticado LÊ (para usar no chat); só admin cria/edita/apaga.
quickRepliesRouter.get("/", async (_req, res) => {
  res.json(await listQuickReplies());
});

quickRepliesRouter.post("/", requireAuth({ admin: true }), async (req, res) => {
  const titulo = String(req.body?.titulo || "").trim();
  const corpo = String(req.body?.corpo || "").trim();
  if (!titulo) return res.status(400).json({ error: "titulo é obrigatório" });
  if (!corpo) return res.status(400).json({ error: "corpo é obrigatório" });
  const reply = await createQuickReply({ titulo, corpo, criadoPor: req.user?.id || "" });
  res.status(201).json(reply);
});

quickRepliesRouter.patch("/:id", requireAuth({ admin: true }), async (req, res) => {
  const patch = {};
  if (typeof req.body?.titulo === "string") {
    const t = req.body.titulo.trim();
    if (!t) return res.status(400).json({ error: "titulo não pode ser vazio" });
    patch.titulo = t;
  }
  if (typeof req.body?.corpo === "string") {
    const c = req.body.corpo.trim();
    if (!c) return res.status(400).json({ error: "corpo não pode ser vazio" });
    patch.corpo = c;
  }
  if (Number.isFinite(req.body?.ordem)) patch.ordem = Number(req.body.ordem);
  const updated = await updateQuickReply(req.params.id, patch);
  if (!updated) return res.status(404).json({ error: "mensagem não encontrada" });
  res.json(updated);
});

quickRepliesRouter.delete("/:id", requireAuth({ admin: true }), async (req, res) => {
  const ok = await deleteQuickReply(req.params.id);
  if (!ok) return res.status(404).json({ error: "mensagem não encontrada" });
  res.json({ ok: true });
});
