import { io, Socket } from "socket.io-client";

let socket: Socket | null = null;
let currentToken: string | null = null;

function readStoredToken(): string | null {
  try {
    const raw = window.localStorage.getItem("crm-auth-token");
    return raw ? (JSON.parse(raw) as string) : null;
  } catch {
    return null;
  }
}

// Atualiza o token de autenticação do socket e reconecta para aplicá-lo.
export function setSocketAuthToken(token: string | null) {
  currentToken = token;
  if (socket) {
    socket.auth = { token };
    if (socket.connected) socket.disconnect();
    if (token) socket.connect();
  }
}

export function getSocket(): Socket {
  if (!socket) {
    if (currentToken == null) currentToken = readStoredToken();
    socket = io({
      path: "/socket.io",
      transports: ["websocket", "polling"],
      auth: { token: currentToken },
    });
  }
  return socket;
}

export function joinInstance(instanceId: string) {
  getSocket().emit("join", instanceId);
}

export function leaveInstance(instanceId: string) {
  getSocket().emit("leave", instanceId);
}
