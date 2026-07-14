import { test } from "node:test";
import assert from "node:assert/strict";
import { bestName, mapChatFromBaileys } from "../src/whatsapp/message-mapper.js";
import { MessagePipeline } from "../src/whatsapp/pipeline/MessagePipeline.js";

const LID = "111222333@lid";
const PN = "5511999999999@s.whatsapp.net";

test("bestName: prefere nome real e ignora provisórios (JID/dígitos/vazio)", () => {
  assert.equal(bestName([{ notify: "Maria" }]), "Maria");
  assert.equal(bestName([{ name: "João" }]), "João");
  assert.equal(bestName([{ verifiedName: "Loja X" }]), "Loja X");
  // Provisórios são pulados até achar um nome de verdade.
  assert.equal(bestName([{ notify: PN }, { name: "5511999999999" }, { notify: "Ana" }]), "Ana");
  assert.equal(bestName([{ notify: PN }, { name: "5511999999999" }]), "");
  assert.equal(bestName([]), "");
  assert.equal(bestName(undefined), "");
});

// Fixture mínima do pipeline: só o necessário para exercitar a resolução de nome.
// Como o JidResolver real, os dois sentidos do mapa ficam sempre em sincronia.
function makePipeline({ lidToPn = new Map() } = {}) {
  const resolver = {
    canonical: jid => (typeof jid === "string" && jid.endsWith("@lid") ? (lidToPn.get(jid) || jid) : jid),
    lidFor: pn => [...lidToPn].find(([, p]) => p === pn)?.[0] || null,
    pnFor: lid => lidToPn.get(lid) || null,
  };
  return new MessagePipeline({
    instanceId: "wa-test",
    io: null,
    resolver,
    mediaQueue: { enqueue: () => {} },
    chatsById: new Map(),
    contactsByJid: new Map(),
  });
}

test("contato do histórico chega sob @lid e é gravado sob o PN canônico", () => {
  const p = makePipeline({ lidToPn: new Map([[LID, PN]]) });
  // Histórico entrega o contato chaveado pelo @lid.
  p._rememberContact(LID, { notify: "Maria" });
  // A conversa é chaveada pelo PN — antes do fix, esta busca falhava ("Sem nome").
  assert.equal(p._contactFor(PN)?.notify, "Maria");
});

test("nome é achado mesmo se o mapeamento LID→PN só for aprendido depois", () => {
  // Mapeamento AINDA não conhecido: o contato fica sob o próprio @lid.
  const lidToPn = new Map();
  const p = makePipeline({ lidToPn });
  p._rememberContact(LID, { notify: "João" });
  assert.equal(p._contactFor(PN), undefined);

  // O par é aprendido depois — o fallback pelo LID resolve o nome.
  lidToPn.set(LID, PN);
  assert.equal(p._contactFor(PN)?.notify, "João");
});

test("conversa do histórico nasce COM nome quando o contato é conhecido", () => {
  const p = makePipeline({ lidToPn: new Map([[LID, PN]]) });
  p._rememberContact(LID, { notify: "Maria Silva" });
  const conv = mapChatFromBaileys({
    jid: PN,
    contact: p._contactFor(PN),
    instanceId: "wa-test",
    lastMessage: { type: "chat", body: "oi", timestamp: 1700000000 },
  });
  assert.equal(conv.whatsappName, "Maria Silva");
  assert.equal(conv.customer, "Maria Silva");
  assert.equal(conv.phone, "+55 11 99999-9999");
});

test("sem nome conhecido, a conversa fica sem nome (o telefone é exibido)", () => {
  const p = makePipeline();
  const conv = mapChatFromBaileys({
    jid: PN,
    contact: p._contactFor(PN),
    instanceId: "wa-test",
    lastMessage: { type: "chat", body: "oi", timestamp: 1700000000 },
  });
  assert.equal(conv.whatsappName, "");
  assert.equal(conv.phone, "+55 11 99999-9999");
});
