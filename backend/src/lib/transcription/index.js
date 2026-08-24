import fs from "node:fs/promises";
import { compressForTranscription, probeDurationSec, splitAudio } from "../audio-compress.js";
import { transcribeWithGroq, GROQ_MAX_BYTES } from "./groq.js";
import { transcribeWithAssemblyAI, ASSEMBLYAI_MAX_BYTES } from "./assemblyai.js";
import { diarizeWithLLM } from "./diarize-llm.js";

export const PROVIDERS = {
  groq: {
    label: "Groq (Whisper turbo)",
    maxBytes: GROQ_MAX_BYTES,
    run: transcribeWithGroq,
    keyField: "groqApiKey",
  },
  assemblyai: {
    label: "AssemblyAI (diarização nativa)",
    maxBytes: ASSEMBLYAI_MAX_BYTES,
    run: transcribeWithAssemblyAI,
    keyField: "assemblyaiApiKey",
  },
};

// Ao dividir, cada pedaço tem uma hora — bem abaixo de qualquer limite de
// tamanho no nosso bitrate, e poucos o bastante para não estourar rate limit.
const CHUNK_SECONDS = 3600;

/**
 * Transcreve o arquivo de áudio de uma consulta.
 *
 * Sempre comprime antes de enviar (16 kHz mono opus): o navegador grava em
 * WebM/Opus a 32 kbps estéreo e o provedor cobra por hora de áudio, não por
 * byte — mas o upload de um arquivo três vezes maior é tempo perdido e é o que
 * separa "cabe no free tier" de "não cabe".
 *
 * Devolve { segments: [{ speaker, start, end, text }], language, durationSec, provider }.
 */
export async function transcribe({ filePath, provider, settings, language = "pt", openaiApiKey }) {
  const adapter = PROVIDERS[provider];
  if (!adapter) throw new Error(`Provedor de transcrição desconhecido: ${provider}`);
  const apiKey = settings?.[adapter.keyField];
  if (!apiKey) throw new Error(`Chave de ${adapter.label} não configurada em Configurações → Transcrição`);

  const compressed = await compressForTranscription(filePath);
  const temporarios = [compressed];

  try {
    const durationSec = await probeDurationSec(compressed);
    const { size } = await fs.stat(compressed);

    let segments = [];
    let detectedLanguage = language;

    if (size <= adapter.maxBytes) {
      const result = await adapter.run({ filePath: compressed, apiKey, language });
      segments = result.segments;
      detectedLanguage = result.language || language;
      if (!result.diarized) {
        segments = await diarizeWithLLM({ segments, apiKey: openaiApiKey });
      }
    } else {
      // Áudio grande demais para uma chamada só. Cada pedaço é transcrito
      // isolado e os tempos voltam para a linha do tempo da consulta inteira.
      const parts = await splitAudio(compressed, CHUNK_SECONDS, durationSec);
      temporarios.push(...parts.map(p => p.path));
      for (const part of parts) {
        const result = await adapter.run({ filePath: part.path, apiKey, language });
        detectedLanguage = result.language || detectedLanguage;
        let partSegments = result.segments;
        if (!result.diarized) {
          partSegments = await diarizeWithLLM({ segments: partSegments, apiKey: openaiApiKey });
        }
        for (const seg of partSegments) {
          segments.push({
            ...seg,
            start: seg.start + part.offsetSec,
            end: seg.end + part.offsetSec,
          });
        }
      }
    }

    // Garantia de que todo segmento sai daqui com falante, inclusive quando a
    // diarização por LLM não foi chamada nem conseguiu responder.
    segments = segments.map(s => ({
      speaker: s.speaker || "A",
      start: Number(s.start) || 0,
      end: Number(s.end) || 0,
      text: String(s.text || "").trim(),
    })).filter(s => s.text);

    if (!segments.length) throw new Error("A transcrição voltou vazia — verifique se o áudio tem som");

    return { segments, language: detectedLanguage, durationSec, provider };
  } finally {
    await Promise.all(temporarios.map(p => fs.unlink(p).catch(() => {})));
  }
}
