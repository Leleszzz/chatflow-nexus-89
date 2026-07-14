import { test } from "node:test";
import assert from "node:assert/strict";
import { decideReconnect } from "../src/whatsapp/connection/reconnect-policy.js";

test("códigos terminais (401/403/411/500) param sem reconectar", () => {
  for (const code of [401, 403, 411, 500]) {
    const d = decideReconnect(code, 0);
    assert.equal(d.action, "stop", `code ${code} deveria parar`);
  }
});

test("440 (connectionReplaced) segura 45s antes de tentar de novo", () => {
  const d = decideReconnect(440, 0);
  assert.equal(d.action, "hold");
  assert.equal(d.delayMs, 45_000);
});

test("515 (restartRequired) religa imediatamente — pareamento depende disso", () => {
  const d = decideReconnect(515, 0);
  assert.equal(d.action, "restart");
  assert.equal(d.delayMs, 0);
});

test("códigos genéricos: backoff exponencial com jitter 50–100%", () => {
  // attempt 0: exp = 1000 -> delay em [500, 1000]
  for (let i = 0; i < 20; i++) {
    const d = decideReconnect(408, 0);
    assert.equal(d.action, "reconnect");
    assert.ok(d.delayMs >= 500 && d.delayMs <= 1000, `delay fora da faixa: ${d.delayMs}`);
  }
  // attempt 3: exp = 8000 -> [4000, 8000]
  for (let i = 0; i < 20; i++) {
    const d = decideReconnect(0, 3);
    assert.ok(d.delayMs >= 4000 && d.delayMs <= 8000, `delay fora da faixa: ${d.delayMs}`);
  }
});

test("backoff respeita o teto (capMs)", () => {
  for (let i = 0; i < 20; i++) {
    const d = decideReconnect(428, 15, { maxAttempts: 50 });
    assert.equal(d.action, "reconnect");
    assert.ok(d.delayMs <= 60_000, `delay acima do teto: ${d.delayMs}`);
    assert.ok(d.delayMs >= 30_000, `delay abaixo do jitter mínimo do teto: ${d.delayMs}`);
  }
});

test("para após maxAttempts tentativas", () => {
  const d = decideReconnect(408, 10);
  assert.equal(d.action, "stop");
  assert.equal(d.reason, "maxAttemptsReached");
});
