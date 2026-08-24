import { callOpenAI } from "../openai.js";

const MODEL = "gpt-4o-mini";
// Uma consulta de 1h dá ~13k tokens. O corte é folgado o bastante para não
// truncar consulta nenhuma na prática, e existe só para o custo não escapar
// numa gravação que ficou ligada a tarde inteira por engano.
const MAX_CHARS = 120_000;

const SYSTEM_PROMPT = `Você resume consultas médicas a partir da transcrição do áudio, para registro no prontuário.

Produza um resumo em português do Brasil, objetivo e em linguagem clínica, com estes campos:
- queixa: o motivo da consulta e a queixa principal relatada pelo paciente.
- historico: histórico relevante mencionado — sintomas, duração, doenças prévias, medicações em uso, alergias, hábitos.
- avaliacao: o que o profissional observou, avaliou ou hipotetizou durante a consulta.
- conduta: o que foi prescrito, solicitado ou orientado — exames, medicações, encaminhamentos, retorno.

Regras:
- Baseie-se APENAS no que está na transcrição. Não invente diagnóstico, dose, exame nem data.
- Se a transcrição não trouxer informação para um campo, devolva string vazia nesse campo.
- A transcrição vem de reconhecimento automático de fala e pode conter erros em termos técnicos e nomes de medicamentos. Se um termo estiver claramente corrompido, registre-o com a ressalva "(conforme áudio)" em vez de chutar o termo correto.

Responda SOMENTE com JSON no formato {"queixa":"","historico":"","avaliacao":"","conduta":""}.`;

/** Gera o resumo clínico estruturado. Devolve null se não der para gerar. */
export async function summarizeConsultation({ transcriptText, apiKey }) {
  if (!apiKey) throw new Error("Chave da OpenAI não configurada (necessária para o resumo)");
  const texto = String(transcriptText || "").trim();
  if (!texto) return null;

  const data = await callOpenAI({
    apiKey,
    model: MODEL,
    temperature: 0.2,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: texto.slice(0, MAX_CHARS) },
    ],
    response_format: { type: "json_object" },
  });

  const raw = data?.choices?.[0]?.message?.content;
  if (!raw) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("O modelo devolveu um resumo em formato inválido");
  }

  return {
    queixa: String(parsed.queixa || ""),
    historico: String(parsed.historico || ""),
    avaliacao: String(parsed.avaliacao || ""),
    conduta: String(parsed.conduta || ""),
    geradoEm: new Date().toISOString(),
  };
}
