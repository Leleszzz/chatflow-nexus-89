import { io, Socket } from "socket.io-client";

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io({ path: "/socket.io", transports: ["websocket", "polling"] });
  }
  return socket;
}

export function joinInstance(instanceId: string) {
  getSocket().emit("join", instanceId);
}

export function leaveInstance(instanceId: string) {
  getSocket().emit("leave", instanceId);
}
