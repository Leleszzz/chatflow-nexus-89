import { connectionManager } from "./ConnectionManager.js";
import { finalizeOutgoingMessage } from "./outgoing.js";
import { emitToInstance } from "../socket/events.js";
import { listDueScheduled, updateScheduled } from "../storage/scheduled-messages-repo.js";

const TICK_MS = 15_000;

// Quantos envios um tick pode fazer, e o intervalo mínimo entre eles.
//
// Antes, `listDueScheduled()` sem limite alimentava um laço que disparava TUDO
// que estava vencido de uma vez. Se 500 mensagens vencessem no mesmo minuto —
// depois de o servidor ficar algumas horas fora do ar, por exemplo — o WhatsApp
// recebia 500 envios em rajada e BANIA O NÚMERO. O envio de campanha já tratava
// disso com cuidado (MIN_THROTTLE_MS + jitter); o agendador ignorava.
const MAX_POR_TICK = Number(process.env.SCHEDULED_MAX_POR_TICK || 5);
const INTERVALO_MIN_MS = Number(process.env.SCHEDULED_INTERVALO_MS || 3_000);
const JITTER_RATIO = 0.3;

let timer = null;
let running = false;

const esperar = ms => new Promise(r => setTimeout(r, ms));

async function processDue(io) {
  if (running) return;
  running = true;
  try {
    const due = (await listDueScheduled()).slice(0, MAX_POR_TICK);
    let primeiro = true;
    for (const sched of due) {
      // Espaça os envios, com variação, para o padrão não ficar mecânico.
      if (!primeiro) {
        await esperar(INTERVALO_MIN_MS + Math.random() * INTERVALO_MIN_MS * JITTER_RATIO);
      }
      primeiro = false;
      const client = connectionManager.get(sched.instanceId);
      if (!client) {
        // Instância desconectada: mantém pendente para tentar de novo no próximo tick.
        continue;
      }
      try {
        const result = await client.sendMessage(sched.chatId, { text: sched.body });
        const { messageId } = await finalizeOutgoingMessage({
          io,
          client,
          instanceId: sched.instanceId,
          chatId: sched.chatId,
          result,
          logLabel: "scheduled",
          message: { type: "chat", body: sched.body },
        });
        const updated = await updateScheduled(sched.id, {
          status: "sent",
          sentAt: new Date().toISOString(),
          sentMessageId: messageId,
        });
        if (updated) emitToInstance(io, sched.instanceId, "scheduled:update", { scheduled: updated });
      } catch (err) {
        console.error(`[scheduled] failed to send ${sched.id}:`, err.message);
        const updated = await updateScheduled(sched.id, { status: "failed", error: err.message });
        if (updated) emitToInstance(io, sched.instanceId, "scheduled:update", { scheduled: updated });
      }
    }
  } catch (err) {
    console.error("[scheduled] tick failed:", err.message);
  } finally {
    running = false;
  }
}

export function startScheduledSender(io) {
  if (timer) return;
  timer = setInterval(() => { processDue(io).catch(() => {}); }, TICK_MS);
  timer.unref?.();
  // Primeira verificação logo após o boot.
  processDue(io).catch(() => {});
}

export function stopScheduledSender() {
  if (timer) clearInterval(timer);
  timer = null;
}
