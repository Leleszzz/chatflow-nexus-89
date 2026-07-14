import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mapMessage,
  extractEditedBody,
  mapBaileysStatusToAck,
  ackForSentResult,
  jidIsUnsupported,
  isPlaceholderName,
  isDisplayableMessage,
  buildConversationId,
  previewFor,
} from "../src/whatsapp/message-mapper.js";

const PN = "5511999999999@s.whatsapp.net";
const key = (over = {}) => ({ id: "MSG1", remoteJid: PN, fromMe: false, ...over });

test("mapMessage: texto simples com timestamp em segundos", () => {
  const m = mapMessage(
    { key: key(), messageTimestamp: 1700000000, message: { conversation: "olá" }, status: 3 },
    { instanceId: "wa-test" },
  );
  assert.equal(m.id, "MSG1");
  assert.equal(m.chatId, PN);
  assert.equal(m.type, "chat");
  assert.equal(m.body, "olá");
  assert.equal(m.timestamp, 1700000000);
  assert.equal(m.ack, 2); // DELIVERY_ACK(3) -> ✓✓
  assert.equal(m.fromMe, false);
});

test("mapMessage: quotedMsgId em resposta de texto (extendedTextMessage)", () => {
  const m = mapMessage({
    key: key(),
    message: { extendedTextMessage: { text: "respondendo", contextInfo: { stanzaId: "QUOTED1" } } },
  }, { instanceId: "wa-test" });
  assert.equal(m.quotedMsgId, "QUOTED1");
});

test("mapMessage: quotedMsgId em resposta com MÍDIA (imageMessage) — gap corrigido", () => {
  const m = mapMessage({
    key: key(),
    message: { imageMessage: { caption: "olha isso", contextInfo: { stanzaId: "QUOTED2" } } },
  }, { instanceId: "wa-test" });
  assert.equal(m.type, "image");
  assert.equal(m.quotedMsgId, "QUOTED2");
});

test("mapMessage: quotedMsgId em resposta com áudio e documento", () => {
  const audio = mapMessage({
    key: key(),
    message: { audioMessage: { ptt: true, contextInfo: { stanzaId: "QA" } } },
  }, { instanceId: "wa-test" });
  assert.equal(audio.type, "ptt");
  assert.equal(audio.quotedMsgId, "QA");

  const doc = mapMessage({
    key: key(),
    message: { documentMessage: { caption: "segue", contextInfo: { stanzaId: "QD" } } },
  }, { instanceId: "wa-test" });
  assert.equal(doc.type, "document");
  assert.equal(doc.quotedMsgId, "QD");
});

test("mapMessage: audio comum vs nota de voz (ptt)", () => {
  const comum = mapMessage({ key: key(), message: { audioMessage: { ptt: false } } }, { instanceId: "i" });
  assert.equal(comum.type, "audio");
  const ptt = mapMessage({ key: key(), message: { audioMessage: { ptt: true } } }, { instanceId: "i" });
  assert.equal(ptt.type, "ptt");
});

test("mapMessage: vídeo com gifPlayback vira isGif", () => {
  const m = mapMessage({ key: key(), message: { videoMessage: { gifPlayback: true } } }, { instanceId: "i" });
  assert.equal(m.type, "video");
  assert.equal(m.isGif, true);
});

test("mapMessage: desembrulha viewOnce e editedMessage (histórico já editado)", () => {
  const vo = mapMessage({
    key: key(),
    message: { viewOnceMessageV2: { message: { imageMessage: { caption: "sumindo" } } } },
  }, { instanceId: "i" });
  assert.equal(vo.type, "image");
  assert.equal(vo.body, "sumindo");

  const ed = mapMessage({
    key: key(),
    message: { editedMessage: { message: { conversation: "texto novo" } } },
  }, { instanceId: "i" });
  assert.equal(ed.type, "chat");
  assert.equal(ed.body, "texto novo");
});

test("mapMessage: contato extrai telefone do vcard", () => {
  const m = mapMessage({
    key: key(),
    message: { contactMessage: { displayName: "Maria", vcard: "BEGIN:VCARD\nFN:Maria\nTEL;waid=5511888888888:+55 11 88888-8888\nEND:VCARD" } },
  }, { instanceId: "i" });
  assert.equal(m.type, "contact");
  assert.equal(m.contact.displayName, "Maria");
  assert.equal(m.contact.phone, "5511888888888");
});

test("extractEditedBody: edição de texto e de legenda de mídia", () => {
  assert.equal(extractEditedBody({ editedMessage: { message: { conversation: "editado" } } }), "editado");
  assert.equal(extractEditedBody({ editedMessage: { message: { extendedTextMessage: { text: "editado 2" } } } }), "editado 2");
  assert.equal(extractEditedBody({ editedMessage: { message: { imageMessage: { caption: "nova legenda" } } } }), "nova legenda");
  assert.equal(extractEditedBody({ editedMessage: { message: {} } }), "");
});

test("mapBaileysStatusToAck: escala proto(0-5) -> ack(0-4)", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(mapBaileysStatusToAck), [0, 0, 1, 2, 3, 4]);
  assert.equal(mapBaileysStatusToAck(undefined), 0);
});

test("ackForSentResult: nunca abaixo de 1 (enviada = pelo menos ✓)", () => {
  assert.equal(ackForSentResult(0), 1);
  assert.equal(ackForSentResult(2), 1);
  assert.equal(ackForSentResult(4), 3);
});

test("jidIsUnsupported: grupos/broadcast/newsletter filtrados; PN e LID aceitos", () => {
  assert.equal(jidIsUnsupported("123@g.us"), true);
  assert.equal(jidIsUnsupported("456@broadcast"), true);
  assert.equal(jidIsUnsupported("status@broadcast"), true);
  assert.equal(jidIsUnsupported("789@newsletter"), true);
  assert.equal(jidIsUnsupported(PN), false);
  assert.equal(jidIsUnsupported("111222333@lid"), false);
  assert.equal(jidIsUnsupported(null), true);
});

test("isPlaceholderName: JIDs e dígitos crus são provisórios; nomes reais não", () => {
  assert.equal(isPlaceholderName(""), true);
  assert.equal(isPlaceholderName(PN), true);
  assert.equal(isPlaceholderName("111222333@lid"), true);
  assert.equal(isPlaceholderName("5511999999999"), true);
  assert.equal(isPlaceholderName("Maria Silva"), false);
});

test("isDisplayableMessage: protocolMessage/reactionMessage são descartados", () => {
  assert.equal(isDisplayableMessage({ message: { conversation: "oi" } }), true);
  assert.equal(isDisplayableMessage({ message: { protocolMessage: { type: 0 } } }), false);
  assert.equal(isDisplayableMessage({ message: { reactionMessage: { text: "👍" } } }), false);
  assert.equal(isDisplayableMessage({ message: {} }), false);
});

test("previewFor: body vence; senão placeholder por tipo", () => {
  assert.equal(previewFor({ type: "image", body: "legenda" }), "legenda");
  assert.equal(previewFor({ type: "image", body: "" }), "[imagem]");
  assert.equal(previewFor({ type: "ptt", body: "" }), "[áudio]");
  assert.equal(previewFor({ type: "video", body: "", isGif: true }), "[GIF]");
});

test("buildConversationId: instanceId__chatId", () => {
  assert.equal(buildConversationId("wa-abc", PN), `wa-abc__${PN}`);
});
