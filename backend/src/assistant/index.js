// O laço do assistente: pergunta -> ferramentas em cadeia -> resposta.
//
// "Analise minhas consultas gravadas hoje e me resuma o que ficou para eu fazer"
// não se responde com uma consulta ao banco: são N chamadas encadeadas, e o
// modelo só sabe qual é a próxima depois de ver o resultado da anterior. Daí o
// laço, e daí os tetos — de rodadas, de ferramentas e de custo.
//
// `chamar` é injetável porque este backend não tem mock de rede em lugar nenhum:
// o padrão da casa é extrair a lógica e testá-la sem tocar na OpenAI.
// backend/tests/assistant-loop.test.js passa uma função de mentira e verifica o
// encadeamento inteiro.

import { callOpenAI } from "../lib/openai.js";
import { MODEL_MAP, priceFor } from "../lib/openai-pricing.js";
import { getOpenaiSettings } from "../storage/settings-repo.js";
import { addAssistantUsage } from "../storage/assistant-repo.js";
import { HttpError } from "../middleware/error-handler.js";
import { AssistantToolError } from "./contexto.js";
import { buildSystemPrompt, PROMPT_DE_FECHAMENTO } from "./prompt.js";
import { getTool, toolSchemas } from "./tools/registry.js";
import { limparObjeto } from "./sanitize.js";

// O modelo forte por padrão: cadeia longa de tool calls é onde o gpt-4o-mini
// erra — chama a ferramenta errada, ou responde sem chamar nenhuma. O volume
// aqui é baixo (um médico perguntando), então o custo por pergunta é o que menos
// importa.
export const ASSISTANT_MODEL = process.env.ASSISTANT_MODEL || MODEL_MAP.premium;

export const MAX_RODADAS = Number(process.env.ASSISTANT_MAX_ROUNDS || 8);
export const MAX_TOOL_CALLS = Number(process.env.ASSISTANT_MAX_TOOL_CALLS || 16);
export const MAX_TOKENS_RESPOSTA = Number(process.env.ASSISTANT_MAX_TOKENS || 1200);
export const TETO_CUSTO_USD = Number(process.env.ASSISTANT_MAX_COST_USD || 0.5);
export const MAX_CHARS_RESULTADO = 8000;
export const MAX_PROPOSTAS = 5;
export const HISTORICO_MAX = 12;

const RESPOSTA_DE_ULTIMO_RECURSO =
  "Consultei bastante coisa e não consegui fechar essa. Pode dividir a pergunta em partes?";

/**
 * O histórico gravado, convertido para o formato da API.
 *
 * NÃO refaz o replay das tool calls antigas. Duas razões: elas custam muito
 * token para pouco valor (o que importava virou texto na resposta), e um
 * tool_call sem o `role:"tool"` correspondente é erro da API. O que sobrevive da
 * ação é uma nota curta, que basta para o modelo não repropor o que já foi
 * recusado.
 *
 * Pura.
 */
export function historicoParaOpenAI(mensagens, limite = HISTORICO_MAX) {
  return (mensagens || [])
    .slice(-limite)
    .map(m => {
      if (m.role === "user") return { role: "user", content: m.body };
      const notas = (m.propostas || [])
        .map(p => `[propus: ${p.tipo} — ${p.status}]`)
        .join(" ");
      const conteudo = [m.body, notas].filter(Boolean).join("\n");
      return conteudo ? { role: "assistant", content: conteudo } : null;
    })
    .filter(Boolean);
}

/**
 * Corta um resultado de ferramenta que ficou grande demais para o prompt.
 *
 * Avisa no próprio conteúdo, em vez de cortar calado: o modelo precisa saber que
 * não viu tudo, senão afirma "não há mais consultas" olhando meia lista.
 *
 * Pura.
 */
export function recorte(dados, max = MAX_CHARS_RESULTADO) {
  const json = JSON.stringify(limparObjeto(dados, 4000) ?? null);
  if (json.length <= max) return json;
  return JSON.stringify({
    truncado: true,
    aviso: `resultado grande demais (${json.length} caracteres); veio cortado. Refine o filtro se precisar do resto.`,
    parcial: json.slice(0, max),
  });
}

function somarUsage(acumulado, usage, modelo) {
  if (!usage) return acumulado;
  return {
    promptTokens: acumulado.promptTokens + (Number(usage.prompt_tokens) || 0),
    completionTokens: acumulado.completionTokens + (Number(usage.completion_tokens) || 0),
    costUsd: acumulado.costUsd + priceFor(modelo, usage),
  };
}

/**
 * Roda um turno do assistente.
 *
 * `onPasso` é chamado a cada ferramenta executada — é por ele que a rota emite o
 * evento de socket que mostra "consultando a agenda..." na tela. Fica como
 * callback para este arquivo não saber o que é socket.
 *
 * Devolve `{ reply, passos, propostas, usage, interrompido }`. Nunca lança por
 * erro de ferramenta: erro de ferramenta é conteúdo, e o modelo se recupera.
 */
export async function runAssistantTurn({
  ctx,
  historico = [],
  texto,
  chamar = callOpenAI,
  onPasso = null,
  modelo = ASSISTANT_MODEL,
  // Injetáveis para o teste: sem eles, exercitar o laço exigiria MongoDB no ar
  // só para ler uma chave e gravar um contador.
  apiKey: apiKeyInjetada = null,
  registrarUso = addAssistantUsage,
}) {
  const apiKey = apiKeyInjetada || (await getOpenaiSettings()).apiKey;
  if (!apiKey) throw new HttpError(400, "OpenAI key não configurada", "SEM_CHAVE_OPENAI");

  const pergunta = String(texto ?? "").trim();
  if (!pergunta) throw new HttpError(400, "mensagem vazia", "PARAMETRO_INVALIDO");

  const messages = [
    { role: "system", content: buildSystemPrompt(ctx) },
    ...historicoParaOpenAI(historico),
    { role: "user", content: pergunta },
  ];

  const tools = toolSchemas(ctx);
  const passos = [];
  const propostas = [];
  let usage = { promptTokens: 0, completionTokens: 0, costUsd: 0 };
  let toolCallsUsadas = 0;
  let reply = "";
  let interrompido = false;

  for (let rodada = 0; rodada < MAX_RODADAS; rodada += 1) {
    const ultima = rodada === MAX_RODADAS - 1;
    const resposta = await chamar({
      apiKey,
      model: modelo,
      // Baixa de propósito: a tarefa é achar e relatar dado do sistema, não
      // escrever bonito. Criatividade aqui vira informação inventada.
      temperature: 0.2,
      messages,
      tools,
      tool_choice: ultima ? "none" : "auto",
      max_tokens: MAX_TOKENS_RESPOSTA,
    });

    usage = somarUsage(usage, resposta?.usage, modelo);
    const msg = resposta?.choices?.[0]?.message;
    const toolCalls = Array.isArray(msg?.tool_calls) ? msg.tool_calls : [];

    if (!toolCalls.length) {
      reply = String(msg?.content ?? "").trim();
      // Responder só na última rodada significa que o modelo ainda queria
      // consultar e foi obrigado a fechar (tool_choice "none"). A resposta vale,
      // mas é parcial — e o médico precisa ver isso na tela.
      if (ultima) interrompido = true;
      break;
    }

    messages.push(msg);

    for (const call of toolCalls) {
      const nome = call?.function?.name || "";
      const inicio = Date.now();
      let conteudo;
      let passo = { tool: nome, ok: false, resumo: "", ms: 0 };

      if (toolCallsUsadas >= MAX_TOOL_CALLS) {
        conteudo = { erro: "limite de consultas deste turno atingido; responda com o que já tem" };
        passo.resumo = "limite de consultas atingido";
        interrompido = true;
      } else {
        toolCallsUsadas += 1;
        const def = getTool(nome);
        try {
          if (!def) throw new AssistantToolError(`ferramenta desconhecida: ${nome}`, "FERRAMENTA_DESCONHECIDA");
          if (def.exigeAcessoClinico && !ctx.temAcessoClinico) {
            throw new AssistantToolError("seu cargo não tem acesso a dado clínico", "SEM_ACESSO_CLINICO");
          }

          let args = {};
          try {
            args = JSON.parse(call.function?.arguments || "{}");
          } catch {
            throw new AssistantToolError("argumentos não são JSON válido", "ARGUMENTOS_INVALIDOS");
          }

          const normalizados = def.normalize(args);

          if (def.tipo === "escrita") {
            if (propostas.length >= MAX_PROPOSTAS) {
              throw new AssistantToolError(
                `já preparei ${MAX_PROPOSTAS} ações neste turno; resuma o resto em texto e pergunte quais virar card`,
                "LIMITE_PROPOSTAS",
              );
            }
            const proposta = await def.propose(normalizados, ctx);
            propostas.push(proposta);
            conteudo = {
              ok: true,
              proposta_id: proposta.id,
              titulo: proposta.titulo,
              // O modelo precisa ouvir isso explicitamente todo turno: sem o
              // aviso, ele conclui a frase com "pronto, enviei".
              aviso: "O card foi mostrado ao médico e AINDA NÃO FOI EXECUTADO. Não repita a proposta e não diga que a ação aconteceu.",
            };
            passo.resumo = proposta.titulo;
          } else {
            const dados = await def.run(normalizados, ctx);
            conteudo = dados;
            passo.resumo = def.resumo ? def.resumo(normalizados, dados) : nome;
          }
          passo.ok = true;
        } catch (err) {
          // Erro de ferramenta volta como conteúdo, não como exceção: o modelo
          // lê "data precisa estar em AAAA-MM-DD", corrige e chama de novo.
          // Derrubar o turno faria o médico perder a pergunta inteira.
          conteudo = { erro: err.message, codigo: err.codigo || "FERRAMENTA_FALHOU" };
          passo.resumo = err.message;
        }
      }

      passo.ms = Date.now() - inicio;
      passos.push(passo);
      if (onPasso) {
        try { onPasso(passo); } catch { /* aviso de tela nunca derruba o turno */ }
      }

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: recorte(conteudo),
      });
    }

    if (usage.costUsd > TETO_CUSTO_USD) {
      interrompido = true;
      break;
    }
  }

  // Estourou rodadas ou custo sem produzir texto: uma última passada, sem
  // ferramenta, pedindo o que já dá para dizer.
  if (!reply) {
    interrompido = true;
    const fechamento = await chamar({
      apiKey,
      model: modelo,
      temperature: 0.2,
      messages: [...messages, { role: "system", content: PROMPT_DE_FECHAMENTO }],
      tool_choice: "none",
      max_tokens: MAX_TOKENS_RESPOSTA,
    }).catch(() => null);
    usage = somarUsage(usage, fechamento?.usage, modelo);
    reply = String(fechamento?.choices?.[0]?.message?.content ?? "").trim();
  }

  // Num chat, ficar sem resposta parece defeito. Diferente do agente de
  // WhatsApp, que lança RESPOSTA_VAZIA, aqui vale dizer algo honesto.
  if (!reply) reply = RESPOSTA_DE_ULTIMO_RECURSO;

  try {
    await registrarUso(ctx.user?.id, usage);
  } catch (err) {
    console.warn(`[assistente] falha ao gravar custo: ${err.message}`);
  }

  return {
    reply,
    passos,
    propostas,
    usage: { ...usage, costUsd: Number(usage.costUsd.toFixed(8)) },
    modelo,
    interrompido,
  };
}
