import fs from "node:fs/promises";

const BASE = "https://api.assemblyai.com/v2";
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 20 * 60 * 1000;

// A AssemblyAI aceita arquivos bem maiores que isso, mas 300 MB já cobre uma
// consulta de ~7h no nosso bitrate e serve de sanidade contra upload errado.
export const ASSEMBLYAI_MAX_BYTES = 300 * 1024 * 1024;

async function readError(response, prefix) {
  const text = await response.text();
  let detail = text;
  try {
    detail = JSON.parse(text)?.error || text;
  } catch {}
  const err = new Error(`${prefix} ${response.status}: ${detail}`);
  err.status = response.status;
  return err;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Transcreve com diarização nativa (speaker_labels): a separação vem da voz, e
 * não de adivinhação sobre o texto. Três passos — upload, criar o job, esperar.
 */
export async function transcribeWithAssemblyAI({ filePath, apiKey, language = "pt" }) {
  if (!apiKey) throw new Error("Chave da AssemblyAI não configurada");
  const buffer = await fs.readFile(filePath);

  const uploadRes = await fetch(`${BASE}/upload`, {
    method: "POST",
    headers: { authorization: apiKey, "content-type": "application/octet-stream" },
    body: buffer,
  });
  if (!uploadRes.ok) throw await readError(uploadRes, "AssemblyAI (upload)");
  const { upload_url: audioUrl } = await uploadRes.json();

  const createRes = await fetch(`${BASE}/transcript`, {
    method: "POST",
    headers: { authorization: apiKey, "content-type": "application/json" },
    body: JSON.stringify({
      audio_url: audioUrl,
      speaker_labels: true,
      language_code: language,
    }),
  });
  if (!createRes.ok) throw await readError(createRes, "AssemblyAI (transcript)");
  const created = await createRes.json();

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let job = created;
  while (job.status !== "completed" && job.status !== "error") {
    if (Date.now() > deadline) {
      throw new Error("AssemblyAI: tempo esgotado esperando a transcrição (20 min)");
    }
    await sleep(POLL_INTERVAL_MS);
    const pollRes = await fetch(`${BASE}/transcript/${created.id}`, {
      headers: { authorization: apiKey },
    });
    if (!pollRes.ok) throw await readError(pollRes, "AssemblyAI (polling)");
    job = await pollRes.json();
  }
  if (job.status === "error") throw new Error(`AssemblyAI: ${job.error || "falha desconhecida"}`);

  // `utterances` já vem agrupado por falante; os tempos vêm em milissegundos.
  const segments = (job.utterances || [])
    .map(u => ({
      speaker: String(u.speaker || "A"),
      start: (Number(u.start) || 0) / 1000,
      end: (Number(u.end) || 0) / 1000,
      text: String(u.text || "").trim(),
    }))
    .filter(s => s.text);

  if (!segments.length && job.text) {
    segments.push({ speaker: "A", start: 0, end: (Number(job.audio_duration) || 0), text: String(job.text).trim() });
  }

  return {
    segments,
    language: job.language_code || language,
    durationSec: Number(job.audio_duration) || 0,
    diarized: true,
  };
}
