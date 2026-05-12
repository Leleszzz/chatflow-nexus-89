import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { createClient } from "./client-factory.js";
import { listInstances, patchInstance, removeInstance } from "../storage/instances-repo.js";
import { removeConversationsByInstance } from "../storage/conversations-repo.js";
import { removeMessagesByInstance } from "../storage/messages-repo.js";

const clients = new Map();
const reconnectTimers = new Map();
let ioRef = null;

export function setIO(io) {
  ioRef = io;
}

export function getClient(instanceId) {
  return clients.get(instanceId) || null;
}

function scheduleReconnect(instanceId, delayMs = 2000) {
  if (reconnectTimers.has(instanceId)) return;
  const t = setTimeout(() => {
    reconnectTimers.delete(instanceId);
    startInstance(instanceId).catch(err => console.error(`[instance-manager] reconnect failed for ${instanceId}:`, err));
  }, delayMs);
  reconnectTimers.set(instanceId, t);
}

export async function startInstance(instanceId) {
  if (clients.has(instanceId)) {
    console.log(`[instance-manager] ${instanceId} already started`);
    return clients.get(instanceId);
  }
  if (!ioRef) throw new Error("Socket.IO not bound; call setIO first");

  console.log(`[instance-manager] starting ${instanceId}`);
  await patchInstance(instanceId, { status: "conectando" });

  const client = await createClient({
    instanceId,
    io: ioRef,
    onConnectionClose: ({ loggedOut }) => {
      clients.delete(instanceId);
      if (!loggedOut) {
        scheduleReconnect(instanceId, 2500);
      }
    },
  });
  clients.set(instanceId, client);
  return client;
}

export async function stopInstance(instanceId, { destroySession = false } = {}) {
  const timer = reconnectTimers.get(instanceId);
  if (timer) {
    clearTimeout(timer);
    reconnectTimers.delete(instanceId);
  }
  const client = clients.get(instanceId);
  if (client) {
    try {
      if (destroySession) await client.logout();
      else await client.destroy();
    } catch (err) {
      console.warn(`[instance-manager] close failed for ${instanceId}:`, err.message);
    }
    clients.delete(instanceId);
  }
  if (destroySession) {
    const sessionDir = path.join(config.paths.baileysAuthDir, instanceId);
    await fs.rm(sessionDir, { recursive: true, force: true });
  }
}

export async function deleteInstance(instanceId) {
  await stopInstance(instanceId, { destroySession: true });
  await removeMessagesByInstance(instanceId);
  await removeConversationsByInstance(instanceId);
  await removeInstance(instanceId);
}

export async function restoreAllInstances() {
  const all = await listInstances();
  for (const inst of all) {
    if (inst.status === "desligada") continue;
    try {
      await startInstance(inst.id);
    } catch (err) {
      console.error(`[instance-manager] failed to restore ${inst.id}:`, err);
    }
  }
}

export async function shutdownAll() {
  for (const t of reconnectTimers.values()) clearTimeout(t);
  reconnectTimers.clear();
  const ids = Array.from(clients.keys());
  await Promise.all(ids.map(id => stopInstance(id)));
}
