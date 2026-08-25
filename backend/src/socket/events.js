import { listInstances } from "../storage/instances-repo.js";
import { listUsers } from "../storage/users-repo.js";
import { getDeal } from "../storage/deals-repo.js";
import { permittedUserIds } from "../lib/deal-permissions.js";
import { socketAuth, canJoinInstance, revalidarSocket } from "./auth.js";

export function emitToInstance(io, instanceId, event, payload) {
  if (!io) return;
  io.to(roomFor(instanceId)).emit(event, payload);
}

export function roomFor(instanceId) {
  return `instance:${instanceId}`;
}

export function userRoom(userId) {
  return `user:${userId}`;
}

// Emite um evento somente para as salas dos usuários informados.
export function emitToUsers(io, userIds, event, payload) {
  if (!io || !userIds?.length) return;
  for (const id of new Set(userIds)) io.to(userRoom(id)).emit(event, payload);
}

// Emite um evento de deal apenas para quem tem permissão de vê-lo. Para delete,
// passe `extraDeal` (estado anterior) para alcançar também quem perdeu acesso.
export async function emitDealEvent(io, event, deal, extraDeal = null) {
  if (!io || !deal) return;
  try {
    const users = await listUsers();
    const ids = new Set(permittedUserIds(deal, users));
    if (extraDeal) for (const id of permittedUserIds(extraDeal, users)) ids.add(id);
    emitToUsers(io, [...ids], event, { deal });
  } catch (err) {
    console.warn(`[socket] emitDealEvent falhou: ${err.message}`);
  }
}

// Consulta gravada segue a permissão do deal a que pertence: quem não pode ver
// o card não pode ver a transcrição da consulta dele.
export async function emitConsultationEvent(io, event, consultation) {
  if (!io || !consultation) return;
  try {
    const deal = await getDeal(consultation.dealId);
    if (!deal) return;
    const users = await listUsers();
    emitToUsers(io, permittedUserIds(deal, users), event, { consultation });
  } catch (err) {
    console.warn(`[socket] emitConsultationEvent falhou: ${err.message}`);
  }
}

// De quanto em quanto tempo um socket conectado tem cargo e instâncias
// reconferidos contra o banco.
const REVALIDAR_A_CADA_MS = Number(process.env.SOCKET_REVALIDAR_MS || 5 * 60 * 1000);

/**
 * Derruba os sockets de um usuário. Chamado quando o admin desativa a conta ou
 * mexe nas instâncias liberadas: sem isto a mudança só valeria no próximo
 * reload da página da pessoa.
 */
export async function revalidarSocketsDoUsuario(io, userId) {
  if (!io || !userId) return 0;
  let afetados = 0;
  for (const socket of await io.in(userRoom(userId)).fetchSockets()) {
    afetados += 1;
    try {
      // fetchSockets devolve um handle remoto; o revalidar precisa do socket
      // local, então nos casos simples (servidor único) ele está em io.sockets.
      const local = io.sockets.sockets.get(socket.id);
      if (!local) continue;
      const segue = await revalidarSocket(local);
      if (!segue) local.disconnect(true);
    } catch (err) {
      console.warn(`[socket] revalidar ${socket.id} falhou: ${err.message}`);
    }
  }
  return afetados;
}

export function bindSocketHandlers(io) {
  io.use(socketAuth());
  io.on("connection", async socket => {
    // Sala pessoal do usuário — usada para entregar eventos de deal só a quem tem permissão.
    const userId = socket.data?.user?.id;
    if (userId) socket.join(userRoom(userId));
    // Entra apenas nas salas das instâncias permitidas para este usuário.
    try {
      const all = await listInstances();
      for (const inst of all) {
        if (canJoinInstance(socket, inst.id)) socket.join(roomFor(inst.id));
      }
    } catch (err) {
      console.warn("[socket] auto-join failed:", err.message);
    }
    socket.on("join", instanceId => {
      if (typeof instanceId === "string" && instanceId && canJoinInstance(socket, instanceId)) {
        socket.join(roomFor(instanceId));
      }
    });
    socket.on("leave", instanceId => {
      if (typeof instanceId === "string" && instanceId) {
        socket.leave(roomFor(instanceId));
      }
    });

    // Reconferência periódica: cobre a revogação feita fora deste processo e o
    // caso de a chamada dirigida ter falhado.
    const relogio = setInterval(async () => {
      try {
        if (!(await revalidarSocket(socket))) socket.disconnect(true);
      } catch (err) {
        console.warn(`[socket] revalidação periódica falhou: ${err.message}`);
      }
    }, REVALIDAR_A_CADA_MS);
    relogio.unref?.();
    socket.on("disconnect", () => clearInterval(relogio));
  });
}
