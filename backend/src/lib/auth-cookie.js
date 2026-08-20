import { TOKEN_TTL_SECONDS } from "./auth-token.js";

// A sessão viaja num cookie httpOnly em vez do header Authorization: assim o
// JavaScript da página não consegue ler o token, então um XSS não consegue
// exfiltrá-lo. O preço é CSRF, mitigado por SameSite=Lax (o navegador não
// manda o cookie em requisição vinda de outro site).
export const AUTH_COOKIE = "crm_token";

// Em produção atrás de HTTPS, ligue COOKIE_SECURE=true. Se algum dia o front e
// a API ficarem em ORIGENS diferentes, Lax deixa de ser enviado no XHR e será
// preciso "none" + secure + proteção CSRF explícita.
const secure = process.env.COOKIE_SECURE === "true";
const sameSite = process.env.COOKIE_SAMESITE || "lax";

const baseOptions = {
  httpOnly: true,
  sameSite,
  secure,
  path: "/",
};

export function setAuthCookie(res, token) {
  res.cookie(AUTH_COOKIE, token, { ...baseOptions, maxAge: TOKEN_TTL_SECONDS * 1000 });
}

export function clearAuthCookie(res) {
  // As opções precisam bater com as da escrita, senão o navegador não remove.
  res.clearCookie(AUTH_COOKIE, baseOptions);
}

/**
 * Lê o token do header Cookie cru. Serve tanto para o Express quanto para o
 * handshake do socket.io, que não passa por middleware de cookie.
 */
export function readAuthCookie(cookieHeader) {
  if (!cookieHeader || typeof cookieHeader !== "string") return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== AUTH_COOKIE) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return part.slice(eq + 1).trim();
    }
  }
  return null;
}
