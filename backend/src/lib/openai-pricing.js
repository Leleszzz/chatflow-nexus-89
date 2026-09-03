// Modelos e preço por token. Vive aqui (e não em whatsapp/agent-service.js, de
// onde saiu) porque o assistente do médico também cobra e mostra custo, e uma
// segunda tabela seria uma segunda tabela para esquecer de atualizar.
//
// Arquivo puro de propósito: sem banco, sem rede, sem estado. É o que permite
// testá-lo direto, já que o backend não tem mock de fetch em lugar nenhum.

// Os três níveis que a tela de agentes oferece. Configurável por ambiente para
// trocar de modelo sem mexer no código — a tabela de preço abaixo precisa ser
// atualizada junto, porque é dela que sai o custo mostrado ao usuário.
export const MODEL_MAP = {
  econom: process.env.OPENAI_MODEL_ECONOM || "gpt-4o-mini",
  balanced: process.env.OPENAI_MODEL_BALANCED || "gpt-4o",
  premium: process.env.OPENAI_MODEL_PREMIUM || "gpt-4.1",
};

export const DEFAULT_OPENAI_MODEL = MODEL_MAP.econom;

// Preço por token, em dólar. Fica em tabela nomeada para ficar óbvio quando
// desatualiza — o custo mostrado ao usuário sai daqui.
export const PRICING = {
  "gpt-4o-mini": { in: 0.15 / 1e6, out: 0.60 / 1e6 },
  "gpt-4o":      { in: 2.50 / 1e6, out: 10.00 / 1e6 },
  "gpt-4.1":     { in: 2.00 / 1e6, out: 8.00 / 1e6 },
  "gpt-4.1-mini": { in: 0.40 / 1e6, out: 1.60 / 1e6 },
  "gpt-4-turbo": { in: 10.00 / 1e6, out: 30.00 / 1e6 },
};

/**
 * Custo em dólar de uma chamada, a partir do `usage` que a OpenAI devolve.
 *
 * `usage` vem com as chaves da API (`prompt_tokens`/`completion_tokens`), não
 * com as nossas — quem chama repassa o objeto cru.
 */
export function priceFor(model, usage) {
  const p = PRICING[model];
  if (!usage) return 0;
  if (!p) {
    // Modelo trocado por ambiente sem entrada na tabela: o custo apareceria como
    // zero e o relatório mentiria calado. Melhor avisar.
    console.warn(`[openai-pricing] sem preço cadastrado para "${model}" — custo será reportado como 0`);
    return 0;
  }
  const pIn = Number(usage.prompt_tokens) || 0;
  const pOut = Number(usage.completion_tokens) || 0;
  return pIn * p.in + pOut * p.out;
}
