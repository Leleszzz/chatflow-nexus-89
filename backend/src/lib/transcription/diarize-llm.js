import { callOpenAI } from "../openai.js";

const MODEL = "gpt-4o-mini";
// Lotes menores que o contexto do modelo, mas grandes o bastante para ele ver o
// vaivém da conversa. Com ~120 falas o modelo ainda enxerga o padrão de
// pergunta-resposta que é o que sustenta o palpite.
const BATCH_SIZE = 120;
// Sobreposição entre lotes: as últimas falas do lote anterior entram como
// contexto (sem serem re-rotuladas) para o falante não "trocar de nome" na
// virada do lote.
const OVERLAP = 8;

const SYSTEM_PROMPT = `Você recebe falas numeradas de uma consulta médica gravada em áudio, na ordem em que foram ditas. A transcrição não sabe quem falou.

Sua tarefa é decidir, para cada fala, qual pessoa a disse.

Regras:
- Use as letras A, B, C... para as pessoas. A é quem fala primeiro.
- Numa consulta típica há duas pessoas: o profissional de saúde (que pergunta, examina, explica, prescreve) e o paciente (que relata sintomas e responde). Use uma terceira letra apenas se houver evidência clara de um acompanhante ou de outra pessoa entrando na sala.
- Perguntas clínicas, orientações e prescrições são do profissional. Relatos de sintoma, dor e histórico pessoal são do paciente.
- Falas seguidas costumam ser da mesma pessoa. Só troque de pessoa quando o conteúdo indicar troca de turno.
- NÃO reescreva, corrija nem traduza o texto das falas.

Responda SOMENTE com JSON no formato {"falas":[{"i":0,"p":"A"},{"i":1,"p":"B"}]}, incluindo todos os índices que foram pedidos.`;

function parseAssignments(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : parsed.falas;
    if (!Array.isArray(list)) return null;
    const map = new Map();
    for (const item of list) {
      const i = Number(item?.i);
      const p = String(item?.p || "").trim().toUpperCase();
      if (Number.isInteger(i) && /^[A-Z]$/.test(p)) map.set(i, p);
    }
    return map.size ? map : null;
  } catch {
    return null;
  }
}

/**
 * Marca cada segmento com um falante usando o gpt-4o-mini. É o caminho do Groq,
 * que transcreve barato mas não separa vozes.
 *
 * A separação aqui é APROXIMADA — ela lê o texto, não a voz. Se a diarização
 * falhar por qualquer motivo, devolvemos tudo como um falante só: perder a
 * separação é ruim, perder a transcrição da consulta é inaceitável.
 */
export async function diarizeWithLLM({ segments, apiKey }) {
  if (!segments?.length) return segments || [];
  if (!apiKey) return segments.map(s => ({ ...s, speaker: "A" }));

  const result = segments.map(s => ({ ...s, speaker: "A" }));

  for (let start = 0; start < segments.length; start += BATCH_SIZE) {
    const end = Math.min(start + BATCH_SIZE, segments.length);
    const contextStart = Math.max(0, start - OVERLAP);

    const lines = [];
    for (let i = contextStart; i < end; i += 1) {
      const marker = i < start ? ` (já definido: ${result[i].speaker})` : "";
      lines.push(`${i}${marker}: ${segments[i].text}`);
    }
    const pedido = `Rotule as falas de ${start} a ${end - 1}. As anteriores são só contexto.\n\n${lines.join("\n")}`;

    try {
      const data = await callOpenAI({
        apiKey,
        model: MODEL,
        temperature: 0,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: pedido },
        ],
        response_format: { type: "json_object" },
      });
      const assignments = parseAssignments(data?.choices?.[0]?.message?.content);
      if (assignments) {
        for (let i = start; i < end; i += 1) {
          const speaker = assignments.get(i);
          if (speaker) result[i].speaker = speaker;
          // Sem resposta para este índice: herda o falante da fala anterior, que
          // é o palpite certo na maioria das vezes (falas seguidas do mesmo).
          else if (i > 0) result[i].speaker = result[i - 1].speaker;
        }
      }
    } catch (err) {
      console.warn(`[diarize-llm] lote ${start}-${end} falhou: ${err.message}`);
    }
  }

  return result;
}
