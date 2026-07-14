import fs from "node:fs/promises";
import path from "node:path";
import mime from "mime-types";
import { nanoid } from "nanoid";
import { config } from "../config.js";

function cleanMime(mimeType) {
  return String(mimeType || "").split(";")[0].trim().toLowerCase();
}

function pickExtension(mimeType) {
  const clean = cleanMime(mimeType);
  if (!clean) return "bin";
  const fromLib = mime.extension(clean);
  if (fromLib) return fromLib;
  if (clean === "audio/ogg" || clean === "audio/opus") return "ogg";
  if (clean === "audio/mp4" || clean === "audio/x-m4a") return "m4a";
  if (clean === "audio/mpeg") return "mp3";
  if (clean === "image/jpeg" || clean === "image/jpg") return "jpg";
  if (clean === "image/webp") return "webp";
  if (clean === "image/png") return "png";
  if (clean === "video/mp4") return "mp4";
  return "bin";
}

export async function saveMedia(buffer, mimeType) {
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
  const safe = path.basename(filename);
  return path.join(config.paths.mediaDir, safe);
}

export async function downloadAndSaveFromUrl(url) {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const mimeType = res.headers.get("content-type") || "image/jpeg";
    const buffer = Buffer.from(await res.arrayBuffer());
    return await saveMedia(buffer, mimeType);
  } catch (err) {
    console.warn("[media-repo] downloadAndSaveFromUrl failed:", err.message);
    return null;
  }
}
