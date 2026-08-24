// Fonte de verdade dos cargos no front. Espelha backend/src/lib/roles.js —
// os dois precisam ser alterados juntos. O backend continua sendo a autoridade
// da permissão; o que está aqui decide o que a interface mostra.

export const ROLES = {
  ADMIN: "admin",
  DOUTOR: "doutor",
  SECRETARIA: "secretaria",
} as const;

export type Role = typeof ROLES[keyof typeof ROLES];

export const ROLE_VALUES: Role[] = [ROLES.ADMIN, ROLES.DOUTOR, ROLES.SECRETARIA];

// O que aparece na tela. O banco guarda a chave, nunca este texto.
export const ROLE_LABELS: Record<Role, string> = {
  [ROLES.ADMIN]: "Administrador",
  [ROLES.DOUTOR]: "Doutor(a)",
  [ROLES.SECRETARIA]: "Secretária",
};

export const ROLE_OPTIONS: { value: Role; label: string }[] = ROLE_VALUES.map(value => ({
  value,
  label: ROLE_LABELS[value],
}));

// Cargos da era "CRM de vendas". Nada é promovido para admin por acidente:
// qualquer coisa desconhecida vira secretaria, o cargo de menor privilégio útil.
const CARGOS_LEGADOS: Record<string, Role> = {
  "Administrador": ROLES.ADMIN,
  "Gerente": ROLES.SECRETARIA,
  "Vendedora": ROLES.SECRETARIA,
  "Vendedor": ROLES.SECRETARIA,
  "Suporte": ROLES.SECRETARIA,
  "Financeiro": ROLES.SECRETARIA,
  "Somente leitura": ROLES.SECRETARIA,
};

export function normalizeRole(value: string | null | undefined): Role {
  const raw = String(value ?? "").trim();
  if ((ROLE_VALUES as string[]).includes(raw)) return raw as Role;
  return CARGOS_LEGADOS[raw] || ROLES.SECRETARIA;
}

export function roleLabel(value: string | null | undefined): string {
  return ROLE_LABELS[normalizeRole(value)];
}

export function isAdminRole(value: string | null | undefined) {
  return normalizeRole(value) === ROLES.ADMIN;
}

export function isDoutorRole(value: string | null | undefined) {
  return normalizeRole(value) === ROLES.DOUTOR;
}

export function isSecretariaRole(value: string | null | undefined) {
  return normalizeRole(value) === ROLES.SECRETARIA;
}

// Quem enxerga TODOS os atendimentos — espelha seesAllDeals do backend.
export function seesAllDeals(value: string | null | undefined) {
  const role = normalizeRole(value);
  return role === ROLES.ADMIN || role === ROLES.SECRETARIA;
}

// ---- Permissões ----------------------------------------------------------
// As chaves seguem as mesmas de antes (são identificadores internos, não texto
// de tela); só o mapa cargo → permissões foi reescrito para a clínica.

export const PERMISSIONS = [
  "Ver dashboard",
  "Ver todos os atendimentos",
  "Ver apenas próprios atendimentos",
  "Editar funil",
  "Editar atendimentos",
  "Finalizar venda",
  "Criar agentes",
  "Editar agentes",
  "Ver relatórios",
  "Exportar dados",
  "Criar usuários",
  "Alterar configurações da empresa",
] as const;

export type PermissionKey = typeof PERMISSIONS[number];

export const ROLE_PERMISSIONS: Record<Role, PermissionKey[]> = {
  [ROLES.ADMIN]: [...PERMISSIONS],
  [ROLES.SECRETARIA]: [
    "Ver dashboard",
    "Ver todos os atendimentos",
    "Editar atendimentos",
    "Finalizar venda",
    "Ver relatórios",
  ],
  [ROLES.DOUTOR]: [
    "Ver dashboard",
    "Ver apenas próprios atendimentos",
    "Editar atendimentos",
    "Ver relatórios",
  ],
};

export function roleHasPermission(role: string | null | undefined, permission: PermissionKey) {
  return ROLE_PERMISSIONS[normalizeRole(role)].includes(permission);
}

// ---- Acesso por rota -----------------------------------------------------
// Tabela única consumida pelo guard de rota (App.tsx) e pela Sidebar, para os
// dois nunca divergirem. Prontuários e Consultas ficam fora da secretária de
// propósito: transcrição de consulta é dado clínico, e quem dispara exames e
// confirmação é o doutor — pela instância de WhatsApp dela, não pela tela.

const TODOS: Role[] = [ROLES.ADMIN, ROLES.DOUTOR, ROLES.SECRETARIA];

export const ROUTE_ROLES: Record<string, Role[]> = {
  "/": TODOS,
  "/conversas": TODOS,
  "/equipe": TODOS,
  "/calendario": TODOS,
  "/relatorios": TODOS,
  "/kanban": [ROLES.ADMIN, ROLES.SECRETARIA],
  "/prontuarios": [ROLES.ADMIN, ROLES.DOUTOR],
  "/consultas": [ROLES.ADMIN, ROLES.DOUTOR],
  "/agentes": [ROLES.ADMIN],
  "/campanhas": [ROLES.ADMIN],
  "/instancias": [ROLES.ADMIN],
  "/usuarios": [ROLES.ADMIN],
  "/configuracoes": [ROLES.ADMIN],
};

// Rota fora da tabela é liberada: só o que está listado é area do app com
// controle de cargo (o /login e o 404 não estão).
export function canRoleAccess(role: string | null | undefined, path: string) {
  const permitidos = ROUTE_ROLES[path];
  if (!permitidos) return true;
  return permitidos.includes(normalizeRole(role));
}

// ---- Helpers de equipe ---------------------------------------------------

/**
 * Quem pode ser responsável por um atendimento/agendamento. Na clínica tanto o
 * doutor quanto a secretária podem ser; o admin não atende.
 * Substitui os antigos `role !== "Administrador"` espalhados pelas telas.
 */
export function isAtendente(value: string | null | undefined) {
  return normalizeRole(value) !== ROLES.ADMIN;
}
