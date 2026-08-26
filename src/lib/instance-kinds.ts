// Espelho de backend/src/lib/instance-kinds.js — os dois precisam ser alterados
// juntos. O backend continua sendo a autoridade; o que está aqui decide o que a
// interface mostra.

import type { WhatsAppInstance } from "@/lib/whatsapp-api";

export const INSTANCE_KINDS = {
  DOUTOR: "doutor",
  SECRETARIA: "secretaria",
} as const;

export type InstanceKind = typeof INSTANCE_KINDS[keyof typeof INSTANCE_KINDS];

export const INSTANCE_KIND_VALUES: InstanceKind[] = [INSTANCE_KINDS.DOUTOR, INSTANCE_KINDS.SECRETARIA];

export const INSTANCE_KIND_LABELS: Record<InstanceKind, string> = {
  [INSTANCE_KINDS.DOUTOR]: "WhatsApp do doutor",
  [INSTANCE_KINDS.SECRETARIA]: "WhatsApp da secretaria",
};

export const INSTANCE_KIND_OPTIONS = INSTANCE_KIND_VALUES.map(value => ({
  value,
  label: INSTANCE_KIND_LABELS[value],
}));

/** Instância sem tipo é da recepção — mesmo padrão do backend. */
export function normalizeInstanceKind(value: string | null | undefined): InstanceKind {
  const raw = String(value ?? "").trim();
  return (INSTANCE_KIND_VALUES as string[]).includes(raw) ? (raw as InstanceKind) : INSTANCE_KINDS.SECRETARIA;
}

export function instanceKindLabel(value: string | null | undefined): string {
  return INSTANCE_KIND_LABELS[normalizeInstanceKind(value)];
}

/**
 * A instância pessoal do usuário: marcada como "doutor" E com ele de
 * responsável. As duas condições importam — o número da recepção também tem
 * responsável, e sem o tipo a secretária ganharia o botão de falar "pelo
 * próprio WhatsApp" apontando para o número compartilhado.
 */
export function instanciaPropria(
  instances: WhatsAppInstance[],
  userId: string | null | undefined,
): WhatsAppInstance | null {
  if (!userId) return null;
  return instances.find(i => normalizeInstanceKind(i.tipo) === INSTANCE_KINDS.DOUTOR && i.ownerId === userId) || null;
}

/** O número oficial da clínica — por onde a secretaria cobra exames e confirma. */
export function instanciaDaSecretaria(instances: WhatsAppInstance[]): WhatsAppInstance | null {
  const daSecretaria = instances.filter(i => normalizeInstanceKind(i.tipo) === INSTANCE_KINDS.SECRETARIA);
  // Conectada na frente: mandar por uma instância desligada só produz erro.
  return daSecretaria.find(i => i.status === "ativa") || daSecretaria[0] || null;
}
