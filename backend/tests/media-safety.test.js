import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import { config } from "../src/config.js";
import { mediaRouter } from "../src/routes/media.js";
import { safeExtension, podeServirInline, nomeParaDownload } from "../src/lib/media-safety.js";
import { resolveMediaPath } from "../src/storage/media-repo.js";

// O anexo de WhatsApp chega com o mimetype escolhido por QUEM ENVIOU. Antes,
// "text/html" virava um .html servido como text/html por uma rota pública que
// roda na mesma origem do cookie de sessão: o contato mandava o arquivo, o
// atendente clicava, e o JavaScript do atacante rodava com a sessão dele.

test("mimetype executável nunca vira extensão executável", () => {
  for (const perigoso of [
    "text/html", "image/svg+xml", "application/xhtml+xml",
    "text/xml", "application/javascript", "text/javascript",
  ]) {
    assert.equal(safeExtension(perigoso), "bin", `${perigoso} deveria virar .bin`);
    assert.equal(podeServirInline(perigoso), false, `${perigoso} não pode ser inline`);
  }
});

test("mídia legítima continua funcionando inline", () => {
  assert.equal(safeExtension("image/jpeg"), "jpg");
  assert.equal(safeExtension("audio/ogg"), "ogg");
  assert.equal(safeExtension("video/mp4"), "mp4");
  assert.ok(podeServirInline("image/png"));
  assert.ok(podeServirInline("audio/mpeg"));
  assert.ok(podeServirInline("video/mp4"));
});

test("documento tem extensão certa mas não é servido inline", () => {
  assert.equal(safeExtension("application/vnd.openxmlformats-officedocument.wordprocessingml.document"), "docx");
  assert.equal(podeServirInline("application/vnd.openxmlformats-officedocument.wordprocessingml.document"), false);
});

test("nome de arquivo não injeta cabeçalho HTTP", () => {
  const sujo = `a"${String.fromCharCode(13, 10)}X-Injetado: sim.pdf`;
  const limpo = nomeParaDownload(sujo);
  assert.ok(!limpo.includes(String.fromCharCode(13)), "CR sobreviveu");
  assert.ok(!limpo.includes(String.fromCharCode(10)), "LF sobreviveu");
  assert.ok(!limpo.includes('"'), "aspas sobreviveram");
});

test("path traversal é recusado", () => {
  const raiz = path.resolve(config.paths.mediaDir);
  for (const tentativa of ["../../../../etc/passwd", "..", "", "/etc/passwd"]) {
    try {
      const r = resolveMediaPath(tentativa);
      assert.ok(r.startsWith(raiz + path.sep), `escapou do diretório: ${tentativa} -> ${r}`);
    } catch {
      // recusar também é resultado correto
    }
  }
});

test("rota serve HTML como download, com nosniff", async t => {
  await fs.mkdir(config.paths.mediaDir, { recursive: true });
  const perigoso = path.join(config.paths.mediaDir, "teste-xss-temporario.html");
  const imagem = path.join(config.paths.mediaDir, "teste-ok-temporario.jpg");
  await fs.writeFile(perigoso, "<script>alert(document.cookie)</script>");
  await fs.writeFile(imagem, Buffer.from([0xff, 0xd8, 0xff, 0xdb]));
  t.after(async () => {
    await fs.unlink(perigoso).catch(() => {});
    await fs.unlink(imagem).catch(() => {});
  });

  const app = express();
  app.use("/api/media", mediaRouter);
  const servidor = app.listen(0);
  t.after(() => servidor.close());
  const { port } = servidor.address();

  const html = await fetch(`http://127.0.0.1:${port}/api/media/teste-xss-temporario.html`);
  assert.equal(html.headers.get("content-type"), "application/octet-stream");
  assert.match(html.headers.get("content-disposition") || "", /^attachment/);
  assert.equal(html.headers.get("x-content-type-options"), "nosniff");

  const jpg = await fetch(`http://127.0.0.1:${port}/api/media/teste-ok-temporario.jpg`);
  assert.match(jpg.headers.get("content-type"), /^image\/jpeg/);
  assert.equal(jpg.headers.get("content-disposition"), null, "imagem deve continuar abrindo inline");
  assert.equal(jpg.headers.get("x-content-type-options"), "nosniff");
});
