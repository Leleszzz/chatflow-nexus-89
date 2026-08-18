import { connectionManager } from "./ConnectionManager.js";
import { finalizeOutgoingMessage } from "./outgoing.js";
import { emitToInstance } from "../socket/events.js";
import { getUser } from "../storage/users-repo.js";
import {
  listRunningCampaigns,
  nextPendingTarget,
  markTargetSent,
  markTargetFailed,
  bumpCampaign,
  countPending,
  updateCampaignStatus,
} from "../storage/campaigns-repo.js";
// Mesmo motor de variáveis do front (quick replies) — importado, não copiado,
// para {{nome}}/{{saudacao}} renderizarem igual nos dois lados.
import { renderTemplate } from "../../../src/lib/message-template.js";

// O tick é curto, mas cada campanha só envia quando já passou o seu próprio
// `throttleMs` desde o último envio. Enviar rápido demais é o caminho mais
// curto para o número ser bloqueado pelo WhatsApp — por isso o ritmo é
// deliberadamente lento e uma mensagem por vez.
const TICK_MS = 5_000;
// Variação aleatória sobre o intervalo, para o padrão de envio não ficar
// mecanicamente regular.
const JITTER_RATIO = 0.25;

let timer = null;
let running = false;
const nextAllowedAt = new Map(); // campaignId -> timestamp

function scheduleNext(campaignId, throttleMs) {
  const jitter = throttleMs * JITTER_RATIO * Math.random();
  nextAllowedAt.set(campaignId, Date.now() + throttleMs + jitter);
}

async function sendOne(io, campaign) {
  const target = await nextPendingTarget(campaign.id);
  if (!target) {
    await updateCampaignStatus(campaign.id, "finalizada");
    nextAllowedAt.delete(campaign.id);
    emitToCampaign(io, campaign.id, { status: "finalizada" });
    return;
  }

  const client = connectionManager.get(target.instanceId);
  if (!client?.isSocketOpen?.()) {
    // Instância fora do ar: não queima o alvo, tenta de novo no próximo ciclo.
    scheduleNext(campaign.id, campaign.throttleMs);
    return;
  }

  const atendente = campaign.createdBy ? (await getUser(campaign.createdBy))?.name || "" : "";
  const body = renderTemplate(campaign.message, {
    nome: target.customer,
    nomeWhatsapp: target.whatsappName,
    telefone: target.phone,
    atendente,
  });

  try {
    const result = await client.sendMessage(target.chatId, { text: body });
    const { messageId } = await finalizeOutgoingMessage({
      io,
      client,
      instanceId: target.instanceId,
      chatId: target.chatId,
      result,
      logLabel: "campaign",
      message: { type: "chat", body },
    });
    // Se outro tick já tiver marcado este alvo, não conta duas vezes.
    if (await markTargetSent(target.id, { messageId })) {
      await bumpCampaign(campaign.id, { sent: 1, touchLastSent: true });
    }
  } catch (err) {
    console.error(`[campaign] falha ao enviar ${target.id}: ${err.message}`);
    if (await markTargetFailed(target.id, err.message)) {
      await bumpCampaign(campaign.id, { failed: 1, touchLastSent: true });
    }
  }

  scheduleNext(campaign.id, campaign.throttleMs);
  emitToCampaign(io, campaign.id, { targetId: target.id });

  if (await countPending(campaign.id) === 0) {
    await updateCampaignStatus(campaign.id, "finalizada");
    nextAllowedAt.delete(campaign.id);
    emitToCampaign(io, campaign.id, { status: "finalizada" });
  }
}

function emitToCampaign(io, campaignId, extra) {
  if (!io) return;
  io.emit("campaign:update", { campaignId, ...extra });
}

async function tick(io) {
  if (running) return;
  running = true;
  try {
    const campaigns = await listRunningCampaigns();
    const now = Date.now();
    for (const campaign of campaigns) {
      const allowedAt = nextAllowedAt.get(campaign.id) ?? 0;
      if (now < allowedAt) continue;
      await sendOne(io, campaign);
    }
  } catch (err) {
    console.error("[campaign] tick falhou:", err.message);
  } finally {
    running = false;
  }
}

export function startCampaignSender(io) {
  if (timer) return;
  timer = setInterval(() => { tick(io).catch(() => {}); }, TICK_MS);
  timer.unref?.();
}

export function stopCampaignSender() {
  if (timer) clearInterval(timer);
  timer = null;
  nextAllowedAt.clear();
}
