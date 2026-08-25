import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createAuthToken, verifyAuthToken } from "../src/lib/auth-token.js";
import { verifyPassword, hashPassword } from "../src/lib/password.js";
import { validarForcaSenha } from "../src/routes/auth.js";

const b64 = v => Buffer.from(v).toString("base64")
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

function forjar(segredo, payload) {
  const h = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const p = b64(JSON.stringify(payload));
  const sig = b64(crypto.createHmac("sha256", segredo).update(`${h}.${p}`).digest());
  return `${h}.${p}.${sig}`;
}

const agora = () => Math.floor(Date.now() / 1000);

test("token forjado com o segredo publicado é rejeitado", () => {
  // "queijo" era o fallback embutido em auth-token.js E o valor commitado no
  // .env do repositório. Com ele, forjar um cookie de admin era uma linha de
  // shell. O fallback foi removido: agora o segredo é obrigatório e o boot
  // falha sem ele.
  for (const publicado of ["queijo", "secret", "changeme", ""]) {
    const token = forjar(publicado, { sub: "admin", role: "admin", iat: agora(), exp: agora() + 3600 });
    assert.equal(verifyAuthToken(token), null, `segredo "${publicado}" ainda assina token válido`);
  }
});

test("token emitido pelo servidor é aceito", () => {
  const payload = verifyAuthToken(createAuthToken({ id: "u1", role: "admin" }));
  assert.equal(payload.sub, "u1");
  assert.equal(payload.role, "admin");
  assert.ok(payload.exp > agora());
});

test("token sem exp é rejeitado (antes valia para sempre)", () => {
  const real = createAuthToken({ id: "u1", role: "admin" }).split(".");
  const semExp = JSON.stringify({ sub: "u1", role: "admin", iat: agora() });
  const p = b64(semExp);
  // Sem o segredo em mãos aqui, basta afirmar que o payload alterado não passa.
  assert.equal(verifyAuthToken(`${real[0]}.${p}.${real[2]}`), null);
});

test("token expirado e token adulterado são rejeitados", () => {
  const valido = createAuthToken({ id: "u1", role: "secretaria" });
  const [h, p, s] = valido.split(".");

  // Payload trocado para admin, assinatura original: a assinatura não bate.
  const escalado = b64(JSON.stringify({ sub: "u1", role: "admin", iat: agora(), exp: agora() + 3600 }));
  assert.equal(verifyAuthToken(`${h}.${escalado}.${s}`), null);

  assert.equal(verifyAuthToken("lixo"), null);
  assert.equal(verifyAuthToken(""), null);
  assert.equal(verifyAuthToken(null), null);
  assert.equal(verifyAuthToken(`${h}.${p}`), null);
});

test("verifyPassword não estoura com hash de formato antigo", async () => {
  // crypto.timingSafeEqual LANÇA quando os buffers têm tamanhos diferentes.
  // Um usuário vindo da semente com hash em outro formato derrubava o login —
  // e, sem tratamento de erro, o processo inteiro.
  assert.equal(await verifyPassword("qualquer", "curto", "c2FsdA"), false);
  assert.equal(await verifyPassword("qualquer", "", ""), false);
  assert.equal(await verifyPassword("", "abc", "c2FsdA"), false);
});

test("verifyPassword continua distinguindo senha certa de errada", async () => {
  const { passwordHash, passwordSalt } = await hashPassword("SenhaForte123");
  assert.equal(await verifyPassword("SenhaForte123", passwordHash, passwordSalt), true);
  assert.equal(await verifyPassword("SenhaForte124", passwordHash, passwordSalt), false);
});

test("senha fraca é recusada", () => {
  for (const fraca of ["123456", "senha", "abc123", "1234567890", "senhasenha"]) {
    assert.ok(validarForcaSenha(fraca), `"${fraca}" deveria ser recusada`);
  }
  assert.equal(validarForcaSenha("Consultorio2024"), null);
});
