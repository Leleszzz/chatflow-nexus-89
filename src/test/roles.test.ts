import { describe, it, expect } from "vitest";
import {
  ROLES,
  ROLE_VALUES,
  ROLE_LABELS,
  ROLE_OPTIONS,
  ROLE_PERMISSIONS,
  ROUTE_ROLES,
  PERMISSIONS,
  normalizeRole,
  roleHasPermission,
  canRoleAccess,
  seesAllDeals,
  isAtendente,
  type Role,
} from "@/lib/roles";

describe("normalizeRole", () => {
  it("converte os cargos do esquema antigo", () => {
    expect(normalizeRole("Administrador")).toBe(ROLES.ADMIN);
    expect(normalizeRole("Vendedora")).toBe(ROLES.SECRETARIA);
    expect(normalizeRole("Gerente")).toBe(ROLES.SECRETARIA);
    expect(normalizeRole("Financeiro")).toBe(ROLES.SECRETARIA);
    expect(normalizeRole("Somente leitura")).toBe(ROLES.SECRETARIA);
    expect(normalizeRole("Suporte")).toBe(ROLES.SECRETARIA);
  });

  // Precisa bater com backend/src/lib/roles.js — os dois arquivos são espelho,
  // e divergir faria a tela mostrar um cargo diferente do que o servidor aplica.
  it("nunca promove ninguém a admin por engano", () => {
    const entradas = ["Gerente", "Vendedora", "Suporte", "Financeiro", "Somente leitura", "", null, undefined, "ADMIN"];
    expect(entradas.filter(v => normalizeRole(v) === ROLES.ADMIN)).toEqual([]);
  });

  it("é idempotente", () => {
    ROLE_VALUES.forEach(cargo => expect(normalizeRole(cargo)).toBe(cargo));
  });
});

describe("cobertura dos mapas de cargo", () => {
  it("todo cargo tem rótulo, permissões e opção de select", () => {
    ROLE_VALUES.forEach(cargo => {
      expect(ROLE_LABELS[cargo]).toBeTruthy();
      expect(Array.isArray(ROLE_PERMISSIONS[cargo])).toBe(true);
      expect(ROLE_OPTIONS.some(o => o.value === cargo)).toBe(true);
    });
  });

  it("admin tem todas as permissões", () => {
    expect(ROLE_PERMISSIONS[ROLES.ADMIN]).toEqual([...PERMISSIONS]);
  });

  it("só o admin configura a empresa e cria usuários", () => {
    expect(roleHasPermission(ROLES.DOUTOR, "Alterar configurações da empresa")).toBe(false);
    expect(roleHasPermission(ROLES.SECRETARIA, "Alterar configurações da empresa")).toBe(false);
    expect(roleHasPermission(ROLES.SECRETARIA, "Criar usuários")).toBe(false);
    expect(roleHasPermission(ROLES.ADMIN, "Criar usuários")).toBe(true);
  });

  it("espelha seesAllDeals do backend: admin e secretária veem tudo", () => {
    expect(seesAllDeals(ROLES.ADMIN)).toBe(true);
    expect(seesAllDeals(ROLES.SECRETARIA)).toBe(true);
    expect(seesAllDeals(ROLES.DOUTOR)).toBe(false);
  });

  it("admin não é atendente — não tem WhatsApp próprio nem recebe atendimento", () => {
    expect(isAtendente(ROLES.ADMIN)).toBe(false);
    expect(isAtendente(ROLES.DOUTOR)).toBe(true);
    expect(isAtendente(ROLES.SECRETARIA)).toBe(true);
  });
});

describe("canRoleAccess", () => {
  const esperado: Record<string, Role[]> = {
    "/": [ROLES.ADMIN, ROLES.DOUTOR, ROLES.SECRETARIA],
    "/conversas": [ROLES.ADMIN, ROLES.DOUTOR, ROLES.SECRETARIA],
    "/equipe": [ROLES.ADMIN, ROLES.DOUTOR, ROLES.SECRETARIA],
    "/calendario": [ROLES.ADMIN, ROLES.DOUTOR, ROLES.SECRETARIA],
    "/relatorios": [ROLES.ADMIN, ROLES.DOUTOR, ROLES.SECRETARIA],
    "/kanban": [ROLES.ADMIN, ROLES.SECRETARIA],
    "/secretaria": [ROLES.ADMIN, ROLES.SECRETARIA, ROLES.DOUTOR],
    "/prontuarios": [ROLES.ADMIN, ROLES.DOUTOR],
    "/consultas": [ROLES.ADMIN, ROLES.DOUTOR],
    "/assistente": [ROLES.ADMIN, ROLES.DOUTOR],
    "/agentes": [ROLES.ADMIN],
    "/campanhas": [ROLES.ADMIN],
    "/instancias": [ROLES.ADMIN],
    "/usuarios": [ROLES.ADMIN],
    "/configuracoes": [ROLES.ADMIN],
  };

  it("a matriz de acesso bate rota a rota, cargo a cargo", () => {
    Object.entries(esperado).forEach(([rota, permitidos]) => {
      ROLE_VALUES.forEach(cargo => {
        expect([rota, cargo, canRoleAccess(cargo, rota)]).toEqual([rota, cargo, permitidos.includes(cargo)]);
      });
    });
  });

  it("cobre exatamente as rotas de ROUTE_ROLES", () => {
    expect(Object.keys(ROUTE_ROLES).sort()).toEqual(Object.keys(esperado).sort());
  });

  // A secretária não lê transcrição de consulta; o doutor não mexe em usuários.
  it("os negativos importantes", () => {
    expect(canRoleAccess(ROLES.SECRETARIA, "/consultas")).toBe(false);
    expect(canRoleAccess(ROLES.SECRETARIA, "/prontuarios")).toBe(false);
    // O assistente le transcricao e prontuario: mesmo veto.
    expect(canRoleAccess(ROLES.SECRETARIA, "/assistente")).toBe(false);
    expect(canRoleAccess(ROLES.DOUTOR, "/usuarios")).toBe(false);
    expect(canRoleAccess(ROLES.DOUTOR, "/instancias")).toBe(false);
  });

  it("rota fora da tabela (login, 404) não é barrada", () => {
    expect(canRoleAccess(ROLES.SECRETARIA, "/login")).toBe(true);
    expect(canRoleAccess(ROLES.DOUTOR, "/qualquer-coisa")).toBe(true);
  });

  it("cargo legado ainda em cache não derruba o guard", () => {
    expect(canRoleAccess("Vendedora", "/conversas")).toBe(true);
    expect(canRoleAccess("Vendedora", "/usuarios")).toBe(false);
  });
});
