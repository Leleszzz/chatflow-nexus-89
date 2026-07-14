import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { decodeAuthToken } from "@/lib/auth-token";
import { Deal, DealStage, INITIAL_AGENTS, Agent, AgentUsage, ALL_TAGS, STAGES, Stage } from "@/lib/mock-data";
import { setApiAuthToken, whatsappApi, UserRecord, ProntuarioAttachment, ProntuarioCategory } from "@/lib/whatsapp-api";
import { getSocket, setSocketAuthToken } from "@/lib/whatsapp-socket";

const inferProntuarioCategory = (
  messageType?: string,
  mimeType?: string,
): ProntuarioCategory => {
  const t = String(messageType || "").toLowerCase();
  if (t === "image" || t === "sticker") return "foto";
  if (t === "video") return "video";
  if (t === "audio" || t === "ptt") return "audio";
  if (t === "document") return "documento";
  const m = String(mimeType || "").toLowerCase();
  if (m.startsWith("image/")) return "foto";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  if (m) return "documento";
  return "outro";
};

interface FinishedDeal {
  dealId: string;
  result: "venda" | "recusa";
  amount?: number;
  description?: string;
  product?: string;
  payment?: string;
  reason?: string;
  notes?: string;
  finishedAt: string;
  operatorId: string;
}

export type AppointmentType = "retorno" | "reuniao" | "follow-up" | "ligacao" | "demonstracao" | "pos-venda" | "retorno-comercial" | "outro";

export interface Appointment {
  id: string;
  title: string;
  dealId: string;
  date: string;
  startTime: string;
  endTime: string;
  sellerId: string;
  description: string;
  type: AppointmentType;
  status?: "agendado" | "concluido" | "cancelado";
  origin?: string;
}

export type TeamUser = {
  id: string;
  name: string;
  username?: string;
  avatar: string;
  photoUrl?: string;
  email: string;
  phone?: string;
  role: string;
  password?: string;
  active: boolean;
  allowedTags?: string[];
  allowedConversationIds?: string[];
  allowedInstanceIds?: string[];
  receivesNewLeads?: boolean;
};

export type SchedulingProposal = {
  baseDateIso: string;
  days: string[];
  createdAt: string;
};

export type CrmPatch = {
  dealId?: string;
  customer?: string;
  sellerId?: string;
  assignedSellerIds?: string[];
  temperature?: Deal["temperature"];
  tags?: string[];
  stage?: string;
  notes?: string;
  aiEnabled?: boolean;
  aiAgentId?: string;
  schedulingProposal?: SchedulingProposal | null;
};

export type LeadDistributionStrategy = "round-robin" | "load-balanced";

export type LeadDistribution = {
  enabled: boolean;
  strategy: LeadDistributionStrategy;
  eligibleUserIds: string[];
  lastAssignedUserId?: string;
};

export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type DaySchedule = {
  enabled: boolean;
  startTime: string;
  endTime: string;
};

export type AgentSchedule = {
  enabled: boolean;
  agentId: string;
  weekly: Record<DayOfWeek, DaySchedule>;
};

export const WEEKDAY_LABELS: Record<DayOfWeek, string> = {
  0: "Domingo",
  1: "Segunda",
  2: "Terça",
  3: "Quarta",
  4: "Quinta",
  5: "Sexta",
  6: "Sábado",
};

const DEFAULT_LEAD_DISTRIBUTION: LeadDistribution = {
  enabled: false,
  strategy: "round-robin",
  eligibleUserIds: [],
};

const DEFAULT_AGENT_SCHEDULE: AgentSchedule = {
  enabled: false,
  agentId: "",
  weekly: {
    0: { enabled: false, startTime: "18:00", endTime: "23:59" },
    1: { enabled: false, startTime: "18:00", endTime: "23:59" },
    2: { enabled: false, startTime: "18:00", endTime: "23:59" },
    3: { enabled: false, startTime: "18:00", endTime: "23:59" },
    4: { enabled: false, startTime: "18:00", endTime: "23:59" },
    5: { enabled: false, startTime: "18:00", endTime: "23:59" },
    6: { enabled: false, startTime: "18:00", endTime: "23:59" },
  },
};

const timeToMinutes = (time: string) => {
  const [h, m] = time.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
};

export const isAgentScheduleActiveAt = (schedule: AgentSchedule, date: Date = new Date()) => {
  if (!schedule.enabled) return false;
  const day = date.getDay() as DayOfWeek;
  const window = schedule.weekly[day];
  if (!window?.enabled) return false;
  const start = timeToMinutes(window.startTime);
  const end = timeToMinutes(window.endTime);
  if (start === null || end === null) return false;
  const now = date.getHours() * 60 + date.getMinutes();
  if (start <= end) return now >= start && now <= end;
  return now >= start || now <= end;
};

export type AccountProfile = {
  name: string;
  email: string;
  phone: string;
  role: string;
  avatar: string;
  photoUrl?: string;
};

interface CRMCtx {
  deals: Deal[];
  setDeals: React.Dispatch<React.SetStateAction<Deal[]>>;
  addDeal: (deal: Deal) => void;
  removeDeal: (id: string) => void;
  moveDeal: (id: string, stage: DealStage) => void;
  updateDeal: (id: string, patch: Partial<Deal>) => void;
  stages: Stage[];
  addStage: (title: string, color?: string) => void;
  updateStage: (id: string, patch: Partial<Stage>) => void;
  moveStage: (id: string, direction: "up" | "down") => void;
  reorderStage: (activeId: string, overId: string) => void;
  removeStage: (id: string) => boolean;
  appointments: Appointment[];
  addAppointment: (appointment: Appointment) => void;
  updateAppointment: (id: string, patch: Partial<Appointment>) => void;
  removeAppointment: (id: string) => void;
  finished: FinishedDeal[];
  finishDeal: (f: FinishedDeal) => void;
  agents: Agent[];
  setAgents: React.Dispatch<React.SetStateAction<Agent[]>>;
  agentUsage: Record<string, AgentUsage>;
  refreshAgentUsage: () => Promise<void>;
  resetAgentUsage: (agentId: string) => Promise<void>;
  tags: string[];
  setTags: React.Dispatch<React.SetStateAction<string[]>>;
  teamUsers: TeamUser[];
  setTeamUsers: React.Dispatch<React.SetStateAction<TeamUser[]>>;
  accountProfile: AccountProfile;
  setAccountProfile: React.Dispatch<React.SetStateAction<AccountProfile>>;
  currentUser: TeamUser | null;
  authReady: boolean;
  isAdmin: boolean;
  login: (identifier: string, password: string) => Promise<boolean>;
  logout: () => void;
  hasPermission: (permission: PermissionKey) => boolean;
  canViewDeal: (deal: Deal) => boolean;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  refreshTeamUsers: () => Promise<void>;
  conversationPatches: Record<string, CrmPatch>;
  setConversationPatch: (conversationId: string, patch: CrmPatch) => void;
  clearSchedulingProposal: (conversationId: string) => void;
  leadDistribution: LeadDistribution;
  setLeadDistribution: React.Dispatch<React.SetStateAction<LeadDistribution>>;
  agentSchedule: AgentSchedule;
  setAgentSchedule: React.Dispatch<React.SetStateAction<AgentSchedule>>;
  getEligibleSellers: () => TeamUser[];
  assignNextSeller: (conversationId: string) => string | null;
  applyScheduledAgentIfActive: (conversationId: string) => boolean;
  isAgentScheduleActive: (date?: Date) => boolean;
  prontuarios: ProntuarioAttachment[];
  refreshProntuarios: () => Promise<void>;
  getProntuariosByDeal: (dealId: string) => ProntuarioAttachment[];
  linkMessageToProntuario: (input: {
    dealId: string;
    name: string;
    mediaUrl: string;
    mediaMime?: string;
    messageType?: string;
    conversationId?: string;
    messageId?: string;
    instanceId?: string;
  }) => Promise<ProntuarioAttachment>;
  uploadProntuarioFile: (input: { dealId: string; name: string; file: File }) => Promise<ProntuarioAttachment>;
  renameProntuario: (id: string, name: string) => Promise<void>;
  removeProntuario: (id: string) => Promise<void>;
}

const Ctx = createContext<CRMCtx | null>(null);

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

const DEFAULT_PERMISSIONS: Record<string, PermissionKey[]> = {
  Administrador: [...PERMISSIONS],
  Gerente: PERMISSIONS.filter(permission => !["Criar usuários", "Alterar configurações da empresa", "Editar funil"].includes(permission)),
  Vendedora: ["Ver dashboard", "Ver apenas próprios atendimentos", "Finalizar venda"],
  Suporte: ["Ver dashboard", "Ver todos os atendimentos", "Ver relatórios"],
};

const loadStored = <T,>(key: string, fallback: T) => {
  try {
    const stored = window.localStorage.getItem(key);
    return stored ? JSON.parse(stored) as T : fallback;
  } catch {
    return fallback;
  }
};

const VALID_MODELS: ReadonlyArray<Agent["model"]> = ["econom", "balanced", "premium"];

const normalizeAgent = (raw: Partial<Agent> & { id?: string }): Agent => ({
  id: String(raw.id || `a${Date.now()}`),
  name: String(raw.name || ""),
  description: String(raw.description || ""),
  prompt: String(raw.prompt || ""),
  model: (VALID_MODELS as readonly string[]).includes(raw.model as string)
    ? (raw.model as Agent["model"])
    : "balanced",
  temperature: Number.isFinite(Number(raw.temperature)) ? Number(raw.temperature) : 0.7,
  active: raw.active !== false,
  conversations: Number(raw.conversations) || 0,
  updatedAt: String(raw.updatedAt || new Date().toISOString()),
  channel: String(raw.channel || "WhatsApp Principal"),
  triggerTags: Array.isArray(raw.triggerTags) ? raw.triggerTags.map(String) : [],
  blockWords: Array.isArray(raw.blockWords) ? raw.blockWords.map(String) : [],
  handoffMessage: String(raw.handoffMessage || "Vou te transferir para um especialista."),
  fallbackMessage: raw.fallbackMessage,
  objective: raw.objective,
  tone: raw.tone,
});

const loadAgents = (): Agent[] => {
  const stored = loadStored<Partial<Agent>[]>("crm-agents", INITIAL_AGENTS as Partial<Agent>[]);
  return Array.isArray(stored) ? stored.map(normalizeAgent) : [];
};

const INITIAL_APPOINTMENTS: Appointment[] = [
  {
    id: "a1",
    title: "Follow-up proposta",
    dealId: "d1",
    date: "2026-04-30",
    startTime: "14:00",
    endTime: "14:30",
    sellerId: "s1",
    description: "Revisar desconto e prazo para fechamento.",
    type: "follow-up",
  },
  {
    id: "a2",
    title: "Demonstração produto",
    dealId: "d13",
    date: "2026-04-30",
    startTime: "10:00",
    endTime: "11:00",
    sellerId: "s1",
    description: "Apresentar linha B2B e condições fiscais.",
    type: "demonstracao",
  },
];

const FALLBACK_ADMIN_PROFILE: AccountProfile = {
  name: "Administrador",
  email: "admin@empresa.com",
  phone: "",
  role: "Administrador",
  avatar: "AD",
};

const profileFromUser = (user: TeamUser): AccountProfile => ({
  name: user.name,
  email: user.email,
  phone: user.phone || "",
  role: user.role,
  avatar: user.avatar,
  photoUrl: user.photoUrl,
});

const toTeamUser = (record: UserRecord): TeamUser => ({
  id: record.id,
  name: record.name,
  username: record.username,
  avatar: record.avatar || "",
  photoUrl: record.photoUrl,
  email: record.email,
  phone: record.phone,
  role: record.role,
  active: record.active,
  allowedTags: record.allowedTags || [],
  allowedConversationIds: record.allowedConversationIds || [],
  allowedInstanceIds: record.allowedInstanceIds || [],
  receivesNewLeads: record.receivesNewLeads,
});

export function CRMProvider({ children }: { children: ReactNode }) {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [finished, setFinished] = useState<FinishedDeal[]>([]);
  const [agents, setAgents] = useState<Agent[]>(() => loadAgents());
  const [agentUsage, setAgentUsage] = useState<Record<string, AgentUsage>>({});
  const [tags, setTags] = useState<string[]>(() => loadStored("crm-tags", ALL_TAGS));
  const [stages, setStages] = useState<Stage[]>(STAGES);
  const [appointments, setAppointments] = useState<Appointment[]>(() => loadStored("crm-appointments", INITIAL_APPOINTMENTS));
  const [teamUsers, setTeamUsers] = useState<TeamUser[]>([]);
  const [authToken, setAuthToken] = useState<string | null>(() => loadStored("crm-auth-token", null));
  const [authReady, setAuthReady] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [accountProfile, setAccountProfile] = useState<AccountProfile>(() => loadStored("crm-account-profile", FALLBACK_ADMIN_PROFILE));
  const [conversationPatches, setConversationPatches] = useState<Record<string, CrmPatch>>(() => loadStored("crm-wa-conversation-patches", {} as Record<string, CrmPatch>));
  const [leadDistribution, setLeadDistribution] = useState<LeadDistribution>(() => ({ ...DEFAULT_LEAD_DISTRIBUTION, ...loadStored("crm-lead-distribution", DEFAULT_LEAD_DISTRIBUTION) }));
  const [prontuarios, setProntuarios] = useState<ProntuarioAttachment[]>([]);
  const [agentSchedule, setAgentSchedule] = useState<AgentSchedule>(() => {
    const stored = loadStored("crm-agent-schedule", DEFAULT_AGENT_SCHEDULE);
    return { ...DEFAULT_AGENT_SCHEDULE, ...stored, weekly: { ...DEFAULT_AGENT_SCHEDULE.weekly, ...(stored?.weekly || {}) } };
  });

  const currentUser = teamUsers.find(user => user.id === currentUserId && user.active) || null;
  const isAdmin = currentUser?.role === "Administrador";

  useEffect(() => {
    window.localStorage.setItem("crm-appointments", JSON.stringify(appointments));
  }, [appointments]);

  useEffect(() => {
    window.localStorage.setItem("crm-account-profile", JSON.stringify(accountProfile));
  }, [accountProfile]);

  useEffect(() => {
    window.localStorage.setItem("crm-agents", JSON.stringify(agents));
  }, [agents]);

  useEffect(() => {
    window.localStorage.setItem("crm-tags", JSON.stringify(tags));
  }, [tags]);

  useEffect(() => {
    window.localStorage.setItem("crm-wa-conversation-patches", JSON.stringify(conversationPatches));
  }, [conversationPatches]);

  useEffect(() => {
    window.localStorage.setItem("crm-lead-distribution", JSON.stringify(leadDistribution));
  }, [leadDistribution]);

  useEffect(() => {
    window.localStorage.setItem("crm-agent-schedule", JSON.stringify(agentSchedule));
  }, [agentSchedule]);

  useEffect(() => {
    if (authToken) {
      window.localStorage.setItem("crm-auth-token", JSON.stringify(authToken));
    } else {
      window.localStorage.removeItem("crm-auth-token");
      window.localStorage.removeItem("crm-current-user-id");
    }
  }, [authToken]);

  useEffect(() => {
    setApiAuthToken(authToken);
    setSocketAuthToken(authToken);
  }, [authToken]);

  const refreshTeamUsers = useCallback(async () => {
    try {
      const list = await whatsappApi.listUsers();
      setTeamUsers(list.map(toTeamUser));
    } catch (err) {
      console.warn("[crm-store] listUsers failed", err);
    }
  }, []);

  const refreshProntuarios = useCallback(async () => {
    try {
      const list = await whatsappApi.listProntuarios();
      setProntuarios(list);
    } catch (err) {
      console.warn("[crm-store] listProntuarios failed", err);
    }
  }, []);

  const refreshDeals = useCallback(async () => {
    try {
      const list = await whatsappApi.listDeals();
      setDeals(list);
    } catch (err) {
      console.warn("[crm-store] listDeals failed", err);
    }
  }, []);

  const refreshStages = useCallback(async () => {
    try {
      const list = await whatsappApi.listStages();
      if (Array.isArray(list) && list.length) setStages(list);
    } catch (err) {
      console.warn("[crm-store] listStages failed", err);
    }
  }, []);

  const refreshAgentUsage = useCallback(async () => {
    try {
      const map = await whatsappApi.getAgentUsage();
      setAgentUsage(map || {});
    } catch (err) {
      console.warn("[crm-store] getAgentUsage failed", err);
    }
  }, []);

  const resetAgentUsageRemote = useCallback(async (agentId: string) => {
    try {
      await whatsappApi.resetAgentUsage(agentId);
      setAgentUsage(prev => {
        if (!(agentId in prev)) return prev;
        const next = { ...prev };
        delete next[agentId];
        return next;
      });
    } catch (err) {
      console.warn("[crm-store] resetAgentUsage failed", err);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!authToken) {
      setCurrentUserId(null);
      setTeamUsers([]);
      setAuthReady(true);
      return () => {
        cancelled = true;
      };
    }

    const payload = decodeAuthToken(authToken);
    if (!payload || (payload.exp && payload.exp <= Math.floor(Date.now() / 1000))) {
      setCurrentUserId(null);
      setAuthToken(null);
      setAuthReady(true);
      return () => {
        cancelled = true;
      };
    }

    setAuthReady(false);
    whatsappApi.me()
      .then(({ user }) => {
        if (cancelled) return;
        setCurrentUserId(user.id);
        setTeamUsers(prev => {
          if (prev.some(u => u.id === user.id)) return prev;
          return [...prev, toTeamUser(user)];
        });
      })
      .catch(err => {
        if (cancelled) return;
        console.warn("[crm-store] /auth/me failed", err);
        setCurrentUserId(null);
        setAuthToken(null);
      })
      .finally(() => {
        if (!cancelled) setAuthReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [authToken]);

  useEffect(() => {
    if (!currentUserId) return;
    refreshTeamUsers();
    refreshProntuarios();
    refreshAgentUsage();
    refreshDeals();
    refreshStages();
  }, [currentUserId, refreshTeamUsers, refreshProntuarios, refreshAgentUsage, refreshDeals, refreshStages]);

  // Sincronização em tempo real dos cards/etapas (eventos do backend, já filtrados por permissão).
  useEffect(() => {
    if (!currentUserId) return;
    const socket = getSocket();
    const upsertDeal = (payload: { deal: Deal }) => {
      const deal = payload?.deal;
      if (!deal?.id) return;
      setDeals(prev => {
        const idx = prev.findIndex(d => d.id === deal.id);
        if (idx === -1) return [deal, ...prev];
        const next = prev.slice();
        next[idx] = deal;
        return next;
      });
    };
    const onDealDelete = (payload: { deal: Deal }) => {
      const id = payload?.deal?.id;
      if (id) setDeals(prev => prev.filter(d => d.id !== id));
    };
    const onStages = (payload: { stages: Stage[] }) => {
      if (Array.isArray(payload?.stages) && payload.stages.length) setStages(payload.stages);
    };
    socket.on("deal:new", upsertDeal);
    socket.on("deal:update", upsertDeal);
    socket.on("deal:delete", onDealDelete);
    socket.on("stages:update", onStages);
    return () => {
      socket.off("deal:new", upsertDeal);
      socket.off("deal:update", upsertDeal);
      socket.off("deal:delete", onDealDelete);
      socket.off("stages:update", onStages);
    };
  }, [currentUserId]);

  useEffect(() => {
    if (currentUser) setAccountProfile(profileFromUser(currentUser));
  }, [currentUser]);

  const login = async (identifier: string, password: string) => {
    try {
      const { token, user } = await whatsappApi.login(identifier, password);
      setAuthToken(token);
      setCurrentUserId(user.id);
      setTeamUsers(prev => {
        const next = prev.filter(u => u.id !== user.id);
        return [...next, toTeamUser(user)];
      });
      setAuthReady(true);
      setAccountProfile(profileFromUser(toTeamUser(user)));
      return true;
    } catch (err) {
      console.warn("[crm-store] login failed", err);
      return false;
    }
  };

  const logout = () => {
    setCurrentUserId(null);
    setAuthToken(null);
    setTeamUsers([]);
  };

  const changePassword = async (currentPassword: string, newPassword: string) => {
    await whatsappApi.changePassword(currentPassword, newPassword);
  };

  const hasPermission = (permission: PermissionKey) => {
    if (!currentUser) return false;
    if (currentUser.role === "Administrador") return true;
    return (DEFAULT_PERMISSIONS[currentUser.role] || []).includes(permission);
  };

  const canViewDeal = (deal: Deal) => {
    if (!currentUser) return false;
    if (currentUser.role === "Administrador" || hasPermission("Ver todos os atendimentos")) return true;

    const assignedSellerIds = Array.from(new Set([deal.sellerId, ...(deal.assignedSellerIds || [])].filter(Boolean)));
    const hasDirectAccess = assignedSellerIds.includes(currentUser.id);
    const hasConversationAccess = Boolean(currentUser.allowedConversationIds?.includes(deal.id));
    const hasTagAccess = currentUser.allowedTags?.length ? deal.tags.some(tag => currentUser.allowedTags?.includes(tag)) : false;

    return hasDirectAccess || hasConversationAccess || hasTagAccess;
  };

  // Cards do Kanban são persistidos no backend (filtrados por permissão no servidor)
  // e sincronizados via socket. As mutações fazem update otimista + chamada à API.
  const addDeal = (deal: Deal) => {
    setDeals(prev => [deal, ...prev]);
    whatsappApi.createDeal(deal).catch(err => console.warn("[crm-store] createDeal failed", err));
  };
  const removeDeal = (id: string) => {
    setDeals(prev => prev.filter(deal => deal.id !== id));
    setAppointments(prev => prev.filter(appointment => appointment.dealId !== id));
    setProntuarios(prev => prev.filter(p => p.dealId !== id));
    whatsappApi.deleteDeal(id).catch(err => console.warn("[crm-store] deleteDeal failed", err));
    whatsappApi.deleteProntuariosByDeal(id).catch(err => {
      console.warn("[crm-store] deleteProntuariosByDeal failed", err);
    });
  };
  const moveDeal = (id: string, stage: DealStage) => {
    setDeals(prev => prev.map(d => (d.id === id ? { ...d, stage } : d)));
    whatsappApi.updateDeal(id, { stage }).catch(err => console.warn("[crm-store] moveDeal failed", err));
  };
  const updateDeal = (id: string, patch: Partial<Deal>) => {
    setDeals(prev => prev.map(d => (d.id === id ? { ...d, ...patch } : d)));
    whatsappApi.updateDeal(id, patch).catch(err => console.warn("[crm-store] updateDeal failed", err));
  };
  // Etapas/colunas s\u00e3o compartilhadas (backend). Muta\u00e7\u00f5es fazem update otimista
  // e persistem; o broadcast "stages:update" reconcilia todos os clientes.
  const persistStageOrder = (ordered: Stage[]) => {
    whatsappApi.reorderStages(ordered.map(s => s.id)).catch(err => console.warn("[crm-store] reorderStages failed", err));
  };
  const addStage = (title: string, color = "bg-primary") => {
    const cleanTitle = title.trim();
    if (!cleanTitle) return;
    whatsappApi.createStage({ title: cleanTitle, color })
      .then(refreshStages)
      .catch(err => console.warn("[crm-store] createStage failed", err));
  };
  const updateStage = (id: string, patch: Partial<Stage>) => {
    setStages(prev => prev.map(stage => (stage.id === id ? { ...stage, ...patch } : stage)));
    whatsappApi.updateStage(id, { title: patch.title, color: patch.color })
      .catch(err => console.warn("[crm-store] updateStage failed", err));
  };
  const moveStage = (id: string, direction: "up" | "down") => {
    const index = stages.findIndex(stage => stage.id === id);
    if (index < 0) return;
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= stages.length) return;
    const next = [...stages];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    setStages(next);
    persistStageOrder(next);
  };
  const reorderStage = (activeId: string, overId: string) => {
    const activeIndex = stages.findIndex(stage => stage.id === activeId);
    const overIndex = stages.findIndex(stage => stage.id === overId);
    if (activeIndex < 0 || overIndex < 0 || activeIndex === overIndex) return;
    const next = [...stages];
    const [moved] = next.splice(activeIndex, 1);
    next.splice(overIndex, 0, moved);
    setStages(next);
    persistStageOrder(next);
  };
  const removeStage = (id: string) => {
    if (id === "fechado" || id === "perdido") return false;
    const fallback = stages.find(stage => stage.id !== id)?.id || "novo-lead";
    setStages(prev => prev.filter(stage => stage.id !== id));
    setDeals(prev => prev.map(deal => (deal.stage === id ? { ...deal, stage: fallback } : deal)));
    whatsappApi.deleteStage(id).catch(err => console.warn("[crm-store] deleteStage failed", err));
    return true;
  };
  const finishDeal = (f: FinishedDeal) => {
    setFinished(prev => [...prev, f]);
    const current = deals.find(deal => deal.id === f.dealId);
    const stage = f.result === "venda" ? "fechado" : "perdido";
    const estimatedValue = f.result === "venda" && f.amount !== undefined ? f.amount : current?.estimatedValue;
    setDeals(prev => prev.map(deal => (deal.id === f.dealId ? { ...deal, stage, estimatedValue } : deal)));
    whatsappApi.updateDeal(f.dealId, { stage, estimatedValue }).catch(err => console.warn("[crm-store] finishDeal failed", err));
  };
  const addAppointment = (appointment: Appointment) =>
    setAppointments(prev => [...prev, appointment].sort((a, b) => `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`)));
  const updateAppointment = (id: string, patch: Partial<Appointment>) =>
    setAppointments(prev => prev.map(appointment => (appointment.id === id ? { ...appointment, ...patch } : appointment)));
  const removeAppointment = (id: string) =>
    setAppointments(prev => prev.filter(appointment => appointment.id !== id));

  const setConversationPatch = (conversationId: string, patch: CrmPatch) =>
    setConversationPatches(prev => {
      const merged = { ...(prev[conversationId] || {}), ...patch };
      if (patch.schedulingProposal === null) delete merged.schedulingProposal;
      return { ...prev, [conversationId]: merged };
    });

  const clearSchedulingProposal = (conversationId: string) =>
    setConversationPatch(conversationId, { schedulingProposal: null });

  const getEligibleSellers = (): TeamUser[] => {
    const baseEligible = teamUsers.filter(user => user.active && user.receivesNewLeads && user.role !== "Administrador");
    if (!leadDistribution.eligibleUserIds.length) return baseEligible;
    return baseEligible.filter(user => leadDistribution.eligibleUserIds.includes(user.id));
  };

  const countAssignedConversations = (userId: string) => {
    let count = 0;
    for (const patch of Object.values(conversationPatches)) {
      const assignees = [patch.sellerId, ...(patch.assignedSellerIds || [])].filter(Boolean);
      if (assignees.includes(userId)) count += 1;
    }
    for (const deal of deals) {
      if (deal.stage === "fechado" || deal.stage === "perdido") continue;
      const assignees = [deal.sellerId, ...(deal.assignedSellerIds || [])].filter(Boolean);
      if (assignees.includes(userId)) count += 1;
    }
    return count;
  };

  const assignNextSeller = (conversationId: string): string | null => {
    const eligible = getEligibleSellers();
    if (!eligible.length) return null;
    let next: TeamUser;
    if (leadDistribution.strategy === "load-balanced") {
      const ranked = eligible
        .map(user => ({ user, load: countAssignedConversations(user.id) }))
        .sort((a, b) => a.load - b.load);
      next = ranked[0].user;
    } else {
      const lastId = leadDistribution.lastAssignedUserId;
      const lastIndex = lastId ? eligible.findIndex(user => user.id === lastId) : -1;
      const nextIndex = (lastIndex + 1) % eligible.length;
      next = eligible[nextIndex];
    }
    setConversationPatch(conversationId, { sellerId: next.id });
    setLeadDistribution(prev => ({ ...prev, lastAssignedUserId: next.id }));
    return next.id;
  };

  const applyScheduledAgentIfActive = (conversationId: string): boolean => {
    if (!agentSchedule.enabled || !agentSchedule.agentId) return false;
    if (!isAgentScheduleActiveAt(agentSchedule)) return false;
    setConversationPatch(conversationId, { aiEnabled: true, aiAgentId: agentSchedule.agentId });
    return true;
  };

  const isAgentScheduleActive = (date?: Date) => isAgentScheduleActiveAt(agentSchedule, date);

  const getProntuariosByDeal = useCallback(
    (dealId: string) => prontuarios.filter(p => p.dealId === dealId),
    [prontuarios],
  );

  const linkMessageToProntuario: CRMCtx["linkMessageToProntuario"] = async input => {
    const category = inferProntuarioCategory(input.messageType, input.mediaMime);
    const created = await whatsappApi.createProntuario({
      dealId: input.dealId,
      name: input.name,
      mediaUrl: input.mediaUrl,
      mediaMime: input.mediaMime,
      category,
      conversationId: input.conversationId,
      messageId: input.messageId,
      instanceId: input.instanceId,
      source: "whatsapp",
      uploadedBy: currentUserId || undefined,
    });
    setProntuarios(prev => [created, ...prev.filter(p => p.id !== created.id)]);
    return created;
  };

  const uploadProntuarioFile: CRMCtx["uploadProntuarioFile"] = async input => {
    const created = await whatsappApi.uploadProntuario(input.dealId, input.name, input.file, currentUserId || undefined);
    setProntuarios(prev => [created, ...prev.filter(p => p.id !== created.id)]);
    return created;
  };

  const renameProntuario: CRMCtx["renameProntuario"] = async (id, name) => {
    const updated = await whatsappApi.renameProntuario(id, name);
    setProntuarios(prev => prev.map(p => (p.id === id ? updated : p)));
  };

  const removeProntuario: CRMCtx["removeProntuario"] = async id => {
    await whatsappApi.deleteProntuario(id);
    setProntuarios(prev => prev.filter(p => p.id !== id));
  };

  return (
    <Ctx.Provider value={{ deals, setDeals, addDeal, removeDeal, moveDeal, updateDeal, stages, addStage, updateStage, moveStage, reorderStage, removeStage, appointments, addAppointment, updateAppointment, removeAppointment, finished, finishDeal, agents, setAgents, agentUsage, refreshAgentUsage, resetAgentUsage: resetAgentUsageRemote, tags, setTags, teamUsers, setTeamUsers, accountProfile, setAccountProfile, currentUser, authReady, isAdmin, login, logout, hasPermission, canViewDeal, changePassword, refreshTeamUsers, conversationPatches, setConversationPatch, clearSchedulingProposal, leadDistribution, setLeadDistribution, agentSchedule, setAgentSchedule, getEligibleSellers, assignNextSeller, applyScheduledAgentIfActive, isAgentScheduleActive, prontuarios, refreshProntuarios, getProntuariosByDeal, linkMessageToProntuario, uploadProntuarioFile, renameProntuario, removeProntuario }}>
      {children}
    </Ctx.Provider>
  );
}

export const useCRM = () => {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCRM must be used within CRMProvider");
  return ctx;
};
