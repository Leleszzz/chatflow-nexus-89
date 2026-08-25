// Motor das mensagens rápidas: troca {{variavel}} pelos dados da conversa
// (vindos do WhatsApp) e da lista de leads importada.
//
// Em JS puro (tipos via JSDoc) de propósito: assim o front e os testes do
// backend importam EXATAMENTE este arquivo, sem duplicar a lógica.

/**
 * @typedef {Object} TemplateContext
 * @property {string} [nome]           Nome do lead no CRM (customer)
 * @property {string} [nomeWhatsapp]   Nome do perfil do WhatsApp (pushName)
 * @property {string} [telefone]       Telefone formatado da conversa
 * @property {string} [listaNome]      Nome vindo do TXT importado
 * @property {string} [listaCpf]       CPF/documento vindo do TXT importado
 * @property {string} [listaTelefone]  Telefone como está no TXT importado
 * @property {string} [atendente]      Nome do usuário logado
 */

/**
 * @typedef {Object} TemplateVariable
 * @property {string} chave
 * @property {string} descricao
 * @property {"WhatsApp"|"Lista importada"|"Outros"} grupo
 */

/** Ordem importa: é a ordem em que aparecem na ajuda da interface. @type {TemplateVariable[]} */
export const TEMPLATE_VARIABLES = [
  { chave: "nome", descricao: "Nome do lead no CRM", grupo: "WhatsApp" },
  { chave: "primeiro_nome", descricao: "Só o primeiro nome do lead", grupo: "WhatsApp" },
  { chave: "nome_whatsapp", descricao: "Nome do perfil do WhatsApp", grupo: "WhatsApp" },
  { chave: "telefone", descricao: "Telefone da conversa", grupo: "WhatsApp" },
  { chave: "lista.nome", descricao: "Nome que veio no TXT importado", grupo: "Lista importada" },
  { chave: "lista.primeiro_nome", descricao: "Só o primeiro nome, do TXT", grupo: "Lista importada" },
  { chave: "lista.cpf", descricao: "CPF do TXT (formatado)", grupo: "Lista importada" },
  { chave: "lista.telefone", descricao: "Telefone como está no TXT", grupo: "Lista importada" },
  { chave: "saudacao", descricao: "Bom dia / Boa tarde / Boa noite (pelo horário)", grupo: "Outros" },
  { chave: "atendente", descricao: "Seu nome (usuário logado)", grupo: "Outros" },
];

const primeiroNome = nome => String(nome || "").trim().split(/\s+/)[0] || "";

const formatarCpf = doc => {
  const d = String(doc || "").replace(/\D/g, "");
  return d.length === 11 ? d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4") : String(doc || "");
};

export const saudacaoAgora = (agora = new Date()) => {
  const h = agora.getHours();
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
};

function valorDe(chave, ctx) {
  switch (chave) {
    case "nome": return ctx.nome;
    case "primeiro_nome": return primeiroNome(ctx.nome);
    case "nome_whatsapp": return ctx.nomeWhatsapp;
    case "telefone": return ctx.telefone;
    case "lista.nome": return ctx.listaNome;
    case "lista.primeiro_nome": return primeiroNome(ctx.listaNome);
    case "lista.cpf": return formatarCpf(ctx.listaCpf);
    case "lista.telefone": return ctx.listaTelefone;
    case "saudacao": return saudacaoAgora();
    case "atendente": return ctx.atendente;
    default: return undefined;
  }
}

/**
 * Substitui {{variavel}} pelo valor do contexto.
 *
 * Variável sem valor (ex.: {{lista.cpf}} numa conversa que não está na lista
 * importada) vira string vazia — jamais sai um "{{lista.cpf}}" cru para o
 * cliente. Espaços duplicados que sobram da substituição são limpos.
 *
 * @param {string} texto
 * @param {TemplateContext} ctx
 * @returns {string}
 */
export function renderTemplate(texto, ctx = {}) {
  const bruto = String(texto || "").replace(
    /\{\{\s*([\w.]+)\s*\}\}/g,
    (_m, chave) => valorDe(chave, ctx) ?? "",
  );
  return bruto
    .split("\n")
    .map(linha => linha.replace(/[ \t]{2,}/g, " ").trimEnd())
    .join("\n");
}

/**
 * Variáveis usadas num texto que não existem — para avisar na interface antes
 * de salvar (senão o usuário só descobriria o erro na frente do cliente).
 * @param {string} texto
 * @returns {string[]}
 */
export function variaveisDesconhecidas(texto) {
  const conhecidas = new Set(TEMPLATE_VARIABLES.map(v => v.chave));
  const achadas = [...String(texto || "").matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map(m => m[1]);
  return [...new Set(achadas.filter(c => !conhecidas.has(c)))];
}
