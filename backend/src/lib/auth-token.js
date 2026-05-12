import crypto from "node:crypto";

const JWT_SECRET = process.env.JWT_SECRET || "queijo";
const JWT_ALGORITHM = "HS256";
const TOKEN_TTL_SECONDS = 60 * 60 * 8;

const base64UrlEncode = value => {
  const buffer = typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value);
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const base64UrlDecode = value => {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Buffer.from(padded, "base64").toString("utf8");
};

const sign = unsignedToken =>
  base64UrlEncode(crypto.createHmac("sha256", JWT_SECRET).update(unsignedToken).digest());

export function createAuthToken(user) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: JWT_ALGORITHM, typ: "JWT" };
  const payload = { sub: user.id, role: user.role, iat: now, exp: now + TOKEN_TTL_SECONDS };
  const unsigned = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;
  return `${unsigned}.${sign(unsigned)}`;
}

export function verifyAuthToken(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  const expected = sign(`${header}.${payload}`);
  if (signature.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const decoded = JSON.parse(base64UrlDecode(payload));
    if (!decoded || typeof decoded !== "object") return null;
    if (decoded.exp && decoded.exp <= Math.floor(Date.now() / 1000)) return null;
    return decoded;
  } catch {
    return null;
  }
}
