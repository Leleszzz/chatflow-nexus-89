import { verifyAuthToken } from "../lib/auth-token.js";
import { readAuthCookie } from "../lib/auth-cookie.js";
import { getUser } from "../storage/users-repo.js";
import { listInstances } from "../storage/instances-repo.js";
import { resolveAllowedInstanceIds } from "../lib/instance-permissions.js";

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
      // Só admin recebe `null` (= todas). Antes, um não-admin com
      // allowedInstanceIds vazio também caía em `null` e recebia o tráfego de
      // todas as instâncias — inclusive a do doutor.
      const ids = resolveAllowedInstanceIds(user, await listInstances());
      socket.data.allowed = ids === null ? null : new Set(ids);
      next();
    } catch (err) {
      next(new Error("unauthorized"));
    }
  };
}

export function canJoinInstance(socket, instanceId) {
  const allowed = socket.data?.allowed;
  // `undefined` não é mais tratado como "todas": socketAuth sempre define o
  // campo, então undefined só aconteceria em estado inesperado — nega.
  return allowed === null || (allowed instanceof Set && allowed.has(instanceId));
}
