// Coleta métricas do navegador e envia ao backend para serem exibidas no terminal.
// CPU é estimada via desvio do requestAnimationFrame (frame jank → uso aproximado).
// RAM usa performance.memory (Chromium). Storage usa navigator.storage.estimate().

const REPORT_INTERVAL_MS = 5000;
const CPU_SAMPLE_MS = 1000;

let started = false;
const clientId = (() => {
  try {
    const key = "resource_reporter_client_id";
    let id = localStorage.getItem(key);
    if (!id) {
      id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      localStorage.setItem(key, id);
    }
    return id;
  } catch {
    return `anon-${Math.random().toString(36).slice(2, 8)}`;
  }
})();

let lastRafTime = performance.now();
let frameDriftMs = 0;
let frameCount = 0;

function rafLoop() {
  const now = performance.now();
  const dt = now - lastRafTime;
  lastRafTime = now;
  // Frame ideal ≈ 16.67ms. Atrasos acima disso indicam ocupação da main thread.
  const ideal = 1000 / 60;
  if (dt > ideal) frameDriftMs += dt - ideal;
  frameCount++;
  requestAnimationFrame(rafLoop);
}

function estimateCpuPercent(windowMs: number): number {
  // Aproxima a ocupação da main thread no último ciclo: drift / janela.
  // Clampeado em 0..100. Não é CPU "real" do processo, mas reflete carga do front.
  const pct = (frameDriftMs / windowMs) * 100;
  frameDriftMs = 0;
  frameCount = 0;
  return Math.max(0, Math.min(100, pct));
}

async function collectAndSend() {
  const cpu = estimateCpuPercent(CPU_SAMPLE_MS);

  const perfMem = (performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
  const jsHeapUsed = perfMem?.usedJSHeapSize ?? null;
  const jsHeapTotal = perfMem?.totalJSHeapSize ?? null;
  const jsHeapLimit = perfMem?.jsHeapSizeLimit ?? null;

  let storageUsage: number | null = null;
  let storageQuota: number | null = null;
  try {
    if (navigator?.storage?.estimate) {
      const est = await navigator.storage.estimate();
      storageUsage = est.usage ?? null;
      storageQuota = est.quota ?? null;
    }
  } catch {
    /* ignore */
  }

  try {
    await fetch("/api/metrics/frontend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId,
        cpu,
        jsHeapUsed,
        jsHeapTotal,
        jsHeapLimit,
        storageUsage,
        storageQuota,
      }),
      keepalive: true,
    });
  } catch {
    /* offline / backend caiu — silencioso */
  }
}

export function startResourceReporter() {
  if (started) return;
  started = true;
  if (typeof window === "undefined") return;
  requestAnimationFrame(rafLoop);
  // primeira amostra rápida para já aparecer no terminal
  setTimeout(collectAndSend, 1500);
  setInterval(collectAndSend, REPORT_INTERVAL_MS);
}
