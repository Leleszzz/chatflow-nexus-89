import agentsData from "@/banco-de-dados/agents.json";
import modelOptionsData from "@/banco-de-dados/model-options.json";
import stagesData from "@/banco-de-dados/stages.json";
import tagsData from "@/banco-de-dados/tags.json";

export type Temperature = "quente" | "morno" | "frio";
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
}

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
