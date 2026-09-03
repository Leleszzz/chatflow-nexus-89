// Fonte de verdade dos cargos no backend. Espelha src/lib/roles.ts do front —
// backend é ESM/JS e o front é TS, então não dá para importar um do outro; os
// dois arquivos precisam ser alterados juntos (o mesmo acordo já usado por
// lib/deal-permissions.js).

export const ROLES = {
  ADMIN: "admin",
  DOUTOR: "doutor",
  SECRETARIA: "secretaria",
};

export const ROLE_VALUES = [ROLES.ADMIN, ROLES.DOUTOR, ROLES.SECRETARIA];

// O que aparece na tela. O banco guarda a chave, nunca este texto.
export const ROLE_LABELS = {
  [ROLES.ADMIN]: "Administrador",
  [ROLES.DOUTOR]: "Doutor(a)",
  [ROLES.SECRETARIA]: "Secretária",
};

/**
 * O cargo escrito para uma pessoa ler. Espelha roleLabel de src/lib/roles.ts.
 *
 * Existe no backend porque o assistente monta texto — o prompt diz com quem está
 * falando, e a lista da equipe mostra o cargo de cada um. Passar o valor cru
 * ("secretaria") daria uma resposta em jargão de banco.
 */
export function roleLabel(value) {
  return ROLE_LABELS[normalizeRole(value)];
}

// Cargos da era "CRM de vendas". Nada é promovido para admin por acidente:
// qualquer coisa desconhecida vira secretaria, o cargo de menor privilégio útil.
const CARGOS_LEGADOS = {
  "Administrador": ROLES.ADMIN,
  "Gerente": ROLES.SECRETARIA,
  "Vendedora": ROLES.SECRETARIA,
  "Vendedor": ROLES.SECRETARIA,
  "Suporte": ROLES.SECRETARIA,
  "Financeiro": ROLES.SECRETARIA,
  "Somente leitura": ROLES.SECRETARIA,
};

export function normalizeRole(value) {
  const raw = String(value ?? "").trim();
  if (ROLE_VALUES.includes(raw)) return raw;
  if (CARGOS_LEGADOS[raw]) return CARGOS_LEGADOS[raw];
  return ROLES.SECRETARIA;
}

// `true` só quando o cargo já está normalizado — usado para validar entrada de
// API, onde silenciosamente virar secretaria seria pior que devolver 400.
export function isValidRole(value) {
  return ROLE_VALUES.includes(String(value ?? "").trim());
}

export function isAdmin(user) {
  return normalizeRole(user?.role) === ROLES.ADMIN;
}

export function isDoutor(user) {
  return normalizeRole(user?.role) === ROLES.DOUTOR;
}

export function isSecretaria(user) {
  return normalizeRole(user?.role) === ROLES.SECRETARIA;
}

// Quem enxerga TODOS os atendimentos. A secretária atende, agenda e encaminha,
// então precisa da fila inteira; o doutor vê só o que é dele.
export function seesAllDeals(user) {
  const role = normalizeRole(user?.role);
  return role === ROLES.ADMIN || role === ROLES.SECRETARIA;
}
