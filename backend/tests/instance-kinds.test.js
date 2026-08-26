import test from "node:test";
import assert from "node:assert/strict";
import {
  INSTANCE_KINDS, isValidInstanceKind, normalizeInstanceKind,
} from "../src/lib/instance-kinds.js";

test("instância antiga, sem tipo, é da recepção", () => {
  assert.equal(normalizeInstanceKind(undefined), INSTANCE_KINDS.SECRETARIA);
  assert.equal(normalizeInstanceKind(null), INSTANCE_KINDS.SECRETARIA);
  assert.equal(normalizeInstanceKind(""), INSTANCE_KINDS.SECRETARIA);
});

test("tipo desconhecido não vira doutor por acidente", () => {
  assert.equal(normalizeInstanceKind("medico"), INSTANCE_KINDS.SECRETARIA);
  assert.equal(normalizeInstanceKind("DOUTOR"), INSTANCE_KINDS.SECRETARIA);
});

test("os dois tipos válidos passam intactos", () => {
  assert.equal(normalizeInstanceKind("doutor"), INSTANCE_KINDS.DOUTOR);
  assert.equal(normalizeInstanceKind(" secretaria "), INSTANCE_KINDS.SECRETARIA);
});

test("isValidInstanceKind recusa o que normalize aceitaria calado", () => {
  // A rota valida antes de normalizar: rebaixar em silêncio um tipo digitado
  // errado seria pior do que devolver 400.
  assert.equal(isValidInstanceKind("medico"), false);
  assert.equal(isValidInstanceKind(""), false);
  assert.equal(isValidInstanceKind("doutor"), true);
  assert.equal(isValidInstanceKind("secretaria"), true);
});
