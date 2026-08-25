/**
 * Política de tipo de mídia.
 *
 * O mimetype de um anexo recebido é escolhido por QUEM ENVIOU — um contato
 * qualquer do WhatsApp. Antes, `mime.extension()` era aplicado direto nesse
 * valor: "text/html" virava arquivo .html, salvo em data/media e servido de
 * volta por /api/media com Content-Type text/html.
 *
 * Como /api/media é intencionalmente sem autenticação (as tags <img>/<audio>/
 * <video> não mandam header, e a proteção é a URL com nanoid de 21 chars), esse
 * .html executava JavaScript NA ORIGEM DA API — a mesma que guarda o cookie de
 * sessão. Um cliente mandava um anexo, o atendente clicava, e a sessão dele ia
 * embora. SVG tem o mesmo problema: é imagem, mas carrega <script>.
 *
 * A regra agora tem duas camadas:
 *   1. na GRAVAÇÃO, extensão só sai de uma allowlist (o resto vira .bin);
 *   2. na LEITURA, só a allowlist é servida inline; todo o resto é download
 *      forçado, com nosniff.
 */

// Tipos que o navegador precisa renderizar dentro da página para o CRM funcionar.
const INLINE_PERMITIDO = new Map([
  ["image/jpeg", "jpg"],
  ["image/jpg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
  ["image/bmp", "bmp"],
  ["audio/ogg", "ogg"],
  ["audio/opus", "ogg"],
  ["audio/mpeg", "mp3"],
  ["audio/mp3", "mp3"],
  ["audio/mp4", "m4a"],
  ["audio/x-m4a", "m4a"],
  ["audio/aac", "aac"],
  ["audio/wav", "wav"],
  ["audio/webm", "weba"],
  ["video/mp4", "mp4"],
  ["video/webm", "webm"],
  ["video/quicktime", "mov"],
  ["video/3gpp", "3gp"],
  ["application/pdf", "pdf"],
]);

// Tipos que o navegador EXECUTA. Nunca inline, em nenhuma hipótese.
const EXECUTAVEIS = new Set([
  "text/html", "application/xhtml+xml", "image/svg+xml", "text/xml",
  "application/xml", "text/javascript", "application/javascript",
  "application/x-javascript", "application/ecmascript", "text/ecmascript",
  "application/xslt+xml", "text/vtt", "application/x-shockwave-flash",
  "text/csv", "application/x-msdownload", "application/x-httpd-php",
]);

// Anexos legítimos que o cliente manda e o atendente precisa baixar. Salvos com
// a extensão certa (para o arquivo abrir no aplicativo correto), mas servidos
// sempre como download.
const ANEXO_PERMITIDO = new Map([
  ["application/msword", "doc"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"],
  ["application/vnd.ms-excel", "xls"],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"],
  ["application/vnd.ms-powerpoint", "ppt"],
  ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "pptx"],
  ["text/plain", "txt"],
  ["application/zip", "zip"],
  ["application/rtf", "rtf"],
  ["application/vnd.oasis.opendocument.text", "odt"],
]);

export function cleanMime(mimeType) {
  return String(mimeType || "").split(";")[0].trim().toLowerCase();
}

/** Extensão segura para gravar. Qualquer coisa desconhecida ou executável vira .bin. */
export function safeExtension(mimeType) {
  const limpo = cleanMime(mimeType);
  if (!limpo) return "bin";
  if (EXECUTAVEIS.has(limpo)) return "bin";
  return INLINE_PERMITIDO.get(limpo) || ANEXO_PERMITIDO.get(limpo) || "bin";
}

/** Pode ser renderizado dentro da página? */
export function podeServirInline(mimeType) {
  const limpo = cleanMime(mimeType);
  if (!limpo || EXECUTAVEIS.has(limpo)) return false;
  return INLINE_PERMITIDO.has(limpo);
}

/**
 * Content-Type com que o arquivo será SERVIDO. Divergente do detectado de
 * propósito: o que não é servível inline sai como octet-stream, para o
 * navegador não tentar interpretar nada.
 */
export function contentTypeParaServir(mimeDetectado) {
  const limpo = cleanMime(mimeDetectado);
  return podeServirInline(limpo) ? limpo : "application/octet-stream";
}

/** Nome de arquivo seguro para o cabeçalho Content-Disposition. */
// Allowlist em vez de blocklist: em vez de tentar listar todo caractere
// perigoso (CR/LF injetam cabecalho HTTP, aspas quebram o Content-Disposition),
// so passa o que sabidamente e seguro num nome de arquivo.
const CARACTERE_SEGURO_NO_NOME = /[A-Za-z0-9 ._-]/;

/** Nome de arquivo seguro para o cabecalho Content-Disposition. */
export function nomeParaDownload(filename) {
  const base = String(filename || "arquivo");
  let saida = "";
  for (const ch of base) saida += CARACTERE_SEGURO_NO_NOME.test(ch) ? ch : "_";
  return saida.trim().slice(0, 100) || "arquivo";
}

export const _tabelas = { INLINE_PERMITIDO, EXECUTAVEIS, ANEXO_PERMITIDO };
