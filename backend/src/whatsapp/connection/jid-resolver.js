import fs from "node:fs/promises";
import path from "node:path";

// Aprende e resolve mapeamentos LID (@lid) <-> PN (@s.whatsapp.net) de um número.
// Persistido em disco para sobreviver a reconexões/reinícios. SEM efeitos
// colaterais (não copia/apaga conversas) — a canonicalização é aplicada em tempo
// de escrita pelo pipeline.
export class JidResolver {
  constructor({ instanceId, authDir, onLearn } = {}) {
    this.instanceId = instanceId;
    this.file = path.join(authDir, "lid-map.json");
    this.lidToPn = new Map();
    this.pnToLid = new Map();
    this._dirty = false;
    this._saveTimer = null;
    // Disparado quando um par LID<->PN INÉDITO é aprendido (não no load).
    this.onLearn = typeof onLearn === "function" ? onLearn : null;
  }

  async load() {
    try {
      const raw = await fs.readFile(this.file, "utf8");
      const data = JSON.parse(raw);
      for (const [lid, pn] of Object.entries(data.lidToPn || {})) {
        this.lidToPn.set(lid, pn);
        this.pnToLid.set(pn, lid);
      }
    } catch (err) {
      if (err.code !== "ENOENT") console.warn(`[jid-resolver:${this.instanceId}] load falhou: ${err.message}`);
    }
  }

  // Aprende a partir de dois JIDs (em qualquer ordem). Retorna true se aprendeu algo novo.
  remember(a, b) {
    if (!a || !b || a === b) return false;
    const aLid = a.endsWith("@lid"), aPn = a.endsWith("@s.whatsapp.net");
    const bLid = b.endsWith("@lid"), bPn = b.endsWith("@s.whatsapp.net");
    let lid = null, pn = null;
    if (aLid && bPn) { lid = a; pn = b; }
    else if (aPn && bLid) { lid = b; pn = a; }
    if (!lid || !pn) return false;
    if (this.lidToPn.get(lid) === pn) return false;
    this.lidToPn.set(lid, pn);
    this.pnToLid.set(pn, lid);
    this._scheduleSave();
    if (this.onLearn) { try { this.onLearn(lid, pn); } catch { /* ignora */ } }
    return true;
  }

  canonical(jid) {
    if (typeof jid !== "string") return jid;
    if (jid.endsWith("@lid")) return this.lidToPn.get(jid) || jid;
    return jid;
  }

  pnFor(lid) { return this.lidToPn.get(lid) || null; }
  lidFor(pn) { return this.pnToLid.get(pn) || null; }
  allMappings() { return [...this.lidToPn.entries()]; }

  _scheduleSave() {
    this._dirty = true;
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => { this._saveTimer = null; this.flush().catch(() => {}); }, 1000);
    this._saveTimer.unref?.();
  }

  async flush() {
    if (!this._dirty) return;
    this._dirty = false;
    const data = { lidToPn: Object.fromEntries(this.lidToPn) };
    try {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      await fs.writeFile(this.file, JSON.stringify(data), "utf8");
    } catch (err) {
      console.warn(`[jid-resolver:${this.instanceId}] save falhou: ${err.message}`);
    }
  }

  dispose() {
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
    this.lidToPn.clear();
    this.pnToLid.clear();
  }
}
