import { Router } from "../lib/safe-router.js";
import {
  findByIdentifier,
  getUser,
  sanitizeUser,
  setPassword,
} from "../storage/users-repo.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { createAuthToken } from "../lib/auth-token.js";
import { setAuthCookie, clearAuthCookie, garantirCookieCsrf } from "../lib/auth-cookie.js";
import { requireAuth } from "../middleware/require-auth.js";
import { loginLimiter, senhaLimiter } from "../middleware/rate-limit.js";

export const authRouter = Router();

// 6 caracteres sem nenhuma outra exigência era fraco demais para um sistema
// exposto na internet que guarda prontuário. As senhas óbvias entram na lista
// porque são as primeiras que qualquer ataque de dicionário tenta.
const SENHAS_PROIBIDAS = new Set([
  "123456", "1234567", "12345678", "123456789", "1234567890",
  "senha123", "password", "admin123", "qwerty123", "clinica123",
  "abc12345", "000000", "111111", "senha1234",
]);

export function validarForcaSenha(senha) {
  if (typeof senha !== "string" || senha.length < 10) {
    return "A senha deve ter pelo menos 10 caracteres";
  }
  if (senha.length > 200) return "A senha é longa demais";
  if (SENHAS_PROIBIDAS.has(senha.toLowerCase())) {
    return "Essa senha é fácil demais de adivinhar — escolha outra";
  }
  if (!/[a-zA-Z]/.test(senha) || !/[0-9]/.test(senha)) {
    return "A senha deve misturar letras e números";
  }
  return null;
}

authRouter.post("/login", loginLimiter, async (req, res) => {
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
  // Reemite o cookie CSRF quando ele falta (sessao antiga, aba restaurada) —
  // sem isso o usuario logado ficaria sem conseguir gravar nada.
  garantirCookieCsrf(req, res);
  res.json({ user: sanitizeUser(req.user) });
});

authRouter.post("/change-password", senhaLimiter, requireAuth(), async (req, res) => {
  const currentPassword = typeof req.body?.currentPassword === "string" ? req.body.currentPassword : "";
  const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "currentPassword e newPassword são obrigatórios" });
  }
  const problemaSenha = validarForcaSenha(newPassword);
  if (problemaSenha) return res.status(400).json({ error: problemaSenha, code: "SENHA_FRACA" });
  if (newPassword === currentPassword) {
    return res.status(400).json({ error: "A nova senha precisa ser diferente da atual", code: "SENHA_REPETIDA" });
  }

  const fresh = await getUser(req.user.id);
  if (!fresh) return res.status(404).json({ error: "Usuário não encontrado" });
  const ok = await verifyPassword(currentPassword, fresh.passwordHash, fresh.passwordSalt);
  if (!ok) return res.status(401).json({ error: "Senha atual incorreta" });

  const { passwordHash, passwordSalt } = await hashPassword(newPassword);
  await setPassword(fresh.id, passwordHash, passwordSalt);
  res.json({ ok: true });
});
