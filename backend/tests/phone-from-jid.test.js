import { test } from "node:test";
import assert from "node:assert/strict";
import { phoneFromChatId } from "../src/whatsapp/message-mapper.js";

// Regressão: ao fundir a conversa @lid (que nunca tem telefone) numa conversa
// @s.whatsapp.net ainda inexistente, o merge fazia `to?.phone || from?.phone || ""`
// e gravava telefone VAZIO — embora o número estivesse no próprio chatId de destino.
test("deriva o telefone do JID de número", () => {
  assert.equal(phoneFromChatId("5527998730387@s.whatsapp.net"), "+55 27 99873-0387");
  assert.equal(phoneFromChatId("552788734828@s.whatsapp.net"), "+55 27 8873-4828");
  assert.equal(phoneFromChatId("5511916116397:12@s.whatsapp.net"), "+55 11 91611-6397"); // com device
});

test("@lid não revela número — devolve vazio", () => {
  assert.equal(phoneFromChatId("154846707617891@lid"), "");
  assert.equal(phoneFromChatId("120363419967410025@g.us"), "");
  assert.equal(phoneFromChatId(""), "");
  assert.equal(phoneFromChatId(undefined), "");
});
