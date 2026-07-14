import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { WhatsAppConnection } from "./connection/WhatsAppConnection.js";
import { decideReconnect } from "./connection/reconnect-policy.js";
import { listInstances, patchInstance, removeInstance } from "../storage/instances-repo.js";
import { removeConversationsByInstance } from "../storage/conversations-repo.js";
import { removeMessagesByInstance } from "../storage/messages-repo.js";
import { metrics } from "../observability/instance-metrics.js";

// Orquestra todas as conexões: registro, política de reconexão por motivo
// (backoff/jitter/teto), boot escalonado, catch-up gated e shutdown limpo.
export class ConnectionManager {
  constructor() {
    this.io = null;
    this.connections = new Map();      // instanceId -> WhatsAppConnection
    this.reconnect = new Map();        // instanceId -> { attempt, timer }
  }

  setIO(io) { this.io = io; }

  get(instanceId) { return this.connections.get(instanceId) || null; }

  async start(instanceId) {
    if (!this.io) throw new Error("Socket.IO não inicializado; chame setIO primeiro");
    const existing = this.connections.get(instanceId);
    if (existing) return existing;

    await patchInstance(instanceId, { status: "conectando" });
    const conn = new WhatsAppConnection({ instanceId, io: this.io });
    this.connections.set(instanceId, conn);

    conn.on("open", ({ isFreshPair }) => {
      const st = this.reconnect.get(instanceId);
      if (st?.timer) clearTimeout(st.timer);
      this.reconnect.set(instanceId, { attempt: 0, timer: null });
      // Catch-up só em reconexão (não no pareamento novo) — uma vez por conexão.
      if (!isFreshPair) {
        const t = setTimeout(() => { this.syncRecent(instanceId).catch(() => {}); }, 4000);
        t.unref?.();
      }
    });

    conn.on("close", async ({ statusCode }) => {
      this.connections.delete(instanceId);
      // Desmonta a conexão antiga ANTES de reagendar: off dos listeners, flush
      // do resolver (lid-map.json) e limpeza de timers. Aguardar aqui garante
      // que o flush aconteça antes do resolver.load() da nova conexão, mesmo
      // no restart imediato (515).
      try { await conn.stop(); } catch (err) { console.warn(`[manager] teardown ${instanceId}:`, err.message); }
      this._scheduleByPolicy(instanceId, statusCode);
    });

    conn.on("loggedOut", async () => {
      this.connections.delete(instanceId);
      const st = this.reconnect.get(instanceId);
      if (st?.timer) clearTimeout(st.timer);
      this.reconnect.delete(instanceId);
      try { await conn.stop(); } catch (err) { console.warn(`[manager] teardown ${instanceId}:`, err.message); }
      // O telefone invalidou as credenciais (401): apaga o auth envenenado para
      // que o próximo start gere QR novo em vez de reentrar em loop de 401.
      // Preserva o lid-map.json — perdê-lo ressuscitaria duplicatas @lid/@PN.
      await this._wipeAuthKeepLidMap(instanceId);
      // status já é "desconectada"; exige novo QR — não reconecta sozinho.
      console.warn(`[manager] ${instanceId} deslogado — sessão limpa, aguardando novo QR`);
    });

    try {
      await conn.start();
    } catch (err) {
      console.error(`[manager] start ${instanceId} falhou:`, err.message);
      await conn.stop().catch(() => {});
      this.connections.delete(instanceId);
      this._scheduleByPolicy(instanceId, 0);
    }
    return conn;
  }

  // Remove credenciais/chaves Signal do diretório de auth, preservando o
  // lid-map.json (mapa @lid↔PN persistente que sobrevive ao re-pareamento).
  async _wipeAuthKeepLidMap(instanceId) {
    const dir = path.join(config.paths.baileysAuthDir, instanceId);
    try {
      const entries = await fs.readdir(dir);
      await Promise.all(entries
        .filter(f => f !== "lid-map.json")
        .map(f => fs.rm(path.join(dir, f), { recursive: true, force: true })));
    } catch (err) {
      if (err.code !== "ENOENT") console.warn(`[manager] wipe auth ${instanceId}:`, err.message);
    }
  }

  _scheduleByPolicy(instanceId, statusCode) {
    const st = this.reconnect.get(instanceId) || { attempt: 0, timer: null };
    const decision = decideReconnect(statusCode, st.attempt, {});
    metrics.set(instanceId, "lastDisconnectReason", decision.reason);

    if (decision.action === "stop") {
      if (st.timer) clearTimeout(st.timer);
      this.reconnect.delete(instanceId);
      patchInstance(instanceId, { status: "desconectada" }).catch(() => {});
      console.warn(`[manager] ${instanceId} não reconecta (${decision.reason})`);
      return;
    }

    st.attempt += 1;
    metrics.inc(instanceId, "reconnectAttempts");
    if (st.timer) clearTimeout(st.timer);
    const delay = decision.delayMs || 0;
    st.timer = setTimeout(() => {
      st.timer = null;
      this.start(instanceId).catch(err => console.error(`[manager] reconnect ${instanceId} falhou:`, err.message));
    }, delay);
    st.timer.unref?.();
    this.reconnect.set(instanceId, st);
    console.log(`[manager] ${instanceId} reconectando em ${Math.round(delay / 1000)}s (tentativa ${st.attempt}, ${decision.reason})`);
  }

  async stop(instanceId, { destroySession = false } = {}) {
    const st = this.reconnect.get(instanceId);
    if (st?.timer) clearTimeout(st.timer);
    this.reconnect.delete(instanceId);

    const conn = this.connections.get(instanceId);
    if (conn) {
      try { await conn.stop({ logout: destroySession }); }
      catch (err) { console.warn(`[manager] stop ${instanceId}:`, err.message); }
      this.connections.delete(instanceId);
    }
    if (destroySession) {
      await fs.rm(path.join(config.paths.baileysAuthDir, instanceId), { recursive: true, force: true });
    }
  }

  async restart(instanceId) {
    await this.stop(instanceId);
    await patchInstance(instanceId, { status: "conectando" });
    return this.start(instanceId);
  }

  async delete(instanceId) {
    await this.stop(instanceId, { destroySession: true });
    await removeMessagesByInstance(instanceId);
    await removeConversationsByInstance(instanceId);
    await removeInstance(instanceId);
    metrics.remove(instanceId);
  }

  // Boot escalonado: no máx. `concurrency` partidas em paralelo, com intervalo.
  async restoreAll({ concurrency = 3, staggerMs = 750 } = {}) {
    const all = await listInstances();
    const pending = all.filter(i => i.status !== "desligada");
    let idx = 0;
    const workers = Array.from({ length: Math.min(concurrency, pending.length) }, async () => {
      while (idx < pending.length) {
        const inst = pending[idx++];
        try { await this.start(inst.id); } catch (err) { console.error(`[manager] restore ${inst.id}:`, err.message); }
        await new Promise(r => setTimeout(r, staggerMs));
      }
    });
    await Promise.all(workers);
  }

  syncRecent(instanceId, opts) {
    const conn = this.connections.get(instanceId);
    if (!conn?.syncRecent) return Promise.resolve(null);
    return conn.syncRecent(opts);
  }

  statusSnapshot() {
    const out = {};
    for (const [id, conn] of this.connections) {
      out[id] = { state: conn.state, ...metrics.get(id) };
    }
    return out;
  }

  async shutdownAll() {
    for (const st of this.reconnect.values()) if (st.timer) clearTimeout(st.timer);
    this.reconnect.clear();
    const ids = Array.from(this.connections.keys());
    await Promise.all(ids.map(id => this.stop(id)));
  }
}

export const connectionManager = new ConnectionManager();
