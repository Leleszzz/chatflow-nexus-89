// Espelha as regras de visibilidade de `canViewDeal`/`DEFAULT_PERMISSIONS` do
// front (src/store/crm-store.tsx). Mantém o backend como fonte de verdade da
// permissão para que um deal só chegue a quem pode vê-lo.

// Papéis que enxergam TODOS os atendimentos (têm a permissão "Ver todos os
// atendimentos" no mapa do front).
const SEE_ALL_ROLES = new Set(["Administrador", "Gerente", "Suporte"]);

export function canUserSeeDeal(user, deal) {
  if (!user || !deal) return false;
  if (SEE_ALL_ROLES.has(user.role)) return true;

  const assigned = [deal.sellerId, ...(deal.assignedSellerIds || [])].filter(Boolean);
  if (assigned.includes(user.id)) return true;

  if (Array.isArray(user.allowedConversationIds) && user.allowedConversationIds.includes(deal.id)) return true;

  const allowedTags = Array.isArray(user.allowedTags) ? user.allowedTags : [];
  const dealTags = Array.isArray(deal.tags) ? deal.tags : [];
  if (allowedTags.length && dealTags.some(tag => allowedTags.includes(tag))) return true;

  return false;
}

// IDs dos usuários (ativos) que podem ver o deal — usado para emissão de socket.
export function permittedUserIds(deal, users) {
  return (users || [])
    .filter(u => u && u.active !== false && canUserSeeDeal(u, deal))
    .map(u => u.id);
}
