import { Router } from "express";
import multer from "multer";
import fs from "node:fs/promises";
import { requireAuth } from "../middleware/require-auth.js";
import { parseLeadsTxt, upsertLeads, findLeadByPhone, leadStats, clearLeads } from "../storage/leads-repo.js";

const upload = multer({ dest: "data/uploads", limits: { fileSize: 20 * 1024 * 1024 } });

export const leadsRouter = Router();
leadsRouter.use(requireAuth());

// Exportações de sistema costumam vir em latin1. Decodifica como UTF-8 e, se
// aparecer caractere de substituição (acentos quebrados), refaz em latin1.
function decodificar(buffer) {
  const utf8 = buffer.toString("utf8");
  if (!utf8.includes("�")) return utf8;
  return buffer.toString("latin1");
}

leadsRouter.get("/stats", async (_req, res) => {
  res.json(await leadStats());
});

// Consulta a lista pelo telefone (ou JID) da conversa. Devolve null se não estiver.
leadsRouter.get("/lookup", async (req, res) => {
  const phone = String(req.query.phone || "");
  if (!phone) return res.status(400).json({ error: "phone é obrigatório" });
  res.json(await findLeadByPhone(phone));
});

leadsRouter.post("/import", requireAuth({ admin: true }), upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "arquivo é obrigatório" });
  try {
    const texto = decodificar(await fs.readFile(req.file.path));
    const { registros, invalidas } = parseLeadsTxt(texto);
    if (!registros.length) {
      return res.status(400).json({
        error: "nenhum telefone válido encontrado — confira se o arquivo usa o separador | e a coluna NU_FONE_TERMINAL",
        invalidas: invalidas.slice(0, 5),
      });
    }
    const { inseridos, atualizados } = await upsertLeads(registros, { importadoPor: req.user?.id || "" });
    const stats = await leadStats();
    res.json({
      ok: true,
      lidos: registros.length,
      inseridos,
      atualizados,
      ignorados: invalidas.length,
      exemplosIgnorados: invalidas.slice(0, 5),
      ...stats,
    });
  } catch (err) {
    console.error("[leads:import] falhou:", err);
    res.status(500).json({ error: err.message });
  } finally {
    fs.unlink(req.file.path).catch(() => {});
  }
});

leadsRouter.delete("/", requireAuth({ admin: true }), async (_req, res) => {
  const removidos = await clearLeads();
  res.json({ ok: true, removidos });
});
