// Validação dos argumentos que o modelo manda nas tool calls.
//
// O modelo erra formato com frequência — manda "28/08/2026" onde o schema pede
// "2026-08-28", ou inventa um campo. Cada função aqui devolve o valor coagido ou
// lança AssistantToolError, que o loop entrega de volta ao modelo como resultado
// da ferramenta. Ele corrige e chama de novo; o turno não cai.
//
// A mensagem de erro é escrita PARA O MODELO ler: diz o formato esperado, não só
// que o valor é inválido.
//
// Pura: sem banco, sem rede.

import { AssistantToolError } from "./erros.js";

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Aceita o formato certo e as duas trocas que o modelo mais faz. */
export function exigirData(valor, campo = "data") {
  const bruto = String(valor ?? "").trim();
  if (DATA.test(bruto)) {
    // Formato certo não garante data real: "2026-02-31" passa no regex.
    const d = new Date(`${bruto}T12:00:00Z`);
    if (Number.isNaN(d.getTime())) {
      throw new AssistantToolError(`${campo} não é uma data real: ${bruto}`, "DATA_INVALIDA");
    }
    const volta = d.toISOString().slice(0, 10);
    if (volta !== bruto) {
      throw new AssistantToolError(`${campo} não existe no calendário: ${bruto}`, "DATA_INVALIDA");
    }
    return bruto;
  }
  const br = bruto.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return exigirData(`${br[3]}-${br[2]}-${br[1]}`, campo);
  throw new AssistantToolError(
    `${campo} precisa estar no formato AAAA-MM-DD (recebi "${bruto}")`,
    "DATA_INVALIDA",
  );
}

export function exigirHora(valor, campo = "hora") {
  const bruto = String(valor ?? "").trim();
  if (HORA.test(bruto)) return bruto;
  // "9:00" e "9h" são o que sai de uma fala transcrita.
  const solta = bruto.match(/^(\d{1,2})(?:[:h](\d{2}))?h?$/);
  if (solta) {
    const h = Number(solta[1]);
    const min = solta[2] ? Number(solta[2]) : 0;
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) {
      return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
    }
  }
  throw new AssistantToolError(
    `${campo} precisa estar no formato HH:MM em 24 horas (recebi "${bruto}")`,
    "HORA_INVALIDA",
  );
}

export function exigirTexto(valor, campo, max = 2000) {
  const bruto = String(valor ?? "").trim();
  if (!bruto) throw new AssistantToolError(`${campo} é obrigatório`, "PARAMETRO_FALTANDO");
  return bruto.slice(0, max);
}

export function opcionalTexto(valor, max = 2000) {
  return String(valor ?? "").trim().slice(0, max);
}

export function exigirId(valor, campo) {
  const bruto = String(valor ?? "").trim();
  if (!bruto) throw new AssistantToolError(`${campo} é obrigatório`, "PARAMETRO_FALTANDO");
  return bruto;
}

export function inteiro(valor, { padrao, min = 1, max = 100 } = {}) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return padrao;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

/**
 * Intervalo fechado de datas, com teto.
 *
 * O teto não é burocracia: "me mostre a agenda do ano" carregaria centenas de
 * compromissos para dentro do prompt, custaria caro e produziria uma resposta
 * que ninguém lê. Melhor recusar e o modelo pedir um recorte.
 */
export function intervaloDeDatas(inicio, fim, { maxDias = 31 } = {}) {
  const de = exigirData(inicio, "inicio");
  const ate = exigirData(fim, "fim");
  if (ate < de) throw new AssistantToolError("fim é anterior a inicio", "INTERVALO_INVALIDO");
  const dias = Math.round(
    (Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86400000,
  ) + 1;
  if (dias > maxDias) {
    throw new AssistantToolError(
      `o intervalo tem ${dias} dias e o máximo é ${maxDias} — peça um período menor`,
      "INTERVALO_LONGO",
    );
  }
  return { inicio: de, fim: ate, dias };
}

/** Soma dias a uma chave AAAA-MM-DD sem passar por fuso. */
export function somarDias(dataKey, dias) {
  const base = Date.parse(`${exigirData(dataKey)}T12:00:00Z`);
  return new Date(base + dias * 86400000).toISOString().slice(0, 10);
}
