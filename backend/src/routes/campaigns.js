import { Router } from "../lib/safe-router.js";
import {
  buildAudience,
  resolveConversations,
  listCampaigns,
  getCampaign,
  listTargets,
  createCampaign,
  updateCampaignStatus,
  deleteCampaign,
  countPending,
  MIN_THROTTLE_MS,
  DEFAULT_THROTTLE_MS,
} from "../storage/campaigns-repo.js";
import { requireAuth } from "../middleware/require-auth.js";
import { registrarAsync, ACOES } from "../lib/auditoria.js";

export const campaignsRouter = Router();

// TODO o router é de admin — e não só as rotas de escrita.
//
// Antes, `GET /:id/targets` entregava nome + telefone de cada contato atingido,
// e `POST /preview` rodava sobre a coleção inteira de conversas sem nenhum
// recorte por instância: qualquer usuário autenticado extraía a base de
// telefones da clínica. A tela /campanhas já era exclusiva do admin no front
// (src/lib/roles.ts), mas isso é bloqueio de interface, não de permissão.
campaignsRouter.use(requireAuth({ admin: true }));

const requireAdmin = requireAuth({ admin: true });

function audienceFiltersFrom(body) {
  return {
    instanceIds: Array.isArray(body?.instanceIds) ? body.instanceIds.map(String) : [],
    inactiveDays: Number(body?.inactiveDays) || 0,
    onlyClientLast: Boolean(body?.onlyClientLast),
    onlyUnread: Boolean(body?.onlyUnread),
    limit: Number(body?.limit) || 1000,
  };
}

campaignsRouter.get("/", async (_req, res) => {
  res.json(await listCampaigns());
});

campaignsRouter.get("/limits", (_req, res) => {
  res.json({ minThrottleMs: MIN_THROTTLE_MS, defaultThrottleMs: DEFAULT_THROTTLE_MS });
});

/**
 * Simula o público sem criar nada. Devolve a contagem e uma amostra para a
 * interface mostrar quem seria atingido antes de confirmar.
 */
campaignsRouter.post("/preview", async (req, res) => {
  const manualIds = Array.isArray(req.body?.conversationIds) ? req.body.conversationIds.map(String) : [];
  const audience = manualIds.length
    ? await resolveConversations(manualIds)
    : await buildAudience(audienceFiltersFrom(req.body));

  // Montar publico e a operacao que devolve telefone de cliente em lote.
  registrarAsync(req, ACOES.EXPORTAR_PUBLICO, { total: audience.length, manual: manualIds.length });
  res.json({
    total: audience.length,
    // Amostra só para conferência visual — o público real é remontado no POST.
    sample: audience.slice(0, 20),
    ignored: manualIds.length ? manualIds.length - audience.length : 0,
  });
});

campaignsRouter.post("/", requireAdmin, async (req, res) => {
  try {
    const manualIds = Array.isArray(req.body?.conversationIds) ? req.body.conversationIds.map(String) : [];
    // O público SEMPRE sai da coleção de conversas. Não existe caminho aqui
    // para enviar a um número que nunca falou com a empresa.
    const audience = manualIds.length
      ? await resolveConversations(manualIds)
      : await buildAudience(audienceFiltersFrom(req.body));

    const campaign = await createCampaign({
      name: req.body?.name,
      message: req.body?.message,
      audience,
      throttleMs: req.body?.throttleMs,
      createdBy: req.user.id,
    });
    res.status(201).json(campaign);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

campaignsRouter.get("/:id", async (req, res) => {
  const campaign = await getCampaign(req.params.id);
  if (!campaign) return res.status(404).json({ error: "campanha não encontrada" });
  res.json(campaign);
});

campaignsRouter.get("/:id/targets", async (req, res) => {
  const campaign = await getCampaign(req.params.id);
  if (!campaign) return res.status(404).json({ error: "campanha não encontrada" });
  res.json(await listTargets(req.params.id));
});

campaignsRouter.post("/:id/start", requireAdmin, async (req, res) => {
  const campaign = await getCampaign(req.params.id);
  if (!campaign) return res.status(404).json({ error: "campanha não encontrada" });
  if (campaign.status === "finalizada" || campaign.status === "cancelada") {
    return res.status(400).json({ error: "campanha já encerrada" });
  }
  if (await countPending(req.params.id) === 0) {
    return res.status(400).json({ error: "não há contatos pendentes nesta campanha" });
  }
  registrarAsync(req, ACOES.DISPARAR_CAMPANHA, { campanhaId: req.params.id, nome: campaign.name });
  res.json(await updateCampaignStatus(req.params.id, "rodando"));
});

campaignsRouter.post("/:id/pause", requireAdmin, async (req, res) => {
  const campaign = await getCampaign(req.params.id);
  if (!campaign) return res.status(404).json({ error: "campanha não encontrada" });
  if (campaign.status !== "rodando") return res.status(400).json({ error: "campanha não está rodando" });
  res.json(await updateCampaignStatus(req.params.id, "pausada"));
});

campaignsRouter.post("/:id/cancel", requireAdmin, async (req, res) => {
  const campaign = await getCampaign(req.params.id);
  if (!campaign) return res.status(404).json({ error: "campanha não encontrada" });
  res.json(await updateCampaignStatus(req.params.id, "cancelada"));
});

campaignsRouter.delete("/:id", requireAdmin, async (req, res) => {
  const campaign = await getCampaign(req.params.id);
  if (!campaign) return res.status(404).json({ error: "campanha não encontrada" });
  if (campaign.status === "rodando") {
    return res.status(400).json({ error: "pause ou cancele a campanha antes de excluir" });
  }
  await deleteCampaign(req.params.id);
  res.status(204).end();
});
