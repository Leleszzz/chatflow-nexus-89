import { test } from "node:test";
import assert from "node:assert/strict";
import { pickBrowser } from "../src/whatsapp/connection/browser-fingerprint.js";

// Regressão: com syncFullHistory=true (modo "full"), o Baileys troca
// webSubPlatform para WIN32/DARWIN se o browser for "Windows"/"Mac OS"
// (Utils/validate-connection.js). O cliente passa a se anunciar como app
// DESKTOP enviando versão web → o WhatsApp encerra a conexão com 428 antes de
// emitir o QR. O fingerprint no modo "full" precisa ficar FORA desse mapa.
const PLATFORM_MAPPED = new Set(["Windows", "Mac OS"]);

test("modo full não usa browser mapeado para plataforma desktop (evita 428)", () => {
  const [os] = pickBrowser("full");
  assert.ok(!PLATFORM_MAPPED.has(os), `browser "${os}" força webSubPlatform desktop e derruba a conexão`);
});

test("modos recent/none usam o browser nativo do host", () => {
  for (const mode of ["recent", "none", undefined]) {
    const browser = pickBrowser(mode);
    assert.ok(Array.isArray(browser) && browser.length === 3, `fingerprint inválido para ${mode}`);
    assert.equal(browser[1], "Chrome");
  }
});
