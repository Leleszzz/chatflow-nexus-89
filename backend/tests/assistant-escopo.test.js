import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TOOLS } from "../src/assistant/tools/registry.js";

// Asserção ESTRUTURAL, e não de comportamento: lê os próprios arquivos.
//
// A regra que ela impõe é a espinha da segurança do assistente — nenhuma
// ferramenta fala com storage/ direto; todas leem por `ctx`, que já filtrou por
// canUserSeeDeal. Um teste de comportamento não pegaria a violação, porque a
// ferramenta nova funcionaria perfeitamente: só responderia também sobre
// paciente de outro médico, em prosa, sem nada parecer errado.

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const DIR_TOOLS = path.join(AQUI, "..", "src", "assistant", "tools");

const arquivosDeFerramenta = () =>
  fs.readdirSync(DIR_TOOLS).filter(f => f.endsWith(".js")).map(f => path.join(DIR_TOOLS, f));

/**
 * O código sem os comentários.
 *
 * Necessário porque estes arquivos EXPLICAM a regra no cabeçalho ("o ctx já
 * filtrou por canUserSeeDeal") — e um teste que reprovasse a documentação da
 * própria regra faria as pessoas apagarem a explicação para o teste passar.
 */
const semComentarios = fonte => fonte
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

test("nenhuma ferramenta importa da camada de storage", () => {
  for (const arquivo of arquivosDeFerramenta()) {
    const codigo = semComentarios(fs.readFileSync(arquivo, "utf8"));
    const importes = [...codigo.matchAll(/from\s+["']([^"']+)["']/g)].map(m => m[1]);
    for (const alvo of importes) {
      assert.ok(
        !alvo.includes("storage/"),
        `${path.basename(arquivo)} importa "${alvo}" — leia por ctx, senão o filtro de permissão fica opcional`,
      );
    }
  }
});

test("nenhuma ferramenta chama o filtro de permissão por conta própria", () => {
  // canUserSeeDeal dentro da ferramenta significaria uma segunda implementação
  // do recorte, que envelhece separado da de contexto.js.
  for (const arquivo of arquivosDeFerramenta()) {
    const codigo = semComentarios(fs.readFileSync(arquivo, "utf8"));
    assert.ok(
      !codigo.includes("canUserSeeDeal"),
      `${path.basename(arquivo)} refaz o filtro — use ctx.assertDeal / ctx.deals()`,
    );
  }
});

test("há de fato ferramentas para o teste conferir", () => {
  // Blindagem contra o teste passar por vacuidade se o diretório for movido.
  assert.ok(arquivosDeFerramenta().length >= 1);
  assert.ok(Object.keys(TOOLS).length >= 5);
});

test("toda ferramenta que devolve total também devolve a lista correspondente", () => {
  // Contagem antes do filtro é vazamento: um `total` maior que a lista
  // denunciaria pacientes de outro médico sem mostrar nenhum. Aqui o que se
  // verifica é o contrato — cada `total` no código anda junto de uma coleção.
  const fonte = fs.readFileSync(path.join(DIR_TOOLS, "leitura.js"), "utf8");
  const ocorrencias = fonte.match(/total:\s*([A-Za-z_.]+)\.length/g) || [];
  assert.ok(ocorrencias.length >= 5, "esperava vários totais derivados de .length de lista já filtrada");
  for (const linha of ocorrencias) {
    assert.match(linha, /\.length$/, `total sem origem em lista: ${linha}`);
  }
});
