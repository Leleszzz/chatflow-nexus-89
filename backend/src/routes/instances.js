import { Router } from "../lib/safe-router.js";
import { nanoid } from "nanoid";
import { listInstances, getInstance, upsertInstance, patchInstance } from "../storage/instances-repo.js";
import { connectionManager } from "../whatsapp/ConnectionManager.js";
import { removeMessagesByInstance } from "../storage/messages-repo.js";
import { removeConversationsByInstance, countConversations } from "../storage/conversations-repo.js";
import { requireAuth } from "../middleware/require-auth.js";
import { requireInstanceAccess } from "../middleware/instance-access.js";
import { canUserSeeInstance } from "../lib/instance-permissions.js";
import { getSanitizedUser } from "../storage/users-repo.js";
import { registrarAsync, ACOES } from "../lib/auditoria.js";

export const instancesRouter = Router();

// Todas as rotas de instância exigem usuário autenticado.
instancesRouter.use(requireAuth());

// Estado de conexão + métricas em tempo real da instância.
instancesRouter.get("/:id/status", requireInstanceAccess(), async (req, res) => {
  const inst = req.instance;
  const snap = connectionManager.statusSnapshot()[req.params.id] || { state: "offline" };
  res.json({ instanceId: req.params.id, dbStatus: inst.status, ...snap });
});

instancesRouter.get("/", async (req, res) => {
  const all = await listInstances();
  const visiveis = all.filter(inst => canUserSeeInstance(req.user, inst));
  // Conta as conversas reais por instância (sempre preciso, sem contador frágil).
  const enriched = await Promise.all(
    visiveis.map(async inst => ({ ...inst, conversations: await countConversations(inst.id) })),
  );
  res.json(enriched);
});

// `ownerId` só pode apontar para um usuário ativo — senão a instância vira órfã
// e some para todo mundo que não é admin.
async function validarDono(ownerId) {
  if (ownerId === null || ownerId === "") return { ok: true, value: null };
  const dono = await getSanitizedUser(String(ownerId));
  if (!dono || !dono.active) return { ok: false, error: "responsável inválido ou inativo" };
  return { ok: true, value: dono.id };
}

// Modos de importação de histórico na primeira conexão:
//   none   → só mensagens novas a partir do pareamento
//   recent → histórico recente que o telefone envia no pareamento (padrão)
//   full   → histórico completo (sync mais demorado)
const HISTORY_SYNC_MODES = new Set(["none", "recent", "full"]);

instancesRouter.post("/", requireAuth({ admin: true }), async (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "name é obrigatório" });
  const historySync = String(req.body?.historySync || "recent").trim();
  if (!HISTORY_SYNC_MODES.has(historySync)) {
    return res.status(400).json({ error: `historySync inválido: use ${[...HISTORY_SYNC_MODES].join(", ")}` });
  }

  const dono = await validarDono(req.body?.ownerId ?? null);
  if (!dono.ok) return res.status(400).json({ error: dono.error });

  const id = `wa-${nanoid(8)}`;
  const instance = {
    id,
    name,
    ownerId: dono.value,
    phone: "",
    status: "conectando",
    lastSync: "",
    conversations: 0,
    historySynced: false,
    historySync,
    createdAt: new Date().toISOString(),
  };
  await upsertInstance(instance);
  await connectionManager.start(id);
  res.status(201).json(instance);
});

instancesRouter.get("/:id", requireInstanceAccess(), async (req, res) => {
  res.json(req.instance);
});

instancesRouter.patch("/:id", requireAuth({ admin: true }), async (req, res) => {
  const inst = await getInstance(req.params.id);
  if (!inst) return res.status(404).json({ error: "instância não encontrada" });
  const patch = {};
  if (typeof req.body?.name === "string") {
    const trimmed = req.body.name.trim();
    if (!trimmed) return res.status(400).json({ error: "name não pode ser vazio" });
    patch.name = trimmed;
  }
  if (req.body?.ownerId !== undefined) {
    const dono = await validarDono(req.body.ownerId);
    if (!dono.ok) return res.status(400).json({ error: dono.error });
    patch.ownerId = dono.value;
  }
  if (Object.keys(patch).length === 0) return res.json(inst);
  await patchInstance(req.params.id, patch);
  const updated = await getInstance(req.params.id);
  const io = req.app.get("io");
  if (io) io.to(`instance:${updated.id}`).emit("instance:status", { instanceId: updated.id, status: updated.status, phone: updated.phone, name: updated.name });
  res.json(updated);
});

// `manage: true`, e não só leitura: quem consegue o QR consegue PAREAR O
// PRÓPRIO CELULAR nesta conta de WhatsApp. Um usuário que recebeu acesso de
// leitura à instância de outra pessoa (users.allowedInstanceIds) podia assumir
// a conta dela por inteiro. O POST /pairing-code logo abaixo já exigia isto —
// os dois GET tinham ficado para trás.
instancesRouter.get("/:id/qr", requireInstanceAccess({ manage: true }), async (req, res) => {
  const client = connectionManager.get(req.params.id);
  const qr = client?.getQrDataUrl?.() || null;
  if (!qr) return res.status(404).json({ error: "QR indisponível" });
  // Quem pega o QR pode parear um aparelho nesta conta: fica registrado.
  registrarAsync(req, ACOES.PAREAR_INSTANCIA, { instanceId: req.params.id, via: "qr" });
  res.json({ qr });
});

instancesRouter.post("/:id/pairing-code", requireInstanceAccess({ manage: true }), async (req, res) => {
  const phone = String(req.body?.phone || "").replace(/\D/g, "");
  if (!phone) return res.status(400).json({ error: "phone é obrigatório (DDI + DDD + número, somente dígitos)" });
  const client = connectionManager.get(req.params.id);
  if (!client) return res.status(409).json({ error: "instância não está em execução — reinicie a instância" });
  if (typeof client.requestPairingCode !== "function") {
    return res.status(500).json({ error: "pareamento por código indisponível" });
  }
  try {
    const code = await client.requestPairingCode(phone);
    res.json({ code });
  } catch (err) {
    console.error(`[instances:pairing-code] ${req.params.id} failed:`, err.message);
    res.status(400).json({ error: err.message });
  }
});

instancesRouter.get("/:id/pairing-code", requireInstanceAccess({ manage: true }), async (req, res) => {
  const client = connectionManager.get(req.params.id);
  const code = client?.getPairingCode?.() || null;
  if (!code) return res.status(404).json({ error: "código indisponível" });
  res.json({ code });
});

instancesRouter.post("/:id/restart", requireInstanceAccess({ manage: true }), async (req, res) => {
  await connectionManager.restart(req.params.id);
  // O catch-up de verificação/backfill roda automaticamente ~4s após o open
  // (ConnectionManager, handler conn.on("open")), emitindo "instance:sync-recent-done".
  res.json({ ok: true, willSync: true });
});

instancesRouter.post("/:id/resync-history", requireAuth({ admin: true }), async (req, res) => {
  const id = req.params.id;
  const inst = await getInstance(id);
  if (!inst) return res.status(404).json({ error: "instância não encontrada" });
  const t0 = Date.now();
  try {
    console.log(`\n[resync-history] ===== START ${id} (${inst.name || "sem nome"}) =====`);
    console.log(`[resync-history] ${id} step 1/6: stopping client and wiping Baileys auth (force re-pair via QR)`);
    await connectionManager.stop(id, { destroySession: true });

    console.log(`[resync-history] ${id} step 2/6: removing stored messages`);
    await removeMessagesByInstance(id);

    console.log(`[resync-history] ${id} step 3/6: removing stored conversations`);
    await removeConversationsByInstance(id);

    console.log(`[resync-history] ${id} step 4/6: resetting instance metadata (fullHistoryRequested=true so filter accepts old messages)`);
    await patchInstance(id, {
      historySynced: false,
      conversations: 0,
      lastSync: "",
      firstConnectedAt: "",
      phone: "",
      status: "qr-pendente",
      fullHistoryRequested: true,
    });

    console.log(`[resync-history] ${id} step 5/6: emitting wipe + status events to clients`);
    const io = req.app.get("io");
    if (io) io.to(`instance:${id}`).emit("instance:status", { instanceId: id, status: "qr-pendente" });
    if (io) io.to(`instance:${id}`).emit("conversation:wipe", { instanceId: id });

    console.log(`[resync-history] ${id} step 6/6: starting fresh client (will emit QR)`);
    await connectionManager.start(id);

    console.log(`[resync-history] ===== READY ${id} in ${Date.now() - t0}ms — scan the QR to begin full history sync =====\n`);
    res.json({ ok: true, requiresQr: true });
  } catch (err) {
    console.error(`[resync-history] ${id} FAILED after ${Date.now() - t0}ms:`, err);
    res.status(500).json({ error: err.message });
  }
});

instancesRouter.post("/:id/shutdown", requireAuth({ admin: true }), async (req, res) => {
  const inst = await getInstance(req.params.id);
  if (!inst) return res.status(404).json({ error: "instância não encontrada" });
  await connectionManager.stop(req.params.id);
  await patchInstance(req.params.id, { status: "desligada" });
  res.json({ ok: true });
});

instancesRouter.delete("/:id", requireAuth({ admin: true }), async (req, res) => {
  const inst = await getInstance(req.params.id);
  if (!inst) return res.status(404).json({ error: "instância não encontrada" });
  await connectionManager.delete(req.params.id);
  res.json({ ok: true });
});
