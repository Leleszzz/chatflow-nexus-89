import type { Deal, Stage } from "@/lib/mock-data";

export type InstanceStatus = "ativa" | "desconectada" | "desligada" | "conectando" | "qr-pendente" | "codigo-pendente";

// Importação de conversas antigas na primeira conexão:
// none = só mensagens novas | recent = histórico recente | full = histórico completo
export type HistorySyncMode = "none" | "recent" | "full";

export type WhatsAppInstance = {
  id: string;
  name: string;
  phone: string;
  status: InstanceStatus;
  lastSync: string;
  conversations: number;
  historySynced: boolean;
  historySync?: HistorySyncMode;
  createdAt: string;
};

export type WAConversation = {
  id: string;
  instanceId: string;
  chatId: string;
  customer: string;
  whatsappName?: string;
  phone: string;
  isGroup: boolean;
  lastMessage: string;
  lastInteraction: string;
  unread: boolean;
  unreadCount: number;
  avatarUrl?: string;
  lastMessageId?: string;
  lastMessageFromMe?: boolean;
  lastMessageAck?: 0 | 1 | 2 | 3 | 4;
};

export type WAMessage = {
  id: string;
  chatId: string;
  instanceId: string;
  fromMe: boolean;
  author?: string;
  type: "chat" | "contact" | "image" | "audio" | "ptt" | "video" | "document" | "sticker";
  isGif?: boolean;
  body: string;
  contact?: { displayName: string; phone?: string; vcard?: string };
  contacts?: { displayName: string; phone?: string; vcard?: string }[];
  timestamp: number;
  mediaUrl?: string;
  mediaMime?: string;
  ack: 0 | 1 | 2 | 3 | 4;
  quotedMsgId?: string;
  edited?: boolean;
  deleted?: boolean;
};

// Registro da lista de leads importada por TXT (NM_PSSA|NU_DOCUMENTO|NU_FONE_TERMINAL).
export type LeadListEntry = {
  phoneKey: string;
  nome: string;
  documento: string;
  telefone: string;
  importadoEm: string;
  importadoPor?: string;
};

export type LeadListStats = { total: number; ultimaImportacao: string };

export type LeadImportResult = LeadListStats & {
  ok: true;
  lidos: number;
  inseridos: number;
  atualizados: number;
  ignorados: number;
};

// Mensagem pré-configurada. O corpo pode conter {{variaveis}} (ver message-template.ts).
export type QuickReply = {
  id: string;
  titulo: string;
  corpo: string;
  ordem: number;
  criadoPor?: string;
  criadoEm: string;
  atualizadoEm: string;
};

export type ProntuarioCategory = "foto" | "video" | "audio" | "documento" | "outro";

export type ProntuarioAttachment = {
  id: string;
  dealId: string;
  conversationId?: string;
  messageId?: string;
  instanceId?: string;
  name: string;
  category: ProntuarioCategory;
  mediaUrl: string;
  mediaMime?: string;
  fileSize?: number;
  source: "whatsapp" | "upload";
  uploadedAt: string;
  uploadedBy?: string;
};

export type ScheduledMessageStatus = "pending" | "sent" | "cancelled" | "failed";

export type ScheduledMessage = {
  id: string;
  instanceId: string;
  chatId: string;
  conversationId: string | null;
  body: string;
  scheduledAt: string;
  status: ScheduledMessageStatus;
  cancelIfClientReplies: boolean;
  cancelIfAgentReplies: boolean;
  note: string;
  createdBy: string | null;
  createdAt: string;
  sentAt: string | null;
  sentMessageId: string | null;
  cancelledReason: string | null;
  error: string | null;
};

// Chat interno da equipe — não passa pelo WhatsApp. Uma thread é 1:1 ("dm") ou
// grupo ("group"); a diferença é só o `type` e o `name`.
export type InternalThread = {
  id: string;
  type: "dm" | "group";
  name: string;
  memberIds: string[];
  createdBy: string;
  createdAt: string;
  lastMessage: { body: string; senderId: string; createdAt: string } | null;
  lastMessageAt: string | null;
  /** Preenchido por thread na listagem do usuário atual. */
  unreadCount?: number;
};

export type InternalMessage = {
  id: string;
  threadId: string;
  senderId: string;
  body: string;
  createdAt: string;
  readBy: string[];
};

// Campanha de remarketing. O público sai sempre das conversas existentes —
// o backend recusa qualquer destino que não tenha conversa no CRM.
export type CampaignStatus = "rascunho" | "rodando" | "pausada" | "finalizada" | "cancelada";

export type Campaign = {
  id: string;
  name: string;
  message: string;
  status: CampaignStatus;
  throttleMs: number;
  total: number;
  sent: number;
  failed: number;
  replied: number;
  createdBy: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  lastSentAt: string | null;
};

export type CampaignTarget = {
  id: string;
  campaignId: string;
  conversationId: string;
  instanceId: string;
  chatId: string;
  customer: string;
  whatsappName: string;
  phone: string;
  status: "pendente" | "enviado" | "falhou";
  createdAt: string;
  sentAt: string | null;
  messageId: string | null;
  repliedAt: string | null;
  error: string | null;
};

export type CampaignAudienceFilters = {
  instanceIds?: string[];
  inactiveDays?: number;
  onlyClientLast?: boolean;
  onlyUnread?: boolean;
  limit?: number;
};

export type CampaignPreview = {
  total: number;
  sample: Array<{ id: string; instanceId: string; chatId: string; customer: string; whatsappName?: string; phone: string; lastInteraction: string }>;
  ignored: number;
};

export type UserRecord = {
  id: string;
  name: string;
  username?: string;
  avatar: string;
  photoUrl?: string;
  email: string;
  phone?: string;
  role: string;
  active: boolean;
  allowedTags?: string[];
  allowedConversationIds?: string[];
  allowedInstanceIds?: string[];
  receivesNewLeads?: boolean;
};

// Lido já no carregamento do módulo: os efeitos de página (ex.: useInstances)
// rodam ANTES do efeito do provider que chama setApiAuthToken, então sem isto o
// primeiro request de cada reload sairia sem Authorization e tomaria 401.
function readStoredToken(): string | null {
  try {
    const raw = window.localStorage.getItem("crm-auth-token");
    return raw ? (JSON.parse(raw) as string) : null;
  } catch {
    return null;
  }
}

let authToken: string | null = readStoredToken();

export function setApiAuthToken(token: string | null) {
  authToken = token;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(init?.headers as Record<string, string> || {}) };
  if (authToken && !headers.Authorization) headers.Authorization = `Bearer ${authToken}`;
  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
    const text = await res.text();
    let detail = text;
    try {
      const parsed = JSON.parse(text);
      if (parsed?.error) detail = parsed.error;
    } catch {}
    throw new Error(detail || `${res.status} ${res.statusText}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const whatsappApi = {
  listInstances: () => request<WhatsAppInstance[]>("/api/instances"),
  createInstance: (name: string, historySync: HistorySyncMode = "recent") =>
    request<WhatsAppInstance>("/api/instances", { method: "POST", body: JSON.stringify({ name, historySync }) }),
  getInstance: (id: string) => request<WhatsAppInstance>(`/api/instances/${encodeURIComponent(id)}`),
  updateInstance: (id: string, patch: { name?: string }) =>
    request<WhatsAppInstance>(`/api/instances/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  getQr: (id: string) => request<{ qr: string }>(`/api/instances/${encodeURIComponent(id)}/qr`),
  requestPairingCode: (id: string, phone: string) =>
    request<{ code: string }>(`/api/instances/${encodeURIComponent(id)}/pairing-code`, {
      method: "POST",
      body: JSON.stringify({ phone }),
    }),
  getPairingCode: (id: string) =>
    request<{ code: string }>(`/api/instances/${encodeURIComponent(id)}/pairing-code`),
  restartInstance: (id: string) =>
    request<{ ok: true }>(`/api/instances/${encodeURIComponent(id)}/restart`, { method: "POST" }),
  resyncHistory: (id: string) =>
    request<{ ok: true }>(`/api/instances/${encodeURIComponent(id)}/resync-history`, { method: "POST" }),
  shutdownInstance: (id: string) =>
    request<{ ok: true }>(`/api/instances/${encodeURIComponent(id)}/shutdown`, { method: "POST" }),
  deleteInstance: (id: string) =>
    request<{ ok: true }>(`/api/instances/${encodeURIComponent(id)}`, { method: "DELETE" }),

  listConversations: (instanceId?: string) => {
    const qs = instanceId ? `?instanceId=${encodeURIComponent(instanceId)}` : "";
    return request<WAConversation[]>(`/api/conversations${qs}`);
  },
  /** Conversas arquivadas (soft delete). Só admin consegue arquivar/restaurar. */
  listArchivedConversations: () =>
    request<WAConversation[]>("/api/conversations?archived=true"),
  archiveConversation: (conversationId: string) =>
    request<{ conversation: WAConversation }>(`/api/conversations/${encodeURIComponent(conversationId)}`, {
      method: "DELETE",
    }),
  restoreConversation: (conversationId: string) =>
    request<{ conversation: WAConversation }>(`/api/conversations/${encodeURIComponent(conversationId)}/restore`, {
      method: "POST",
    }),

  // --- Chat interno da equipe ---
  listInternalThreads: () => request<InternalThread[]>("/api/internal-chat/threads"),
  internalUnreadCount: () => request<{ count: number }>("/api/internal-chat/unread-count"),
  openInternalDm: (userId: string) =>
    request<InternalThread>("/api/internal-chat/threads/dm", {
      method: "POST",
      body: JSON.stringify({ userId }),
    }),
  createInternalGroup: (payload: { name: string; memberIds: string[] }) =>
    request<InternalThread>("/api/internal-chat/threads/group", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateInternalGroup: (threadId: string, patch: { name?: string; memberIds?: string[] }) =>
    request<InternalThread>(`/api/internal-chat/threads/${encodeURIComponent(threadId)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  leaveInternalGroup: (threadId: string) =>
    request<{ ok: true; removed: boolean }>(`/api/internal-chat/threads/${encodeURIComponent(threadId)}/leave`, {
      method: "POST",
    }),
  listInternalMessages: (threadId: string, opts?: { before?: string; limit?: number }) => {
    const params = new URLSearchParams();
    if (opts?.before) params.set("before", opts.before);
    if (opts?.limit) params.set("limit", String(opts.limit));
    const qs = params.toString() ? `?${params.toString()}` : "";
    return request<InternalMessage[]>(`/api/internal-chat/threads/${encodeURIComponent(threadId)}/messages${qs}`);
  },
  sendInternalMessage: (threadId: string, body: string) =>
    request<InternalMessage>(`/api/internal-chat/threads/${encodeURIComponent(threadId)}/messages`, {
      method: "POST",
      body: JSON.stringify({ body }),
    }),
  markInternalThreadRead: (threadId: string) =>
    request<{ ok: true; marked: number }>(`/api/internal-chat/threads/${encodeURIComponent(threadId)}/read`, {
      method: "POST",
    }),

  // --- Campanhas de remarketing ---
  listCampaigns: () => request<Campaign[]>("/api/campaigns"),
  campaignLimits: () => request<{ minThrottleMs: number; defaultThrottleMs: number }>("/api/campaigns/limits"),
  previewCampaignAudience: (payload: CampaignAudienceFilters & { conversationIds?: string[] }) =>
    request<CampaignPreview>("/api/campaigns/preview", { method: "POST", body: JSON.stringify(payload) }),
  createCampaign: (payload: CampaignAudienceFilters & {
    name: string;
    message: string;
    throttleMs?: number;
    conversationIds?: string[];
  }) => request<Campaign>("/api/campaigns", { method: "POST", body: JSON.stringify(payload) }),
  listCampaignTargets: (campaignId: string) =>
    request<CampaignTarget[]>(`/api/campaigns/${encodeURIComponent(campaignId)}/targets`),
  startCampaign: (campaignId: string) =>
    request<Campaign>(`/api/campaigns/${encodeURIComponent(campaignId)}/start`, { method: "POST" }),
  pauseCampaign: (campaignId: string) =>
    request<Campaign>(`/api/campaigns/${encodeURIComponent(campaignId)}/pause`, { method: "POST" }),
  cancelCampaign: (campaignId: string) =>
    request<Campaign>(`/api/campaigns/${encodeURIComponent(campaignId)}/cancel`, { method: "POST" }),
  deleteCampaign: (campaignId: string) =>
    request<void>(`/api/campaigns/${encodeURIComponent(campaignId)}`, { method: "DELETE" }),
  getMessages: (conversationId: string, opts?: { before?: number; limit?: number }) => {
    const params = new URLSearchParams();
    if (opts?.before) params.set("before", String(opts.before));
    if (opts?.limit) params.set("limit", String(opts.limit));
    const qs = params.toString() ? `?${params.toString()}` : "";
    return request<WAMessage[]>(`/api/conversations/${encodeURIComponent(conversationId)}/messages${qs}`);
  },
  markRead: (conversationId: string) =>
    request<WAConversation>(`/api/conversations/${encodeURIComponent(conversationId)}/read`, { method: "POST" }),
  updateConversation: (conversationId: string, patch: { customer?: string }) =>
    request<WAConversation>(`/api/conversations/${encodeURIComponent(conversationId)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  startConversation: (payload: { instanceId: string; phone: string; customer?: string }) =>
    request<WAConversation>("/api/conversations/start", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  sendText: async (instanceId: string, chatId: string, body: string) => {
    const form = new FormData();
    form.append("chatId", chatId);
    form.append("type", "text");
    form.append("body", body);
    const headers: Record<string, string> = {};
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    const res = await fetch(`/api/instances/${encodeURIComponent(instanceId)}/send`, { method: "POST", body: form, headers });
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    return res.json() as Promise<{ ok: true; messageId: string | null; timestamp: number }>;
  },
  sendMedia: async (instanceId: string, chatId: string, type: "image" | "audio" | "video" | "document", file: File, caption = "") => {
    const form = new FormData();
    form.append("chatId", chatId);
    form.append("type", type);
    form.append("body", caption);
    form.append("file", file);
    const headers: Record<string, string> = {};
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    const res = await fetch(`/api/instances/${encodeURIComponent(instanceId)}/send`, { method: "POST", body: form, headers });
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    return res.json() as Promise<{ ok: true; messageId: string | null; timestamp: number }>;
  },

  login: (identifier: string, password: string) =>
    request<{ token: string; user: UserRecord }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ identifier, password }),
    }),
  me: () => request<{ user: UserRecord }>("/api/auth/me"),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: true }>("/api/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  listUsers: () => request<UserRecord[]>("/api/users"),
  createUser: (user: Partial<UserRecord> & { password?: string }) =>
    request<UserRecord>("/api/users", { method: "POST", body: JSON.stringify(user) }),
  updateUser: (id: string, patch: Partial<UserRecord> & { password?: string }) =>
    request<UserRecord>(`/api/users/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteUser: (id: string) =>
    request<void>(`/api/users/${encodeURIComponent(id)}`, { method: "DELETE" }),

  getOpenaiStatus: () => request<{ configured: boolean; defaultModel: string }>("/api/settings/openai"),
  saveOpenaiKey: (apiKey: string, defaultModel?: string) =>
    request<{ configured: boolean; defaultModel: string }>("/api/settings/openai", {
      method: "PUT",
      body: JSON.stringify({ apiKey, defaultModel }),
    }),
  deleteOpenaiKey: () =>
    request<{ configured: boolean }>("/api/settings/openai", { method: "DELETE" }),

  testAgent: (payload: { model: string; temperature: number; systemPrompt: string; userMessage: string }) =>
    request<{ reply: string; model: string }>("/api/agents/test", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  listProntuarios: (dealId?: string) => {
    const qs = dealId ? `?dealId=${encodeURIComponent(dealId)}` : "";
    return request<ProntuarioAttachment[]>(`/api/prontuarios${qs}`);
  },
  createProntuario: (payload: {
    dealId: string;
    name: string;
    mediaUrl: string;
    mediaMime?: string;
    category?: ProntuarioCategory;
    conversationId?: string;
    messageId?: string;
    instanceId?: string;
    source?: "whatsapp" | "upload";
    uploadedBy?: string;
  }) =>
    request<ProntuarioAttachment>("/api/prontuarios", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  listQuickReplies: () => request<QuickReply[]>("/api/quick-replies"),
  createQuickReply: (payload: { titulo: string; corpo: string }) =>
    request<QuickReply>("/api/quick-replies", { method: "POST", body: JSON.stringify(payload) }),
  updateQuickReply: (id: string, patch: { titulo?: string; corpo?: string }) =>
    request<QuickReply>(`/api/quick-replies/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteQuickReply: (id: string) =>
    request<{ ok: true }>(`/api/quick-replies/${encodeURIComponent(id)}`, { method: "DELETE" }),

  leadListStats: () => request<LeadListStats>("/api/leads/stats"),
  lookupLead: (phone: string) =>
    request<LeadListEntry | null>(`/api/leads/lookup?phone=${encodeURIComponent(phone)}`),
  clearLeadList: () => request<{ ok: true; removidos: number }>("/api/leads", { method: "DELETE" }),
  importLeadList: async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    const headers: Record<string, string> = {};
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    const res = await fetch("/api/leads/import", { method: "POST", body: form, headers });
    if (!res.ok) {
      const text = await res.text();
      let detail = text;
      try { const p = JSON.parse(text); if (p?.error) detail = p.error; } catch { /* texto cru */ }
      throw new Error(detail || `${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<LeadImportResult>;
  },

  uploadProntuario: async (dealId: string, name: string, file: File, uploadedBy?: string) => {
    const form = new FormData();
    form.append("dealId", dealId);
    form.append("name", name);
    if (uploadedBy) form.append("uploadedBy", uploadedBy);
    form.append("file", file);
    const headers: Record<string, string> = {};
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    const res = await fetch("/api/prontuarios/upload", { method: "POST", body: form, headers });
    if (!res.ok) {
      const text = await res.text();
      let detail = text;
      try {
        const parsed = JSON.parse(text);
        if (parsed?.error) detail = parsed.error;
      } catch {}
      throw new Error(detail || `${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<ProntuarioAttachment>;
  },
  renameProntuario: (id: string, name: string) =>
    request<ProntuarioAttachment>(`/api/prontuarios/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }),
  deleteProntuario: (id: string) =>
    request<{ ok: true }>(`/api/prontuarios/${encodeURIComponent(id)}`, { method: "DELETE" }),
  deleteProntuariosByDeal: (dealId: string) =>
    request<{ ok: true; removed: number }>(`/api/prontuarios/by-deal/${encodeURIComponent(dealId)}`, {
      method: "DELETE",
    }),

  agentRespond: (payload: {
    instanceId: string;
    chatId: string;
    model: string;
    temperature: number;
    systemPrompt: string;
    contextLimit?: number;
    agentId?: string;
    nowIso?: string;
  }) =>
    request<{
      ok: true;
      reply: string;
      messageId: string | null;
      model: string;
      usage?: { promptTokens: number; completionTokens: number; costUsd: number };
      scheduling?: { baseDateIso: string; days: string[] } | null;
    }>("/api/agents/respond", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  listScheduledMessages: (params: { conversationId?: string; instanceId?: string; status?: ScheduledMessageStatus } = {}) => {
    const qs = new URLSearchParams();
    if (params.conversationId) qs.set("conversationId", params.conversationId);
    if (params.instanceId) qs.set("instanceId", params.instanceId);
    if (params.status) qs.set("status", params.status);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return request<ScheduledMessage[]>(`/api/scheduled-messages${suffix}`);
  },
  createScheduledMessage: (payload: {
    instanceId: string;
    chatId: string;
    conversationId?: string;
    body: string;
    scheduledAt: string;
    cancelIfClientReplies?: boolean;
    cancelIfAgentReplies?: boolean;
    note?: string;
    createdBy?: string;
  }) =>
    request<ScheduledMessage>("/api/scheduled-messages", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  cancelScheduledMessage: (id: string, opts: { purge?: boolean } = {}) =>
    request<ScheduledMessage | { ok: true }>(`/api/scheduled-messages/${encodeURIComponent(id)}${opts.purge ? "?purge=true" : ""}`, {
      method: "DELETE",
    }),

  getAgentUsage: () =>
    request<Record<string, { promptTokens: number; completionTokens: number; costUsd: number; calls?: number; lastUpdatedAt?: string | null }>>(
      "/api/agents/usage",
    ),

  resetAgentUsage: (agentId: string) =>
    request<{ ok: true }>(`/api/agents/usage/${encodeURIComponent(agentId)}`, { method: "DELETE" }),

  // ---- Kanban: deals (cards) ----
  listDeals: () => request<Deal[]>("/api/deals"),
  createDeal: (deal: Deal) =>
    request<Deal>("/api/deals", { method: "POST", body: JSON.stringify(deal) }),
  updateDeal: (id: string, patch: Partial<Deal>) =>
    request<Deal>(`/api/deals/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteDeal: (id: string) =>
    request<{ ok: true }>(`/api/deals/${encodeURIComponent(id)}`, { method: "DELETE" }),

  // ---- Kanban: stages (colunas) ----
  listStages: () => request<Stage[]>("/api/stages"),
  createStage: (payload: { title: string; color?: string }) =>
    request<Stage>("/api/stages", { method: "POST", body: JSON.stringify(payload) }),
  updateStage: (id: string, patch: { title?: string; color?: string }) =>
    request<Stage>(`/api/stages/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) }),
  reorderStages: (orderedIds: string[]) =>
    request<Stage[]>("/api/stages/reorder", { method: "POST", body: JSON.stringify({ orderedIds }) }),
  deleteStage: (id: string) =>
    request<{ ok: true; stages: Stage[] }>(`/api/stages/${encodeURIComponent(id)}`, { method: "DELETE" }),
};
