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
  const candidate = await derive(password, passwordSalt);
  return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(passwordHash));
}
