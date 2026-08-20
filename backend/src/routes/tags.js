import { Router } from "express";
import { listTags, createTag, deleteTag } from "../storage/tags-repo.js";
import { requireAuth } from "../middleware/require-auth.js";

export const tagsRouter = Router();

function broadcastTags(req, tags) {
  const io = req.app.get("io");
  if (io) io.emit("tags:update", { tags });
}

tagsRouter.get("/", requireAuth(), async (_req, res) => {
  try {
    res.json(await listTags());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Qualquer atendente pode criar tag no meio do atendimento (é assim hoje, pelo
// chat e pelo card) — só a remoção é restrita, porque apaga do vocabulário do time.
tagsRouter.post("/", requireAuth(), async (req, res) => {
  try {
    const tags = await createTag(req.body?.name);
    broadcastTags(req, tags);
    res.status(201).json(tags);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

tagsRouter.delete("/:name", requireAuth({ admin: true }), async (req, res) => {
  try {
    const { removed, tags } = await deleteTag(decodeURIComponent(req.params.name));
    if (!removed) return res.status(404).json({ error: "tag não encontrada" });
    broadcastTags(req, tags);
    res.json({ ok: true, tags });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
