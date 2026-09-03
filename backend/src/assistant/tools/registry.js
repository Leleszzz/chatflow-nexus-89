// O registro de ferramentas do assistente.
//
// Segue o padrão que este projeto já usa em lib/transcription/suggestions.js:
// o registro é a fonte, e o PROMPT É DERIVADO DELE. Ninguém escreve à mão a
// lista de ferramentas no texto do sistema — é exatamente assim que se adiciona
// uma capacidade e se esquece de contar ao modelo que ela existe.
// backend/tests/assistant-registry.test.js itera o registro e cobra isso.

import { LEITURA } from "./leitura.js";
import { ESCRITA } from "./escrita.js";

export const TOOLS = { ...LEITURA, ...ESCRITA };

export function getTool(nome) {
  return Object.prototype.hasOwnProperty.call(TOOLS, nome) ? TOOLS[nome] : null;
}

/**
 * Os schemas no formato da API, já recortados pelo cargo.
 *
 * Ferramenta clínica não é escondida da secretária: ela simplesmente NÃO EXISTE
 * no schema dela. Oferecer e recusar depois faria o modelo prometer ao usuário
 * algo que não pode entregar, e ainda gastaria uma rodada para descobrir.
 */
export function toolSchemas(ctx) {
  return Object.entries(TOOLS)
    .filter(([, def]) => !def.exigeAcessoClinico || ctx?.temAcessoClinico)
    .map(([name, def]) => ({
      type: "function",
      function: { name, description: def.descricao, parameters: def.parameters },
    }));
}

/** As ferramentas que este usuário enxerga, separadas por natureza. */
export function toolsVisiveis(ctx) {
  const entradas = Object.entries(TOOLS).filter(
    ([, def]) => !def.exigeAcessoClinico || ctx?.temAcessoClinico,
  );
  return {
    leitura: entradas.filter(([, d]) => d.tipo === "leitura").map(([n]) => n),
    escrita: entradas.filter(([, d]) => d.tipo === "escrita").map(([n]) => n),
  };
}

/**
 * A seção do prompt que fala das ferramentas — gerada, nunca escrita à mão.
 *
 * Cita cada nome disponível, porque o teste do registro verifica exatamente
 * isso: ferramenta que existe no schema e não aparece aqui é ferramenta que o
 * modelo tende a ignorar.
 */
export function buildToolsPrompt(ctx) {
  const { leitura, escrita } = toolsVisiveis(ctx);
  const linhas = [];

  if (leitura.length) {
    linhas.push(
      "FERRAMENTAS DE CONSULTA (executam na hora e devolvem dado do sistema):",
      leitura.map(n => `- ${n}`).join("\n"),
    );
  }
  if (escrita.length) {
    linhas.push(
      "FERRAMENTAS DE AÇÃO (NÃO executam nada — desenham um card que o médico confirma):",
      escrita.map(n => `- ${n}`).join("\n"),
    );
  }
  linhas.push(
    "Nunca invente dado: se a informação não veio de uma ferramenta, ela não existe — "
    + "diga que não encontrou e, se for o caso, pergunte o que falta.",
  );
  return linhas.join("\n");
}
