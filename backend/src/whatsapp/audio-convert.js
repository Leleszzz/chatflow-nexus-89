import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import ffmpegPath from "ffmpeg-static";
import { nanoid } from "nanoid";

export function isOggOpus(mime) {
  if (!mime) return false;
  const m = mime.split(";")[0].trim().toLowerCase();
  return m === "audio/ogg" || m === "audio/opus";
}

export async function convertToOggOpus(inputPath) {
  const outPath = path.join(os.tmpdir(), `wa-${nanoid()}.ogg`);
  await new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error("ffmpeg-static binary not found"));
    const args = [
      "-y",
      "-i", inputPath,
      "-vn",
      "-c:a", "libopus",
      "-b:a", "64k",
      "-ar", "48000",
      "-ac", "1",
      "-f", "ogg",
      outPath,
    ];
    const proc = spawn(ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", chunk => { stderr += chunk.toString(); });
    proc.on("error", reject);
    proc.on("close", code => {
      if (code === 0) resolve(undefined);
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-300)}`));
    });
  });
  const data = await fs.readFile(outPath);
  fs.unlink(outPath).catch(() => {});
  return { buffer: data, mimeType: "audio/ogg; codecs=opus" };
}
