import agentsData from "@/banco-de-dados/agents.json";
import modelOptionsData from "@/banco-de-dados/model-options.json";
import stagesData from "@/banco-de-dados/stages.json";
import tagsData from "@/banco-de-dados/tags.json";

export type Temperature = "quente" | "morno" | "frio";

// Campos personalizados do lead. A `key` (ex.: NOME_COMPLETO) é derivada do
// rótulo na criação e nunca muda — é ela que chaveia os valores em
// Deal.customFields e nomeia a propriedade no schema que a IA preenche.
export type CustomFieldType = "texto" | "numero" | "data" | "lista";
export interface CustomField {
  id: string;
  key: string;
  label: string;
  type: CustomFieldType;
  options: string[];
  required: boolean;
  order: number;
}
export type CustomFieldValues = Record<string, string | number>;
export type DealStage = string;
export interface Stage {
  id: DealStage;
  title: string;
  color: string;
}

export interface Deal {
  id: string;
  customer: string;
  phone: string;
  avatar?: string;
  lastMessage: string;
  interest?: string;
  lastInteraction: string;
  sellerId: string;
  assignedSellerIds?: string[];
  temperature: Temperature;
  tags: string[];
  unread: boolean;
  estimatedValue?: number;
  stage: DealStage;
  notes?: string;
  aiEnabled?: boolean;
  aiAgentId?: string;
  customFields?: CustomFieldValues;
}

// ---- Tipos compartilhados entre store e cliente de API ----
// Moram aqui (e não no crm-store) porque whatsapp-api.ts precisa deles e o
// store importa o cliente de API — o caminho inverso seria import circular.

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

export interface DealOutcome {
  id: string;
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

export type SchedulingProposal = {
  baseDateIso: string;
  days: string[];
  createdAt: string;
};

/** Overlay de CRM da conversa — persistido em conversations.crm. */
export type CrmPatch = {
  dealId?: string;
  customer?: string;
  sellerId?: string;
  assignedSellerIds?: string[];
  temperature?: Temperature;
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
  /** Cursor do rodízio — gerido pelo servidor, o cliente nunca escreve. */
  assignCursor?: number;
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

export interface AgentUsage {
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  calls?: number;
  lastUpdatedAt?: string | null;
}

export interface Agent {
  id: string;
  name: string;
  description: string;
  prompt: string;
  model: "econom" | "balanced" | "premium";
  temperature: number;
  active: boolean;
  conversations: number;
  updatedAt: string;
  channel: string;
  triggerTags: string[];
  blockWords: string[];
  handoffMessage: string;
  objective?: string;
  tone?: string;
  fallbackMessage?: string;
  /** `key`s de campos personalizados que este agente deve extrair da conversa. */
  extractFields: string[];
}

export const STAGES = stagesData as Stage[];
export const ALL_TAGS = tagsData;
export const MODEL_OPTIONS = modelOptionsData as {
  id: Agent["model"];
  label: string;
  model: string;
  desc: string;
}[];
export const INITIAL_AGENTS = agentsData as Agent[];
