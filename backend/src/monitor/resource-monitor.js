import os from "node:os";
import fs from "node:fs/promises";
import { config } from "../config.js";

let lastProcCpu = process.cpuUsage();
let lastProcTime = process.hrtime.bigint();
let lastSysCpu = sampleSystemCpu();

const frontendByClient = new Map();
const FRONTEND_TTL_MS = 20000;

function fmtBytes(bytes) {
  if (bytes == null || Number.isNaN(bytes)) return "-";
  if (bytes < 0) bytes = 0;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let n = Number(bytes);
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 100 ? 0 : 1)} ${units[i]}`;
}

function sampleSystemCpu() {
  const cpus = os.cpus();
  let user = 0,
    nice = 0,
    sys = 0,
    idle = 0,
    irq = 0;
  for (const c of cpus) {
    user += c.times.user;
    nice += c.times.nice;
    sys += c.times.sys;
    idle += c.times.idle;
    irq += c.times.irq;
  }
  return { user, nice, sys, idle, irq, total: user + nice + sys + idle + irq };
}

function getSystemCpuPercent() {
  const curr = sampleSystemCpu();
  const totalDiff = curr.total - lastSysCpu.total;
  const idleDiff = curr.idle - lastSysCpu.idle;
  lastSysCpu = curr;
  if (totalDiff <= 0) return 0;
  return Math.max(0, Math.min(100, ((totalDiff - idleDiff) / totalDiff) * 100));
}

function getBackendCpuPercent() {
  const cu = process.cpuUsage(lastProcCpu);
  const now = process.hrtime.bigint();
  const elapsedUs = Number(now - lastProcTime) / 1000;
  lastProcCpu = process.cpuUsage();
  lastProcTime = now;
  if (elapsedUs <= 0) return 0;
  const cpuUs = cu.user + cu.system;
  const cores = os.cpus().length || 1;
  return Math.max(0, Math.min(100, (cpuUs / elapsedUs) * (100 / cores)));
}

async function getDiskUsage(target) {
  try {
    if (typeof fs.statfs !== "function") return null;
    const s = await fs.statfs(target);
    const total = Number(s.blocks) * Number(s.bsize);
    const free = Number(s.bfree) * Number(s.bsize);
    return { total, free, used: total - free };
  } catch {
    return null;
  }
}

export function recordFrontendStats(stats, clientId) {
  const id = clientId || "default";
  frontendByClient.set(id, { ...stats, at: Date.now() });
}

function activeFrontends() {
  const now = Date.now();
  const out = [];
  for (const [id, s] of frontendByClient) {
    if (now - s.at > FRONTEND_TTL_MS) {
      frontendByClient.delete(id);
      continue;
    }
    out.push({ id, stats: s });
  }
  return out;
}

export function startResourceMonitor({ intervalMs = 5000 } = {}) {
  // primeira amostra (descartada) para iniciar baselines
  getBackendCpuPercent();
  getSystemCpuPercent();

  setInterval(async () => {
    try {
      const backendCpu = getBackendCpuPercent();
      const sysCpu = getSystemCpuPercent();
      const mem = process.memoryUsage();
      const sysTotal = os.totalmem();
      const sysFree = os.freemem();
      const disk = await getDiskUsage(config.paths.dataDir);
      const fronts = activeFrontends();
      const ts = new Date().toLocaleTimeString();

      const lines = [];
      lines.push(`\n[monitor] ${ts}  ─────────────── consumo de recursos ───────────────`);
      lines.push(
        `  Sistema   CPU ${sysCpu.toFixed(1).padStart(5)}%   RAM ${fmtBytes(sysTotal - sysFree)} / ${fmtBytes(sysTotal)}`
      );
      if (disk) {
        const pct = ((disk.used / disk.total) * 100).toFixed(1);
        lines.push(
          `  Disco     Uso ${pct.padStart(5)}%   ${fmtBytes(disk.used)} / ${fmtBytes(disk.total)}   livre ${fmtBytes(disk.free)}`
        );
      }
      lines.push(
        `  Backend   CPU ${backendCpu.toFixed(1).padStart(5)}%   RAM ${fmtBytes(mem.rss)}   heap ${fmtBytes(mem.heapUsed)} / ${fmtBytes(mem.heapTotal)}`
      );

      if (fronts.length === 0) {
        lines.push(`  Frontend  (sem clientes reportando — abra o app no navegador)`);
      } else {
        for (const { id, stats } of fronts) {
          const age = ((Date.now() - stats.at) / 1000).toFixed(0);
          const cpu = stats.cpu != null ? `${stats.cpu.toFixed(1).padStart(5)}%` : "  -  ";
          const heap = stats.jsHeapUsed != null ? fmtBytes(stats.jsHeapUsed) : "-";
          const heapTotal = stats.jsHeapTotal != null ? fmtBytes(stats.jsHeapTotal) : "-";
          const stU = stats.storageUsage != null ? fmtBytes(stats.storageUsage) : "-";
          const stQ = stats.storageQuota != null ? fmtBytes(stats.storageQuota) : "-";
          const tag = id === "default" ? "" : ` [${id.slice(0, 6)}]`;
          lines.push(
            `  Frontend${tag}  CPU ${cpu}   RAM heap ${heap} / ${heapTotal}   storage ${stU} / ${stQ}   (há ${age}s)`
          );
        }
      }
      console.log(lines.join("\n"));
    } catch (err) {
      console.warn("[monitor] erro:", err.message);
    }
  }, intervalMs).unref();
}
