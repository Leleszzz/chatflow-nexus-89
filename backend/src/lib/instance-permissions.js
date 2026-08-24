// Quem enxerga e quem administra cada instância de WhatsApp. Mesma forma de
// lib/deal-permissions.js: funções puras, sem acesso ao banco, para poderem ser
// usadas tanto pelas rotas HTTP quanto pelo handshake do Socket.IO.
//
// Regra do consultório: o doutor tem a instância dele (ownerId) e recebe a da
// secretária por liberação explícita (users.allowedInstanceIds, configurável em
// /usuarios). A secretária só tem a dela. O admin vê todas.

import { isAdmin } from "./roles.js";

export function canUserSeeInstance(user, instance) {
  if (!user || !instance) return false;
  if (isAdmin(user)) return true;
  if (instance.ownerId && instance.ownerId === user.id) return true;
  const liberadas = Array.isArray(user.allowedInstanceIds) ? user.allowedInstanceIds : [];
  return liberadas.includes(instance.id);
}

// Operações de manutenção da conexão (parear, reiniciar). Ser liberado a ver a
// instância de outra pessoa não dá direito de mexer na conexão dela.
export function canUserManageInstance(user, instance) {
  if (!user || !instance) return false;
  if (isAdmin(user)) return true;
  return Boolean(instance.ownerId) && instance.ownerId === user.id;
}

/**
 * Ids que o usuário pode ver. `null` significa "todas" (admin) — deixar
 * explícito evita o fail-open de tratar lista vazia como irrestrita.
 */
export function resolveAllowedInstanceIds(user, instances) {
  if (isAdmin(user)) return null;
  return (instances || []).filter(inst => canUserSeeInstance(user, inst)).map(inst => inst.id);
}
