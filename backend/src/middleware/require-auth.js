import { verifyAuthToken } from "../lib/auth-token.js";
import { readAuthCookie } from "../lib/auth-cookie.js";
import { getUser } from "../storage/users-repo.js";
import { ROLES } from "../lib/roles.js";

// `admin: true` é açúcar para `roles: ["admin"]` — mantido porque já é usado em
// ~25 rotas. `roles` aceita a lista de cargos que podem entrar.
export function requireAuth(options = {}) {
  const { admin = false, roles = null } = options;
  const permitidos = admin ? [ROLES.ADMIN] : roles;
  return async (req, res, next) => {
    const token = readAuthCookie(req.headers.cookie);
    if (!token) return res.status(401).json({ error: "Token ausente" });
    const payload = verifyAuthToken(token);
    if (!payload) return res.status(401).json({ error: "Token inválido ou expirado" });

    const user = await getUser(payload.sub);
    if (!user || !user.active) return res.status(401).json({ error: "Usuário não encontrado" });

    if (permitidos && !permitidos.includes(user.role)) {
      return res.status(403).json({
        error: admin ? "Acesso restrito a administradores" : "Cargo sem acesso a este recurso",
      });
    }

    req.user = user;
    req.tokenPayload = payload;
    next();
  };
}
