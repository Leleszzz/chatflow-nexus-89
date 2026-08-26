// O que a instância É dentro do consultório. Espelha src/lib/instance-kinds.ts —
// os dois precisam ser alterados juntos.
//
// Não confundir com `ownerId`, que diz de QUEM ela é: o número da recepção é
// "secretaria" mesmo tendo uma secretária como responsável, e é normal que
// várias secretárias usem o mesmo aparelho. O tipo decide por onde a cobrança
// de exame sai (sempre pelo número da clínica) e a quem o botão "falar pelo meu
// WhatsApp" aparece.

export const INSTANCE_KINDS = {
  DOUTOR: "doutor",
  SECRETARIA: "secretaria",
};

export const INSTANCE_KIND_VALUES = [INSTANCE_KINDS.DOUTOR, INSTANCE_KINDS.SECRETARIA];

/**
 * Instância antiga não tem `tipo`. Vira "secretaria" — o número compartilhado
 * da recepção é o caso comum, e é o padrão que não dá poder a ninguém: marcar
 * errado como "doutor" faria surgir um botão de falar por um número pessoal
 * que talvez nem seja pessoal.
 */
export function normalizeInstanceKind(value) {
  const raw = String(value ?? "").trim();
  return INSTANCE_KIND_VALUES.includes(raw) ? raw : INSTANCE_KINDS.SECRETARIA;
}

export function isValidInstanceKind(value) {
  return INSTANCE_KIND_VALUES.includes(String(value ?? "").trim());
}
