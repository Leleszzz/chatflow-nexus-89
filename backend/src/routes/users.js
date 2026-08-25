import { Router } from "../lib/safe-router.js";
import {
  createUser,
  deleteUser,
  listUsers,
  updateUser,
  getSanitizedUser,
} from "../storage/users-repo.js";
import { removeUserFromThreads } from "../storage/internal-chat-repo.js";
import { requireAuth } from "../middleware/require-auth.js";
import { revalidarSocketsDoUsuario } from "../socket/events.js";
import { registrarAsync, ACOES } from "../lib/auditoria.js";
import { isValidRole, isAdmin, ROLES, ROLE_VALUES } from "../lib/roles.js";

export const usersRouter = Router();

// O front precisa da lista para montar seletor de responsável e exibir nome de
// quem enviou. Isso NÃO exige e-mail e telefone de toda a equipe — que era o
// que a rota devolvia para qualquer cargo.
const CAMPOS_PUBLICOS = ["id", "name", "username", "role", "active", "avatar", "photoUrl", "receivesNewLeads"];

function resumirUsuario(user) {
  const out = {};
  for (const campo of CAMPOS_PUBLICOS) if (user[campo] !== undefined) out[campo] = user[campo];
  return out;
}

usersRouter.get("/", requireAuth(), async (req, res) => {
  const all = await listUsers();
  // Admin administra a equipe e precisa do cadastro completo; os demais recebem
  // só o necessário para a interface funcionar.
  res.json(isAdmin(req.user) ? all : all.map(resumirUsuario));
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

  // Mudanca de cargo, desativacao ou de instancias liberadas so valia no
  // proximo reload da pagina da pessoa: a permissao do socket era resolvida
  // uma vez, no handshake. Revogar acesso enquanto ela estava com o CRM
  // aberto nao tinha efeito nenhum sobre o tempo real.
  const mexeuEmPermissao = ["role", "active", "allowedInstanceIds", "allowedTags", "allowedConversationIds"]
    .some(campo => campo in patch);
  if (mexeuEmPermissao) {
    registrarAsync(req, ACOES.ALTERAR_USUARIO, { alvo: targetId, campos: Object.keys(patch) });
    revalidarSocketsDoUsuario(req.app.get("io"), targetId)
      .catch(err => console.warn(`[users] revalidar sockets falhou: ${err.message}`));
  }
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
  registrarAsync(req, ACOES.ALTERAR_USUARIO, { alvo: req.params.id, acao: "excluido" });
  revalidarSocketsDoUsuario(req.app.get("io"), req.params.id)
    .catch(err => console.warn(`[users] revalidar sockets falhou: ${err.message}`));
  // Sem isso sobrariam DMs apontando para um usuário que não existe mais.
  try {
    await removeUserFromThreads(req.params.id);
  } catch (err) {
    console.warn(`[users] limpeza do chat interno falhou: ${err.message}`);
  }
  res.status(204).end();
});
