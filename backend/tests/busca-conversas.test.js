import test from "node:test";
import assert from "node:assert/strict";
import { escaparRegex } from "../src/storage/conversations-repo.js";

// A busca de conversas passou a acontecer NO BANCO (antes o front baixava tudo
// e filtrava em memória, o que só funcionava porque tudo estava carregado).
// Como o termo do usuário vira regex, ele precisa ser neutralizado: sem isso,
// um nome com parênteses quebra a consulta e um termo como "(a+)+$" vira um
// regex catastrófico que trava o MongoDB (ReDoS).

test("metacaracteres viram texto literal", () => {
  for (const termo of ["Ana (mãe)", "a.b*c", "[teste]", "c|d", "e{2}", "f?"]) {
    const escapado = escaparRegex(termo);
    // O termo escapado tem que casar consigo mesmo, e só consigo mesmo.
    assert.ok(new RegExp(escapado).test(termo), `"${termo}" não casa consigo`);
  }
});

test("padrão catastrófico não sobrevive ao escape", () => {
  const perigoso = "(a+)+$";
  const escapado = escaparRegex(perigoso);
  const re = new RegExp(escapado);
  // Vira literal: casa com a string "(a+)$..." e NÃO com "aaaaaa".
  assert.equal(re.test("(a+)+$"), true);
  assert.equal(re.test("aaaaaaaaaaaaaaaaaaaaaaaa"), false);

  // E avalia em tempo trivial, em vez de explodir.
  const t0 = Date.now();
  re.test("a".repeat(40) + "!");
  assert.ok(Date.now() - t0 < 200, "avaliação demorou demais");
});

test("ponto não vira curinga", () => {
  const re = new RegExp(escaparRegex("a.c"), "i");
  assert.equal(re.test("a.c"), true);
  assert.equal(re.test("abc"), false, "o ponto virou curinga e casou errado");
});

test("texto comum passa sem alteração", () => {
  assert.equal(escaparRegex("Maria Silva"), "Maria Silva");
  assert.equal(escaparRegex("5527999887766"), "5527999887766");
});

test("barra invertida é escapada", () => {
  const barra = String.fromCharCode(92);
  const escapado = escaparRegex(barra + "d");
  // Sem escapar, "\d" viraria a classe de dígitos e casaria com "5".
  assert.equal(new RegExp(escapado).test("5"), false);
  assert.equal(new RegExp(escapado).test(barra + "d"), true);
});
