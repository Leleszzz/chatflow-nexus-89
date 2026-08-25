import { Router } from "../lib/safe-router.js";
import multer from "multer";
import fs from "node:fs/promises";
import { saveMedia } from "../storage/media-repo.js";
import { getDeal } from "../storage/deals-repo.js";
import { canUserSeeDeal } from "../lib/deal-permissions.js";
import { requireAuth } from "../middleware/require-auth.js";
import { ROLES, isAdmin } from "../lib/roles.js";
import { registrarAsync, ACOES } from "../lib/auditoria.js";
import { config } from "../config.js";
import {
  listProntuarios,
  getProntuario,
  createProntuario,
  updateProntuario,
  deleteProntuario,
  deleteProntuariosByDeal,
} from "../storage/prontuarios-repo.js";

const upload = multer({ dest: config.paths.uploadsDir, limits: { fileSize: 50 * 1024 * 1024 } });

const VALID_CATEGORIES = new Set(["foto", "video", "audio", "documento", "outro"]);

function inferCategoryFromMime(mimeType) {
  const clean = String(mimeType || "").toLowerCase();
  if (clean.startsWith("image/")) return "foto";
  if (clean.startsWith("video/")) return "video";
  if (clean.startsWith("audio/")) return "audio";
  if (clean) return "documento";
  return "outro";
}

// O anexo herda a permissão do card a que pertence: quem não pode ver o lead
// não pode ver, alterar nem apagar os arquivos do prontuário dele.
async function podeAcessarDeal(user, dealId) {
  const deal = await getDeal(dealId);
  // FAIL-CLOSED para anexo órfão. O comentário acima defendia liberar o que
  // aponta para um card que já não existe, para não travar a limpeza — mas isso
  // deixava foto e documento clínico de um paciente excluído legíveis por
  // qualquer usuário. A limpeza continua possível: o admin passa.
  if (!deal) return isAdmin(user);
  return canUserSeeDeal(user, deal);
}

async function assertAcesso(req, res, anexo) {
  if (!anexo) {
    res.status(404).json({ error: "prontuário não encontrado" });
    return false;
  }
  if (!(await podeAcessarDeal(req.user, anexo.dealId))) {
    res.status(403).json({ error: "sem permissão para este prontuário" });
    return false;
  }
  return true;
}

export const prontuariosRouter = Router();

// Prontuário é dado clínico, como a consulta gravada: src/lib/roles.ts já
// mantinha a tela fora do alcance da secretária, mas o backend aceitava
// qualquer usuário logado.
prontuariosRouter.use(requireAuth({ roles: [ROLES.ADMIN, ROLES.DOUTOR] }));

prontuariosRouter.get("/", async (req, res) => {
  try {
    const dealId = req.query.dealId ? String(req.query.dealId) : undefined;
    const items = await listProntuarios({ dealId });
    // Filtro no servidor, como faz GET /api/deals — sem ele a lista sem dealId
    // devolveria os arquivos de todos os clientes para qualquer vendedor.
    const cache = new Map();
    const visiveis = [];
    for (const item of items) {
      if (!cache.has(item.dealId)) cache.set(item.dealId, await podeAcessarDeal(req.user, item.dealId));
      if (cache.get(item.dealId)) visiveis.push(item);
    }
    res.json(visiveis);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

prontuariosRouter.get("/:id", async (req, res) => {
  try {
    const item = await getProntuario(req.params.id);
    if (!(await assertAcesso(req, res, item))) return;
    registrarAsync(req, ACOES.LER_PRONTUARIO, { prontuarioId: item.id, dealId: item.dealId });
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

prontuariosRouter.post("/", async (req, res) => {
  try {
    const body = req.body || {};
    const dealId = String(body.dealId || "").trim();
    const mediaUrl = String(body.mediaUrl || "").trim();
    if (!dealId) return res.status(400).json({ error: "dealId é obrigatório" });
    if (!mediaUrl) return res.status(400).json({ error: "mediaUrl é obrigatório" });
    if (!(await podeAcessarDeal(req.user, dealId))) {
      return res.status(403).json({ error: "sem permissão para este cliente" });
    }

    const category = VALID_CATEGORIES.has(body.category) ? body.category : inferCategoryFromMime(body.mediaMime);

    const record = await createProntuario({
      dealId,
      name: body.name || "Sem nome",
      mediaUrl,
      mediaMime: body.mediaMime,
      category,
      conversationId: body.conversationId,
      messageId: body.messageId,
      instanceId: body.instanceId,
      source: body.source === "upload" ? "upload" : "whatsapp",
      // Quem enviou é quem está autenticado, e não o que o cliente disser.
      uploadedBy: req.user.id,
    });
    res.status(201).json(record);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// requireAuth ANTES do multer: requisição não autenticada não grava arquivo em
// disco. Mesmo motivo do comentário em routes/send.js.
prontuariosRouter.post("/upload", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "file é obrigatório" });
  try {
    const dealId = String(req.body?.dealId || "").trim();
    if (!dealId) return res.status(400).json({ error: "dealId é obrigatório" });
    if (!(await podeAcessarDeal(req.user, dealId))) {
      return res.status(403).json({ error: "sem permissão para este cliente" });
    }

    const name = String(req.body?.name || req.file.originalname || "Sem nome").trim();
    const buffer = await fs.readFile(req.file.path);
    const mimeType = req.file.mimetype || "application/octet-stream";
    const saved = await saveMedia(buffer, mimeType);

    const category = inferCategoryFromMime(saved.mimeType);

    const record = await createProntuario({
      dealId,
      name,
      mediaUrl: saved.url,
      mediaMime: saved.mimeType,
      category,
      fileSize: req.file.size,
      source: "upload",
      uploadedBy: req.user.id,
    });
    res.status(201).json(record);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (req.file) fs.unlink(req.file.path).catch(() => {});
  }
});

prontuariosRouter.patch("/:id", async (req, res) => {
  try {
    const current = await getProntuario(req.params.id);
    if (!(await assertAcesso(req, res, current))) return;

    const patch = {};
    if (typeof req.body?.name === "string") patch.name = req.body.name;
    if (VALID_CATEGORIES.has(req.body?.category)) patch.category = req.body.category;
    if (Object.keys(patch).length === 0) return res.json(current);

    const updated = await updateProntuario(req.params.id, patch);
    if (!updated) return res.status(404).json({ error: "prontuário não encontrado" });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

prontuariosRouter.delete("/:id", async (req, res) => {
  try {
    const current = await getProntuario(req.params.id);
    if (!(await assertAcesso(req, res, current))) return;
    const removed = await deleteProntuario(req.params.id);
    if (!removed) return res.status(404).json({ error: "prontuário não encontrado" });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

prontuariosRouter.delete("/by-deal/:dealId", async (req, res) => {
  try {
    if (!(await podeAcessarDeal(req.user, req.params.dealId))) {
      return res.status(403).json({ error: "sem permissão para este cliente" });
    }
    const count = await deleteProntuariosByDeal(req.params.dealId);
    res.json({ ok: true, removed: count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
