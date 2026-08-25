import crypto from "node:crypto";

const HASH_ITERATIONS = 100000;
const HASH_LENGTH_BYTES = 32;
const SALT_BYTES = 16;

const toBase64Url = buffer =>
  Buffer.from(buffer).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

const fromBase64Url = value => {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Buffer.from(padded, "base64");
};

const derive = (password, saltBase64Url) =>
  new Promise((resolve, reject) => {
    crypto.pbkdf2(password, fromBase64Url(saltBase64Url), HASH_ITERATIONS, HASH_LENGTH_BYTES, "sha256", (err, key) => {
      if (err) return reject(err);
      resolve(toBase64Url(key));
    });
  });

export async function hashPassword(password) {
  const salt = toBase64Url(crypto.randomBytes(SALT_BYTES));
  const passwordHash = await derive(password, salt);
  return { passwordHash, passwordSalt: salt };
}

export async function verifyPassword(password, passwordHash, passwordSalt) {
  if (!passwordHash || !passwordSalt) return false;
  if (typeof password !== "string" || !password) return false;

  let candidate;
  try {
    candidate = await derive(password, passwordSalt);
  } catch {
    // Salt corrompido/ilegível: é senha inválida, não erro de servidor.
    return false;
  }

  const a = Buffer.from(candidate);
  const b = Buffer.from(passwordHash);
  // timingSafeEqual LANÇA quando os buffers têm tamanhos diferentes
  // (ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH). Um usuário com hash em formato
  // antigo — vindo da semente src/banco-de-dados/users.json — fazia a rota de
  // login estourar, e sem tratamento de erro isso derrubava o processo inteiro.
  // Tamanho diferente já significa hash diferente: responder `false` é correto
  // e não abre canal lateral (o comprimento do hash não é segredo).
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
