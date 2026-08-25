import { Router } from "../lib/safe-router.js";
import { listDealOutcomes, createDealOutcome } from "../storage/deal-outcomes-repo.js";
import { listAllDeals, getDeal } from "../storage/deals-repo.js";
import { listUsers } from "../storage/users-repo.js";
import { canUserSeeDeal, permittedUserIds } from "../lib/deal-permissions.js";
import { requireAuth } from "../middleware/require-auth.js";
import { emitToUsers } from "../socket/events.js";

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
    // O card precisa ser visível para quem registra o fechamento: sem isso,
    // qualquer usuário lançava venda em card alheio.
    if (req.body?.dealId) {
      const deal = await getDeal(String(req.body.dealId));
      if (!deal) return res.status(404).json({ error: "cliente não encontrado" });
      if (!canUserSeeDeal(req.user, deal)) {
        return res.status(403).json({ error: "sem permissão para este cliente" });
      }
    }
    const created = await createDealOutcome({ ...(req.body || {}), operatorId: req.user.id });

    // `io.emit` global transmitia o VALOR DE CADA VENDA para todos os sockets
    // conectados, desfazendo o filtro de permissão que o GET acima aplica.
    const io = req.app.get("io");
    if (io) {
      const usuarios = await listUsers();
      const deal = created.dealId ? await getDeal(created.dealId) : null;
      const alcance = new Set(deal ? permittedUserIds(deal, usuarios) : []);
      alcance.add(req.user.id);
      emitToUsers(io, [...alcance], "deal-outcome:new", { outcome: created });
    }
    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
