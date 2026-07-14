// Ruído benigno do libsignal/Baileys durante o re-keying de sessões. Não indica
// perda real de conversa — o WhatsApp re-sincroniza as sessões sozinho. Como cada
// biblioteca usa um canal diferente (console.log/info/warn/error), suprimimos os
// mesmos prefixos em TODOS os canais.
const suppressedPrefixes = [
  "Closing session:",
  "Opening session:",
  "Removing old closed session:",
  "Migrating session to:",
  "Closing open session in favor of incoming prekey bundle",
  "Closing stale open session for new outgoing prekey bundle",
  "Failed to decrypt message with any known session",
  "Session error:",
];

function matchesPrefix(args) {
  const first = args[0];
  if (typeof first !== "string") return false;
  return suppressedPrefixes.some(p => first.startsWith(p));
}

export function suppressLibsignalSessionLogs() {
  if (globalThis.__libsignalSessionLogSuppressed) return;
  globalThis.__libsignalSessionLogSuppressed = true;

  for (const channel of ["log", "info", "warn", "error"]) {
    const original = console[channel].bind(console);
    console[channel] = (...args) => {
      if (matchesPrefix(args)) return;
      original(...args);
    };
  }
}
