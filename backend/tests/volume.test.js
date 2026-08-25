import test from "node:test";
import assert from "node:assert/strict";
import { clampLimiteMensagens, LIMITE_MAXIMO_MENSAGENS, LIMITE_PADRAO_MENSAGENS } from "../src/storage/messages-repo.js";
import { clampLimiteConversas, LIMITE_MAXIMO_CONVERSAS, LIMITE_PADRAO_CONVERSAS } from "../src/storage/conversations-repo.js";

/**
 * O `limit` vinha da query como `Number(req.query.limit)`, sem validação.
 * "?limit=abc" produzia NaN, que o driver do Mongo aceita sem reclamar — o erro
 * só estourava no servidor do banco, virando exceção assíncrona que DERRUBAVA O
 * PROCESSO. E "?limit=99999999" materializava a coleção inteira em memória.
 */

for (const [nome, clamp, padrao, maximo] of [
  ["mensagens", clampLimiteMensagens, LIMITE_PADRAO_MENSAGENS, LIMITE_MAXIMO_MENSAGENS],
  ["conversas", clampLimiteConversas, LIMITE_PADRAO_CONVERSAS, LIMITE_MAXIMO_CONVERSAS],
]) {
  test(`limit de ${nome}: entrada inválida cai no padrão, nunca em NaN`, () => {
    for (const lixo of ["abc", "", null, undefined, NaN, "NaN", {}, [], "1e999", "-∞"]) {
      const r = clamp(lixo);
      assert.ok(Number.isInteger(r), `${JSON.stringify(lixo)} produziu ${r}, que não é inteiro`);
      assert.ok(r > 0 && r <= maximo, `${JSON.stringify(lixo)} produziu ${r}, fora da faixa`);
    }
    assert.equal(clamp("abc"), padrao);
    assert.equal(clamp(undefined), padrao);
  });

  test(`limit de ${nome}: valor absurdo é limitado ao teto`, () => {
    assert.equal(clamp(99999999), maximo);
    assert.equal(clamp(Infinity), padrao, "Infinity não é finito, deve cair no padrão");
    assert.equal(clamp(maximo + 1), maximo);
  });

  test(`limit de ${nome}: negativo e zero não passam`, () => {
    assert.equal(clamp(-1), padrao);
    assert.equal(clamp(0), padrao);
    assert.equal(clamp("-500"), padrao);
  });

  test(`limit de ${nome}: valor legítimo é preservado`, () => {
    assert.equal(clamp(10), 10);
    assert.equal(clamp("25"), 25);
    assert.equal(clamp(7.9), 7, "fracionário é truncado, não repassado ao driver");
  });
}
