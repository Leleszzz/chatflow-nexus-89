import { Router } from "express";
import { listDealOutcomes, createDealOutcome } from "../storage/deal-outcomes-repo.js";
import { listAllDeals } from "../storage/deals-repo.js";
import { canUserSeeDeal } from "../lib/deal-permissions.js";
import { requireAuth } from "../middleware/require-auth.js";

export const dealOutcomesRouter = Router();

dealOutcomesRouter.get("/", requireAuth(), async (req, res) => {
  try {
    const [all, deals] = await Promise.all([listDealOutcomes(), listAllDeals()]);
    const visible = new Set(deals.filter(d => canUserSeeDeal(req.user, d)).map(d => d.id));
    // Também mostra o que o próprio usuário fechou, mesmo que o card já tenha
    // mudado de responsável depois — senão o relatório dele perderia as vendas.
    res.json(all.filter(o => visible.has(o.dealId) || o.operatorId === req.user.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

dealOutcomesRouter.post("/", requireAuth(), async (req, res) => {
  try {
    const created = await createDealOutcome({ ...(req.body || {}), operatorId: req.user.id });
    const io = req.app.get("io");
    if (io) io.emit("deal-outcome:new", { outcome: created });
    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
