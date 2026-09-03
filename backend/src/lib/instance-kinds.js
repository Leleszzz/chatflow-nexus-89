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

/**
 * A instância pessoal de um usuário: marcada como "doutor" E com ele de
 * responsável. As duas condições importam — o número da recepção também tem
 * responsável, e sem o tipo a secretária ganharia um "meu WhatsApp" apontando
 * para o número compartilhado.
 */
export function instanciaPropria(instances, userId) {
  if (!userId) return null;
  return (instances || []).find(
    i => normalizeInstanceKind(i?.tipo) === INSTANCE_KINDS.DOUTOR && i?.ownerId === userId,
  ) || null;
}

/**
 * O número oficial da clínica — por onde a secretaria cobra exames e confirma
 * consulta. É o padrão do que o assistente propõe enviar: cobrança saindo do
 * WhatsApp pessoal do doutor mistura o administrativo com o clínico.
 */
export function instanciaDaSecretaria(instances) {
  const daSecretaria = (instances || []).filter(
    i => normalizeInstanceKind(i?.tipo) === INSTANCE_KINDS.SECRETARIA,
  );
  // Conectada na frente: mandar por uma instância desligada só produz erro.
  return daSecretaria.find(i => i?.status === "ativa") || daSecretaria[0] || null;
}
