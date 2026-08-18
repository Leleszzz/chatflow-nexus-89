import { connectionManager } from "./ConnectionManager.js";
import { finalizeOutgoingMessage } from "./outgoing.js";
import { emitToInstance } from "../socket/events.js";
import { listDueScheduled, updateScheduled } from "../storage/scheduled-messages-repo.js";

const TICK_MS = 15_000;
let timer = null;
let running = false;

async function processDue(io) {
  if (running) return;
  running = true;
  try {
    const due = await listDueScheduled();
    for (const sched of due) {
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
