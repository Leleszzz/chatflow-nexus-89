// Shim de compatibilidade: mantém a API antiga usada por server.js, rotas,
// send.js e scheduled-sender, delegando ao ConnectionManager.
import { connectionManager } from "./ConnectionManager.js";

export function setIO(io) {
  connectionManager.setIO(io);
}

export function getClient(instanceId) {
  return connectionManager.get(instanceId);
}

export function startInstance(instanceId) {
  return connectionManager.start(instanceId);
}

export function stopInstance(instanceId, opts) {
  return connectionManager.stop(instanceId, opts);
}

export function deleteInstance(instanceId) {
  return connectionManager.delete(instanceId);
}

export function restoreAllInstances() {
  return connectionManager.restoreAll();
}

export function shutdownAll() {
  return connectionManager.shutdownAll();
}

export { connectionManager };
