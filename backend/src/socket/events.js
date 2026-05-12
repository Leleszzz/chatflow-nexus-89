import { listInstances } from "../storage/instances-repo.js";

export function emitToInstance(io, instanceId, event, payload) {
  if (!io) return;
  io.to(roomFor(instanceId)).emit(event, payload);
}

export function roomFor(instanceId) {
  return `instance:${instanceId}`;
}

export function bindSocketHandlers(io) {
  io.on("connection", async socket => {
    try {
      const all = await listInstances();
      for (const inst of all) socket.join(roomFor(inst.id));
    } catch (err) {
      console.warn("[socket] auto-join failed:", err.message);
    }
    socket.on("join", instanceId => {
      if (typeof instanceId === "string" && instanceId) {
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
