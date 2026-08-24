import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ROLES,
  ROLE_VALUES,
  ROLE_LABELS,
  normalizeRole,
  isValidRole,
  isAdmin,
  isDoutor,
  isSecretaria,
  seesAllDeals,
} from "../src/lib/roles.js";

test("cada cargo legado cai no destino certo", () => {
  assert.equal(normalizeRole("Administrador"), ROLES.ADMIN);
  assert.equal(normalizeRole("Gerente"), ROLES.SECRETARIA);
  assert.equal(normalizeRole("Vendedora"), ROLES.SECRETARIA);
  assert.equal(normalizeRole("Suporte"), ROLES.SECRETARIA);
  assert.equal(normalizeRole("Financeiro"), ROLES.SECRETARIA);
  assert.equal(normalizeRole("Somente leitura"), ROLES.SECRETARIA);
});

// A migração roda sozinha no boot: promover alguém a admin por engano daria
// acesso a usuários, instâncias e chaves de API sem ninguém pedir.
test("nada além de Administrador vira admin", () => {
  const promovidos = ["Gerente", "Vendedora", "Suporte", "Financeiro", "Somente leitura", "ADMIN", "", null, undefined, "doutorzinho"]
    .filter(valor => normalizeRole(valor) === ROLES.ADMIN);
  assert.deepEqual(promovidos, []);
});

test("cargo desconhecido cai em secretaria", () => {
  assert.equal(normalizeRole("Estagiário"), ROLES.SECRETARIA);
  assert.equal(normalizeRole(""), ROLES.SECRETARIA);
  assert.equal(normalizeRole(undefined), ROLES.SECRETARIA);
});

// A migração roda em todo boot; se não fosse idempotente, reescreveria o banco
// inteiro toda vez que o servidor sobe.
test("normalizeRole é idempotente", () => {
  for (const cargo of ROLE_VALUES) {
    assert.equal(normalizeRole(normalizeRole(cargo)), cargo);
  }
});

test("isValidRole só aceita o que já está normalizado", () => {
  assert.equal(isValidRole("admin"), true);
  assert.equal(isValidRole("Administrador"), false);
  assert.equal(isValidRole("vendedora"), false);
});

test("todo cargo tem rótulo de exibição", () => {
  for (const cargo of ROLE_VALUES) {
    assert.equal(typeof ROLE_LABELS[cargo], "string");
    assert.ok(ROLE_LABELS[cargo].length > 0);
  }
});

test("os predicados de cargo são mutuamente exclusivos", () => {
  assert.deepEqual(
    [isAdmin({ role: "admin" }), isDoutor({ role: "admin" }), isSecretaria({ role: "admin" })],
    [true, false, false],
  );
  assert.deepEqual(
    [isAdmin({ role: "doutor" }), isDoutor({ role: "doutor" }), isSecretaria({ role: "doutor" })],
    [false, true, false],
  );
});

// Espelha canViewDeal do front: a secretária precisa da fila inteira porque é
// ela quem atende e encaminha; o doutor vê só o que é dele.
test("admin e secretária veem todos os atendimentos, doutor não", () => {
  assert.equal(seesAllDeals({ role: ROLES.ADMIN }), true);
  assert.equal(seesAllDeals({ role: ROLES.SECRETARIA }), true);
  assert.equal(seesAllDeals({ role: ROLES.DOUTOR }), false);
});
