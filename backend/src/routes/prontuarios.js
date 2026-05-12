import { Router } from "express";
import multer from "multer";
import fs from "node:fs/promises";
import { saveMedia } from "../storage/media-repo.js";
import {
  listProntuarios,
  getProntuario,
  createProntuario,
  updateProntuario,
  deleteProntuario,
  deleteProntuariosByDeal,
} from "../storage/prontuarios-repo.js";

const upload = multer({ dest: "data/uploads", limits: { fileSize: 50 * 1024 * 1024 } });

const VALID_CATEGORIES = new Set(["foto", "video", "audio", "documento", "outro"]);

function inferCategoryFromMime(mimeType) {
  const clean = String(mimeType || "").toLowerCase();
  if (clean.startsWith("image/")) return "foto";
  if (clean.startsWith("video/")) return "video";
  if (clean.startsWith("audio/")) return "audio";
  if (clean) return "documento";
  return "outro";
}

export const prontuariosRouter = Router();

prontuariosRouter.get("/", async (req, res) => {
  try {
    const dealId = req.query.dealId ? String(req.query.dealId) : undefined;
    const items = await listProntuarios({ dealId });
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

prontuariosRouter.get("/:id", async (req, res) => {
  const item = await getProntuario(req.params.id);
  if (!item) return res.status(404).json({ error: "prontuário não encontrado" });
  res.json(item);
});

prontuariosRouter.post("/", async (req, res) => {
  try {
    const body = req.body || {};
    const dealId = String(body.dealId || "").trim();
    const mediaUrl = String(body.mediaUrl || "").trim();
    if (!dealId) return res.status(400).json({ error: "dealId é obrigatório" });
    if (!mediaUrl) return res.status(400).json({ error: "mediaUrl é obrigatório" });

    const category = VALID_CATEGORIES.has(body.category) ? body.category : inferCategoryFromMime(body.mediaMime);

    const record = await createProntuario({
      dealId,
      name: body.name || "Sem nome",
      mediaUrl,
      mediaMime: body.mediaMime,
      category,
      conversationId: body.conversationId,
      messageId: body.messageId,
      instanceId: body.instanceId,
      source: body.source === "upload" ? "upload" : "whatsapp",
      uploadedBy: body.uploadedBy,
    });
    res.status(201).json(record);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

prontuariosRouter.post("/upload", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "file é obrigatório" });
  try {
    const dealId = String(req.body?.dealId || "").trim();
    if (!dealId) return res.status(400).json({ error: "dealId é obrigatório" });

    const name = String(req.body?.name || req.file.originalname || "Sem nome").trim();
    const buffer = await fs.readFile(req.file.path);
    const mimeType = req.file.mimetype || "application/octet-stream";
    const saved = await saveMedia(buffer, mimeType);

    const category = inferCategoryFromMime(saved.mimeType);

    const record = await createProntuario({
      dealId,
      name,
      mediaUrl: saved.url,
      mediaMime: saved.mimeType,
      category,
      fileSize: req.file.size,
      source: "upload",
      uploadedBy: req.body?.uploadedBy,
    });
    res.status(201).json(record);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (req.file) fs.unlink(req.file.path).catch(() => {});
  }
});

prontuariosRouter.patch("/:id", async (req, res) => {
  try {
    const patch = {};
    if (typeof req.body?.name === "string") patch.name = req.body.name;
    if (VALID_CATEGORIES.has(req.body?.category)) patch.category = req.body.category;
    if (Object.keys(patch).length === 0) {
      const current = await getProntuario(req.params.id);
      if (!current) return res.status(404).json({ error: "prontuário não encontrado" });
      return res.json(current);
    }
    const updated = await updateProntuario(req.params.id, patch);
    if (!updated) return res.status(404).json({ error: "prontuário não encontrado" });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

prontuariosRouter.delete("/:id", async (req, res) => {
  try {
    const removed = await deleteProntuario(req.params.id);
    if (!removed) return res.status(404).json({ error: "prontuário não encontrado" });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

prontuariosRouter.delete("/by-deal/:dealId", async (req, res) => {
  try {
    const count = await deleteProntuariosByDeal(req.params.dealId);
    res.json({ ok: true, removed: count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
