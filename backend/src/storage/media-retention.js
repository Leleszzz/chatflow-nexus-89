import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { getCol, collections } from "./mongo.js";

/**
 * Limpeza de mídia órfã.
 *
 * `data/media` só crescia: nada apagava arquivo nenhum, nunca. Cada anexo
 * recebido, cada áudio de consulta e cada mídia ENVIADA (que é gravada aqui
 * além de ir para o WhatsApp) ficava para sempre. Na base atual isso já eram
 * 683 MB em 1.412 arquivos; num consultório em operação, o disco enche e o
 * servidor para — sem aviso, porque ninguém monitora espaço até faltar.
 *
 * O que é apagado: arquivo antigo que NENHUM registro referencia mais. Mídia de
 * mensagem, prontuário e consulta é preservada enquanto o registro existir,
 * independentemente da idade — apagá-la seria perder o histórico do paciente.
 *
 * Roda com passo lento e teto por rodada: é faxina, não urgência.
 */

// Idade mínima para um arquivo órfão ser considerado lixo. A folga existe para
// não apagar algo que acabou de ser gravado e cujo registro ainda está sendo
// criado (upload em duas etapas: salva o arquivo, depois grava o documento).
const IDADE_MINIMA_HORAS = Number(process.env.MEDIA_ORFA_HORAS || 48);
const MAX_POR_RODADA = Number(process.env.MEDIA_LIMPEZA_MAX || 500);
const INTERVALO_MS = Number(process.env.MEDIA_LIMPEZA_INTERVALO_MS || 6 * 60 * 60 * 1000);

// Apagar arquivo é irreversível, então a exclusão é OPT-IN: por padrão o job
// só RELATA o que removeria. Confira o log por uma ou duas rodadas e, quando
// os números fizerem sentido, ligue MEDIA_LIMPEZA_ATIVA=true no .env.
const EXCLUSAO_ATIVA = process.env.MEDIA_LIMPEZA_ATIVA === "true";

let timer = null;
let rodando = false;

/** Nomes de arquivo referenciados por algum registro vivo. */
async function referenciados() {
  const usados = new Set();
  const anotar = url => {
    const nome = String(url || "").split("/").pop();
    if (nome) usados.add(nome);
  };

  const fontes = [
    [collections.messages, { mediaUrl: 1 }, d => anotar(d.mediaUrl)],
    [collections.prontuarios, { mediaUrl: 1 }, d => anotar(d.mediaUrl)],
    [collections.consultations, { audioUrl: 1 }, d => anotar(d.audioUrl)],
    [collections.conversations, { avatarUrl: 1 }, d => anotar(d.avatarUrl)],
  ];

  for (const [nomeCol, projecao, coletar] of fontes) {
    // Cursor em vez de toArray: a coleção de mensagens é a maior do sistema e
    // materializá-la para uma faxina seria trocar um problema por outro.
    const cursor = getCol(nomeCol).find(
      {},
      { projection: { _id: 0, ...projecao } },
    ).batchSize(2000);
    for await (const doc of cursor) coletar(doc);
  }
  return usados;
}

/** Uma rodada de limpeza. Devolve o que foi apagado. */
export async function limparMediaOrfa({ dryRun = false } = {}) {
  const dir = config.paths.mediaDir;
  let arquivos;
  try {
    arquivos = await fs.readdir(dir);
  } catch (err) {
    if (err.code === "ENOENT") return { apagados: 0, bytes: 0, examinados: 0 };
    throw err;
  }

  const usados = await referenciados();
  const corte = Date.now() - IDADE_MINIMA_HORAS * 3600 * 1000;
  let apagados = 0;
  let bytes = 0;

  for (const nome of arquivos) {
    if (apagados >= MAX_POR_RODADA) break;
    if (usados.has(nome)) continue;

    const caminho = path.join(dir, nome);
    try {
      const st = await fs.stat(caminho);
      if (!st.isFile()) continue;
      // mtime, e não ctime: no Windows o ctime muda por motivos que não têm a
      // ver com a idade real do conteúdo.
      if (st.mtimeMs > corte) continue;

      if (!dryRun) await fs.unlink(caminho);
      apagados += 1;
      bytes += st.size;
    } catch (err) {
      if (err.code !== "ENOENT") console.warn(`[media-retention] ${nome}: ${err.message}`);
    }
  }

  if (apagados) {
    const mb = (bytes / 1048576).toFixed(1);
    console.log(`[media-retention] ${dryRun ? "(simulação) " : ""}${apagados} arquivo(s) órfão(s), ${mb} MB`);
  }
  return { apagados, bytes, examinados: arquivos.length };
}

/** Limpa temporários de upload que ficaram para trás (crash no meio da rota). */
export async function limparUploadsAbandonados() {
  const dir = config.paths.uploadsDir;
  const corte = Date.now() - 6 * 3600 * 1000;
  let apagados = 0;
  try {
    for (const nome of await fs.readdir(dir)) {
      const caminho = path.join(dir, nome);
      try {
        const st = await fs.stat(caminho);
        if (st.isFile() && st.mtimeMs < corte) {
          await fs.unlink(caminho);
          apagados += 1;
        }
      } catch { /* já sumiu */ }
    }
  } catch (err) {
    if (err.code !== "ENOENT") console.warn(`[media-retention] uploads: ${err.message}`);
  }
  if (apagados) console.log(`[media-retention] ${apagados} temporário(s) de upload removido(s)`);
  return apagados;
}

async function rodada() {
  if (rodando) return;
  rodando = true;
  try {
    // Temporário de upload abandonado nunca é dado do paciente — some sempre.
    await limparUploadsAbandonados();
    const r = await limparMediaOrfa({ dryRun: !EXCLUSAO_ATIVA });
    if (!EXCLUSAO_ATIVA && r.apagados) {
      console.log(
        `[media-retention] ${r.apagados} arquivo(s) órfão(s) ocupando ` +
        `${(r.bytes / 1048576).toFixed(1)} MB. Nada foi apagado: ligue ` +
        "MEDIA_LIMPEZA_ATIVA=true no .env quando quiser liberar o espaço.",
      );
    }
  } catch (err) {
    console.error("[media-retention] rodada falhou:", err.message);
  } finally {
    rodando = false;
  }
}

export function startMediaRetention() {
  if (timer) return;
  timer = setInterval(() => { rodada().catch(() => {}); }, INTERVALO_MS);
  timer.unref?.();
  // Primeira faxina alguns minutos após o boot, para não competir com a
  // restauração das conexões de WhatsApp.
  const inicial = setTimeout(() => { rodada().catch(() => {}); }, 5 * 60 * 1000);
  inicial.unref?.();
}

export function stopMediaRetention() {
  if (timer) clearInterval(timer);
  timer = null;
}
