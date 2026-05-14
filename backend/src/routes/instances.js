import { Router } from "express";
import { nanoid } from "nanoid";
import { listInstances, getInstance, upsertInstance, patchInstance } from "../storage/instances-repo.js";
import { startInstance, stopInstance, deleteInstance, getClient } from "../whatsapp/instance-manager.js";
import { removeMessagesByInstance } from "../storage/messages-repo.js";
import { removeConversationsByInstance } from "../storage/conversations-repo.js";

export const instancesRouter = Router();

instancesRouter.get("/", async (_req, res) => {
  const all = await listInstances();
  res.json(all);
});

instancesRouter.post("/", async (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "name é obrigatório" });

  const id = `wa-${nanoid(8)}`;
  const instance = {
    id,
    name,
    phone: "",
    status: "conectando",
    lastSync: "",
    conversations: 0,
    historySynced: false,
    createdAt: new Date().toISOString(),
  };
  await upsertInstance(instance);
  await startInstance(id);
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
  const client = getClient(req.params.id);
  const qr = client?.getQrDataUrl?.() || null;
  if (!qr) return res.status(404).json({ error: "QR indisponível" });
  res.json({ qr });
});

instancesRouter.post("/:id/pairing-code", async (req, res) => {
  const inst = await getInstance(req.params.id);
  if (!inst) return res.status(404).json({ error: "instância não encontrada" });
  const phone = String(req.body?.phone || "").replace(/\D/g, "");
  if (!phone) return res.status(400).json({ error: "phone é obrigatório (DDI + DDD + número, somente dígitos)" });
  const client = getClient(req.params.id);
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
  const client = getClient(req.params.id);
  const code = client?.getPairingCode?.() || null;
  if (!code) return res.status(404).json({ error: "código indisponível" });
  res.json({ code });
});

instancesRouter.post("/:id/restart", async (req, res) => {
  const inst = await getInstance(req.params.id);
  if (!inst) return res.status(404).json({ error: "instância não encontrada" });
  await stopInstance(req.params.id);
  await patchInstance(req.params.id, { status: "conectando" });
  await startInstance(req.params.id);
  res.json({ ok: true });
});

instancesRouter.post("/:id/resync-history", async (req, res) => {
  const id = req.params.id;
  const inst = await getInstance(id);
  if (!inst) return res.status(404).json({ error: "instância não encontrada" });
  const t0 = Date.now();
  try {
    console.log(`\n[resync-history] ===== START ${id} (${inst.name || "sem nome"}) =====`);
    console.log(`[resync-history] ${id} step 1/6: stopping client and wiping Baileys auth (force re-pair via QR)`);
    await stopInstance(id, { destroySession: true });

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
    await startInstance(id);

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
  await stopInstance(req.params.id);
  await patchInstance(req.params.id, { status: "desligada" });
  res.json({ ok: true });
});

instancesRouter.delete("/:id", async (req, res) => {
  const inst = await getInstance(req.params.id);
  if (!inst) return res.status(404).json({ error: "instância não encontrada" });
  await deleteInstance(req.params.id);
  res.json({ ok: true });
});
