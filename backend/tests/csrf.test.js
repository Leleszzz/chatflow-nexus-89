import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { Router } from "../src/lib/safe-router.js";
import { csrfProtection } from "../src/middleware/csrf.js";
import { errorHandler } from "../src/middleware/error-handler.js";

// A sessão vive num cookie httpOnly, que o navegador anexa sozinho em qualquer
// requisição para a API — inclusive numa disparada por um site malicioso que o
// atendente abriu noutra aba. O double-submit exige que o valor chegue TAMBÉM
// num header, que o site atacante não consegue montar (não lê nosso cookie).

function subir() {
  const app = express();
  app.use(express.json());
  app.use("/api", csrfProtection);
  const r = Router();
  r.get("/coisa", (_q, s) => s.json({ ok: true }));
  r.post("/coisa", (_q, s) => s.json({ gravado: true }));
  r.post("/login", (_q, s) => s.json({ entrou: true }));
  app.use("/api", r);
  app.use(errorHandler);
  return app.listen(0);
}

async function pedir(servidor, { metodo = "GET", rota = "/coisa", cookie, header } = {}) {
  const { port } = servidor.address();
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (header) headers["X-CSRF-Token"] = header;
  const res = await fetch(`http://127.0.0.1:${port}/api${rota}`, { method: metodo, headers });
  return res.status;
}

test("GET nunca é bloqueado (não muda estado)", async t => {
  const s = subir(); t.after(() => s.close());
  assert.equal(await pedir(s, { cookie: "crm_csrf=abc123" }), 200);
});

test("POST sem o header é bloqueado quando existe cookie CSRF", async t => {
  const s = subir(); t.after(() => s.close());
  // É exatamente isto que um site atacante consegue montar: o navegador manda
  // os cookies, mas ele não sabe o valor para pôr no header.
  assert.equal(await pedir(s, { metodo: "POST", cookie: "crm_csrf=segredo-da-sessao" }), 403);
});

test("POST com header divergente é bloqueado", async t => {
  const s = subir(); t.after(() => s.close());
  assert.equal(
    await pedir(s, { metodo: "POST", cookie: "crm_csrf=segredo-da-sessao", header: "chute-errado" }),
    403,
  );
});

test("POST com header igual ao cookie passa", async t => {
  const s = subir(); t.after(() => s.close());
  assert.equal(
    await pedir(s, { metodo: "POST", cookie: "crm_csrf=segredo-da-sessao", header: "segredo-da-sessao" }),
    200,
  );
});

test("login continua acessível antes de existir sessão", async t => {
  const s = subir(); t.after(() => s.close());
  assert.equal(await pedir(s, { metodo: "POST", rota: "/login" }), 200);
});

test("cliente fora do navegador (sem cookie CSRF) não é barrado aqui", async t => {
  const s = subir(); t.after(() => s.close());
  // Sem cookie não há sessão de navegador para proteger; quem decide é o
  // requireAuth de cada rota.
  assert.equal(await pedir(s, { metodo: "POST", cookie: "crm_token=xyz" }), 200);
});
