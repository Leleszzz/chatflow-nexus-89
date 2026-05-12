import { Router } from "express";
import {
  createUser,
  deleteUser,
  listUsers,
  updateUser,
  getSanitizedUser,
} from "../storage/users-repo.js";
import { requireAuth } from "../middleware/require-auth.js";

export const usersRouter = Router();

usersRouter.get("/", requireAuth(), async (_req, res) => {
  const all = await listUsers();
  res.json(all);
});

usersRouter.post("/", requireAuth({ admin: true }), async (req, res) => {
  try {
    const created = await createUser(req.body || {});
    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

usersRouter.patch("/:id", requireAuth(), async (req, res) => {
  const targetId = req.params.id;
  const requesterIsAdmin = req.user.role === "Administrador";
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

  const updated = await updateUser(targetId, patch);
  if (!updated) return res.status(404).json({ error: "Usuário não encontrado" });
  res.json(updated);
});

usersRouter.delete("/:id", requireAuth({ admin: true }), async (req, res) => {
  if (req.params.id === "admin") {
    return res.status(400).json({ error: "A conta admin inicial não pode ser excluída" });
  }
  const target = await getSanitizedUser(req.params.id);
  if (!target) return res.status(404).json({ error: "Usuário não encontrado" });
  await deleteUser(req.params.id);
  res.status(204).end();
});
