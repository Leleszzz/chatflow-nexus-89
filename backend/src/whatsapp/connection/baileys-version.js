import { fetchLatestBaileysVersion } from "@whiskeysockets/baileys";

const TTL_MS = 6 * 60 * 60 * 1000; // 6h
let cached = null; // { version, at }
let inFlight = null;

// Versão de fallback caso a rede falhe no primeiro fetch (atualizada quando
// um fetch bem-sucedido ocorre). Evita que a reconexão bloqueie/quebre.
let lastGood = null;

// Memoiza fetchLatestBaileysVersion por TTL no processo inteiro, compartilhado
// entre todas as instâncias — não há mais 1 chamada de rede por reconexão.
export async function getCachedBaileysVersion() {
  const now = Date.now();
  if (cached && now - cached.at < TTL_MS) return cached.version;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const { version } = await fetchLatestBaileysVersion();
      cached = { version, at: Date.now() };
      lastGood = version;
      return version;
    } catch (err) {
      console.warn(`[baileys-version] fetch falhou (${err.message}); usando fallback`);
      if (lastGood) return lastGood;
      // Último recurso: deixa o Baileys usar sua versão embutida.
      return undefined;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
