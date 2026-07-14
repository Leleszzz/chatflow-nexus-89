import { listInstances } from "../storage/instances-repo.js";
import { listUsers } from "../storage/users-repo.js";
import { permittedUserIds } from "../lib/deal-permissions.js";
import { socketAuth, canJoinInstance } from "./auth.js";

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
  });
}
