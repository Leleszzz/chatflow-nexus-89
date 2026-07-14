// Contadores e estado por instância (em memória). Snapshot exposto via /status.
const byInstance = new Map();

function entry(instanceId) {
  let e = byInstance.get(instanceId);
  if (!e) {
    e = {
      state: "idle",
      messagesIn: 0,
      messagesOut: 0,
      mediaFailed: 0,
      reconnectAttempts: 0,
      lastDisconnectCode: null,
      lastDisconnectReason: null,
      mediaQueueDepth: 0,
      lastOpenAt: null,
    };
    byInstance.set(instanceId, e);
  }
  return e;
}

export const metrics = {
  inc(instanceId, key, n = 1) {
    const e = entry(instanceId);
    e[key] = (e[key] || 0) + n;
  },
  set(instanceId, key, value) {
    entry(instanceId)[key] = value;
  },
  get(instanceId) {
    return { ...entry(instanceId) };
  },
  remove(instanceId) {
    byInstance.delete(instanceId);
  },
  snapshot() {
    const out = {};
    for (const [id, e] of byInstance) out[id] = { ...e };
    return out;
  },
};
