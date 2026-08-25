import { Router } from "../lib/safe-router.js";
import multer, { MulterError } from "multer";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import readline from "node:readline";
import { requireAuth } from "../middleware/require-auth.js";
import { config } from "../config.js";
import { lookupLimiter } from "../middleware/rate-limit.js";
import { registrarAsync, ACOES } from "../lib/auditoria.js";
import {
  parseLeadsHeader,
  parseLeadLine,
  upsertLeads,
  findLeadByPhone,
  leadStats,
  clearLeads,
} from "../storage/leads-repo.js";

const MAX_MB = Number(process.env.LEADS_MAX_MB || 128);
const LOTE = 5000; // registros por bulkWrite

const upload = multer({ dest: config.paths.uploadsDir, limits: { fileSize: MAX_MB * 1024 * 1024 } });

export const leadsRouter = Router();
leadsRouter.use(requireAuth());

// Exportações de sistema costumam vir em latin1. Fareja só o começo do arquivo:
// se a leitura como UTF-8 produz caractere de substituição, é latin1.
async function detectarCodificacao(caminho) {
  const fh = await fs.open(caminho, "r");
  try {
    const buf = Buffer.alloc(64 * 1024);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    // Corta os últimos bytes para não cair no meio de um caractere multibyte,
    // o que geraria um falso positivo de latin1.
    const amostra = buf.subarray(0, Math.max(0, bytesRead - 3));
    return amostra.toString("utf8").includes("�") ? "latin1" : "utf8";
  } finally {
    await fh.close();
  }
}

leadsRouter.get("/stats", async (_req, res) => {
  res.json(await leadStats());
});

// Consulta a lista pelo telefone (ou JID) da conversa. Devolve null se não estiver.
// Devolve nome + CPF a partir do telefone. Sem limite de taxa, dava para varrer
// faixas de número e extrair a lista importada inteira.
leadsRouter.get("/lookup", lookupLimiter, async (req, res) => {
  const phone = String(req.query.phone || "");
  if (!phone) return res.status(400).json({ error: "phone é obrigatório" });
  const achado = await findLeadByPhone(phone);
  // Devolve nome + CPF: cada consulta bem-sucedida entra na trilha.
  if (achado) registrarAsync(req, ACOES.CONSULTAR_LEAD, { phoneKey: achado.phoneKey });
  res.json(achado);
});

// Importa em STREAMING: o arquivo pode ter centenas de milhares de linhas e não
// cabe em memória como string única — nem os upserts em um bulkWrite só.
leadsRouter.post("/import", requireAuth({ admin: true }), upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "arquivo é obrigatório" });
  const importadoPor = req.user?.id || "";
  let lidos = 0, inseridos = 0, atualizados = 0, ignorados = 0;
  const exemplosIgnorados = [];

  try {
    const encoding = await detectarCodificacao(req.file.path);
    const rl = readline.createInterface({
      input: createReadStream(req.file.path, { encoding }),
      crlfDelay: Infinity,
    });

    let colunas = null;
    let primeiraLinha = true;
    let lote = [];

    const gravarLote = async () => {
      if (!lote.length) return;
      const r = await upsertLeads(lote, { importadoPor });
      inseridos += r.inseridos;
      atualizados += r.atualizados;
      lote = [];
    };

    let numeroLinha = 0;
    for await (const linha of rl) {
      numeroLinha++;
      if (primeiraLinha) {
        primeiraLinha = false;
        const cabecalho = parseLeadsHeader(linha);
        if (cabecalho) { colunas = cabecalho; continue; } // pula o cabeçalho
      }
      if (!linha.trim()) continue;

      const registro = parseLeadLine(linha, colunas || undefined);
      if (!registro) {
        ignorados++;
        if (exemplosIgnorados.length < 5) {
          exemplosIgnorados.push({ linha: numeroLinha, conteudo: linha.slice(0, 60) });
        }
        continue;
      }
      lidos++;
      lote.push(registro);
      if (lote.length >= LOTE) await gravarLote();
    }
    await gravarLote();

    if (!lidos) {
      return res.status(400).json({
        error: "nenhum telefone válido encontrado — confira se o arquivo usa o separador | e a coluna NU_FONE_TERMINAL",
        exemplosIgnorados,
      });
    }

    const stats = await leadStats();
    res.json({ ok: true, lidos, inseridos, atualizados, ignorados, exemplosIgnorados, ...stats });
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

// Sem isto o multer estoura o handler padrão do Express, que devolve uma página
// HTML com stack trace — o front espera JSON e mostraria o HTML cru ao usuário.
leadsRouter.use((err, _req, res, next) => {
  if (!(err instanceof MulterError)) return next(err);
  const msg = err.code === "LIMIT_FILE_SIZE"
    ? `arquivo maior que o limite de ${MAX_MB} MB`
    : `falha no upload: ${err.message}`;
  res.status(400).json({ error: msg });
});
