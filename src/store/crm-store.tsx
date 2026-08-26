import { createContext, useContext, useEffect, useState, useRef, ReactNode, useCallback, SetStateAction } from "react";
import type {
  Appointment, AppointmentType, DealOutcome, SchedulingProposal, CrmPatch,
  LeadDistribution, LeadDistributionStrategy, DayOfWeek, DaySchedule, AgentSchedule,
} from "@/lib/mock-data";
import { Deal, DealStage, Agent, AgentUsage, ALL_TAGS, STAGES, Stage, CustomField, CustomFieldValues } from "@/lib/mock-data";
import { ROLES, seesAllDeals, roleHasPermission, isAtendente, normalizeRole, type PermissionKey, type Role } from "@/lib/roles";
import { whatsappApi, UserRecord, ProntuarioAttachment, ProntuarioCategory, Consultation, Task } from "@/lib/whatsapp-api";
import { getSocket, reconnectSocket } from "@/lib/whatsapp-socket";
import { mensagemDeErro } from "@/lib/erros";

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

// Tipos compartilhados moram em mock-data.ts (o cliente de API também precisa
// deles). Reexportados aqui porque muita tela importa direto do store.
export type {
  Appointment, AppointmentType, DealOutcome, SchedulingProposal, CrmPatch,
  LeadDistribution, LeadDistributionStrategy, DayOfWeek, DaySchedule, AgentSchedule,
} from "@/lib/mock-data";

/** @deprecated use DealOutcome — mantido pelo nome usado nas telas. */
type FinishedDeal = DealOutcome;

export type TeamUser = {
  id: string;
  name: string;
  username?: string;
  avatar: string;
  photoUrl?: string;
  email: string;
  phone?: string;
  role: Role;
  password?: string;
  active: boolean;
  allowedTags?: string[];
  allowedConversationIds?: string[];
  allowedInstanceIds?: string[];
  receivesNewLeads?: boolean;
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
  role: Role;
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
  /** `id` e `operatorId` são atribuídos pelo servidor. */
  finishDeal: (f: Omit<FinishedDeal, "id" | "operatorId"> & { operatorId?: string }) => void;
  agents: Agent[];
  addAgent: (agent: Partial<Agent>) => Promise<Agent | null>;
  updateAgentConfig: (id: string, patch: Partial<Agent>) => Promise<void>;
  removeAgent: (id: string) => Promise<void>;
  /** Definições dos campos personalizados do lead (schema compartilhado). */
  customFields: CustomField[];
  refreshCustomFields: () => Promise<void>;
  setDealCustomField: (dealId: string, key: string, value: string | number | null) => void;
  agentUsage: Record<string, AgentUsage>;
  refreshAgentUsage: () => Promise<void>;
  resetAgentUsage: (agentId: string) => Promise<void>;
  tags: string[];
  addTag: (name: string) => void;
  removeTag: (name: string) => void;
  teamUsers: TeamUser[];
  setTeamUsers: React.Dispatch<React.SetStateAction<TeamUser[]>>;
  accountProfile: AccountProfile;
  setAccountProfile: React.Dispatch<React.SetStateAction<AccountProfile>>;
  currentUser: TeamUser | null;
  authReady: boolean;
  isAdmin: boolean;
  isDoutor: boolean;
  isSecretaria: boolean;
  currentRole: Role | null;
  /** `{ ok: false, motivo }` quando falha — o motivo já vem pronto para exibir. */
  login: (identifier: string, password: string) => Promise<{ ok: true } | { ok: false; motivo: string }>;
  logout: () => void;
  hasPermission: (permission: PermissionKey) => boolean;
  canViewDeal: (deal: Deal) => boolean;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  refreshTeamUsers: () => Promise<void>;
  conversationPatches: Record<string, CrmPatch>;
  setConversationPatch: (conversationId: string, patch: CrmPatch) => void;
  clearSchedulingProposal: (conversationId: string) => void;
  leadDistribution: LeadDistribution;
  setLeadDistribution: (value: SetStateAction<LeadDistribution>) => void;
  agentSchedule: AgentSchedule;
  setAgentSchedule: (value: SetStateAction<AgentSchedule>) => void;
  getEligibleSellers: () => TeamUser[];
  assignNextSeller: (conversationId: string) => void;
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
  consultations: Consultation[];
  refreshConsultations: () => Promise<void>;
  getConsultationsByDeal: (dealId: string) => Consultation[];
  removeConsultation: (id: string) => Promise<void>;
  tasks: Task[];
  refreshTasks: () => Promise<void>;
  createTask: (task: Partial<Task>) => Promise<Task>;
  updateTask: (id: string, patch: Partial<Task>) => Promise<void>;
  removeTask: (id: string) => Promise<void>;
}

const Ctx = createContext<CRMCtx | null>(null);

// As permissões e o mapa cargo → permissões moram em @/lib/roles (espelhado por
// backend/src/lib/roles.js). Reexportados aqui porque várias telas importam
// PermissionKey deste módulo desde antes.
export { PERMISSIONS } from "@/lib/roles";
export type { PermissionKey } from "@/lib/roles";

// Chaves do tempo em que o estado do time morava no navegador. Removidas no
// boot para não deixar lixo — os dados agora vêm todos do banco.
const LEGACY_STORAGE_KEYS = [
  "crm-tags",
  "crm-appointments",
  "crm-account-profile",
  "crm-wa-conversation-patches",
  "crm-lead-distribution",
  "crm-agent-schedule",
  "crm-current-user-id",
  "crm-auth-token",
];

const clearLegacyStorage = () => {
  try {
    for (const key of LEGACY_STORAGE_KEYS) window.localStorage.removeItem(key);
  } catch { /* modo privado / storage bloqueado */ }
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
  extractFields: Array.isArray(raw.extractFields) ? raw.extractFields.map(String) : [],
});



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
  role: ROLES.ADMIN,
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
  // Agentes vivem no Mongo (antes era localStorage): a meta de campos precisa
  // valer para o time inteiro, não só para o navegador que configurou.
  const [agents, setAgents] = useState<Agent[]>([]);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [agentUsage, setAgentUsage] = useState<Record<string, AgentUsage>>({});
  // Tudo abaixo vinha do localStorage e agora nasce vazio, preenchido pelas
  // rotas assim que o usuário autentica (efeito de carga mais abaixo).
  const [tags, setTagsState] = useState<string[]>(ALL_TAGS);
  const [stages, setStages] = useState<Stage[]>(STAGES);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [teamUsers, setTeamUsers] = useState<TeamUser[]>([]);
  const [authReady, setAuthReady] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  // Lido dentro do refreshTeamUsers, que é useCallback([]) — o ref evita
  // recriar o callback (e re-disparar os efeitos que dependem dele) a cada login.
  const currentUserIdRef = useRef<string | null>(null);
  useEffect(() => { currentUserIdRef.current = currentUserId; }, [currentUserId]);
  const [accountProfile, setAccountProfile] = useState<AccountProfile>(FALLBACK_ADMIN_PROFILE);
  // Derivado das conversas (conversations.crm) — ver refreshConversationPatches.
  const [conversationPatches, setConversationPatches] = useState<Record<string, CrmPatch>>({});
  const [leadDistribution, setLeadDistributionState] = useState<LeadDistribution>(DEFAULT_LEAD_DISTRIBUTION);
  const [prontuarios, setProntuarios] = useState<ProntuarioAttachment[]>([]);
  const [consultations, setConsultations] = useState<Consultation[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [agentSchedule, setAgentScheduleState] = useState<AgentSchedule>(DEFAULT_AGENT_SCHEDULE);
  // Espelhos síncronos: os setters resolvem a forma de updater sem depender do
  // estado do render atual (nem executar efeito colateral dentro do updater).
  const leadDistributionRef = useRef(leadDistribution);
  const agentScheduleRef = useRef(agentSchedule);
  useEffect(() => { leadDistributionRef.current = leadDistribution; }, [leadDistribution]);
  useEffect(() => { agentScheduleRef.current = agentSchedule; }, [agentSchedule]);

  const currentUser = teamUsers.find(user => user.id === currentUserId && user.active) || null;
  const currentRole: Role | null = currentUser ? normalizeRole(currentUser.role) : null;
  const isAdmin = currentRole === ROLES.ADMIN;
  const isDoutor = currentRole === ROLES.DOUTOR;
  const isSecretaria = currentRole === ROLES.SECRETARIA;

  // Único resquício do localStorage: apagar o que ficou das versões antigas.
  useEffect(() => { clearLegacyStorage(); }, []);

  const refreshTeamUsers = useCallback(async () => {
    try {
      const list = await whatsappApi.listUsers();
      const proximos = list.map(toTeamUser);
      // As instâncias que o socket entrega são resolvidas no handshake. Quando o
      // admin libera (ou tira) um canal deste usuário, sem reconectar ele
      // continuaria com o conjunto antigo até dar F5.
      setTeamUsers(anteriores => {
        const meuId = currentUserIdRef.current;
        const antes = anteriores.find(u => u.id === meuId)?.allowedInstanceIds || [];
        const depois = proximos.find(u => u.id === meuId)?.allowedInstanceIds || [];
        if (meuId && antes.join("|") !== depois.join("|")) reconnectSocket();
        return proximos;
      });
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

  const refreshConsultations = useCallback(async () => {
    try {
      const list = await whatsappApi.listConsultations();
      setConsultations(list);
    } catch (err) {
      console.warn("[crm-store] listConsultations failed", err);
    }
  }, []);

  const refreshTasks = useCallback(async () => {
    try {
      setTasks(await whatsappApi.listTasks());
    } catch (err) {
      console.warn("[crm-store] listTasks failed", err);
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

  const refreshAgents = useCallback(async () => {
    try {
      const list = await whatsappApi.listAgents();
      if (Array.isArray(list)) setAgents(list.map(normalizeAgent));
    } catch (err) {
      console.warn("[crm-store] listAgents failed", err);
    }
  }, []);

  const refreshCustomFields = useCallback(async () => {
    try {
      const list = await whatsappApi.listCustomFields();
      if (Array.isArray(list)) setCustomFields(list);
    } catch (err) {
      console.warn("[crm-store] listCustomFields failed", err);
    }
  }, []);

  const refreshTags = useCallback(async () => {
    try {
      const list = await whatsappApi.listTags();
      if (Array.isArray(list)) setTagsState(list);
    } catch (err) {
      console.warn("[crm-store] listTags failed", err);
    }
  }, []);

  const refreshAppointments = useCallback(async () => {
    try {
      const list = await whatsappApi.listAppointments();
      if (Array.isArray(list)) setAppointments(list);
    } catch (err) {
      console.warn("[crm-store] listAppointments failed", err);
    }
  }, []);

  const refreshDealOutcomes = useCallback(async () => {
    try {
      const list = await whatsappApi.listDealOutcomes();
      if (Array.isArray(list)) setFinished(list);
    } catch (err) {
      console.warn("[crm-store] listDealOutcomes failed", err);
    }
  }, []);

  const refreshLeadDistribution = useCallback(async () => {
    try {
      setLeadDistributionState(await whatsappApi.getLeadDistribution());
    } catch (err) {
      console.warn("[crm-store] getLeadDistribution failed", err);
    }
  }, []);

  const refreshAgentSchedule = useCallback(async () => {
    try {
      setAgentScheduleState(await whatsappApi.getAgentSchedule());
    } catch (err) {
      console.warn("[crm-store] getAgentSchedule failed", err);
    }
  }, []);

  // O overlay de CRM vem junto das conversas (conversations.crm). Aqui ele é
  // reindexado por conversationId, que é o formato que as telas já consomem.
  const refreshConversationPatches = useCallback(async () => {
    try {
      // Endpoint dedicado: antes isto baixava a lista COMPLETA de conversas só
      // para reindexar o overlay. Com a listagem paginada, esse caminho passaria
      // a perder o overlay de tudo que não coubesse na primeira página.
      const linhas = await whatsappApi.listCrmOverlays();
      const indexado: Record<string, CrmPatch> = {};
      for (const linha of linhas) {
        if (linha.crm && Object.keys(linha.crm).length) indexado[linha.id] = linha.crm;
      }
      setConversationPatches(indexado);
    } catch (err) {
      console.warn("[crm-store] listCrmOverlays failed", err);
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

  // Com o token em cookie httpOnly o cliente não consegue mais inspecionar a
  // validade da sessão — e não precisa: perguntar ao /auth/me é a única fonte
  // confiável. 401 significa simplesmente "não logado".
  useEffect(() => {
    let cancelled = false;
    setAuthReady(false);
    whatsappApi.me()
      .then(({ user }) => {
        if (cancelled) return;
        setCurrentUserId(user.id);
        setTeamUsers(prev => (prev.some(u => u.id === user.id) ? prev : [...prev, toTeamUser(user)]));
      })
      .catch(() => {
        if (cancelled) return;
        setCurrentUserId(null);
        setTeamUsers([]);
      })
      .finally(() => {
        if (!cancelled) setAuthReady(true);
      });

    return () => {
      cancelled = true;
    };
    // Roda uma vez: login/logout atualizam currentUserId diretamente.
  }, []);

  useEffect(() => {
    if (!currentUserId) return;
    refreshTeamUsers();
    refreshProntuarios();
    refreshConsultations();
    refreshTasks();
    refreshAgentUsage();
    refreshDeals();
    refreshStages();
    refreshAgents();
    refreshCustomFields();
    refreshTags();
    refreshAppointments();
    refreshDealOutcomes();
    refreshLeadDistribution();
    refreshAgentSchedule();
    refreshConversationPatches();
  }, [currentUserId, refreshTeamUsers, refreshProntuarios, refreshConsultations, refreshTasks, refreshAgentUsage, refreshDeals, refreshStages,
      refreshAgents, refreshCustomFields, refreshTags, refreshAppointments, refreshDealOutcomes,
      refreshLeadDistribution, refreshAgentSchedule, refreshConversationPatches]);

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
    const onCustomFields = (payload: { customFields: CustomField[] }) => {
      if (Array.isArray(payload?.customFields)) setCustomFields(payload.customFields);
    };
    const onAgents = (payload: { agents: Agent[] }) => {
      if (Array.isArray(payload?.agents)) setAgents(payload.agents.map(normalizeAgent));
    };
    const onTags = (payload: { tags: string[] }) => {
      if (Array.isArray(payload?.tags)) setTagsState(payload.tags);
    };
    const onLeadDistribution = (payload: { leadDistribution: LeadDistribution }) => {
      if (payload?.leadDistribution) setLeadDistributionState(payload.leadDistribution);
    };
    const onAgentSchedule = (payload: { agentSchedule: AgentSchedule }) => {
      if (payload?.agentSchedule) setAgentScheduleState(payload.agentSchedule);
    };
    const onAppointment = (payload: { appointment: Appointment }) => {
      const appointment = payload?.appointment;
      if (!appointment?.id) return;
      setAppointments(prev => {
        const idx = prev.findIndex(a => a.id === appointment.id);
        const next = idx === -1 ? [...prev, appointment] : prev.map(a => (a.id === appointment.id ? appointment : a));
        return next.sort((a, b) => `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`));
      });
    };
    const onAppointmentDelete = (payload: { appointmentId: string }) => {
      if (payload?.appointmentId) setAppointments(prev => prev.filter(a => a.id !== payload.appointmentId));
    };
    const onAppointmentWipe = (payload: { dealId: string }) => {
      if (payload?.dealId) setAppointments(prev => prev.filter(a => a.dealId !== payload.dealId));
    };
    const onDealOutcome = (payload: { outcome: DealOutcome }) => {
      const outcome = payload?.outcome;
      if (!outcome?.id) return;
      setFinished(prev => (prev.some(f => f.id === outcome.id) ? prev : [outcome, ...prev]));
    };
    // O overlay de CRM chega dentro da própria conversa atualizada.
    const onConversationCrm = (payload: { conversation: { id: string; crm?: CrmPatch } }) => {
      const conversa = payload?.conversation;
      if (!conversa?.id) return;
      setConversationPatches(prev => ({ ...prev, [conversa.id]: conversa.crm || {} }));
    };
    // A transcrição chega segundos ou minutos depois do upload: sem este
    // evento o médico ficaria olhando "processando" até dar F5.
    const onConsultation = (payload: { consultation: Consultation }) => {
      const consultation = payload?.consultation;
      if (!consultation?.id) return;
      setConsultations(prev => {
        const idx = prev.findIndex(c => c.id === consultation.id);
        if (idx === -1) return [consultation, ...prev];
        const next = prev.slice();
        next[idx] = consultation;
        return next;
      });
    };
    const onConsultationDelete = (payload: { consultation: Consultation }) => {
      const id = payload?.consultation?.id;
      if (id) setConsultations(prev => prev.filter(c => c.id !== id));
    };
    const onTask = (payload: { task: Task }) => {
      const task = payload?.task;
      if (!task?.id) return;
      setTasks(prev => {
        const idx = prev.findIndex(t => t.id === task.id);
        if (idx === -1) return [task, ...prev];
        const next = prev.slice();
        next[idx] = task;
        return next;
      });
    };
    const onTaskDelete = (payload: { taskId: string }) => {
      if (payload?.taskId) setTasks(prev => prev.filter(t => t.id !== payload.taskId));
    };
    socket.on("deal:new", upsertDeal);
    socket.on("deal:update", upsertDeal);
    socket.on("deal:delete", onDealDelete);
    socket.on("stages:update", onStages);
    socket.on("custom-fields:update", onCustomFields);
    socket.on("agents:update", onAgents);
    socket.on("tags:update", onTags);
    socket.on("lead-distribution:update", onLeadDistribution);
    socket.on("agent-schedule:update", onAgentSchedule);
    socket.on("appointment:update", onAppointment);
    socket.on("appointment:delete", onAppointmentDelete);
    socket.on("appointment:wipe", onAppointmentWipe);
    socket.on("deal-outcome:new", onDealOutcome);
    socket.on("conversation:update", onConversationCrm);
    socket.on("consultation:update", onConsultation);
    socket.on("consultation:delete", onConsultationDelete);
    socket.on("task:update", onTask);
    socket.on("task:delete", onTaskDelete);
    return () => {
      socket.off("deal:new", upsertDeal);
      socket.off("deal:update", upsertDeal);
      socket.off("deal:delete", onDealDelete);
      socket.off("stages:update", onStages);
      socket.off("custom-fields:update", onCustomFields);
      socket.off("agents:update", onAgents);
      socket.off("tags:update", onTags);
      socket.off("lead-distribution:update", onLeadDistribution);
      socket.off("agent-schedule:update", onAgentSchedule);
      socket.off("appointment:update", onAppointment);
      socket.off("appointment:delete", onAppointmentDelete);
      socket.off("appointment:wipe", onAppointmentWipe);
      socket.off("deal-outcome:new", onDealOutcome);
      socket.off("conversation:update", onConversationCrm);
      socket.off("consultation:update", onConsultation);
      socket.off("consultation:delete", onConsultationDelete);
      socket.off("task:update", onTask);
      socket.off("task:delete", onTaskDelete);
    };
  }, [currentUserId]);

  useEffect(() => {
    if (currentUser) setAccountProfile(profileFromUser(currentUser));
  }, [currentUser]);

  const login = async (identifier: string, password: string) => {
    try {
      // O cookie de sessão vem no Set-Cookie da resposta; o corpo traz só o usuário.
      const { user } = await whatsappApi.login(identifier, password);
      setCurrentUserId(user.id);
      setTeamUsers(prev => {
        const next = prev.filter(u => u.id !== user.id);
        return [...next, toTeamUser(user)];
      });
      setAuthReady(true);
      setAccountProfile(profileFromUser(toTeamUser(user)));
      // O socket já está conectado com a credencial antiga (nenhuma): reconecta
      // para o servidor reavaliar o cookie no handshake.
      reconnectSocket();
      return { ok: true as const };
    } catch (err) {
      console.warn("[crm-store] login failed", err);
      // Devolve o MOTIVO, e não só `false`: com rate limit no login, mostrar
      // "usuário ou senha inválidos" para quem foi bloqueado por tentativas
      // demais faz a pessoa insistir e prolongar o bloqueio.
      return { ok: false as const, motivo: mensagemDeErro(err, "Usuário ou senha inválidos") };
    }
  };

  const logout = () => {
    setCurrentUserId(null);
    setTeamUsers([]);
    // Só o servidor consegue apagar um cookie httpOnly.
    whatsappApi.logout()
      .catch(err => console.warn("[crm-store] logout failed", err))
      .finally(reconnectSocket);
  };

  const changePassword = async (currentPassword: string, newPassword: string) => {
    await whatsappApi.changePassword(currentPassword, newPassword);
  };

  const hasPermission = (permission: PermissionKey) => {
    if (!currentUser) return false;
    return roleHasPermission(currentUser.role, permission);
  };

  const canViewDeal = (deal: Deal) => {
    if (!currentUser) return false;
    // Espelha canUserSeeDeal do backend: admin e secretária veem todos.
    if (seesAllDeals(currentUser.role)) return true;

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
    setConsultations(prev => prev.filter(c => c.dealId !== id));
    // Solta o vínculo conversa→card já no cliente (o servidor faz o mesmo e
    // avisa por socket): sem isto a conversa continuaria apontando para um card
    // que não existe mais e ficaria sem como criar outro.
    setConversationPatches(prev => {
      let mudou = false;
      const next: Record<string, CrmPatch> = {};
      for (const [conversationId, patch] of Object.entries(prev)) {
        if (patch?.dealId !== id) { next[conversationId] = patch; continue; }
        const { dealId, ...resto } = patch;
        next[conversationId] = resto;
        mudou = true;
      }
      return mudou ? next : prev;
    });
    whatsappApi.deleteDeal(id).catch(err => console.warn("[crm-store] deleteDeal failed", err));
    // A cascata de prontuário roda no servidor, dentro de DELETE /api/deals/:id:
    // é lá que a permissão do card já foi verificada. Chamar daqui deixava anexo
    // órfão quando a requisição falhava, e passava a dar 403 para a secretária
    // depois que prontuário virou rota restrita a admin/doutor.
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
  // Agentes e campos personalizados são compartilhados (Mongo). Mutações
  // persistem e o broadcast reconcilia os demais clientes — mesmo desenho das etapas.
  const addAgent = async (agent: Partial<Agent>) => {
    try {
      const criado = await whatsappApi.createAgent(agent);
      await refreshAgents();
      return normalizeAgent(criado);
    } catch (err) {
      console.warn("[crm-store] createAgent failed", err);
      return null;
    }
  };
  const updateAgentConfig = async (id: string, patch: Partial<Agent>) => {
    setAgents(prev => prev.map(a => (a.id === id ? normalizeAgent({ ...a, ...patch }) : a)));
    try {
      await whatsappApi.updateAgentRemote(id, patch);
    } catch (err) {
      console.warn("[crm-store] updateAgent failed", err);
      await refreshAgents();
    }
  };
  const removeAgent = async (id: string) => {
    setAgents(prev => prev.filter(a => a.id !== id));
    try {
      await whatsappApi.deleteAgent(id);
    } catch (err) {
      console.warn("[crm-store] deleteAgent failed", err);
      await refreshAgents();
    }
  };

  // Grava UM campo personalizado do lead. O backend mescla em customFields, então
  // mandar só a chave alterada não apaga os demais valores já coletados.
  const setDealCustomField = (dealId: string, key: string, value: string | number | null) => {
    setDeals(prev => prev.map(d => {
      if (d.id !== dealId) return d;
      const next: CustomFieldValues = { ...(d.customFields || {}) };
      if (value === null || value === "") delete next[key];
      else next[key] = value;
      return { ...d, customFields: next };
    }));
    whatsappApi.updateDeal(dealId, { customFields: { [key]: value } } as Partial<Deal>)
      .catch(err => console.warn("[crm-store] setDealCustomField failed", err));
  };

  // O fechamento agora é persistido por inteiro (valor, produto, pagamento,
  // motivo). Antes só stage/estimatedValue chegavam ao banco e o resto sumia no
  // primeiro refresh, zerando Dashboard e Relatórios.
  const finishDeal = (f: Omit<FinishedDeal, "id" | "operatorId"> & { operatorId?: string }) => {
    const current = deals.find(deal => deal.id === f.dealId);
    const stage = f.result === "venda" ? "fechado" : "perdido";
    const estimatedValue = f.result === "venda" && f.amount !== undefined ? f.amount : current?.estimatedValue;
    setDeals(prev => prev.map(deal => (deal.id === f.dealId ? { ...deal, stage, estimatedValue } : deal)));
    whatsappApi.updateDeal(f.dealId, { stage, estimatedValue })
      .catch(err => console.warn("[crm-store] finishDeal (deal) failed", err));
    // Sem update otimista aqui: o id vem do servidor, e o socket deal-outcome:new
    // devolve o registro completo — inserir antes duplicaria a linha no relatório.
    whatsappApi.createDealOutcome(f)
      .catch(err => { console.warn("[crm-store] finishDeal (outcome) failed", err); refreshDealOutcomes(); });
  };

  const addTag = (name: string) => {
    const clean = name.trim();
    if (!clean || tags.includes(clean)) return;
    setTagsState(prev => [...prev, clean]);
    whatsappApi.createTag(clean).catch(err => { console.warn("[crm-store] createTag failed", err); refreshTags(); });
  };
  const removeTag = (name: string) => {
    setTagsState(prev => prev.filter(tag => tag !== name));
    whatsappApi.deleteTag(name).catch(err => { console.warn("[crm-store] deleteTag failed", err); refreshTags(); });
  };

  const addAppointment = (appointment: Appointment) => {
    setAppointments(prev => [...prev, appointment].sort((a, b) => `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`)));
    whatsappApi.createAppointment(appointment)
      .catch(err => { console.warn("[crm-store] createAppointment failed", err); refreshAppointments(); });
  };
  const updateAppointment = (id: string, patch: Partial<Appointment>) => {
    setAppointments(prev => prev.map(appointment => (appointment.id === id ? { ...appointment, ...patch } : appointment)));
    whatsappApi.updateAppointment(id, patch)
      .catch(err => { console.warn("[crm-store] updateAppointment failed", err); refreshAppointments(); });
  };
  const removeAppointment = (id: string) => {
    setAppointments(prev => prev.filter(appointment => appointment.id !== id));
    whatsappApi.deleteAppointment(id)
      .catch(err => { console.warn("[crm-store] deleteAppointment failed", err); refreshAppointments(); });
  };

  // Aceitam tanto um patch quanto a forma de updater do React, porque as telas
  // de configuração já chamavam `setX(prev => ({ ...prev, campo }))`. O valor
  // resolvido é gravado no servidor — antes só ia para o localStorage, o que
  // fazia o botão "Salvar" do agente programado ser puramente decorativo.
  const setLeadDistribution = (value: SetStateAction<LeadDistribution>) => {
    const next = typeof value === "function"
      ? (value as (prev: LeadDistribution) => LeadDistribution)(leadDistributionRef.current)
      : { ...leadDistributionRef.current, ...value };
    leadDistributionRef.current = next;
    setLeadDistributionState(next);
    whatsappApi.saveLeadDistribution(next)
      .then(saved => { leadDistributionRef.current = saved; setLeadDistributionState(saved); })
      .catch(err => { console.warn("[crm-store] saveLeadDistribution failed", err); refreshLeadDistribution(); });
  };
  const setAgentSchedule = (value: SetStateAction<AgentSchedule>) => {
    const next = typeof value === "function"
      ? (value as (prev: AgentSchedule) => AgentSchedule)(agentScheduleRef.current)
      : { ...agentScheduleRef.current, ...value };
    agentScheduleRef.current = next;
    setAgentScheduleState(next);
    whatsappApi.saveAgentSchedule(next)
      .then(saved => { agentScheduleRef.current = saved; setAgentScheduleState(saved); })
      .catch(err => { console.warn("[crm-store] saveAgentSchedule failed", err); refreshAgentSchedule(); });
  };

  // Persiste em conversations.crm. O `schedulingProposal: null` continua
  // significando "remover a chave" — o backend faz $unset.
  const setConversationPatch = (conversationId: string, patch: CrmPatch) => {
    setConversationPatches(prev => {
      const merged = { ...(prev[conversationId] || {}), ...patch };
      if (patch.schedulingProposal === null) delete merged.schedulingProposal;
      return { ...prev, [conversationId]: merged };
    });
    whatsappApi.patchConversationCrm(conversationId, patch)
      .catch(err => console.warn("[crm-store] patchConversationCrm failed", err));
  };

  const clearSchedulingProposal = (conversationId: string) =>
    setConversationPatch(conversationId, { schedulingProposal: null });

  const getEligibleSellers = (): TeamUser[] => {
    const baseEligible = teamUsers.filter(user => user.active && user.receivesNewLeads && user.role === ROLES.SECRETARIA);
    if (!leadDistribution.eligibleUserIds.length) return baseEligible;
    return baseEligible.filter(user => leadDistribution.eligibleUserIds.includes(user.id));
  };

  // O rodízio é resolvido NO SERVIDOR, com cursor atômico. Fazer a conta aqui
  // era o bug original: cada navegador tinha o seu "último atribuído" e o mesmo
  // vendedor recebia repetido. Retorna void — quem sabe o resultado é o socket.
  const assignNextSeller = (conversationId: string) => {
    whatsappApi.assignNextSeller(conversationId)
      .then(({ assigned }) => {
        if (assigned) setConversationPatches(prev => ({
          ...prev,
          [conversationId]: { ...(prev[conversationId] || {}), sellerId: assigned },
        }));
      })
      .catch(err => console.warn("[crm-store] assignNextSeller failed", err));
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

  const getConsultationsByDeal = useCallback(
    (dealId: string) => consultations.filter(c => c.dealId === dealId),
    [consultations],
  );

  const removeConsultation: CRMCtx["removeConsultation"] = async id => {
    const prontuarioId = consultations.find(c => c.id === id)?.prontuarioId;
    await whatsappApi.deleteConsultation(id);
    setConsultations(prev => prev.filter(c => c.id !== id));
    // O anexo espelho é apagado junto no servidor; sai da lista local também
    // para o prontuário não mostrar um áudio que já não existe.
    if (prontuarioId) setProntuarios(prev => prev.filter(p => p.id !== prontuarioId));
  };

  // Tarefa não usa a atualização otimista do resto do store: o servidor decide
  // quem concluiu e quando, e a fila da recepção é compartilhada — mostrar
  // "concluída" antes da confirmação faria duas pessoas pensarem que pegaram a
  // mesma tarefa. O socket `task:update` reconcilia todo mundo em seguida.
  const createTask: CRMCtx["createTask"] = async task => {
    const criada = await whatsappApi.createTask(task);
    setTasks(prev => (prev.some(t => t.id === criada.id) ? prev : [criada, ...prev]));
    return criada;
  };

  const updateTask: CRMCtx["updateTask"] = async (id, patch) => {
    const atualizada = await whatsappApi.updateTask(id, patch);
    setTasks(prev => prev.map(t => (t.id === id ? atualizada : t)));
  };

  const removeTask: CRMCtx["removeTask"] = async id => {
    await whatsappApi.deleteTask(id);
    setTasks(prev => prev.filter(t => t.id !== id));
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
    <Ctx.Provider value={{ deals, setDeals, addDeal, removeDeal, moveDeal, updateDeal, stages, addStage, updateStage, moveStage, reorderStage, removeStage, appointments, addAppointment, updateAppointment, removeAppointment, finished, finishDeal, agents, addAgent, updateAgentConfig, removeAgent, customFields, refreshCustomFields, setDealCustomField, agentUsage, refreshAgentUsage, resetAgentUsage: resetAgentUsageRemote, tags, addTag, removeTag, teamUsers, setTeamUsers, accountProfile, setAccountProfile, currentUser, authReady, isAdmin, isDoutor, isSecretaria, currentRole, login, logout, hasPermission, canViewDeal, changePassword, refreshTeamUsers, conversationPatches, setConversationPatch, clearSchedulingProposal, leadDistribution, setLeadDistribution, agentSchedule, setAgentSchedule, getEligibleSellers, assignNextSeller, applyScheduledAgentIfActive, isAgentScheduleActive, prontuarios, refreshProntuarios, getProntuariosByDeal, linkMessageToProntuario, uploadProntuarioFile, renameProntuario, removeProntuario, consultations, refreshConsultations, getConsultationsByDeal, removeConsultation, tasks, refreshTasks, createTask, updateTask, removeTask }}>
      {children}
    </Ctx.Provider>
  );
}

export const useCRM = () => {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCRM must be used within CRMProvider");
  return ctx;
};
