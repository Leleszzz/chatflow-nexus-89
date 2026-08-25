import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { config } from "../config.js";
import { cleanMime, safeExtension } from "../lib/media-safety.js";

// Teto do que aceitamos gravar. O buffer de mídia recebida vem de um contato
// qualquer do WhatsApp: sem limite, um vídeo grande o bastante derruba o
// processo por falta de memória antes mesmo de chegar ao disco.
export const MAX_MEDIA_BYTES = Number(process.env.MAX_MEDIA_MB || 100) * 1024 * 1024;

// A extensão sai de uma allowlist (lib/media-safety.js) e NÃO de mime.extension()
// aplicado ao mimetype que o remetente escolheu — era assim que um anexo
// "text/html" virava um .html executável servido pela API.
const pickExtension = safeExtension;

export async function saveMedia(buffer, mimeType) {
  if (!buffer?.length) throw new Error("mídia vazia");
  if (buffer.length > MAX_MEDIA_BYTES) {
    throw new Error(`mídia de ${Math.round(buffer.length / 1048576)} MB excede o limite de ${Math.round(MAX_MEDIA_BYTES / 1048576)} MB`);
  }
  await fs.mkdir(config.paths.mediaDir, { recursive: true });
  const ext = pickExtension(mimeType);
  const filename = `${nanoid()}.${ext}`;
  const filePath = path.join(config.paths.mediaDir, filename);
  await fs.writeFile(filePath, buffer);
  return { filename, mimeType: cleanMime(mimeType), url: `/api/media/${filename}` };
}

export async function saveMediaFromBuffer(buffer, mimeType) {
  return saveMedia(buffer, mimeType);
}

export function resolveMediaPath(filename) {
  const safe = path.basename(String(filename || ""));
  const alvo = path.resolve(config.paths.mediaDir, safe);
  // path.basename já barra "../", mas conferir o resultado final contra o
  // diretório de mídia é a garantia que não depende do comportamento de uma
  // função só (e cobre nome vazio, que resolveria para o próprio diretório).
  const raiz = path.resolve(config.paths.mediaDir);
  if (!safe || alvo === raiz || !alvo.startsWith(raiz + path.sep)) {
    throw new Error("nome de arquivo inválido");
  }
  return alvo;
}

export async function downloadAndSaveFromUrl(url) {
  if (!url) return null;
  try {
    // Só HTTP(S), e com tempo máximo: a URL vem do servidor do WhatsApp (foto de
    // perfil), mas tratar como não-confiável evita que um redirecionamento leve
    // a fetch para um endereço interno da rede.
    const alvo = new URL(String(url));
    if (alvo.protocol !== "https:" && alvo.protocol !== "http:") return null;
    const res = await fetch(alvo, { signal: AbortSignal.timeout(20000), redirect: "follow" });
    if (!res.ok) return null;
    const mimeType = res.headers.get("content-type") || "image/jpeg";
    const buffer = Buffer.from(await res.arrayBuffer());
    return await saveMedia(buffer, mimeType);
  } catch (err) {
    console.warn("[media-repo] downloadAndSaveFromUrl failed:", err.message);
    return null;
  }
}
