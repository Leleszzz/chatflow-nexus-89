import test from "node:test";
import assert from "node:assert/strict";
import { mimeDeUpload, safeExtension, podeServirInline } from "../src/lib/media-safety.js";

test("mimetype declarado vence a extensão", () => {
  // Adivinhar pela extensão quando o remetente JÁ declarou um tipo reabriria o
  // buraco que este módulo fecha: um .png com "text/html" dentro.
  assert.equal(mimeDeUpload("text/html", "foto.png"), "text/html");
  assert.equal(mimeDeUpload("audio/mpeg", "consulta.m4a"), "audio/mpeg");
});

test("sem mimetype, vale a extensão do arquivo", () => {
  assert.equal(mimeDeUpload("", "consulta.opus"), "audio/ogg");
  assert.equal(mimeDeUpload("", "consulta.amr"), "audio/amr");
  assert.equal(mimeDeUpload("application/octet-stream", "consulta.m4a"), "audio/mp4");
  assert.equal(mimeDeUpload("application/octet-stream", "consulta.mp4"), "video/mp4");
});

test("extensão desconhecida não inventa mimetype", () => {
  assert.equal(mimeDeUpload("", "consulta.xyz"), "");
  assert.equal(mimeDeUpload("", "consulta"), "");
});

test("os formatos de gravador de celular são salvos com extensão real, não .bin", () => {
  for (const [mime, ext] of [
    ["audio/x-wav", "wav"], ["audio/wave", "wav"], ["audio/flac", "flac"],
    ["audio/x-flac", "flac"], ["audio/amr", "amr"], ["audio/3gpp", "3gp"],
    ["audio/x-ms-wma", "wma"], ["video/x-matroska", "mkv"],
  ]) {
    assert.equal(safeExtension(mime), ext, `${mime} devia virar .${ext}`);
    // Sem isto o arquivo é servido como octet-stream e o player fica mudo.
    assert.equal(podeServirInline(mime), true, `${mime} devia tocar na página`);
  }
});

test("executável continua virando .bin mesmo com extensão amigável", () => {
  assert.equal(safeExtension("text/html"), "bin");
  assert.equal(safeExtension("image/svg+xml"), "bin");
  assert.equal(podeServirInline("text/html"), false);
});
