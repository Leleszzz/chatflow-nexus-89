import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canUserSeeInstance,
  canUserManageInstance,
  resolveAllowedInstanceIds,
} from "../src/lib/instance-permissions.js";
import { ROLES } from "../src/lib/roles.js";

const doutor = { id: "u-doutor", role: ROLES.DOUTOR, allowedInstanceIds: ["wa-secretaria"] };
const secretaria = { id: "u-secretaria", role: ROLES.SECRETARIA, allowedInstanceIds: [] };
const admin = { id: "u-admin", role: ROLES.ADMIN, allowedInstanceIds: [] };

const waDoutor = { id: "wa-doutor", ownerId: "u-doutor" };
const waSecretaria = { id: "wa-secretaria", ownerId: "u-secretaria" };
const waOrfa = { id: "wa-orfa", ownerId: null };
const todas = [waDoutor, waSecretaria, waOrfa];

test("admin vê todas as instâncias, inclusive as sem dono", () => {
  assert.equal(canUserSeeInstance(admin, waDoutor), true);
  assert.equal(canUserSeeInstance(admin, waSecretaria), true);
  assert.equal(canUserSeeInstance(admin, waOrfa), true);
});

// O caso central do consultório: exames e confirmação saem pelo WhatsApp da
// secretária, então o doutor precisa enxergar o canal dela.
test("doutor vê a instância dele e a da secretária que foi liberada", () => {
  assert.equal(canUserSeeInstance(doutor, waDoutor), true);
  assert.equal(canUserSeeInstance(doutor, waSecretaria), true);
});

test("secretária não vê a instância do doutor", () => {
  assert.equal(canUserSeeInstance(secretaria, waDoutor), false);
  assert.equal(canUserSeeInstance(secretaria, waSecretaria), true);
});

// Antes da correção, lista vazia significava "todas" no handshake do socket, e
// uma secretária recém-criada recebia o tráfego do doutor em tempo real.
test("lista vazia não libera nada além do que a pessoa é dona", () => {
  assert.deepEqual(resolveAllowedInstanceIds(secretaria, todas), ["wa-secretaria"]);
  const novata = { id: "u-nova", role: ROLES.SECRETARIA, allowedInstanceIds: [] };
  assert.deepEqual(resolveAllowedInstanceIds(novata, todas), []);
});

test("instância sem dono só aparece para o admin", () => {
  assert.equal(canUserSeeInstance(doutor, waOrfa), false);
  assert.equal(canUserSeeInstance(secretaria, waOrfa), false);
  assert.deepEqual(resolveAllowedInstanceIds(admin, todas), null);
});

// Ver o canal de outra pessoa não dá direito de reiniciar a conexão dela.
test("liberação de leitura não dá direito de administrar a conexão", () => {
  assert.equal(canUserManageInstance(doutor, waSecretaria), false);
  assert.equal(canUserManageInstance(doutor, waDoutor), true);
  assert.equal(canUserManageInstance(admin, waSecretaria), true);
});

test("usuário ou instância ausente nunca libera", () => {
  assert.equal(canUserSeeInstance(null, waDoutor), false);
  assert.equal(canUserSeeInstance(doutor, null), false);
  assert.equal(canUserManageInstance(null, waDoutor), false);
});
