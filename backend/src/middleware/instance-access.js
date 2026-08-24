import { getInstance, listInstances } from "../storage/instances-repo.js";
import {
  canUserSeeInstance,
  canUserManageInstance,
  resolveAllowedInstanceIds,
} from "../lib/instance-permissions.js";

/**
 * Middleware para rotas com :id de instância. Carrega o registro em
 * `req.instance` e barra quem não pode. `manage: true` exige dono ou admin
 * (parear, reiniciar) em vez de só leitura.
 *
 * Usa 404 para quem não pode ver: responder 403 revelaria que a instância
 * existe para quem não deveria nem saber disso.
 */
export function requireInstanceAccess({ manage = false } = {}) {
  return async (req, res, next) => {
    const inst = await getInstance(req.params.id);
    if (!inst) return res.status(404).json({ error: "instância não encontrada" });
    if (!canUserSeeInstance(req.user, inst)) {
      return res.status(404).json({ error: "instância não encontrada" });
    }
    if (manage && !canUserManageInstance(req.user, inst)) {
      return res.status(403).json({ error: "somente o responsável pela instância ou um administrador" });
    }
    req.instance = inst;
    next();
  };
}

/** Ids que o usuário da requisição pode ver. `null` = todas (admin). */
export async function allowedInstanceIdsForRequest(req) {
  return resolveAllowedInstanceIds(req.user, await listInstances());
}

/** Checa um instanceId avulso, vindo do body ou da query. */
export async function userCanUseInstance(user, instanceId) {
  if (!instanceId) return false;
  const inst = await getInstance(instanceId);
  return Boolean(inst) && canUserSeeInstance(user, inst);
}
