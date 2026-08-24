// Espelha as regras de visibilidade de `canViewDeal`/`ROLE_PERMISSIONS` do
// front (src/lib/roles.ts). Mantém o backend como fonte de verdade da
// permissão para que um deal só chegue a quem pode vê-lo.

import { seesAllDeals } from "./roles.js";

export function canUserSeeDeal(user, deal) {
  if (!user || !deal) return false;
  // Admin e secretária enxergam todos; o doutor, só o que é dele.
  if (seesAllDeals(user)) return true;

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
