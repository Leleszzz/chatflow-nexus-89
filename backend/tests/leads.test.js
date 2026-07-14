import { test } from "node:test";
import assert from "node:assert/strict";
import { phoneKey, parseLeadsTxt } from "../src/storage/leads-repo.js";

test("phoneKey: arquivo (sem DDI) casa com o JID (com DDI)", () => {
  const doArquivo = phoneKey("27997230505");            // como vem no TXT
  const doWhatsApp = phoneKey("5527997230505");         // como vem no JID
  assert.equal(doArquivo, doWhatsApp);
});

test("phoneKey: casa mesmo quando o WhatsApp OMITE o nono dígito", () => {
  const comNove = phoneKey("27997230505");              // TXT
  const semNove = phoneKey("552797230505");             // JID legado, sem o 9
  assert.equal(comNove, semNove);
});

test("phoneKey: não come o DDD 55 (interior do RS)", () => {
  // Número de DDD 55 no arquivo (11 dígitos) e o mesmo com DDI (13 dígitos).
  assert.equal(phoneKey("55997230505"), phoneKey("5555997230505"));
  // E não colide com um DDD 27.
  assert.notEqual(phoneKey("55997230505"), phoneKey("27997230505"));
});

test("phoneKey: aceita formatação e descarta lixo", () => {
  assert.equal(phoneKey("+55 (27) 99723-0505"), phoneKey("27997230505"));
  assert.equal(phoneKey("123"), "");
  assert.equal(phoneKey(""), "");
  assert.equal(phoneKey(null), "");
});

const TXT = `NM_PSSA|NU_DOCUMENTO|NU_FONE_TERMINAL
VALDINETE SANTOS|34615783809|27997230505
ANDRESSA PEREIRA SCHNEIDER|5845229758|27999060983
`;

test("parseLeadsTxt: lê o layout com pipe e cabeçalho", () => {
  const { registros, invalidas } = parseLeadsTxt(TXT);
  assert.equal(registros.length, 2);
  assert.equal(invalidas.length, 0);
  assert.equal(registros[0].nome, "VALDINETE SANTOS");
  assert.equal(registros[0].documento, "34615783809");
  assert.equal(registros[0].telefone, "27997230505");
  assert.equal(registros[0].phoneKey, phoneKey("5527997230505"));
  assert.equal(registros[1].nome, "ANDRESSA PEREIRA SCHNEIDER");
});

test("parseLeadsTxt: tolera BOM, CRLF, linhas em branco e espaços", () => {
  const sujo = "﻿NM_PSSA|NU_DOCUMENTO|NU_FONE_TERMINAL\r\n" +
    "  VALDINETE SANTOS | 34615783809 | 27997230505 \r\n" +
    "\r\n" +
    "ANDRESSA PEREIRA SCHNEIDER|5845229758|27999060983\r\n";
  const { registros } = parseLeadsTxt(sujo);
  assert.equal(registros.length, 2);
  assert.equal(registros[0].nome, "VALDINETE SANTOS");
});

test("parseLeadsTxt: respeita a ordem das colunas do cabeçalho", () => {
  const invertido = "NU_FONE_TERMINAL|NM_PSSA|NU_DOCUMENTO\n27997230505|VALDINETE SANTOS|34615783809\n";
  const { registros } = parseLeadsTxt(invertido);
  assert.equal(registros[0].nome, "VALDINETE SANTOS");
  assert.equal(registros[0].telefone, "27997230505");
  assert.equal(registros[0].documento, "34615783809");
});

test("parseLeadsTxt: linha sem telefone válido é ignorada, não derruba o import", () => {
  const comLixo = TXT + "LINHA QUEBRADA|sem telefone\n";
  const { registros, invalidas } = parseLeadsTxt(comLixo);
  assert.equal(registros.length, 2);
  assert.equal(invalidas.length, 1);
});

test("parseLeadsTxt: duas linhas do mesmo número viram a mesma chave (dedup no upsert)", () => {
  const dup = "NM_PSSA|NU_DOCUMENTO|NU_FONE_TERMINAL\n" +
    "FULANO|111|27997230505\n" +
    "FULANO DE TAL|111|5527997230505\n";
  const { registros } = parseLeadsTxt(dup);
  assert.equal(registros[0]._id, registros[1]._id);
});
