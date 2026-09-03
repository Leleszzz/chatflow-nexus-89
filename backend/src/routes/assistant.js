// A API do assistente do médico.
//
// Molde: routes/internal-chat.js (thread + mensagens + socket dirigido). A
// diferença que importa é o dono: lá a thread é de vários membros, aqui é de UMA
// pessoa. A conversa guarda recorte de prontuário em texto plano, e nem admin
// entra na conversa clínica de outro médico — por isso `carregarThreadDoDono`
// compara com req.user.id e não olha cargo.

import fs from "node:fs/promises";
import multer from "multer";
import { Router } from "../lib/safe-router.js";
import {
  listThreads, getThread, createThread, patchThread, deleteThread,
  listMessages, appendMessage, getMessage, marcarProposta, tituloDaPergunta, getAssistantUsage,
} from "../storage/assistant-repo.js";
import { requireAuth } from "../middleware/require-auth.js";
import { iaLimiter } from "../middleware/rate-limit.js";
import { emitToUsers } from "../socket/events.js";
import { ROLES } from "../lib/roles.js";
import { ACOES, registrarAsync } from "../lib/auditoria.js";
import { HttpError } from "../middleware/error-handler.js";
import { config } from "../config.js";
import { getTranscriptionSettings } from "../storage/settings-repo.js";
import { transcribeWithGroq } from "../lib/transcription/groq.js";
import { criarContexto } from "../assistant/contexto.js";
import { runAssistantTurn, HISTORICO_MAX } from "../assistant/index.js";
import { aplicarEdicao, TOOL_DE_PROPOSTA } from "../assistant/propostas.js";
import { getTool } from "../assistant/tools/registry.js";

// 8 MB cobre com folga dois minutos de webm/opus do navegador (~1 MB) e barra
// arquivo grande travestido de gravação de comando.
const upload = multer({ dest: config.paths.uploadsDir, limits: { fileSize: 8 * 1024 * 1024 } });

export const assistantRouter = Router();

// Mesmo gate de /api/consultations e /api/prontuarios: o assistente lê
// transcrição e prontuário, então a secretária não entra. Ver ROUTE_ROLES em
// src/lib/roles.ts, que precisa dizer a mesma coisa no front.
assistantRouter.use(requireAuth({ roles: [ROLES.ADMIN, ROLES.DOUTOR] }));

/**
 * Carrega a thread e recusa quem não é o dono.
 *
 * 404 (e não 403) para thread de outra pessoa: responder 403 confirmaria que
 * aquele id existe.
 */
async function carregarThreadDoDono(req, res) {
  const thread = await getThread(req.params.id);
  if (!thread || thread.userId !== req.user.id) {
    res.status(404).json({ error: "conversa não encontrada", code: "THREAD_NAO_ENCONTRADA" });
    return null;
  }
  return thread;
}

assistantRouter.get("/threads", async (req, res) => {
  res.json(await listThreads(req.user.id));
});

assistantRouter.post("/threads", async (req, res) => {
  const thread = await createThread({
    userId: req.user.id,
    titulo: tituloDaPergunta(req.body?.titulo || ""),
  });
  res.status(201).json(thread);
});

assistantRouter.delete("/threads/:id", async (req, res) => {
  const thread = await carregarThreadDoDono(req, res);
  if (!thread) return;
  await deleteThread(thread.id);
  res.json({ ok: true });
});

assistantRouter.get("/threads/:id/messages", async (req, res) => {
  const thread = await carregarThreadDoDono(req, res);
  if (!thread) return;
  res.json(await listMessages(thread.id, {
    before: req.query.before ? String(req.query.before) : undefined,
    limit: req.query.limit,
  }));
});

assistantRouter.get("/usage", async (req, res) => {
  res.json(await getAssistantUsage(req.user.id));
});

/**
 * Um turno: grava a pergunta, roda o laço, grava a resposta.
 *
 * A pergunta é gravada ANTES de chamar o modelo. Se a OpenAI cair no meio, o
 * médico recarrega a página e a pergunta dele continua lá — perder o que a
 * pessoa acabou de digitar é a pior forma de falhar.
 */
assistantRouter.post("/threads/:id/messages", iaLimiter, async (req, res) => {
  const thread = await carregarThreadDoDono(req, res);
  if (!thread) return;

  const texto = String(req.body?.body ?? "").trim();
  if (!texto) return res.status(400).json({ error: "mensagem vazia", code: "PARAMETRO_INVALIDO" });
  const entrada = req.body?.entrada === "voz" ? "voz" : "texto";

  const pergunta = await appendMessage({
    threadId: thread.id, userId: req.user.id, role: "user", body: texto, entrada,
  });

  // Primeira pergunta batiza a conversa, como o ChatGPT faz.
  if (thread.totalMensagens === 0) {
    await patchThread(thread.id, { titulo: tituloDaPergunta(texto) });
  }

  const io = req.app.get("io");
  const ctx = await criarContexto(req);
  const historico = await listMessages(thread.id, { limit: HISTORICO_MAX + 1 });

  const turno = await runAssistantTurn({
    ctx,
    // Sem a própria pergunta: ela entra como a última mensagem do turno.
    historico: historico.filter(m => m.id !== pergunta.id),
    texto,
    // O progresso vai por socket porque um turno com quatro ferramentas leva
    // dezenas de segundos, e tela parada nesse tempo parece travamento.
    onPasso: passo => emitToUsers(io, [req.user.id], "assistant:step", {
      threadId: thread.id, passo,
    }),
  });

  const resposta = await appendMessage({
    threadId: thread.id,
    userId: req.user.id,
    role: "assistant",
    body: turno.reply,
    modelo: turno.modelo,
    passos: turno.passos,
    propostas: turno.propostas,
    usage: turno.usage,
    interrompido: turno.interrompido,
  });

  const atualizada = await patchThread(thread.id, {
    usage: {
      promptTokens: thread.usage.promptTokens + turno.usage.promptTokens,
      completionTokens: thread.usage.completionTokens + turno.usage.completionTokens,
      costUsd: thread.usage.costUsd + turno.usage.costUsd,
      calls: thread.usage.calls + 1,
    },
  });

  // As outras abas do mesmo médico acompanham sem recarregar.
  emitToUsers(io, [req.user.id], "assistant:message", {
    threadId: thread.id, mensagem: resposta, thread: atualizada,
  });

  res.status(201).json({ pergunta, resposta, thread: atualizada });
});

/**
 * Carrega mensagem e proposta, conferindo que pertencem a esta thread.
 *
 * Sem a conferência do threadId, um id de mensagem de outra conversa (do mesmo
 * médico, mas de outro contexto) executaria uma ação que ele não está vendo.
 */
async function carregarProposta(req, res, thread) {
  const mensagem = await getMessage(req.params.msgId);
  if (!mensagem || mensagem.threadId !== thread.id) {
    res.status(404).json({ error: "mensagem não encontrada", code: "MENSAGEM_NAO_ENCONTRADA" });
    return null;
  }
  const proposta = (mensagem.propostas || []).find(p => p.id === req.params.propostaId);
  if (!proposta) {
    res.status(404).json({ error: "ação não encontrada", code: "PROPOSTA_NAO_ENCONTRADA" });
    return null;
  }
  if (proposta.status !== "pendente") {
    res.status(409).json({ error: "esta ação já foi decidida", code: "PROPOSTA_JA_DECIDIDA" });
    return null;
  }
  return { mensagem, proposta };
}

/**
 * Executa a ação que o médico confirmou.
 *
 * O cliente manda apenas os ids e a edição — o payload autoritativo vem do
 * Mongo. É a segunda camada da defesa contra injeção: nem o modelo nem o
 * navegador conseguem trocar o destinatário depois que o card foi desenhado,
 * porque `aplicarEdicao` só aceita os campos que a ferramenta declarou
 * editáveis, e `revalidar` refaz as checagens do zero.
 */
assistantRouter.post("/threads/:id/messages/:msgId/propostas/:propostaId/confirmar", async (req, res) => {
  const thread = await carregarThreadDoDono(req, res);
  if (!thread) return;
  const carregada = await carregarProposta(req, res, thread);
  if (!carregada) return;
  const { mensagem, proposta } = carregada;

  const def = getTool(TOOL_DE_PROPOSTA[proposta.tipo]);
  if (!def?.execute) {
    return res.status(400).json({ error: "esta ação não pode mais ser executada", code: "ACAO_INDISPONIVEL" });
  }

  const payload = aplicarEdicao(proposta, def.editaveis, req.body?.edicao);
  const ctx = await criarContexto(req);

  let resultado = null;
  let erro = "";
  try {
    await def.revalidar(payload, ctx);
    resultado = await def.execute(payload, ctx);
  } catch (err) {
    erro = err.message;
  }

  // A trava é atômica: dois cliques, duas abas ou um retry de rede produzem um
  // efeito só. Perdeu a corrida, avisa em vez de executar de novo.
  const status = erro ? "falhou" : "confirmada";
  const gravou = await marcarProposta(mensagem.id, proposta.id, {
    status,
    payload,
    erro,
    resultado: resultado ? { ...resultado, em: new Date().toISOString() } : null,
  });
  if (!gravou) {
    return res.status(409).json({ error: "esta ação já foi decidida", code: "PROPOSTA_JA_DECIDIDA" });
  }

  // Sem esta linha, a mensagem que o assistente mandou ao paciente sai
  // indistinguível de uma que o médico digitou, e "quem mandou isso?" fica sem
  // resposta.
  registrarAsync(req, ACOES.EXECUTAR_ACAO_IA, {
    tipo: proposta.tipo, propostaId: proposta.id, threadId: thread.id, status,
    refTipo: resultado?.refTipo, refId: resultado?.refId, erro,
  });

  const atualizada = await getMessage(mensagem.id);
  emitToUsers(req.app.get("io"), [req.user.id], "assistant:message", {
    threadId: thread.id, mensagem: atualizada, thread,
  });
  res.json({ mensagem: atualizada });
});

assistantRouter.post("/threads/:id/messages/:msgId/propostas/:propostaId/recusar", async (req, res) => {
  const thread = await carregarThreadDoDono(req, res);
  if (!thread) return;
  const carregada = await carregarProposta(req, res, thread);
  if (!carregada) return;

  const gravou = await marcarProposta(carregada.mensagem.id, carregada.proposta.id, { status: "recusada" });
  if (!gravou) {
    return res.status(409).json({ error: "esta ação já foi decidida", code: "PROPOSTA_JA_DECIDIDA" });
  }
  const atualizada = await getMessage(carregada.mensagem.id);
  emitToUsers(req.app.get("io"), [req.user.id], "assistant:message", {
    threadId: thread.id, mensagem: atualizada, thread,
  });
  res.json({ mensagem: atualizada });
});

/**
 * Transcreve um comando de voz curto.
 *
 * Vai direto no Groq, e não pelo pipeline de lib/transcription/index.js: aquele
 * comprime com ffmpeg, mede a duração e ainda chama a OpenAI para separar
 * falantes — dois a quatro segundos de latência e uma chamada paga a mais, tudo
 * desperdiçado para vinte segundos de uma pessoa só falando.
 *
 * Sempre Groq mesmo quando a clínica escolheu AssemblyAI como provedor das
 * consultas: aqui o que importa é ser rápido. Se só o AssemblyAI estiver
 * configurado, o front esconde o microfone.
 */
assistantRouter.post("/transcribe", iaLimiter, upload.single("file"), async (req, res) => {
  if (!req.file) throw new HttpError(400, "file é obrigatório", "UPLOAD_INVALIDO");
  try {
    const { groqApiKey } = await getTranscriptionSettings();
    if (!groqApiKey) {
      throw new HttpError(
        400,
        "Chave do Groq não configurada em Configurações → Transcrição",
        "SEM_CHAVE_TRANSCRICAO",
      );
    }
    const { segments } = await transcribeWithGroq({ filePath: req.file.path, apiKey: groqApiKey, language: "pt" });
    const texto = segments.map(s => s.text).join(" ").replace(/\s+/g, " ").trim();
    if (!texto) throw new HttpError(422, "Não entendi o áudio", "AUDIO_VAZIO");
    res.json({ texto });
  } finally {
    await fs.unlink(req.file.path).catch(() => {});
  }
});
