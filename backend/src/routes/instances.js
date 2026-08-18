import { Router } from "express";
import { nanoid } from "nanoid";
import { listInstances, getInstance, upsertInstance, patchInstance } from "../storage/instances-repo.js";
import { connectionManager } from "../whatsapp/ConnectionManager.js";
import { removeMessagesByInstance } from "../storage/messages-repo.js";
import { removeConversationsByInstance, countConversations } from "../storage/conversations-repo.js";
import { requireAuth } from "../middleware/require-auth.js";

export const instancesRouter = Router();

// Todas as rotas de instância exigem usuário autenticado.
instancesRouter.use(requireAuth());

// Estado de conexão + métricas em tempo real da instância.
instancesRouter.get("/:id/status", async (req, res) => {
  const inst = await getInstance(req.params.id);
  if (!inst) return res.status(404).json({ error: "instância não encontrada" });
  const snap = connectionManager.statusSnapshot()[req.params.id] || { state: "offline" };
  res.json({ instanceId: req.params.id, dbStatus: inst.status, ...snap });
});

instancesRouter.get("/", async (_req, res) => {
  const all = await listInstances();
  // Conta as conversas reais por instância (sempre preciso, sem contador frágil).
  const enriched = await Promise.all(
    all.map(async inst => ({ ...inst, conversations: await countConversations(inst.id) })),
  );
  res.json(enriched);
});

// Modos de importação de histórico na primeira conexão:
//   none   → só mensagens novas a partir do pareamento
//   recent → histórico recente que o telefone envia no pareamento (padrão)
//   full   → histórico completo (sync mais demorado)
const HISTORY_SYNC_MODES = new Set(["none", "recent", "full"]);

instancesRouter.post("/", async (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "name é obrigatório" });
  const historySync = String(req.body?.historySync || "recent").trim();
  if (!HISTORY_SYNC_MODES.has(historySync)) {
    return res.status(400).json({ error: `historySync inválido: use ${[...HISTORY_SYNC_MODES].join(", ")}` });
  }

  const id = `wa-${nanoid(8)}`;
  const instance = {
    id,
    name,
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

instancesRouter.get("/:id", async (req, res) => {
  const inst = await getInstance(req.params.id);
  if (!inst) return res.status(404).json({ error: "instância não encontrada" });
  res.json(inst);
});

instancesRouter.patch("/:id", async (req, res) => {
  const inst = await getInstance(req.params.id);
  if (!inst) return res.status(404).json({ error: "instância não encontrada" });
  const patch = {};
  if (typeof req.body?.name === "string") {
    const trimmed = req.body.name.trim();
    if (!trimmed) return res.status(400).json({ error: "name não pode ser vazio" });
    patch.name = trimmed;
  }
  if (Object.keys(patch).length === 0) return res.json(inst);
  await patchInstance(req.params.id, patch);
  const updated = await getInstance(req.params.id);
  const io = req.app.get("io");
  if (io) io.to(`instance:${updated.id}`).emit("instance:status", { instanceId: updated.id, status: updated.status, phone: updated.phone, name: updated.name });
  res.json(updated);
});

instancesRouter.get("/:id/qr", async (req, res) => {
  const client = connectionManager.get(req.params.id);
  const qr = client?.getQrDataUrl?.() || null;
  if (!qr) return res.status(404).json({ error: "QR indisponível" });
  res.json({ qr });
});

instancesRouter.post("/:id/pairing-code", async (req, res) => {
  const inst = await getInstance(req.params.id);
  if (!inst) return res.status(404).json({ error: "instância não encontrada" });
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

instancesRouter.get("/:id/pairing-code", async (req, res) => {
  const client = connectionManager.get(req.params.id);
  const code = client?.getPairingCode?.() || null;
  if (!code) return res.status(404).json({ error: "código indisponível" });
  res.json({ code });
});

instancesRouter.post("/:id/restart", async (req, res) => {
  const inst = await getInstance(req.params.id);
  if (!inst) return res.status(404).json({ error: "instância não encontrada" });
  await connectionManager.restart(req.params.id);
  // O catch-up de verificação/backfill roda automaticamente ~4s após o open
  // (ConnectionManager, handler conn.on("open")), emitindo "instance:sync-recent-done".
  res.json({ ok: true, willSync: true });
});

instancesRouter.post("/:id/resync-history", async (req, res) => {
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

instancesRouter.post("/:id/shutdown", async (req, res) => {
  const inst = await getInstance(req.params.id);
  if (!inst) return res.status(404).json({ error: "instância não encontrada" });
  await connectionManager.stop(req.params.id);
  await patchInstance(req.params.id, { status: "desligada" });
  res.json({ ok: true });
});

instancesRouter.delete("/:id", async (req, res) => {
  const inst = await getInstance(req.params.id);
  if (!inst) return res.status(404).json({ error: "instância não encontrada" });
  await connectionManager.delete(req.params.id);
  res.json({ ok: true });
});
