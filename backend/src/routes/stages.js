import { Router } from "express";
import {
  listStages,
  createStage,
  updateStage,
  reorderStages,
  removeStage,
} from "../storage/stages-repo.js";
import { emitDealEvent } from "../socket/events.js";
import { requireAuth } from "../middleware/require-auth.js";

export const stagesRouter = Router();

function broadcastStages(req, stages) {
  const io = req.app.get("io");
  if (io) io.emit("stages:update", { stages });
}

stagesRouter.get("/", requireAuth(), async (_req, res) => {
  try {
    res.json(await listStages());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

stagesRouter.post("/", requireAuth({ admin: true }), async (req, res) => {
  try {
    const created = await createStage({ title: req.body?.title, color: req.body?.color });
    broadcastStages(req, await listStages());
    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

stagesRouter.patch("/:id", requireAuth({ admin: true }), async (req, res) => {
  try {
    const updated = await updateStage(req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ error: "etapa não encontrada" });
    broadcastStages(req, await listStages());
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

stagesRouter.post("/reorder", requireAuth({ admin: true }), async (req, res) => {
  try {
    const stages = await reorderStages(req.body?.orderedIds || []);
    broadcastStages(req, stages);
    res.json(stages);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

stagesRouter.delete("/:id", requireAuth({ admin: true }), async (req, res) => {
  try {
    const { stages, reassigned } = await removeStage(req.params.id);
    broadcastStages(req, stages);
    // Notifica os clientes sobre os deals que mudaram de etapa.
    const io = req.app.get("io");
    for (const deal of reassigned) emitDealEvent(io, "deal:update", deal);
    res.json({ ok: true, stages });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
