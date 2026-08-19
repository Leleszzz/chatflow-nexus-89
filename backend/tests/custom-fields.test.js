import { test } from "node:test";
import assert from "node:assert/strict";
import {
  keyFromLabel,
  coerceFieldValue,
  applyCustomFieldValues,
} from "../src/storage/custom-fields-repo.js";

const campo = (over = {}) => ({ key: "X", label: "X", type: "texto", options: [], ...over });

test("keyFromLabel gera chave legível, sem acento e sem pontuação", () => {
  assert.equal(keyFromLabel("Nome completo"), "NOME_COMPLETO");
  assert.equal(keyFromLabel("Data de nascimento"), "DATA_DE_NASCIMENTO");
  assert.equal(keyFromLabel("CPF/CNPJ"), "CPF_CNPJ");
  assert.equal(keyFromLabel("  Endereço (rua)  "), "ENDERECO_RUA");
  // Nunca devolve string vazia — a chave é o identificador dos valores.
  assert.equal(keyFromLabel("!!!"), "CAMPO");
  assert.equal(keyFromLabel(""), "CAMPO");
});

test("coerce de número aceita formato pt-BR e recusa texto", () => {
  const f = campo({ type: "numero" });
  assert.equal(coerceFieldValue(f, "1234.56"), 1234.56);
  assert.equal(coerceFieldValue(f, "1.234,56"), 1234.56);
  assert.equal(coerceFieldValue(f, "42"), 42);
  assert.equal(coerceFieldValue(f, "abc"), undefined);
});

test("coerce de data normaliza dd/mm/aaaa para ISO e recusa data inválida", () => {
  const f = campo({ type: "data" });
  assert.equal(coerceFieldValue(f, "1990-03-14"), "1990-03-14");
  assert.equal(coerceFieldValue(f, "14/03/1990"), "1990-03-14");
  assert.equal(coerceFieldValue(f, "14 de março"), undefined);
  assert.equal(coerceFieldValue(f, "1990-13-45"), undefined);
});

test("coerce de lista só aceita opção existente", () => {
  const f = campo({ type: "lista", options: ["Indicação", "Instagram"] });
  assert.equal(coerceFieldValue(f, "Instagram"), "Instagram");
  assert.equal(coerceFieldValue(f, "Facebook"), undefined);
});

test("valor vazio limpa o campo em vez de gravar string vazia", () => {
  assert.equal(coerceFieldValue(campo(), ""), null);
  assert.equal(coerceFieldValue(campo(), null), null);
  assert.equal(coerceFieldValue(campo({ type: "numero" }), "   "), null);
});

test("applyCustomFieldValues mescla, valida e reporta o que recusou", () => {
  const defs = [
    campo({ key: "NOME_COMPLETO", type: "texto" }),
    campo({ key: "NASCIMENTO", type: "data" }),
    campo({ key: "ORIGEM", type: "lista", options: ["Indicação"] }),
  ];
  const atuais = { NOME_COMPLETO: "Maria" };
  const { values, aplicados, rejeitados } = applyCustomFieldValues(defs, atuais, {
    NASCIMENTO: "14/03/1990",
    ORIGEM: "TikTok",          // fora das opções
    INEXISTENTE: "x",          // campo que não existe
  });

  // Preserva o que já havia e grava só o que passou na validação.
  assert.equal(values.NOME_COMPLETO, "Maria");
  assert.equal(values.NASCIMENTO, "1990-03-14");
  assert.equal(values.ORIGEM, undefined);
  assert.deepEqual(aplicados, ["NASCIMENTO"]);
  assert.deepEqual(rejeitados.map(r => r.key).sort(), ["INEXISTENTE", "ORIGEM"]);
});

test("valor vazio remove a chave já gravada", () => {
  const defs = [campo({ key: "NOME_COMPLETO" })];
  const { values, aplicados } = applyCustomFieldValues(defs, { NOME_COMPLETO: "Maria" }, { NOME_COMPLETO: "" });
  assert.equal("NOME_COMPLETO" in values, false);
  assert.deepEqual(aplicados, ["NOME_COMPLETO"]);
});
