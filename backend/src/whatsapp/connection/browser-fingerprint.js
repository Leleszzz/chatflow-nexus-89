import { Browsers } from "@whiskeysockets/baileys";

// Escolhe o fingerprint de browser conforme o modo de histórico.
//
// Cuidado (bug conhecido do Baileys): com syncFullHistory=true, o
// validate-connection.js troca webSubPlatform para WIN32/DARWIN quando o browser
// é "Windows"/"Mac OS" — ou seja, o cliente se anuncia como app DESKTOP, mas
// continua enviando a versão do WhatsApp *Web*. O servidor rejeita essa
// combinação e encerra a conexão com 428 (Connection Terminated) ANTES de emitir
// o QR. Um browser fora do PLATFORM_MAP (ex.: Ubuntu) mantém WEB_BROWSER e
// preserva requireFullSync no payload — o histórico completo continua vindo.
export function pickBrowser(historyMode) {
  return historyMode === "full"
    ? Browsers.ubuntu("Chrome")
    : Browsers.appropriate("Chrome");
}
