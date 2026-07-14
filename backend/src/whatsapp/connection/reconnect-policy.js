import { DisconnectReason } from "@whiskeysockets/baileys";

// Ações possíveis:
//  reconnect  -> reconectar com backoff exponencial + jitter
//  restart    -> reconectar imediatamente (restartRequired 515)
//  hold       -> cool-down longo, NÃO martelar (connectionReplaced 440)
//  stop       -> não reconectar; exige ação manual / novo QR

const STOP_CODES = new Set([
  DisconnectReason.loggedOut,         // 401
  DisconnectReason.forbidden,         // 403
  DisconnectReason.multideviceMismatch, // 411
  DisconnectReason.badSession,        // 500
]);

const HOLD_MS = 45_000; // connectionReplaced: aguarda bastante antes de tentar de novo

export function decideReconnect(statusCode, attempt, opts = {}) {
  const { baseMs = 1000, capMs = 60_000, maxAttempts = 10 } = opts;
  const code = Number(statusCode) || 0;

  if (STOP_CODES.has(code)) {
    return { action: "stop", reason: reasonName(code) };
  }
  if (code === DisconnectReason.connectionReplaced) {
    return { action: "hold", delayMs: HOLD_MS, reason: "connectionReplaced" };
  }
  if (code === DisconnectReason.restartRequired) {
    return { action: "restart", delayMs: 0, reason: "restartRequired" };
  }
  // connectionClosed(428), timedOut/connectionLost(408), unavailableService(503),
  // statusCode 0 (genérico) → reconectar com backoff até o teto de tentativas.
  if (attempt >= maxAttempts) {
    return { action: "stop", reason: "maxAttemptsReached" };
  }
  const exp = Math.min(capMs, baseMs * 2 ** attempt);
  const delayMs = Math.round(exp * (0.5 + Math.random() * 0.5)); // jitter 50–100%
  return { action: "reconnect", delayMs, reason: reasonName(code) };
}

function reasonName(code) {
  return DisconnectReason[code] || `code:${code}`;
}
