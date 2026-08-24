import { Router } from "express";
import multer from "multer";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { saveMedia, resolveMediaPath } from "../storage/media-repo.js";
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
import { requireAuth } from "../middleware/require-auth.js";
import { emitConsultationEvent } from "../socket/events.js";
import { getTranscriptionSettings, getOpenaiSettings } from "../storage/settings-repo.js";
import { transcribe } from "../lib/transcription/index.js";
import { summarizeConsultation } from "../lib/transcription/summary.js";
import { mergeSuggestions, SUGGESTION_STATUS } from "../lib/transcription/suggestions.js";
import { renderTranscript, buildSpeakers } from "../lib/transcription/render.js";

// 200 MB cobre uma consulta de várias horas gravada em WebM pelo navegador.
const upload = multer({ dest: "data/uploads", limits: { fileSize: 200 * 1024 * 1024 } });

export const consultationsRouter = Router();

/** O usuário pode ver/mexer nesta consulta? Reusa a permissão do card. */
async function assertAcesso(req, res, consultation) {
  if (!consultation) {
    res.status(404).json({ error: "consulta não encontrada" });
    return false;
  }
  const deal = await getDeal(consultation.dealId);
  if (deal && !canUserSeeDeal(req.user, deal)) {
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

consultationsRouter.get("/", requireAuth(), async (req, res) => {
  try {
    const dealId = req.query.dealId ? String(req.query.dealId) : undefined;
    const todas = await listConsultations({ dealId });
    // Filtra pela permissão do card, como faz GET /api/deals.
    const deals = new Map();
    const visiveis = [];
    for (const c of todas) {
      if (!deals.has(c.dealId)) deals.set(c.dealId, await getDeal(c.dealId));
      const deal = deals.get(c.dealId);
      if (!deal || canUserSeeDeal(req.user, deal)) visiveis.push(c);
    }
    res.json(visiveis);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

consultationsRouter.get("/:id", requireAuth(), async (req, res) => {
  try {
    const item = await getConsultation(req.params.id);
    if (!(await assertAcesso(req, res, item))) return;
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// requireAuth ANTES do multer: requisição não autenticada não grava arquivo em
// disco. Mesmo motivo do comentário em routes/send.js.
consultationsRouter.post("/upload", requireAuth(), upload.single("file"), async (req, res) => {
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

    const buffer = await fs.readFile(req.file.path);
    const saved = await saveMedia(buffer, req.file.mimetype || "audio/webm");

    // Espelho no prontuário: o áudio da consulta tem que aparecer junto com os
    // outros anexos do cliente, e não só na tela nova.
    const anexo = await createProntuario({
      dealId,
      name: title,
      mediaUrl: saved.url,
      mediaMime: saved.mimeType,
      category: "audio",
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

consultationsRouter.patch("/:id", requireAuth(), async (req, res) => {
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
consultationsRouter.post("/:id/retry", requireAuth(), async (req, res) => {
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

consultationsRouter.post("/:id/summary", requireAuth(), async (req, res) => {
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
consultationsRouter.patch("/:id/suggestions/:sugestaoId", requireAuth(), async (req, res) => {
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

consultationsRouter.delete("/:id", requireAuth(), async (req, res) => {
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

consultationsRouter.delete("/by-deal/:dealId", requireAuth(), async (req, res) => {
  try {
    const deal = await getDeal(req.params.dealId);
    if (deal && !canUserSeeDeal(req.user, deal)) {
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
