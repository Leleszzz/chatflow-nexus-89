import { nanoid } from "nanoid";

/**
 * Registro dos tipos de sugestão que a IA pode propor depois de resumir a
 * consulta.
 *
 * É de propósito um registro, e não uma cadeia de `if`: o trecho do prompt que
 * ensina a IA e a validação do que ela devolveu saem os dois daqui. Acrescentar
 * uma ação nova é acrescentar uma entrada neste objeto (e a irmã dela em
 * src/lib/consultation-actions.ts, que decide como o botão aparece).
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_ITENS = 20;
const MAX_TEXTO = 1200;

const VALID_STATUS = new Set(["pendente", "feito", "dispensado"]);

const texto = (valor, max = MAX_TEXTO) => String(valor ?? "").trim().slice(0, max);

/** Limpa a lista de exames: sem vazios, sem repetido (ignorando caixa), com teto. */
function listaDeItens(raw) {
  if (!Array.isArray(raw)) return [];
  const vistos = new Set();
  const saida = [];
  for (const item of raw) {
    const limpo = texto(item, 120);
    if (!limpo) continue;
    const chave = limpo.toLowerCase();
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    saida.push(limpo);
    if (saida.length >= MAX_ITENS) break;
  }
  return saida;
}

export const SUGGESTION_TYPES = {
  agendar_retorno: {
    rotulo: "Agendar retorno",
    instrucao:
      '"agendar_retorno" — ficou combinado um retorno, uma remarcação ou uma nova consulta. ' +
      'payload: {"data":"AAAA-MM-DD","hora":"HH:MM","motivo":"por que o retorno foi pedido"}. ' +
      'Preencha "data" e "hora" APENAS com o que foi dito em voz alta (resolvendo "daqui 15 dias" e ' +
      '"na próxima terça" a partir da data da consulta). Se não foi dito, devolva string vazia — ' +
      "não chute.",
    normalize(payload) {
      return {
        data: ISO_DATE.test(String(payload?.data || "")) ? String(payload.data) : "",
        hora: HHMM.test(String(payload?.hora || "")) ? String(payload.hora) : "",
        motivo: texto(payload?.motivo, 200),
      };
    },
    // Um retorno combinado sem data ainda vale o botão — o médico escolhe a data
    // no diálogo. É o único tipo que sobrevive com o payload vazio.
    vazio: () => false,
  },

  exames: {
    rotulo: "Solicitar exames",
    instrucao:
      '"exames" — o profissional pediu exames, laboratoriais ou de imagem. ' +
      'payload: {"itens":["nome do exame", "..."]}. Um exame por item, com o nome como foi dito.',
    normalize(payload) {
      return { itens: listaDeItens(payload?.itens) };
    },
    vazio: p => p.itens.length === 0,
  },

  confirmacao: {
    rotulo: "Confirmar pelo WhatsApp",
    instrucao:
      '"confirmacao" — vale a pena mandar ao paciente uma confirmação curta do que ficou combinado. ' +
      'payload: {"texto":"mensagem pronta para enviar, em 2ª pessoa, tratando o paciente por você"}.',
    normalize(payload) {
      return { texto: texto(payload?.texto) };
    },
    vazio: p => !p.texto,
  },

  orientacoes: {
    rotulo: "Enviar orientações",
    instrucao:
      '"orientacoes" — houve orientações de cuidado, uso de medicação ou preparo que o paciente ' +
      "precisa levar para casa. " +
      'payload: {"texto":"as orientações em linguagem simples, sem jargão, em tópicos curtos"}. ' +
      "Não invente dose nem medicamento que não foi dito.",
    normalize(payload) {
      return { texto: texto(payload?.texto) };
    },
    vazio: p => !p.texto,
  },
};

/** A seção do prompt que ensina os tipos — derivada do registro, nunca escrita à mão. */
export function buildSuggestionsPrompt() {
  const tipos = Object.entries(SUGGESTION_TYPES)
    .map(([tipo, def]) => `- ${def.instrucao.startsWith(`"${tipo}"`) ? def.instrucao : `"${tipo}" — ${def.instrucao}`}`)
    .join("\n");

  return `Além do resumo, liste em "acoes" o que o profissional pode fazer AGORA por causa desta consulta.
Cada item de "acoes" é {"tipo":"...","payload":{...}}, com um destes tipos:
${tipos}

Regras das ações:
- Proponha uma ação SOMENTE se ela foi combinada ou pedida em voz alta na consulta. Nada de ação "por precaução".
- No máximo uma ação de cada tipo.
- Se nada foi combinado, devolva "acoes": [].`;
}

/**
 * Valida o que a IA devolveu (ou o que já estava gravado) contra o registro.
 * Tipo desconhecido e payload vazio saem em silêncio — botão que não faz nada é
 * pior do que botão nenhum. `status`, `id` e `concluidoEm` são preservados
 * quando já existem, para que um patch de falantes não rebaixe para pendente uma
 * sugestão que o médico já executou.
 */
export function normalizeSuggestions(raw) {
  if (!Array.isArray(raw)) return [];
  const saida = [];
  const tiposUsados = new Set();

  for (const item of raw) {
    const tipo = String(item?.tipo || "");
    const def = SUGGESTION_TYPES[tipo];
    if (!def || tiposUsados.has(tipo)) continue;

    const payload = def.normalize(item?.payload || {});
    if (def.vazio(payload)) continue;

    tiposUsados.add(tipo);
    saida.push({
      id: item?.id ? String(item.id) : `sg-${nanoid(8)}`,
      tipo,
      titulo: def.rotulo,
      payload,
      status: VALID_STATUS.has(item?.status) ? item.status : "pendente",
      geradoEm: item?.geradoEm || new Date().toISOString(),
      concluidoEm: item?.concluidoEm || undefined,
    });
  }
  return saida;
}

/**
 * Funde as sugestões recém-geradas com as anteriores, ao regerar o resumo.
 *
 * O que o médico já executou (`feito`) fica — apagar o registro de um retorno já
 * agendado faria o botão reaparecer e ele agendaria duas vezes. Pendentes e
 * dispensadas são substituídas pela leitura nova da transcrição.
 */
export function mergeSuggestions(novas, anteriores) {
  const feitas = normalizeSuggestions(anteriores).filter(s => s.status === "feito");
  const tiposFeitos = new Set(feitas.map(s => s.tipo));
  return [...feitas, ...normalizeSuggestions(novas).filter(s => !tiposFeitos.has(s.tipo))];
}

export const SUGGESTION_STATUS = VALID_STATUS;
