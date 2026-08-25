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
      socket.data.revalidadoEm = Date.now();
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

/**
 * Recalcula cargo e instâncias liberadas de um socket já conectado.
 *
 * A permissão era resolvida UMA VEZ, no handshake, e nunca mais. Um socket
 * aberto continuava recebendo mensagens de instâncias que o admin já tinha
 * revogado — e com o cargo antigo — até a pessoa recarregar a página. Numa
 * jornada de trabalho inteira sem reload, revogar acesso não tinha efeito
 * nenhum sobre o tráfego em tempo real.
 *
 * Devolve `false` quando o usuário sumiu ou foi desativado: aí o socket é
 * derrubado em vez de reconciliado.
 */
export async function revalidarSocket(socket) {
  const id = socket.data?.user?.id;
  if (!id) return false;

  const user = await getUser(id);
  if (!user || !user.active) return false;

  socket.data.user = { id: user.id, role: user.role };
  const ids = resolveAllowedInstanceIds(user, await listInstances());
  const permitidas = ids === null ? null : new Set(ids);
  socket.data.allowed = permitidas;
  socket.data.revalidadoEm = Date.now();

  // Sai das salas que deixaram de ser permitidas. Entrar de novo é papel do
  // cliente (evento "join") ou do próximo auto-join.
  for (const sala of socket.rooms) {
    if (!sala.startsWith("instance:")) continue;
    if (!canJoinInstance(socket, sala.slice("instance:".length))) socket.leave(sala);
  }
  return true;
}
