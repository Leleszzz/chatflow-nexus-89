import { verifyAuthToken } from "../lib/auth-token.js";
import { getUser } from "../storage/users-repo.js";

export function requireAuth(options = {}) {
  const { admin = false } = options;
  return async (req, res, next) => {
    const header = req.headers.authorization || req.headers.Authorization;
    if (!header || !header.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Token ausente" });
    }
    const token = header.slice("Bearer ".length).trim();
    const payload = verifyAuthToken(token);
    if (!payload) return res.status(401).json({ error: "Token inválido ou expirado" });

    const user = await getUser(payload.sub);
    if (!user || !user.active) return res.status(401).json({ error: "Usuário não encontrado" });

    if (admin && user.role !== "Administrador") {
      return res.status(403).json({ error: "Acesso restrito a administradores" });
    }

    req.user = user;
    req.tokenPayload = payload;
    next();
  };
}
