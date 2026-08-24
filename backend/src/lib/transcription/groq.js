import fs from "node:fs/promises";

const ENDPOINT = "https://api.groq.com/openai/v1/audio/transcriptions";
const MODEL = "whisper-large-v3-turbo";

// Limite do free tier. O plano pago aceita 100 MB, mas assumir o menor evita
// que quem está no free descubra o teto no meio de uma consulta de 2h.
export const GROQ_MAX_BYTES = 25 * 1024 * 1024;

/**
 * Transcreve um arquivo já comprimido. Devolve segmentos SEM falante — quem
 * chama (transcription/index.js) encaminha para a diarização por LLM.
 */
export async function transcribeWithGroq({ filePath, apiKey, language = "pt" }) {
  if (!apiKey) throw new Error("Chave do Groq não configurada");
  const buffer = await fs.readFile(filePath);

  const form = new FormData();
  form.append("file", new Blob([buffer], { type: "audio/ogg" }), "consulta.ogg");
  form.append("model", MODEL);
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "segment");
  form.append("language", language);

  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!response.ok) {
    const text = await response.text();
    let detail = text;
    try {
      detail = JSON.parse(text)?.error?.message || text;
    } catch {}
    const err = new Error(`Groq ${response.status}: ${detail}`);
    err.status = response.status;
    throw err;
  }

  const data = await response.json();
  const segments = (data.segments || [])
    .map(s => ({
      start: Number(s.start) || 0,
      end: Number(s.end) || 0,
      text: String(s.text || "").trim(),
    }))
    .filter(s => s.text);

  // Sem segmentos mas com texto: alguns áudios curtos voltam só com `text`.
  if (!segments.length && data.text) {
    segments.push({ start: 0, end: Number(data.duration) || 0, text: String(data.text).trim() });
  }

  return {
    segments,
    language: data.language || language,
    durationSec: Number(data.duration) || 0,
    diarized: false,
  };
}
