import { io, Socket } from "socket.io-client";

let socket: Socket | null = null;

// A autenticação do socket sai do cookie httpOnly, que o navegador anexa no
// handshake quando `withCredentials` está ligado. Não há token em JavaScript
// para passar em `auth`.
export function getSocket(): Socket {
  if (!socket) {
    socket = io({
      path: "/socket.io",
      transports: ["websocket", "polling"],
      withCredentials: true,
    });
  }
  return socket;
}

/**
 * Reconecta para o servidor reavaliar o cookie — chamado depois do login e do
 * logout, já que a credencial mudou mas o socket segue aberto com a antiga.
 */
export function reconnectSocket() {
  if (!socket) return;
  socket.disconnect();
  socket.connect();
}

export function joinInstance(instanceId: string) {
  getSocket().emit("join", instanceId);
}
