import { Router } from "../lib/safe-router.js";
import multer from "multer";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { config } from "../config.js";
import { saveMedia, resolveMediaPath, MAX_MEDIA_BYTES } from "../storage/media-repo.js";
import { mimeDeUpload } from "../lib/media-safety.js";
import {
  listConsultations,
  getConsultation,
  createConsultation,
  patchConsultation,
  deleteConsultation,
  deleteConsultationsByDeal,
} from "../storage/consultations-repo.js";
import { createProntuario, deleteProntuario } from "../storage/prontuarios-repo.js";
import { getDeal } from "../storage/deals-repo.js";
import { canUserSeeDeal } from "../lib/deal-permissions.js";
import { isAdmin } from "../lib/roles.js";
import { registrarAsync, ACOES } from "../lib/auditoria.js";
import { requireAuth } from "../middleware/require-auth.js";
import { ROLES } from "../lib/roles.js";
import { emitConsultationEvent } from "../socket/events.js";
import { getTranscriptionSettings, getOpenaiSettings } from "../storage/settings-repo.js";
import { transcribe } from "../lib/transcription/index.js";
import { summarizeConsultation } from "../lib/transcription/summary.js";
import { mergeSuggestions, SUGGESTION_STATUS } from "../lib/transcription/suggestions.js";
import { renderTranscript, buildSpeakers } from "../lib/transcription/render.js";

// Caminho ABSOLUTO: "data/uploads" é relativo ao diretório de onde o processo
// foi iniciado, então iniciar o servidor de outro lugar espalhava temporários.
//
// O teto é o MESMO de saveMedia. Antes o multer aceitava 200 MB e o
// `saveMedia` recusava acima de 100 MB: o upload subia inteiro, demorava, e só
// então falhava — o pior dos dois mundos. Agora quem estoura é barrado no
// começo, com a mensagem certa.
const upload = multer({ dest: config.paths.uploadsDir, limits: { fileSize: MAX_MEDIA_BYTES } });

export const consultationsRouter = Router();

// Transcrição de consulta é DADO CLÍNICO. src/lib/roles.ts já mantinha a tela
// /consultas fora do alcance da secretária, com comentário explicando o porquê
// — mas o backend só exigia "estar logado", e canUserSeeDeal devolve `true`
// para secretária em todos os cards. Ou seja: um GET /api/consultations
// autenticado como secretária devolvia TODAS as transcrições da clínica. O
// bloqueio existia só na interface; agora existe aqui, que é onde vale.
const exigeAcessoClinico = requireAuth({ roles: [ROLES.ADMIN, ROLES.DOUTOR] });
consultationsRouter.use(exigeAcessoClinico);

/** O usuário pode ver/mexer nesta consulta? Reusa a permissão do card. */
async function assertAcesso(req, res, consultation) {
  if (!consultation) {
    res.status(404).json({ error: "consulta não encontrada" });
    return false;
  }
  const deal = await getDeal(consultation.dealId);
  // FAIL-CLOSED. Antes era `if (deal && !canUserSeeDeal(...))`: com o card
  // excluído, `deal` vinha null e a checagem inteira era pulada — qualquer
  // usuário lia, editava e apagava a consulta órfã, transcrição clínica
  // incluída. Sem card para ancorar a permissão, só o admin passa.
  if (!deal) {
    if (!isAdmin(req.user)) {
      res.status(403).json({ error: "consulta sem cliente vinculado — acesso restrito a administradores" });
      return false;
    }
    return true;
  }
  if (!canUserSeeDeal(req.user, deal)) {
    res.status(403).json({ error: "sem permissão para esta consulta" });
    return false;
  }
  return true;
}

/**
 * Transcreve em segundo plano e vai avisando o cliente por socket.
 *
 * Roda destacado do request de propósito: uma consulta de 40 min leva de
 * segundos (Groq) a minutos (AssemblyAI), e o médico não pode ficar com a tela
 * presa esperando. Qualquer falha vira `status: "erro"` com a mensagem — o
 * áudio já está salvo, então dá para tentar de novo sem regravar nada.
 */
async function processConsultation(io, consultationId, sourcePath) {
  try {
    const [transcription, openai, anterior] = await Promise.all([
      getTranscriptionSettings(),
      getOpenaiSettings(),
      getConsultation(consultationId),
    ]);

    const result = await transcribe({
      filePath: sourcePath,
      provider: transcription.provider,
      settings: transcription,
      openaiApiKey: openai.apiKey,
    });

    const speakers = buildSpeakers(result.segments);
    const transcriptText = renderTranscript(result.segments, speakers);

    const patch = {
      status: "pronto",
      error: "",
      provider: result.provider,
      language: result.language,
      durationSec: result.durationSec,
      segments: result.segments,
      speakers,
      transcriptText,
    };

    if (transcription.autoSummary && openai.apiKey) {
      try {
        const gerado = await summarizeConsultation({
          transcriptText,
          recordedAt: anterior?.recordedAt,
          apiKey: openai.apiKey,
        });
        patch.summary = gerado.summary;
        // Reprocessar não pode desfazer o que o médico já executou: as sugestões
        // concluídas atravessam o retry.
        patch.suggestions = mergeSuggestions(gerado.suggestions, anterior?.suggestions);
      } catch (err) {
        // Resumo é acessório: a transcrição é o produto, e perdê-la porque o
        // resumo falhou seria um mau negócio. Fica sem resumo e segue.
        console.warn(`[consultations] resumo falhou (${consultationId}): ${err.message}`);
      }
    }

    const updated = await patchConsultation(consultationId, patch);
    emitConsultationEvent(io, "consultation:update", updated);
  } catch (err) {
    console.error(`[consultations] falha ao processar ${consultationId}:`, err.message);
    const updated = await patchConsultation(consultationId, {
      status: "erro",
      error: err.message,
    }).catch(() => null);
    if (updated) emitConsultationEvent(io, "consultation:update", updated);
  } finally {
    await fs.unlink(sourcePath).catch(() => {});
  }
}

consultationsRouter.get("/", async (req, res) => {
  try {
    const dealId = req.query.dealId ? String(req.query.dealId) : undefined;
    const todas = await listConsultations({ dealId });
    // Filtra pela permissão do card, como faz GET /api/deals.
    const deals = new Map();
    const visiveis = [];
    for (const c of todas) {
      if (!deals.has(c.dealId)) deals.set(c.dealId, await getDeal(c.dealId));
      const deal = deals.get(c.dealId);
      // Órfã (card excluído) só aparece para admin — antes `!deal` incluía a
      // consulta na lista de qualquer usuário.
      if (deal ? canUserSeeDeal(req.user, deal) : isAdmin(req.user)) visiveis.push(c);
    }
    res.json(visiveis);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

consultationsRouter.get("/:id", async (req, res) => {
  try {
    const item = await getConsultation(req.params.id);
    if (!(await assertAcesso(req, res, item))) return;
    // Transcricao de consulta e o dado mais sensivel do sistema: cada leitura
    // fica registrada.
    registrarAsync(req, ACOES.LER_CONSULTA, { consultaId: item.id, dealId: item.dealId });
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// requireAuth ANTES do multer: requisição não autenticada não grava arquivo em
// disco. Mesmo motivo do comentário em routes/send.js.
consultationsRouter.post("/upload", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "file é obrigatório" });
  let responded = false;
  try {
    const dealId = String(req.body?.dealId || "").trim();
    if (!dealId) return res.status(400).json({ error: "dealId é obrigatório" });

    const deal = await getDeal(dealId);
    if (!deal) return res.status(404).json({ error: "cliente não encontrado" });
    if (!canUserSeeDeal(req.user, deal)) return res.status(403).json({ error: "sem permissão para este cliente" });

    const title = String(req.body?.title || "Consulta").trim() || "Consulta";
    const recordedAt = req.body?.recordedAt || new Date().toISOString();
    const durationSec = Number(req.body?.durationSec) || 0;

    // Gravação do navegador sempre manda o mime; arquivo importado de celular
    // ou do Windows às vezes vem sem nenhum, ou como octet-stream — aí vale a
    // extensão do nome. Sem isso o arquivo virava .bin e não tocava na tela.
    const mime = mimeDeUpload(req.file.mimetype, req.file.originalname) || "audio/webm";
    const buffer = await fs.readFile(req.file.path);
    const saved = await saveMedia(buffer, mime);

    // Espelho no prontuário: o áudio da consulta tem que aparecer junto com os
    // outros anexos do cliente, e não só na tela nova. A categoria vem do mime
    // porque uma consulta importada pode ser um vídeo — rotular tudo de "audio"
    // deixaria o prontuário mentindo sobre o que é o anexo.
    const anexo = await createProntuario({
      dealId,
      name: title,
      mediaUrl: saved.url,
      mediaMime: saved.mimeType,
      category: saved.mimeType.startsWith("video/") ? "video" : "audio",
      fileSize: req.file.size,
      source: "upload",
      uploadedBy: req.user.id,
    });

    const consulta = await createConsultation({
      dealId,
      title,
      recordedAt,
      durationSec,
      audioUrl: saved.url,
      audioMime: saved.mimeType,
      fileSize: req.file.size,
      prontuarioId: anexo.id,
      status: "processando",
      createdBy: req.user.id,
    });

    const io = req.app.get("io");
    emitConsultationEvent(io, "consultation:update", consulta);
    res.status(201).json(consulta);
    responded = true;

    // Só depois de responder. O arquivo temporário é apagado lá dentro.
    processConsultation(io, consulta.id, req.file.path);
  } catch (err) {
    if (!responded) res.status(500).json({ error: err.message });
    await fs.unlink(req.file.path).catch(() => {});
  }
});

consultationsRouter.patch("/:id", async (req, res) => {
  try {
    const atual = await getConsultation(req.params.id);
    if (!(await assertAcesso(req, res, atual))) return;

    const patch = {};
    if (typeof req.body?.title === "string") patch.title = req.body.title;
    if (Array.isArray(req.body?.speakers)) patch.speakers = req.body.speakers;
    if (Array.isArray(req.body?.segments)) patch.segments = req.body.segments;
    if (typeof req.body?.transcriptText === "string") {
      patch.transcriptText = req.body.transcriptText;
      patch.edited = true;
    }
    if (!Object.keys(patch).length) return res.json(atual);

    const updated = await patchConsultation(req.params.id, patch);
    emitConsultationEvent(req.app.get("io"), "consultation:update", updated);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reprocessa a partir do áudio já salvo — não exige regravar a consulta.
consultationsRouter.post("/:id/retry", async (req, res) => {
  try {
    const atual = await getConsultation(req.params.id);
    if (!(await assertAcesso(req, res, atual))) return;

    const filename = String(atual.audioUrl || "").split("/").pop();
    const audioPath = resolveMediaPath(filename);
    try {
      await fs.access(audioPath);
    } catch {
      return res.status(410).json({ error: "o arquivo de áudio desta consulta não está mais no servidor" });
    }

    const updated = await patchConsultation(req.params.id, { status: "processando", error: "" });
    const io = req.app.get("io");
    emitConsultationEvent(io, "consultation:update", updated);
    res.json(updated);

    // Cópia temporária: processConsultation apaga o arquivo que recebe no fim, e
    // ele não pode levar junto o áudio definitivo da consulta. A cópia vai para
    // o tmpdir do sistema, e não para data/media — o que nasce lá é servido
    // publicamente por /api/media enquanto existir.
    const tmpPath = path.join(os.tmpdir(), `consulta-retry-${req.params.id}-${Date.now()}`);
    await fs.copyFile(audioPath, tmpPath);
    processConsultation(io, req.params.id, tmpPath);
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

consultationsRouter.post("/:id/summary", async (req, res) => {
  try {
    const atual = await getConsultation(req.params.id);
    if (!(await assertAcesso(req, res, atual))) return;
    if (!atual.transcriptText) return res.status(400).json({ error: "esta consulta ainda não tem transcrição" });

    const { apiKey } = await getOpenaiSettings();
    if (!apiKey) return res.status(400).json({ error: "OpenAI key não configurada" });

    const { summary, suggestions } = await summarizeConsultation({
      transcriptText: atual.transcriptText,
      recordedAt: atual.recordedAt,
      apiKey,
    });
    const updated = await patchConsultation(req.params.id, {
      summary,
      suggestions: mergeSuggestions(suggestions, atual.suggestions),
    });
    emitConsultationEvent(req.app.get("io"), "consultation:update", updated);
    res.json(updated);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Marca uma sugestão como executada ou dispensada. Endpoint próprio, e não o
// array inteiro no PATCH /:id, para que dois cliques seguidos (ou duas abas) não
// se sobrescrevam.
consultationsRouter.patch("/:id/suggestions/:sugestaoId", async (req, res) => {
  try {
    const atual = await getConsultation(req.params.id);
    if (!(await assertAcesso(req, res, atual))) return;

    const status = String(req.body?.status || "");
    if (!SUGGESTION_STATUS.has(status)) {
      return res.status(400).json({ error: "status inválido (use pendente, feito ou dispensado)" });
    }

    const suggestions = (atual.suggestions || []).map(s => (
      s.id === req.params.sugestaoId
        ? { ...s, status, concluidoEm: status === "pendente" ? undefined : new Date().toISOString() }
        : s
    ));
    if (!suggestions.some(s => s.id === req.params.sugestaoId)) {
      return res.status(404).json({ error: "sugestão não encontrada" });
    }

    const updated = await patchConsultation(req.params.id, { suggestions });
    emitConsultationEvent(req.app.get("io"), "consultation:update", updated);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

consultationsRouter.delete("/:id", async (req, res) => {
  try {
    const atual = await getConsultation(req.params.id);
    if (!(await assertAcesso(req, res, atual))) return;

    await deleteConsultation(req.params.id);
    if (atual.prontuarioId) await deleteProntuario(atual.prontuarioId).catch(() => {});
    emitConsultationEvent(req.app.get("io"), "consultation:delete", atual);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

consultationsRouter.delete("/by-deal/:dealId", async (req, res) => {
  try {
    const deal = await getDeal(req.params.dealId);
    if (deal ? !canUserSeeDeal(req.user, deal) : !isAdmin(req.user)) {
      return res.status(403).json({ error: "sem permissão para este cliente" });
    }
    const removidas = await deleteConsultationsByDeal(req.params.dealId);
    await Promise.all(
      removidas.filter(c => c.prontuarioId).map(c => deleteProntuario(c.prontuarioId).catch(() => {})),
    );
    res.json({ ok: true, removed: removidas.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
