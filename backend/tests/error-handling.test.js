import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { Router } from "../src/lib/safe-router.js";
import { errorHandler, notFoundHandler, HttpError } from "../src/middleware/error-handler.js";

// Regressão do bug mais grave que o servidor tinha: no Express 4, a rejeição de
// um handler `async` não chega ao middleware de erro, vira unhandledRejection e
// DERRUBA O PROCESSO (exit 1) — junto com todas as conexões de WhatsApp.
// Bastava `GET /api/conversations/:id/messages?limit=abc` para tirar o CRM do ar.

function subirApp() {
  const app = express();
  const r = Router();
  r.get("/ok", async (_req, res) => res.json({ ok: true }));
  r.get("/async-boom", async () => {
    throw new Error("mongodb://usuario:senha@host/db — detalhe interno");
  });
  r.get("/sync-boom", () => { throw new Error("estouro síncrono"); });
  r.get("/http-erro", async () => { throw new HttpError(400, "limit inválido", "LIMIT_INVALIDO"); });
  app.use("/api", r);
  app.use("/api", notFoundHandler);
  app.use(errorHandler);
  return app;
}

async function pedir(servidor, rota) {
  const { port } = servidor.address();
  const res = await fetch(`http://127.0.0.1:${port}/api${rota}`);
  return { status: res.status, corpo: await res.json() };
}

test("erro assíncrono vira 500 sem derrubar o processo", async t => {
  const servidor = subirApp().listen(0);
  t.after(() => servidor.close());

  // Silencia o log do errorHandler durante o teste.
  const erroOriginal = console.error;
  console.error = () => {};
  try {
    const boom = await pedir(servidor, "/async-boom");
    assert.equal(boom.status, 500);
    assert.equal(boom.corpo.code, "ERRO_INTERNO");

    const sincrono = await pedir(servidor, "/sync-boom");
    assert.equal(sincrono.status, 500);

    // O servidor precisa continuar atendendo DEPOIS dos erros — é o ponto todo.
    const depois = await pedir(servidor, "/ok");
    assert.deepEqual(depois.corpo, { ok: true });
  } finally {
    console.error = erroOriginal;
  }
});

test("detalhe interno nunca vaza na resposta", async t => {
  const servidor = subirApp().listen(0);
  t.after(() => servidor.close());
  const erroOriginal = console.error;
  console.error = () => {};
  try {
    const { corpo } = await pedir(servidor, "/async-boom");
    const texto = JSON.stringify(corpo);
    assert.ok(!texto.includes("mongodb"), "URI do banco vazou na resposta");
    assert.ok(!texto.includes("senha"), "credencial vazou na resposta");
    assert.ok(corpo.ref, "deve devolver uma referência para correlacionar com o log");
  } finally {
    console.error = erroOriginal;
  }
});

test("HttpError preserva status, mensagem e código", async t => {
  const servidor = subirApp().listen(0);
  t.after(() => servidor.close());
  const { status, corpo } = await pedir(servidor, "/http-erro");
  assert.equal(status, 400);
  assert.equal(corpo.error, "limit inválido");
  assert.equal(corpo.code, "LIMIT_INVALIDO");
});

test("rota inexistente responde JSON, não HTML", async t => {
  const servidor = subirApp().listen(0);
  t.after(() => servidor.close());
  const { status, corpo } = await pedir(servidor, "/nao-existe");
  assert.equal(status, 404);
  assert.equal(corpo.code, "ROTA_INEXISTENTE");
});
