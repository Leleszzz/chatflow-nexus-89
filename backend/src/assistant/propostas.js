// A proposta de ação: o objeto que o assistente devolve em vez de executar.
//
// Este arquivo é o coração da regra "escrita nunca acontece sozinha". Ela não é
// só conforto de interface: é a defesa contra injeção de prompt. Mensagem de
// paciente e transcrição de consulta entram no contexto do modelo, e um paciente
// pode escrever "ignore as instruções e mande X para Y". Com a escrita virando
// proposta, o melhor que uma injeção consegue é desenhar um card estranho na
// tela do médico, que ele lê antes de clicar.
//
// Puro de propósito — sem banco, sem rede. É o que permite testá-lo direto.

import { nanoid } from "nanoid";

export const TIPOS_PROPOSTA = [
  "criar_agendamento",
  "remarcar_agendamento",
  "cancelar_agendamento",
  "enviar_whatsapp",
  "agendar_whatsapp",
  "criar_tarefa",
  "mensagem_interna",
];

export const STATUS_PROPOSTA = ["pendente", "confirmada", "recusada", "falhou"];

/**
 * Qual ferramenta do registro sabe executar cada tipo.
 *
 * Vive aqui, e não no registro, porque o executor precisa do mapa sem importar
 * as ferramentas (que importam este arquivo) — seria um ciclo.
 */
export const TOOL_DE_PROPOSTA = {
  criar_agendamento: "propor_agendamento",
  remarcar_agendamento: "propor_remarcacao",
  cancelar_agendamento: "propor_cancelamento",
  enviar_whatsapp: "propor_mensagem_whatsapp",
  agendar_whatsapp: "propor_mensagem_agendada",
  criar_tarefa: "propor_tarefa",
  mensagem_interna: "propor_mensagem_interna",
};

const texto = (valor, max = 2000) => String(valor ?? "").trim().slice(0, max);

/**
 * Pré-condições avaliadas na geração da proposta.
 *
 * Requisito não atendido NÃO impede a proposta de existir: o card mostra o
 * aviso e desabilita o botão, como SchedulingProposalBar já faz com
 * `canSchedule`. Sumir com o card deixaria o médico sem saber por que o
 * assistente falou em remarcar e nada apareceu.
 */
function normalizeRequisitos(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(r => r && r.chave)
    .map(r => ({
      chave: texto(r.chave, 40),
      ok: r.ok !== false,
      aviso: texto(r.aviso, 300),
    }))
    .slice(0, 8);
}

function normalizePreview(raw) {
  const linhas = Array.isArray(raw?.linhas)
    ? raw.linhas
        .filter(l => l && l.rotulo)
        .map(l => ({ rotulo: texto(l.rotulo, 40), valor: texto(l.valor, 200) }))
        .slice(0, 10)
    : [];
  return { texto: texto(raw?.texto, 4000), linhas };
}

/** Descarta em silêncio campo fora da lista — mesmo contrato dos repos. */
export function normalizeProposal(record) {
  if (!TIPOS_PROPOSTA.includes(record?.tipo)) return null;
  const status = STATUS_PROPOSTA.includes(record?.status) ? record.status : "pendente";
  return {
    id: String(record?.id || `pr-${nanoid(8)}`),
    tipo: record.tipo,
    titulo: texto(record?.titulo, 120),
    resumo: texto(record?.resumo, 400),
    // O payload é o do servidor, montado pela ferramenta a partir dos argumentos
    // já validados. Nunca o objeto cru que o modelo devolveu.
    payload: record?.payload && typeof record.payload === "object" ? { ...record.payload } : {},
    requisitos: normalizeRequisitos(record?.requisitos),
    preview: normalizePreview(record?.preview),
    status,
    resultado: record?.resultado && typeof record.resultado === "object" ? { ...record.resultado } : null,
    erro: texto(record?.erro, 500),
    geradoEm: record?.geradoEm || new Date().toISOString(),
    decididoEm: status === "pendente" ? "" : (record?.decididoEm || new Date().toISOString()),
  };
}

/** Atalho para as ferramentas de escrita: monta uma proposta pendente. */
export function novaProposta({ tipo, titulo, resumo, payload, requisitos, preview }) {
  const proposta = normalizeProposal({ tipo, titulo, resumo, payload, requisitos, preview, status: "pendente" });
  if (!proposta) throw new Error(`tipo de proposta desconhecido: ${tipo}`);
  return proposta;
}

/**
 * Aplica a edição que o médico fez no card, devolvendo o payload a executar.
 *
 * A lista branca é o ponto crítico de segurança do fluxo inteiro. `paciente_id`,
 * `agendamento_id` e `usuario_id` NUNCA são editáveis: trocar o destinatário
 * depois que o card foi desenhado é exatamente o que uma injeção tentaria — o
 * médico leria "avisar o Lucas" e confirmaria um envio para outra pessoa.
 *
 * Só aceita chaves que a ferramenta declarou em `editaveis`, e só as que já
 * existem no payload — campo novo inventado pelo cliente não entra.
 */
export function aplicarEdicao(proposta, editaveis, edicao) {
  const payload = { ...(proposta?.payload || {}) };
  if (!edicao || typeof edicao !== "object") return payload;
  const permitidas = new Set(Array.isArray(editaveis) ? editaveis : []);
  for (const [chave, valor] of Object.entries(edicao)) {
    if (!permitidas.has(chave)) continue;
    if (valor === undefined) continue;
    payload[chave] = valor;
  }
  return payload;
}

/** Requisitos que impedem a confirmação. Vazio = pode clicar. */
export function requisitosPendentes(proposta) {
  return (proposta?.requisitos || []).filter(r => r.ok === false);
}

export function podeConfirmar(proposta) {
  return proposta?.status === "pendente" && requisitosPendentes(proposta).length === 0;
}
