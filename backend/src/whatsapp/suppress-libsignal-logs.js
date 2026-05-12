const suppressedInfoPrefixes = new Set([
  "Closing session:",
  "Opening session:",
  "Removing old closed session:",
  "Migrating session to:",
]);

const suppressedLogPrefixes = [
  "Closing open session in favor of incoming prekey bundle",
  "Failed to decrypt message with any known session",
  "Closing stale open session for new outgoing prekey bundle",
];

const suppressedErrorPrefixes = [
  "Session error:",
];

function matchesPrefix(args, prefixes) {
  const first = args[0];
  if (typeof first !== "string") return false;
  return prefixes.some(p => first.startsWith(p));
}

export function suppressLibsignalSessionLogs() {
  if (globalThis.__libsignalSessionLogSuppressed) return;
  globalThis.__libsignalSessionLogSuppressed = true;

  const originalInfo = console.info.bind(console);
  console.info = (...args) => {
    const first = args[0];
    if (typeof first === "string" && suppressedInfoPrefixes.has(first)) return;
    originalInfo(...args);
  };

  const originalLog = console.log.bind(console);
  console.log = (...args) => {
    if (matchesPrefix(args, suppressedLogPrefixes)) return;
    originalLog(...args);
  };

  const originalError = console.error.bind(console);
  console.error = (...args) => {
    if (matchesPrefix(args, suppressedErrorPrefixes)) return;
    originalError(...args);
  };
}
