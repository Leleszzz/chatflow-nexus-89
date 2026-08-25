import crypto from "node:crypto";
import { readCsrfCookie, CSRF_HEADER } from "../lib/auth-cookie.js";

/**
 * Proteção CSRF por double-submit.
 *
 * A sessão vive num cookie httpOnly, que o navegador anexa sozinho em QUALQUER
 * requisição para a API — inclusive uma disparada por um site malicioso que o
 * atendente abriu noutra aba. Até aqui a única defesa era `SameSite=Lax`, e o
 * comentário em lib/auth-cookie.js já avisava que ela some no dia em que front
 * e API ficarem em origens diferentes (que é justamente o cenário de deploy
 * público, com o front num CDN e a API noutro host).
 *
 * O double-submit fecha isso: o valor precisa chegar TAMBÉM num header. O site
 * atacante consegue fazer o navegador enviar o cookie, mas não consegue lê-lo
 * — logo não sabe que valor pôr no header.
 *
 * Só métodos que mudam estado são checados; GET/HEAD/OPTIONS passam.
 */

const METODOS_SEGUROS = new Set(["GET", "HEAD", "OPTIONS"]);

// Rotas que precisam funcionar antes de existir sessão (e, portanto, antes de
// existir cookie CSRF).
const ISENTAS = new Set(["/login", "/logout"]);

function iguais(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export function csrfProtection(req, res, next) {
  if (METODOS_SEGUROS.has(req.method)) return next();
  if (ISENTAS.has(req.path)) return next();

  const doCookie = readCsrfCookie(req.headers.cookie);
  const doHeader = req.get(CSRF_HEADER);

  // Sem cookie de sessão CSRF, não há sessão de navegador para proteger — o
  // requireAuth de cada rota é quem decide se a requisição segue. Isto mantém
  // funcionando um cliente que use a API fora do navegador.
  if (!doCookie) return next();

  if (!iguais(doCookie, doHeader)) {
    return res.status(403).json({
      error: "Requisição bloqueada por proteção CSRF. Recarregue a página e tente de novo.",
      code: "CSRF_INVALIDO",
    });
  }
  return next();
}
