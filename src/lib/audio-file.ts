/**
 * Importação de gravação feita fora do navegador — celular, gravador de mesa,
 * áudio que chegou pronto.
 *
 * O pipeline do servidor já aceita qualquer formato (o ffmpeg identifica pelo
 * conteúdo e extrai a faixa de áudio de vídeo com `-vn`), então o trabalho aqui
 * é só reconhecer o arquivo e medir a duração antes de subir.
 */

/** Teto do servidor (MAX_MEDIA_MB, padrão 100 MB). Barrar aqui evita subir 100 MB para levar erro. */
export const MAX_IMPORT_BYTES = 100 * 1024 * 1024;

/**
 * O que o seletor de arquivos oferece.
 *
 * As extensões soltas no fim não são redundância: o Windows manda mimetype
 * vazio para `.opus` e `.amr`, e nesses casos um accept só com `audio/*` esconde
 * o arquivo do usuário.
 */
export const ACCEPT_IMPORTACAO =
  "audio/*,video/*,.mp3,.m4a,.m4b,.aac,.wav,.ogg,.oga,.opus,.flac,.amr,.wma,.caf,.3gp,.mp4,.mov,.mkv,.webm";

const EXTENSOES_ACEITAS = new Set([
  "mp3", "m4a", "m4b", "aac", "wav", "ogg", "oga", "opus", "flac", "amr", "wma",
  "caf", "weba", "3gp", "mp4", "mov", "mkv", "webm",
]);

/** Espelha MIME_POR_EXTENSAO de backend/src/lib/media-safety.js. */
const MIME_POR_EXTENSAO: Record<string, string> = {
  mp3: "audio/mpeg", m4a: "audio/mp4", m4b: "audio/mp4", aac: "audio/aac",
  wav: "audio/wav", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg",
  flac: "audio/flac", amr: "audio/amr", wma: "audio/x-ms-wma", weba: "audio/webm",
  caf: "audio/x-caf", "3gp": "video/3gpp", mp4: "video/mp4",
  mov: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska",
};

const SEM_INFORMACAO = new Set(["", "application/octet-stream", "binary/octet-stream"]);

export const extensaoDe = (nome: string) =>
  (nome || "").split(".").length > 1 ? (nome.split(".").pop() || "").toLowerCase() : "";

/**
 * Mimetype efetivo do arquivo: o que o navegador declarou, ou o da extensão
 * quando ele não soube dizer. Devolve "" quando não dá para saber nem por um
 * nem por outro.
 */
export function mimeDoArquivo(file: File): string {
  const declarado = String(file.type || "").split(";")[0].trim().toLowerCase();
  if (!SEM_INFORMACAO.has(declarado)) return declarado;
  return MIME_POR_EXTENSAO[extensaoDe(file.name)] || "";
}

/** É um arquivo que faz sentido transcrever? */
export function ehMidiaAceita(file: File): boolean {
  const mime = mimeDoArquivo(file);
  if (mime.startsWith("audio/") || mime.startsWith("video/")) return true;
  return EXTENSOES_ACEITAS.has(extensaoDe(file.name));
}

/** Mensagem de recusa, ou null quando o arquivo serve. */
export function recusaImportacao(file: File): string | null {
  if (!ehMidiaAceita(file)) return "Escolha um arquivo de áudio ou vídeo.";
  if (file.size === 0) return "O arquivo está vazio.";
  if (file.size > MAX_IMPORT_BYTES) {
    return `O arquivo tem ${Math.round(file.size / 1048576)} MB e o limite é ${Math.round(MAX_IMPORT_BYTES / 1048576)} MB.`;
  }
  return null;
}

/**
 * Duração do arquivo, em segundos.
 *
 * WebM/Opus e alguns m4a chegam com `duration === Infinity` no
 * `loadedmetadata`; o seek para um instante absurdo força o navegador a
 * calcular a duração real. Mesmo truque de AudioMessage.tsx.
 *
 * Devolve 0 quando não dá para medir — o servidor sobrescreve a duração com o
 * que o ffmpeg apurar assim que a transcrição terminar, então um 0 aqui só
 * deixa o rótulo vazio durante o processamento.
 */
export function duracaoDoArquivo(file: File, timeoutMs = 10_000): Promise<number> {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const el = document.createElement("video"); // aceita áudio e vídeo
    el.preload = "metadata";
    el.muted = true;

    let encerrado = false;
    const encerrar = (valor: number) => {
      if (encerrado) return;
      encerrado = true;
      clearTimeout(timer);
      el.removeAttribute("src");
      el.load();
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(valor) && valor > 0 ? Math.floor(valor) : 0);
    };

    const timer = setTimeout(() => encerrar(0), timeoutMs);

    let corrigindo = false;
    const onMeta = () => {
      const d = el.duration;
      if (Number.isFinite(d) && d > 0) encerrar(d);
      else if (!corrigindo) {
        corrigindo = true;
        el.currentTime = 1e101;
      }
    };
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("durationchange", onMeta);
    el.addEventListener("seeked", () => { if (corrigindo) encerrar(el.duration); });
    el.addEventListener("error", () => encerrar(0));

    el.src = url;
  });
}
