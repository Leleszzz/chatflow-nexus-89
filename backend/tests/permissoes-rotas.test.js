import test from "node:test";
import assert from "node:assert/strict";
import { ROLES, isAdmin, seesAllDeals } from "../src/lib/roles.js";
import { canUserSeeDeal } from "../src/lib/deal-permissions.js";
import { canUserSeeInstance, canUserManageInstance } from "../src/lib/instance-permissions.js";

/**
 * O front (src/lib/roles.ts) declara quais cargos entram em cada tela. Isso é
 * bloqueio de INTERFACE: quem chama a API direto passa por cima. Estes testes
 * afirmam que o backend — a autoridade de verdade — aplica a mesma regra.
 */

// Espelha ROUTE_ROLES do front para as áreas que guardam dado sensível.
const CARGOS_ESPERADOS = {
  "/api/consultations": [ROLES.ADMIN, ROLES.DOUTOR],
  "/api/prontuarios": [ROLES.ADMIN, ROLES.DOUTOR],
  "/api/campaigns": [ROLES.ADMIN],
};

function guardasDoRouter(router) {
  // Camadas registradas via router.use(...) sem path próprio valem para o router inteiro.
  return (router.stack || [])
    .map(layer => layer.handle)
    .filter(h => typeof h === "function" && h.exigeCargos !== undefined)
    .map(h => h.exigeCargos);
}

test("consultas exigem cargo clínico no backend, não só na tela", async () => {
  const { consultationsRouter } = await import("../src/routes/consultations.js");
  const guardas = guardasDoRouter(consultationsRouter);
  assert.ok(guardas.length > 0, "nenhum guarda de cargo no router de consultas");
  const permitidos = guardas.find(g => Array.isArray(g));
  assert.deepEqual([...permitidos].sort(), [...CARGOS_ESPERADOS["/api/consultations"]].sort());
  assert.ok(!permitidos.includes(ROLES.SECRETARIA), "secretária não pode ler transcrição clínica");
});

test("prontuários exigem cargo clínico no backend", async () => {
  const { prontuariosRouter } = await import("../src/routes/prontuarios.js");
  const guardas = guardasDoRouter(prontuariosRouter);
  const permitidos = guardas.find(g => Array.isArray(g));
  assert.ok(permitidos, "nenhum guarda de cargo no router de prontuários");
  assert.ok(!permitidos.includes(ROLES.SECRETARIA), "secretária não pode ler prontuário");
});

test("campanhas são exclusivas de admin (inclusive as rotas de leitura)", async () => {
  const { campaignsRouter } = await import("../src/routes/campaigns.js");
  const guardas = guardasDoRouter(campaignsRouter);
  const permitidos = guardas.find(g => Array.isArray(g));
  assert.deepEqual(permitidos, [ROLES.ADMIN]);
});

test("QR e código de pareamento exigem gestão, não só leitura da instância", () => {
  const instancia = { id: "wa-1", ownerId: "secretaria-1" };
  const doutorComLeitura = { id: "doutor-1", role: ROLES.DOUTOR, allowedInstanceIds: ["wa-1"] };

  // Enxerga a instância (pode atender por ela)…
  assert.equal(canUserSeeInstance(doutorComLeitura, instancia), true);
  // …mas NÃO pode gerenciá-la. É esta distinção que impede que ele pegue o QR
  // e pareie o próprio celular na conta de WhatsApp da secretária.
  assert.equal(canUserManageInstance(doutorComLeitura, instancia), false);

  const dono = { id: "secretaria-1", role: ROLES.SECRETARIA };
  assert.equal(canUserManageInstance(dono, instancia), true);
  assert.equal(canUserManageInstance({ id: "a", role: ROLES.ADMIN }, instancia), true);
});

test("doutor não enxerga card de outro doutor", () => {
  const doutorA = { id: "dr-a", role: ROLES.DOUTOR };
  const cardDoDoutorB = { id: "d1", sellerId: "dr-b", tags: [] };
  assert.equal(canUserSeeDeal(doutorA, cardDoDoutorB), false);
  assert.equal(canUserSeeDeal({ id: "dr-b", role: ROLES.DOUTOR }, cardDoDoutorB), true);
});

test("secretária continua vendo todos os cards (é ela quem atende a fila)", () => {
  // Confirma que a restrição clínica NÃO quebrou o fluxo de atendimento dela.
  const secretaria = { id: "s1", role: ROLES.SECRETARIA };
  assert.equal(seesAllDeals(secretaria), true);
  assert.equal(canUserSeeDeal(secretaria, { id: "d1", sellerId: "dr-b", tags: [] }), true);
  assert.equal(isAdmin(secretaria), false);
});

test("cargo desconhecido cai no menor privilégio, nunca em admin", () => {
  for (const valor of ["Administrator", "root", "", null, undefined, "ADMIN", "superuser"]) {
    assert.equal(isAdmin({ role: valor }), false, `"${valor}" não pode virar admin`);
  }
});
