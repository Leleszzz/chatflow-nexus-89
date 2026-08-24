import { Router } from "express";
import {
  createUser,
  deleteUser,
  listUsers,
  updateUser,
  getSanitizedUser,
} from "../storage/users-repo.js";
import { removeUserFromThreads } from "../storage/internal-chat-repo.js";
import { requireAuth } from "../middleware/require-auth.js";
import { isValidRole, isAdmin, ROLES, ROLE_VALUES } from "../lib/roles.js";

export const usersRouter = Router();

usersRouter.get("/", requireAuth(), async (_req, res) => {
  const all = await listUsers();
  res.json(all);
});

const CARGO_INVALIDO = `role inválido: use ${ROLE_VALUES.join(", ")}`;

usersRouter.post("/", requireAuth({ admin: true }), async (req, res) => {
  try {
    if (req.body?.role !== undefined && !isValidRole(req.body.role)) {
      return res.status(400).json({ error: CARGO_INVALIDO });
    }
    const created = await createUser(req.body || {});
    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

usersRouter.patch("/:id", requireAuth(), async (req, res) => {
  const targetId = req.params.id;
  const requesterIsAdmin = isAdmin(req.user);
  const requesterIsSelf = req.user.id === targetId;
  if (!requesterIsAdmin && !requesterIsSelf) {
    return res.status(403).json({ error: "Sem permissão para editar este usuário" });
  }

  const patch = { ...(req.body || {}) };

  if (!requesterIsAdmin) {
    delete patch.role;
    delete patch.active;
    delete patch.allowedTags;
    delete patch.allowedConversationIds;
    delete patch.allowedInstanceIds;
    delete patch.receivesNewLeads;
    delete patch.password;
  }

  delete patch.id;
  delete patch.passwordHash;
  delete patch.passwordSalt;

  if (patch.role !== undefined) {
    if (!isValidRole(patch.role)) return res.status(400).json({ error: CARGO_INVALIDO });
    // Sem isto o único admin consegue se rebaixar e ninguém mais entra em
    // /usuarios, /instancias ou /configuracoes para desfazer.
    if (patch.role !== ROLES.ADMIN && (await ehUltimoAdmin(targetId))) {
      return res.status(400).json({ error: "Não é possível remover o último administrador" });
    }
  }
  if (patch.active === false && (await ehUltimoAdmin(targetId))) {
    return res.status(400).json({ error: "Não é possível desativar o último administrador" });
  }

  const updated = await updateUser(targetId, patch);
  if (!updated) return res.status(404).json({ error: "Usuário não encontrado" });
  res.json(updated);
});

async function ehUltimoAdmin(userId) {
  const todos = await listUsers();
  const admins = todos.filter(u => u.active && isAdmin(u));
  return admins.length === 1 && admins[0].id === userId;
}

usersRouter.delete("/:id", requireAuth({ admin: true }), async (req, res) => {
  if (req.params.id === "admin") {
    return res.status(400).json({ error: "A conta admin inicial não pode ser excluída" });
  }
  const target = await getSanitizedUser(req.params.id);
  if (!target) return res.status(404).json({ error: "Usuário não encontrado" });
  if (await ehUltimoAdmin(req.params.id)) {
    return res.status(400).json({ error: "Não é possível excluir o último administrador" });
  }
  await deleteUser(req.params.id);
  // Sem isso sobrariam DMs apontando para um usuário que não existe mais.
  try {
    await removeUserFromThreads(req.params.id);
  } catch (err) {
    console.warn(`[users] limpeza do chat interno falhou: ${err.message}`);
  }
  res.status(204).end();
});
