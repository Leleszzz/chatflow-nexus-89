// Rótulo padrão de um falante ainda não identificado. É o "Pessoa 1 / Pessoa 2"
// que o médico depois troca por "Dr. Fulano / Paciente" no SpeakerMapper.
export function defaultSpeakerLabel(key, index) {
  return `Pessoa ${index + 1}`;
}

/** Deriva a lista de falantes a partir dos segmentos, preservando rótulos já definidos. */
export function buildSpeakers(segments, existing = []) {
  const byKey = new Map((existing || []).map(s => [s.key, s]));
  const keys = [];
  for (const seg of segments || []) {
    const key = seg.speaker || "A";
    if (!keys.includes(key)) keys.push(key);
  }
  return keys.map((key, index) => {
    const prev = byKey.get(key);
    return {
      key,
      label: prev?.label || defaultSpeakerLabel(key, index),
      role: prev?.role || "outro",
    };
  });
}

function timecode(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Renderiza os segmentos no texto que os agentes de IA vão ler. Falas seguidas
 * do mesmo falante são fundidas num parágrafo só: o modelo de fala corta a cada
 * pausa, e sem isso a transcrição vira uma lista de fragmentos de três palavras
 * que atrapalha tanto a leitura humana quanto a da IA.
 */
export function renderTranscript(segments, speakers) {
  const labelOf = new Map((speakers || []).map(s => [s.key, s.label]));
  const blocks = [];
  for (const seg of segments || []) {
    const text = String(seg.text || "").trim();
    if (!text) continue;
    const key = seg.speaker || "A";
    const last = blocks[blocks.length - 1];
    if (last && last.key === key) {
      last.text += ` ${text}`;
      continue;
    }
    blocks.push({ key, start: seg.start, text });
  }
  return blocks
    .map(b => `[${timecode(b.start)}] ${labelOf.get(b.key) || b.key}: ${b.text}`)
    .join("\n");
}
