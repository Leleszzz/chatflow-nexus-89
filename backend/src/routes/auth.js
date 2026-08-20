import { Router } from "express";
import {
  findByIdentifier,
  getUser,
  sanitizeUser,
  setPassword,
} from "../storage/users-repo.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { createAuthToken } from "../lib/auth-token.js";
import { setAuthCookie, clearAuthCookie } from "../lib/auth-cookie.js";
import { requireAuth } from "../middleware/require-auth.js";

export const authRouter = Router();

authRouter.post("/login", async (req, res) => {
  const identifier = typeof req.body?.identifier === "string" ? req.body.identifier : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!identifier.trim() || !password) {
    return res.status(400).json({ error: "identifier e password são obrigatórios" });
  }

  const user = await findByIdentifier(identifier);
  if (!user) return res.status(401).json({ error: "Usuário ou senha inválidos" });

  const ok = await verifyPassword(password, user.passwordHash, user.passwordSalt);
  if (!ok) return res.status(401).json({ error: "Usuário ou senha inválidos" });

  // O token vai no cookie httpOnly, NÃO no corpo: se voltasse no JSON o front
  // teria como guardá-lo e o ganho de segurança se perderia.
  setAuthCookie(res, createAuthToken(user));
  res.json({ user: sanitizeUser(user) });
});

authRouter.post("/logout", (_req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

authRouter.get("/me", requireAuth(), async (req, res) => {
  res.json({ user: sanitizeUser(req.user) });
});

authRouter.post("/change-password", requireAuth(), async (req, res) => {
  const currentPassword = typeof req.body?.currentPassword === "string" ? req.body.currentPassword : "";
  const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "currentPassword e newPassword são obrigatórios" });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: "A nova senha deve ter pelo menos 6 caracteres" });
  }

  const fresh = await getUser(req.user.id);
  if (!fresh) return res.status(404).json({ error: "Usuário não encontrado" });
  const ok = await verifyPassword(currentPassword, fresh.passwordHash, fresh.passwordSalt);
  if (!ok) return res.status(401).json({ error: "Senha atual incorreta" });

  const { passwordHash, passwordSalt } = await hashPassword(newPassword);
  await setPassword(fresh.id, passwordHash, passwordSalt);
  res.json({ ok: true });
});
