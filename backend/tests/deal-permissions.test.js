import { test } from "node:test";
import assert from "node:assert/strict";
import { canUserSeeDeal, permittedUserIds } from "../src/lib/deal-permissions.js";
import { ROLES } from "../src/lib/roles.js";

const admin = { id: "u-admin", role: ROLES.ADMIN, active: true };
const secretaria = { id: "u-secretaria", role: ROLES.SECRETARIA, active: true };
const doutor = { id: "u-doutor", role: ROLES.DOUTOR, active: true };

const dealDeOutro = { id: "d1", sellerId: "u-secretaria", tags: [] };
const dealDoDoutor = { id: "d2", sellerId: "u-doutor", tags: [] };

test("admin e secretária veem qualquer atendimento", () => {
  assert.equal(canUserSeeDeal(admin, dealDeOutro), true);
  assert.equal(canUserSeeDeal(secretaria, dealDoDoutor), true);
});

test("doutor só vê o atendimento atribuído a ele", () => {
  assert.equal(canUserSeeDeal(doutor, dealDoDoutor), true);
  assert.equal(canUserSeeDeal(doutor, dealDeOutro), false);
});

test("doutor também vê o que foi liberado por conversa ou por tag", () => {
  const porConversa = { ...doutor, allowedConversationIds: ["d1"] };
  assert.equal(canUserSeeDeal(porConversa, dealDeOutro), true);

  const porTag = { ...doutor, allowedTags: ["cardiologia"] };
  assert.equal(canUserSeeDeal(porTag, { id: "d3", sellerId: "x", tags: ["cardiologia"] }), true);
  assert.equal(canUserSeeDeal(porTag, { id: "d4", sellerId: "x", tags: ["dermato"] }), false);
});

test("doutor entra na lista de assignedSellerIds, não só em sellerId", () => {
  const compartilhado = { id: "d5", sellerId: "u-secretaria", assignedSellerIds: ["u-doutor"], tags: [] };
  assert.equal(canUserSeeDeal(doutor, compartilhado), true);
});

// Usado no fan-out de socket: um deal não pode ser emitido para quem não o vê.
test("permittedUserIds ignora usuários inativos", () => {
  const inativo = { id: "u-off", role: ROLES.SECRETARIA, active: false };
  const ids = permittedUserIds(dealDoDoutor, [admin, secretaria, doutor, inativo]);
  assert.deepEqual(ids.sort(), ["u-admin", "u-doutor", "u-secretaria"]);
});
