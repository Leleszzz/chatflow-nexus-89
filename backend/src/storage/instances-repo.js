import { config } from "../config.js";
import { readJson, updateJson } from "./json-store.js";

const FILE = config.paths.instancesFile;

export async function listInstances() {
  return readJson(FILE, []);
}

export async function getInstance(id) {
  const all = await listInstances();
  return all.find(i => i.id === id) || null;
}

export async function upsertInstance(instance) {
  return updateJson(FILE, [], current => {
    const idx = current.findIndex(i => i.id === instance.id);
    if (idx === -1) return [...current, instance];
    const next = current.slice();
    next[idx] = { ...next[idx], ...instance };
    return next;
  });
}

export async function patchInstance(id, patch) {
  return updateJson(FILE, [], current => {
    const idx = current.findIndex(i => i.id === id);
    if (idx === -1) return current;
    const next = current.slice();
    next[idx] = { ...next[idx], ...patch };
    return next;
  });
}

export async function removeInstance(id) {
  return updateJson(FILE, [], current => current.filter(i => i.id !== id));
}
