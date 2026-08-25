import crypto from "node:crypto";
import { TOKEN_TTL_SECONDS } from "./auth-token.js";
import { config } from "../config.js";

// A sessão viaja num cookie httpOnly em vez do header Authorization: assim o
// JavaScript da página não consegue ler o token, então um XSS não consegue
// exfiltrá-lo. O preço é CSRF, mitigado por SameSite=Lax (o navegador não
// manda o cookie em requisição vinda de outro site).
export const AUTH_COOKIE = "crm_token";

// Par do double-submit contra CSRF. Este cookie NÃO é httpOnly de propósito: o
// JavaScript da própria página precisa lê-lo para reenviar o valor no header
// X-CSRF-Token. Um site atacante consegue fazer o navegador ENVIAR o cookie,
// mas não consegue LÊ-LO (a same-origin policy o impede), então não sabe qual
// valor colocar no header — e a requisição falha.
export const CSRF_COOKIE = "crm_csrf";
export const CSRF_HEADER = "x-csrf-token";

// Em produção atrás de HTTPS, ligue COOKIE_SECURE=true. Se algum dia o front e
// a API ficarem em ORIGENS diferentes, Lax deixa de ser enviado no XHR e será
// preciso "none" + secure + proteção CSRF explícita.
const secure = config.cookieSecure;
const sameSite = process.env.COOKIE_SAMESITE || "lax";

const baseOptions = {
  httpOnly: true,
  sameSite,
  secure,
  path: "/",
};

// Mesmas opções, menos o httpOnly: o front precisa ler para montar o header.
const csrfOptions = { ...baseOptions, httpOnly: false };

export function novoTokenCsrf() {
  return crypto.randomBytes(32).toString("hex");
}

export function setAuthCookie(res, token) {
  res.cookie(AUTH_COOKIE, token, { ...baseOptions, maxAge: TOKEN_TTL_SECONDS * 1000 });
  res.cookie(CSRF_COOKIE, novoTokenCsrf(), { ...csrfOptions, maxAge: TOKEN_TTL_SECONDS * 1000 });
}

export function clearAuthCookie(res) {
  // As opções precisam bater com as da escrita, senão o navegador não remove.
  res.clearCookie(AUTH_COOKIE, baseOptions);
  res.clearCookie(CSRF_COOKIE, csrfOptions);
}

/** Garante que a sessão tem um token CSRF, emitindo um se faltar. */
export function garantirCookieCsrf(req, res) {
  const atual = lerCookie(req.headers.cookie, CSRF_COOKIE);
  if (atual) return atual;
  const novo = novoTokenCsrf();
  res.cookie(CSRF_COOKIE, novo, { ...csrfOptions, maxAge: TOKEN_TTL_SECONDS * 1000 });
  return novo;
}

/**
 * Lê o token do header Cookie cru. Serve tanto para o Express quanto para o
 * handshake do socket.io, que não passa por middleware de cookie.
 */
export function readAuthCookie(cookieHeader) {
  return lerCookie(cookieHeader, AUTH_COOKIE);
}

export function readCsrfCookie(cookieHeader) {
  return lerCookie(cookieHeader, CSRF_COOKIE);
}

function lerCookie(cookieHeader, nome) {
  if (!cookieHeader || typeof cookieHeader !== "string") return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== nome) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return part.slice(eq + 1).trim();
    }
  }
  return null;
}
