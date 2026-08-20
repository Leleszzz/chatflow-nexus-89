import { verifyAuthToken } from "../lib/auth-token.js";
import { readAuthCookie } from "../lib/auth-cookie.js";
import { getUser } from "../storage/users-repo.js";

// Middleware io.use: exige JWT válido no handshake e resolve as instâncias que o
// usuário pode receber. `socket.data.allowed` = null significa "todas".
export function socketAuth() {
  return async (socket, next) => {
    try {
      // O handshake carrega o cookie httpOnly automaticamente (withCredentials).
      const token = readAuthCookie(socket.handshake.headers?.cookie);
      const payload = verifyAuthToken(token);
      if (!payload) return next(new Error("unauthorized"));
      const user = await getUser(payload.sub);
      if (!user || !user.active) return next(new Error("unauthorized"));
      socket.data.user = { id: user.id, role: user.role };
      const isAdmin = user.role === "Administrador";
      const list = Array.isArray(user.allowedInstanceIds) ? user.allowedInstanceIds : [];
      // Admin (ou usuário sem restrição configurada) recebe todas; caso contrário,
      // somente as instâncias atribuídas.
      socket.data.allowed = (!isAdmin && list.length) ? new Set(list) : null;
      next();
    } catch (err) {
      next(new Error("unauthorized"));
    }
  };
}

export function canJoinInstance(socket, instanceId) {
  const allowed = socket.data?.allowed;
  return allowed === null || allowed === undefined || allowed.has(instanceId);
}
