import test from "node:test";
import assert from "node:assert/strict";
import { podeVerTarefa, podeEscreverTarefa } from "../src/lib/task-permissions.js";
import { ROLES } from "../src/lib/roles.js";

// A regra saiu de routes/tasks.js para poder ser usada pelo assistente do médico
// (que lista tarefas sem passar por HTTP). O que estes testes protegem é a
// assimetria de propósito entre ver e escrever: o doutor ACOMPANHA a cobrança
// que outro pediu para o paciente dele, mas não a fecha por ele.

const doutor = { id: "u-dr", role: ROLES.DOUTOR, allowedTags: [], allowedConversationIds: [] };
const secretaria = { id: "u-sec", role: ROLES.SECRETARIA, allowedTags: [], allowedConversationIds: [] };
const admin = { id: "u-adm", role: ROLES.ADMIN, allowedTags: [], allowedConversationIds: [] };

const tarefa = (over = {}) => ({
  id: "tk-1", titulo: "Cobrar retorno", dealId: "", assigneeId: "", criadoPor: "", ...over,
});
const card = (over = {}) => ({ id: "d-1", sellerId: "u-dr", assignedSellerIds: [], tags: [], ...over });

test("admin e secretária veem a fila inteira", () => {
  const solta = tarefa({ criadoPor: "outro" });
  assert.equal(podeVerTarefa(admin, solta, null), true);
  assert.equal(podeVerTarefa(secretaria, solta, null), true);
});

test("doutor vê o que ele criou e o que é dele", () => {
  assert.equal(podeVerTarefa(doutor, tarefa({ criadoPor: "u-dr" }), null), true);
  assert.equal(podeVerTarefa(doutor, tarefa({ assigneeId: "u-dr" }), null), true);
});

test("doutor vê a tarefa de um paciente dele", () => {
  const t = tarefa({ dealId: "d-1", criadoPor: "u-sec" });
  assert.equal(podeVerTarefa(doutor, t, card()), true);
});

test("doutor não vê a tarefa de paciente de outro", () => {
  const t = tarefa({ dealId: "d-9", criadoPor: "u-sec" });
  assert.equal(podeVerTarefa(doutor, t, card({ id: "d-9", sellerId: "u-outro" })), false);
});

test("tarefa órfã de card não vaza por engano", () => {
  // O card foi excluído: `deal` chega null. Sem dono nem criador, ninguém que
  // não seja admin/secretária deve enxergar.
  const t = tarefa({ dealId: "d-sumiu", criadoPor: "u-sec" });
  assert.equal(podeVerTarefa(doutor, t, null), false);
});

test("tarefa solta sem vínculo nenhum é invisível para o doutor", () => {
  assert.equal(podeVerTarefa(doutor, tarefa({ criadoPor: "u-sec" }), null), false);
});

test("ver o card do paciente não dá direito de escrita", () => {
  // A assimetria que importa: a secretária pediu, o doutor acompanha, mas quem
  // fecha é quem executa.
  const t = tarefa({ dealId: "d-1", criadoPor: "u-sec", assigneeId: "u-sec" });
  assert.equal(podeVerTarefa(doutor, t, card()), true);
  assert.equal(podeEscreverTarefa(doutor, t), false);
});

test("a fila da recepção é compartilhada entre secretárias", () => {
  // Uma cobre a outra na folga; travar cada tarefa na dona faria a fila parar.
  const outra = { id: "u-sec2", role: ROLES.SECRETARIA, allowedTags: [], allowedConversationIds: [] };
  assert.equal(podeEscreverTarefa(outra, tarefa({ assigneeId: "u-sec" })), true);
});

test("quem delegou pode mexer no que delegou", () => {
  assert.equal(podeEscreverTarefa(doutor, tarefa({ criadoPor: "u-dr", assigneeId: "u-sec" })), true);
});
