import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import ffmpegPath from "ffmpeg-static";
import { nanoid } from "nanoid";

// Mesmo padrão de spawn de whatsapp/audio-convert.js, mas com outro alvo: lá o
// objetivo é uma nota de voz que o WhatsApp aceite (48 kHz, 64 kbps); aqui é o
// menor arquivo que um modelo de fala ainda entende bem. 16 kHz mono a 24 kbps
// deixa 1h de consulta em ~11 MB — bem dentro do limite de 25 MB do free tier
// do Groq, e o Whisper reamostra tudo para 16 kHz internamente de qualquer jeito.
function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error("ffmpeg-static binary not found"));
    const proc = spawn(ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", chunk => { stderr += chunk.toString(); });
    proc.on("error", reject);
    proc.on("close", code => {
      // ffmpeg -i sem output sai com código 1 de propósito; quem chama decide
      // se isso é erro (conversão) ou não (leitura de metadado).
      resolve({ code, stderr });
    });
  });
}

/** Comprime para ogg/opus 16 kHz mono. Devolve o caminho do arquivo temporário. */
export async function compressForTranscription(inputPath) {
  const outPath = path.join(os.tmpdir(), `consulta-${nanoid()}.ogg`);
  const { code, stderr } = await runFfmpeg([
    "-y",
    "-i", inputPath,
    "-vn",
    "-c:a", "libopus",
    "-b:a", "24k",
    "-ar", "16000",
    "-ac", "1",
    "-f", "ogg",
    outPath,
  ]);
  if (code !== 0) {
    await fs.unlink(outPath).catch(() => {});
    throw new Error(`ffmpeg exited ${code}: ${stderr.slice(-300)}`);
  }
  return outPath;
}

/**
 * Duração em segundos. O ffmpeg-static não traz o ffprobe, então o caminho é
 * rodar `ffmpeg -i` sem saída e ler o "Duration:" do stderr.
 */
export async function probeDurationSec(inputPath) {
  const { stderr } = await runFfmpeg(["-i", inputPath]);
  const m = stderr.match(/Duration:\s*(\d+):(\d{2}):(\d{2})\.(\d{2})/);
  if (!m) return 0;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 100;
}

/**
 * Divide o áudio em pedaços de `chunkSeconds`. Só é acionado quando o arquivo
 * já comprimido ainda passa do limite do provedor (consulta de várias horas).
 * Devolve [{ path, offsetSec }] — o offset é o que reposiciona os timestamps de
 * cada pedaço na linha do tempo da consulta inteira.
 */
export async function splitAudio(inputPath, chunkSeconds, totalSeconds) {
  const parts = [];
  const total = totalSeconds || (await probeDurationSec(inputPath));
  for (let offset = 0; offset < total; offset += chunkSeconds) {
    const outPath = path.join(os.tmpdir(), `consulta-part-${nanoid()}.ogg`);
    const { code, stderr } = await runFfmpeg([
      "-y",
      // -ss antes de -i faz seek rápido pelo índice em vez de decodificar tudo
      // desde o começo a cada pedaço.
      "-ss", String(offset),
      "-t", String(chunkSeconds),
      "-i", inputPath,
      "-vn",
      "-c:a", "libopus",
      "-b:a", "24k",
      "-ar", "16000",
      "-ac", "1",
      "-f", "ogg",
      outPath,
    ]);
    if (code !== 0) {
      await Promise.all(parts.map(p => fs.unlink(p.path).catch(() => {})));
      await fs.unlink(outPath).catch(() => {});
      throw new Error(`ffmpeg split exited ${code}: ${stderr.slice(-300)}`);
    }
    parts.push({ path: outPath, offsetSec: offset });
  }
  return parts;
}
