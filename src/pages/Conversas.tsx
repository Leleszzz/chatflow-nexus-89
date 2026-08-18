import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { useCRM, CrmPatch } from "@/store/crm-store";
import { Deal } from "@/lib/mock-data";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ClientTemperatureBadge, ConversationStatus, StatusBadge, TagBadge } from "@/components/shared/Badges";
import { EmptyState } from "@/components/shared/EmptyState";
import { Archive, ArchiveRestore, ArrowDownWideNarrow, ArrowUpNarrowWide, Ban, Bold, Bot, CalendarClock, CalendarPlus, Check, CheckCheck, ClipboardList, Clock, Contact as ContactIcon, Copy, FileText, Film, Filter, FolderOpen, Image as ImageIcon, ImageOff, Info, Italic, KanbanSquare, Loader2, MessageCirclePlus, MessageSquareText, Mic, MoreVertical, Music, Paperclip, Pencil, Phone, Plus, Scissors, Search, Send, Settings2, SlidersHorizontal, Smartphone, Tag, Trash2, UserPlus, UserRound, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { useWhatsAppConversations, useWhatsAppMessages } from "@/hooks/useWhatsAppConversations";
import { whatsappApi, LeadListEntry, QuickReply, ScheduledMessage, WAConversation, WAMessage, WhatsAppInstance } from "@/lib/whatsapp-api";
import { renderTemplate } from "@/lib/message-template";
import { Label } from "@/components/ui/label";
import { AudioMessage } from "@/components/chat/AudioMessage";
import { ImageViewer } from "@/components/chat/ImageViewer";
import { RecordingWaveform } from "@/components/chat/RecordingWaveform";
import { SchedulingProposalBar } from "@/components/chat/SchedulingProposalBar";

type Conversation = {
  id: string;
  dealId?: string;
  instanceId?: string;
  instanceName?: string;
  chatId?: string;
  avatarUrl?: string;
  customer: string;
  whatsappName?: string;
  phone: string;
  lastMessage: string;
  lastInteraction: string;
  lastMessageFromMe?: boolean;
  lastMessageAck?: 0 | 1 | 2 | 3 | 4;
  sellerId: string;
  assignedSellerIds?: string[];
  temperature: Deal["temperature"];
  tags: string[];
  unread: boolean;
  stage?: string;
  notes?: string;
  aiEnabled?: boolean;
  aiAgentId?: string;
};

const safeStr = (v: unknown, fallback = "") => (typeof v === "string" && v.length > 0 ? v : fallback);

// Tipos cuja mensagem é o próprio arquivo: sem mediaUrl o balão ficaria VAZIO,
// só com o horário. Espelha o previewFor do backend (message-mapper.js).
const MEDIA_PLACEHOLDERS: Record<string, string> = {
  image: "[imagem]",
  sticker: "[figurinha]",
  audio: "[áudio]",
  ptt: "[áudio]",
  video: "[vídeo]",
  document: "[documento]",
};
const mediaPlaceholder = (type: string, isGif?: boolean) =>
  type === "video" && isGif ? "[GIF]" : MEDIA_PLACEHOLDERS[type];
const initials = (name: string) => (name || "").trim().slice(0, 2).toUpperCase() || "?";
const formatCpf = (doc: string) => {
  const d = (doc || "").replace(/\D/g, "");
  return d.length === 11 ? d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4") : doc;
};

const toConversationFromDeal = (deal: Deal): Conversation => ({
  id: `deal-${deal.id}`,
  dealId: deal.id,
  customer: safeStr(deal.customer, safeStr(deal.phone, "Sem nome")),
  phone: safeStr(deal.phone),
  lastMessage: safeStr(deal.lastMessage),
  lastInteraction: safeStr(deal.lastInteraction),
  sellerId: safeStr(deal.sellerId),
  assignedSellerIds: deal.assignedSellerIds || [],
  temperature: deal.temperature,
  tags: deal.tags || [],
  unread: Boolean(deal.unread),
  stage: deal.stage,
  notes: deal.notes,
  aiEnabled: deal.aiEnabled,
  aiAgentId: deal.aiAgentId,
});

const toConversationFromWA = (wa: WAConversation, patch: CrmPatch | undefined, linkedDeal?: Deal): Conversation => ({
  id: wa.id,
  dealId: linkedDeal?.id || patch?.dealId,
  instanceId: wa.instanceId,
  chatId: wa.chatId,
  avatarUrl: wa.avatarUrl,
  lastMessageFromMe: wa.lastMessageFromMe,
  lastMessageAck: wa.lastMessageAck,
  customer: safeStr(linkedDeal?.customer, safeStr(patch?.customer, safeStr(wa.customer, safeStr(wa.whatsappName, safeStr(wa.phone, "Sem nome"))))),
  whatsappName: safeStr(wa.whatsappName),
  phone: safeStr(linkedDeal?.phone, safeStr(wa.phone)),
  lastMessage: safeStr(wa.lastMessage),
  lastInteraction: safeStr(wa.lastInteraction),
  sellerId: safeStr(linkedDeal?.sellerId, safeStr(patch?.sellerId)),
  assignedSellerIds: linkedDeal?.assignedSellerIds || patch?.assignedSellerIds || [],
  temperature: linkedDeal?.temperature || patch?.temperature || "morno",
  tags: linkedDeal?.tags || patch?.tags || [],
  unread: Boolean(wa.unread),
  stage: linkedDeal?.stage || patch?.stage,
  notes: linkedDeal?.notes || patch?.notes,
  aiEnabled: linkedDeal?.aiEnabled ?? patch?.aiEnabled,
  aiAgentId: linkedDeal?.aiAgentId || patch?.aiAgentId,
});

const AckIcon = ({ ack }: { ack?: number }) => {
  if (ack == null) return null;
  if (ack <= 0) return <Clock className="h-3 w-3 shrink-0 text-muted-foreground" />;
  if (ack === 1) return <Check className="h-3 w-3 shrink-0 text-muted-foreground" />;
  if (ack === 2) return <CheckCheck className="h-3 w-3 shrink-0 text-muted-foreground" />;
  return <CheckCheck className="h-3 w-3 shrink-0 text-info" />;
};

const tsValue = (iso: string) => {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
};
const formatRelative = (iso: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? formatDistanceToNow(d, { locale: ptBR }) : "";
};

const conversationStatus = (conversation: Conversation): ConversationStatus => {
  if (!conversation.dealId) return "nova";
  if (conversation.stage === "fechado" || conversation.stage === "perdido") return "finalizada";
  if (conversation.unread) return "sem-resposta";
  if (conversation.stage === "aguardando-resposta") return "aguardando-cliente";
  if (conversation.lastInteraction && Date.now() - tsValue(conversation.lastInteraction) > 24 * 3600000) return "lead-parado";
  return "em-atendimento";
};

// Liga/desliga um item num Set de filtro sem mutar o anterior.
const toggleInSet = (current: Set<string>, id: string) => {
  const next = new Set(current);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
};

// Ordem: o padrão primeiro, depois o que exige ação do atendente, e por último
// os estados terminais.
const statusFilters = [
  { id: "todas", label: "Todas" },
  { id: "minhas", label: "Minhas conversas" },
  { id: "sem-resposta", label: "Sem resposta" },
  { id: "cliente-por-ultimo", label: "Cliente falou por último" },
  { id: "aguardando-cliente", label: "Aguardando cliente" },
  { id: "finalizadas", label: "Finalizadas" },
];

// Usado tanto para filtrar a lista quanto para contar o badge de cada chip —
// manter os dois em um único lugar evita contador divergente da lista.
const matchesStatusFilter = (conversation: Conversation, filterId: string, currentUserId: string) => {
  if (filterId === "todas") return true;
  if (filterId === "minhas") return [conversation.sellerId, ...(conversation.assignedSellerIds || [])].includes(currentUserId);
  const status = conversationStatus(conversation);
  if (filterId === "finalizadas") return status === "finalizada";
  // Última mensagem veio do cliente (a bola está com você). Compara com
  // `false` explicitamente: conversa sem nenhuma mensagem tem o campo
  // indefinido e não deve entrar aqui.
  if (filterId === "cliente-por-ultimo") return conversation.lastMessageFromMe === false;
  return status === filterId;
};

const formatTime = (iso: string) => {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(d);
};

// Rótulo do separador de dia dentro do chat: "Hoje", "Ontem", ou a data.
// Datas do mesmo ano omitem o ano; anos anteriores mostram por extenso.
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const formatDaySeparator = (d: Date) => {
  const hoje = new Date();
  const ontem = new Date();
  ontem.setDate(hoje.getDate() - 1);
  if (dayKey(d) === dayKey(hoje)) return "Hoje";
  if (dayKey(d) === dayKey(ontem)) return "Ontem";
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    ...(d.getFullYear() !== hoje.getFullYear() ? { year: "numeric" } : {}),
  }).format(d);
};

export default function Conversas() {
  const { deals, addDeal, updateDeal, currentUser, isAdmin, teamUsers, tags, setTags, stages, agents, hasPermission, conversationPatches: waPatches, setConversationPatch, clearSchedulingProposal, appointments, addAppointment, linkMessageToProntuario } = useCRM();
  const { conversations: waConversations, markRead, refresh: refreshConversations } = useWhatsAppConversations();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialDealId = searchParams.get("deal");
  const query = searchParams.get("q")?.toLowerCase().trim() || "";
  const statusQuery = searchParams.get("status") || "todas";
  const [conversationSearch, setConversationSearch] = useState(query);
  const [statusFilter, setStatusFilter] = useState(statusQuery);
  // "recentes" = última interação mais nova primeiro (padrão, como no WhatsApp).
  const [sortOrder, setSortOrder] = useState<"recentes" | "antigas">("recentes");
  // Filtro por etapa do funil (múltipla escolha). Vazio = todas as etapas.
  const [stageFilter, setStageFilter] = useState<Set<string>>(new Set());
  const [stageFilterOpen, setStageFilterOpen] = useState(false);
  // Filtros por instância e por responsável — só o admin vê estes controles.
  // Vazio = sem recorte.
  const [instanceFilter, setInstanceFilter] = useState<Set<string>>(new Set());
  const [sellerFilter, setSellerFilter] = useState<Set<string>>(new Set());
  const [adminFilterOpen, setAdminFilterOpen] = useState(false);
  const adminFilterCount = instanceFilter.size + sellerFilter.size;
  // Arquivamento de conversas — exclusivo do admin.
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const [archivedListOpen, setArchivedListOpen] = useState(false);
  const [archivedList, setArchivedList] = useState<WAConversation[]>([]);
  const [archivedLoading, setArchivedLoading] = useState(false);
  const [newTag, setNewTag] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [leadActionsOpen, setLeadActionsOpen] = useState(false);
  const [notesDraft, setNotesDraft] = useState("");
  const [draftMessage, setDraftMessage] = useState("");
  const [sending, setSending] = useState(false);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const conversationListRef = useRef<HTMLDivElement>(null);
  const [selectionToolbar, setSelectionToolbar] = useState<{ top: number; left: number } | null>(null);
  const attachInputRef = useRef<HTMLInputElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingStartRef = useRef<number>(0);
  const recordingTimerRef = useRef<number | null>(null);
  const [viewer, setViewer] = useState<{ src: string; kind: "image" | "video" } | null>(null);
  // Mídia cujo arquivo sumiu do disco: o <img> dispara onError e caímos no
  // mesmo placeholder de quando o download nunca aconteceu.
  const [brokenMedia, setBrokenMedia] = useState<Set<string>>(new Set());
  const [attachKind, setAttachKind] = useState<"image" | "video" | "audio" | "document">("image");
  const [attachOpen, setAttachOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordingStream, setRecordingStream] = useState<MediaStream | null>(null);
  const [instancesList, setInstancesList] = useState<WhatsAppInstance[]>([]);
  const [newConversationOpen, setNewConversationOpen] = useState(false);
  const [newConversationInstanceId, setNewConversationInstanceId] = useState("");
  const [newConversationPhone, setNewConversationPhone] = useState("");
  const [newConversationName, setNewConversationName] = useState("");
  const [startingConversation, setStartingConversation] = useState(false);
  const [prontuarioTarget, setProntuarioTarget] = useState<WAMessage | null>(null);
  const [prontuarioName, setProntuarioName] = useState("");
  const [linkingProntuario, setLinkingProntuario] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduledList, setScheduledList] = useState<ScheduledMessage[]>([]);
  const [loadingScheduled, setLoadingScheduled] = useState(false);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [schedBody, setSchedBody] = useState("");
  const [schedDate, setSchedDate] = useState("");
  const [schedTime, setSchedTime] = useState("");
  const [schedCancelClient, setSchedCancelClient] = useState(true);
  const [schedCancelAgent, setSchedCancelAgent] = useState(false);

  useEffect(() => {
    let cancelled = false;
    whatsappApi.listInstances().then(list => { if (!cancelled) setInstancesList(list); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!newConversationInstanceId && instancesList.length > 0) {
      setNewConversationInstanceId(instancesList[0].id);
    }
  }, [instancesList, newConversationInstanceId]);

  const instanceNameById = useMemo(() => {
    const m = new Map<string, string>();
    instancesList.forEach(i => m.set(i.id, i.name));
    return m;
  }, [instancesList]);
  const duplicatedChatIds = useMemo(() => {
    const counts = new Map<string, number>();
    for (const wa of waConversations) counts.set(wa.chatId, (counts.get(wa.chatId) || 0) + 1);
    return new Set(Array.from(counts.entries()).filter(([, c]) => c > 1).map(([k]) => k));
  }, [waConversations]);

  const sellerOptions = useMemo(() => teamUsers.filter(user => user.active && user.role !== "Administrador"), [teamUsers]);
  const activeAgents = useMemo(() => agents.filter(agent => agent.active), [agents]);

  const inboxConversations = useMemo(
    () => waConversations.map(wa => {
      const patch = waPatches[wa.id];
      const linkedDeal = patch?.dealId ? deals.find(deal => deal.id === patch.dealId) : undefined;
      const conv = toConversationFromWA(wa, patch, linkedDeal);
      if (duplicatedChatIds.has(wa.chatId)) {
        conv.instanceName = instanceNameById.get(wa.instanceId) || wa.instanceId;
      }
      return conv;
    }),
    [waConversations, waPatches, deals, duplicatedChatIds, instanceNameById],
  );
  const conversations = inboxConversations
    .filter(conversation =>
      isAdmin ||
      conversation.sellerId === currentUser?.id ||
      conversation.assignedSellerIds?.includes(currentUser?.id || "") ||
      conversation.tags.some(tag => currentUser?.allowedTags?.includes(tag))
    )
    .sort((a, b) => tsValue(b.lastInteraction) - tsValue(a.lastInteraction));
  const initialSelectedId = initialDealId
    ? conversations.find(conversation => conversation.dealId === initialDealId)?.id || conversations[0]?.id
    : conversations[0]?.id;
  const [selectedId, setSelectedId] = useState(initialSelectedId);

  const activeSearch = conversationSearch.toLowerCase().trim();
  // Tudo o que passa pela busca e pelos filtros de recorte (etapa, instância,
  // responsável), mas ainda sem o filtro de status. É a base dos contadores dos
  // chips: cada chip mostra quantas conversas cairiam nele.
  const scopedConversations = (activeSearch
    ? conversations.filter(conversation =>
      conversation.customer.toLowerCase().includes(activeSearch) ||
      conversation.phone.toLowerCase().includes(activeSearch) ||
      conversation.lastMessage.toLowerCase().includes(activeSearch) ||
      conversation.tags.some(tag => tag.toLowerCase().includes(activeSearch)) ||
      sellerOptions.some(user => [user.name, user.role].join(" ").toLowerCase().includes(activeSearch) && [conversation.sellerId, ...(conversation.assignedSellerIds || [])].includes(user.id))
    )
    : conversations)
    // Etapa do funil (múltipla): vazio = todas. Conversa sem etapa cai fora
    // quando há filtro ativo (não pertence a nenhuma etapa selecionada).
    .filter(conversation => stageFilter.size === 0 || (conversation.stage ? stageFilter.has(conversation.stage) : false))
    // Instância e responsável: filtros exclusivos do admin. Vazio = todos.
    .filter(conversation => instanceFilter.size === 0 || (conversation.instanceId ? instanceFilter.has(conversation.instanceId) : false))
    .filter(conversation => sellerFilter.size === 0
      || [conversation.sellerId, ...(conversation.assignedSellerIds || [])].some(id => id && sellerFilter.has(id)));

  // Uma passada só pela lista, distribuindo cada conversa nos chips que casam —
  // evita varrer `scopedConversations` uma vez por filtro.
  const statusCounts: Record<string, number> = {};
  for (const filter of statusFilters) statusCounts[filter.id] = 0;
  for (const conversation of scopedConversations) {
    for (const filter of statusFilters) {
      if (matchesStatusFilter(conversation, filter.id, currentUser?.id || "")) statusCounts[filter.id] += 1;
    }
  }

  const visibleConversations = scopedConversations
    .filter(conversation => matchesStatusFilter(conversation, statusFilter, currentUser?.id || ""))
    // Ordena só a lista exibida — `conversations` continua na ordem padrão, para
    // a conversa selecionada não pular ao inverter a ordenação.
    .sort((a, b) => (sortOrder === "recentes"
      ? tsValue(b.lastInteraction) - tsValue(a.lastInteraction)
      : tsValue(a.lastInteraction) - tsValue(b.lastInteraction)));
  const selected = conversations.find(conversation => conversation.id === selectedId) || visibleConversations[0];
  const selectedDeal = selected?.dealId ? deals.find(deal => deal.id === selected.dealId) : null;
  const isWaConversation = Boolean(selected?.instanceId && selected?.chatId);
  const assignedIds = Array.from(new Set([selected?.sellerId, ...(selected?.assignedSellerIds || [])].filter(Boolean)));
  const assignedUsers = sellerOptions.filter(user => assignedIds.includes(user.id));
  const canEditLeadName = isAdmin || hasPermission("Editar atendimentos");
  const selectedStatus = selected ? conversationStatus(selected) : null;

  const { messages: waMessages } = useWhatsAppMessages(isWaConversation ? selected?.id : null);

  // Mensagens pré-configuradas (Configurações > Mensagens rápidas).
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [quickOpen, setQuickOpen] = useState(false);
  useEffect(() => {
    let cancelled = false;
    whatsappApi.listQuickReplies()
      .then(list => { if (!cancelled) setQuickReplies(list); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Observações da lista de leads importada (Configurações > Lista de leads).
  // Casa pelo telefone; se a conversa ainda não tem número (chat @lid), usa o
  // próprio chatId, que só bate quando ele é um JID de número.
  const [leadInfo, setLeadInfo] = useState<LeadListEntry | null>(null);
  const leadLookupKey = selected?.phone || selected?.chatId || "";
  useEffect(() => {
    if (!leadLookupKey) {
      setLeadInfo(null);
      return;
    }
    let cancelled = false;
    whatsappApi.lookupLead(leadLookupKey)
      .then(hit => { if (!cancelled) setLeadInfo(hit); })
      .catch(() => { if (!cancelled) setLeadInfo(null); });
    return () => { cancelled = true; };
  }, [leadLookupKey]);

  useEffect(() => {
    if (!initialDealId) return;
    const conversation = conversations.find(item => item.dealId === initialDealId);
    if (conversation) setSelectedId(conversation.id);
  }, [conversations, initialDealId]);

  // Fixa a seleção inicial assim que a lista carrega. Sem isto, `selectedId`
  // fica indefinido e a conversa exibida seria SEMPRE o primeiro item da lista —
  // que muda de lugar a cada mensagem recebida, trocando a conversa aberta
  // sozinha (e apagando o rascunho que estivesse sendo digitado).
  useEffect(() => {
    if (!selectedId && visibleConversations.length) {
      setSelectedId(visibleConversations[0].id);
    }
  }, [selectedId, visibleConversations]);

  useEffect(() => {
    setEditingName(false);
    setNameDraft(selected?.customer || "");
    setNotesDraft(selected?.notes || "");
    setDraftMessage("");
  }, [selected?.id, selected?.customer, selected?.notes]);

  useEffect(() => {
    if (selected?.id && isWaConversation && selected.unread) {
      markRead(selected.id);
    }
  }, [selected?.id, isWaConversation, selected?.unread, markRead]);

  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick(t => t + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [selected?.id, waMessages.length]);

  // --- Rolagem da lista lateral ---
  // Chegou mensagem: a conversa sobe para o topo, a lista se reordena e a
  // rolagem era jogada de volta ao começo enquanto o usuário navegava mais
  // abaixo. Guardamos a posição a cada rolagem e a devolvemos antes da tela
  // pintar (useLayoutEffect, para não piscar).
  const listScrollRef = useRef(0);

  // Trocar filtro/busca/ordem gera OUTRA lista — aí sim o certo é voltar ao topo.
  // Declarado antes do efeito de restauração para rodar primeiro e não brigar
  // com ele no mesmo render.
  useLayoutEffect(() => {
    listScrollRef.current = 0;
    if (conversationListRef.current) conversationListRef.current.scrollTop = 0;
  }, [statusFilter, activeSearch, sortOrder, stageFilter, instanceFilter, sellerFilter]);

  useLayoutEffect(() => {
    const el = conversationListRef.current;
    if (!el) return;
    if (el.scrollTop !== listScrollRef.current) {
      el.scrollTop = listScrollRef.current;
    }
  }, [visibleConversations]);

  // Arquivar é soft delete: some da lista mas o histórico continua no banco e a
  // conversa pode ser restaurada. Se o contato mandar mensagem nova, o backend
  // desarquiva sozinho.
  const handleArchiveConversation = async () => {
    if (!selected?.id) return;
    try {
      await whatsappApi.archiveConversation(selected.id);
      setArchiveConfirmOpen(false);
      setSelectedId("");
      await refreshConversations();
      toast.success(`Conversa com ${selected.customer} arquivada`);
    } catch (err) {
      toast.error(`Não foi possível arquivar: ${err instanceof Error ? err.message : "erro desconhecido"}`);
    }
  };

  const loadArchivedConversations = async () => {
    setArchivedLoading(true);
    try {
      setArchivedList(await whatsappApi.listArchivedConversations());
    } catch (err) {
      toast.error(`Não foi possível carregar as arquivadas: ${err instanceof Error ? err.message : "erro desconhecido"}`);
    } finally {
      setArchivedLoading(false);
    }
  };

  const handleRestoreConversation = async (conversation: WAConversation) => {
    try {
      await whatsappApi.restoreConversation(conversation.id);
      setArchivedList(cur => cur.filter(item => item.id !== conversation.id));
      await refreshConversations();
      toast.success(`Conversa com ${conversation.customer} restaurada`);
    } catch (err) {
      toast.error(`Não foi possível restaurar: ${err instanceof Error ? err.message : "erro desconhecido"}`);
    }
  };

  useEffect(() => {
    if (archivedListOpen) loadArchivedConversations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archivedListOpen]);

  const updateSelectedConversation = (patch: Partial<Conversation>) => {
    if (!selected) return;
    if (selected.dealId) {
      updateDeal(selected.dealId, patch as Partial<Deal>);
      return;
    }
    if (selected.instanceId) {
      setConversationPatch(selected.id, patch as CrmPatch);
    }
  };

  const toggleTag = (tag: string) => {
    if (!selected) return;
    const nextTags = selected.tags.includes(tag)
      ? selected.tags.filter(item => item !== tag)
      : [...selected.tags, tag];
    updateSelectedConversation({ tags: nextTags });
  };

  const addTagToConversation = () => {
    const tag = newTag.trim();
    if (!selected || !tag) return;
    if (!tags.includes(tag)) setTags(current => [...current, tag]);
    if (!selected.tags.includes(tag)) updateSelectedConversation({ tags: [...selected.tags, tag] });
    setNewTag("");
    toast.success("Tag aplicada");
  };

  const saveLeadName = async () => {
    if (!selected || !canEditLeadName) return;
    const customer = nameDraft.trim();
    if (!customer) {
      toast.error("Informe o nome do lead");
      return;
    }
    updateSelectedConversation({ customer });
    setEditingName(false);
    if (selected.instanceId && selected.id) {
      try {
        await whatsappApi.updateConversation(selected.id, { customer });
        toast.success("Nome do lead atualizado");
      } catch (err) {
        toast.error(`Não foi possível salvar: ${(err as Error).message}`);
      }
    } else {
      toast.success("Nome do lead atualizado");
    }
  };

  const changeTemperature = (temperature: Deal["temperature"]) => {
    if (!selected) return;
    updateSelectedConversation({ temperature });
    toast.success("Temperatura do lead atualizada");
  };

  const changeStage = (stage: string) => {
    if (!selected) return;
    updateSelectedConversation({ stage });
    toast.success("Etapa do funil atualizada");
  };

  const createKanbanCardFromConversation = (options: { silent?: boolean } = {}): string | null => {
    if (!selected) return null;
    if (selected.dealId) return selected.dealId;

    const sellerId = selected.sellerId || currentUser?.id || sellerOptions[0]?.id || "s1";
    const stage = selected.stage || stages.find(item => item.id !== "fechado" && item.id !== "perdido")?.id || stages[0]?.id || "novo-lead";
    const dealId = `d${Date.now()}`;
    const deal: Deal = {
      id: dealId,
      customer: selected.customer.trim() || selected.whatsappName || selected.phone || "Sem nome",
      phone: selected.phone,
      lastMessage: selected.lastMessage || "Conversa importada do WhatsApp.",
      lastInteraction: selected.lastInteraction || new Date().toISOString(),
      sellerId,
      assignedSellerIds: selected.assignedSellerIds || [],
      temperature: selected.temperature,
      tags: selected.tags,
      unread: selected.unread,
      stage,
      notes: selected.notes,
      aiEnabled: selected.aiEnabled,
      aiAgentId: selected.aiAgentId,
    };

    addDeal(deal);
    setConversationPatch(selected.id, {
      dealId,
      customer: deal.customer,
      sellerId,
      assignedSellerIds: deal.assignedSellerIds,
      temperature: deal.temperature,
      tags: deal.tags,
      stage,
      notes: deal.notes,
      aiEnabled: deal.aiEnabled,
      aiAgentId: deal.aiAgentId,
    });
    if (!options.silent) toast.success("Card criado no Kanban");
    return dealId;
  };

  const openProntuarioLink = (message: WAMessage) => {
    if (!message.mediaUrl) return;
    const suggestion = (() => {
      const dt = new Date(message.timestamp * 1000);
      const pretty = `${dt.toLocaleDateString("pt-BR")} ${dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
      const base =
        message.type === "image" || message.type === "sticker" ? "Foto"
        : message.type === "video" ? "Vídeo"
        : message.type === "audio" || message.type === "ptt" ? "Áudio"
        : message.type === "document" ? "Documento"
        : "Arquivo";
      return `${base} • ${pretty}`;
    })();
    setProntuarioTarget(message);
    setProntuarioName(suggestion);
  };

  const confirmProntuarioLink = async () => {
    if (!prontuarioTarget || !selected) return;
    const name = prontuarioName.trim();
    if (!name) {
      toast.error("Informe um nome para o arquivo");
      return;
    }
    setLinkingProntuario(true);
    try {
      let dealId = selected.dealId;
      if (!dealId) {
        const created = createKanbanCardFromConversation({ silent: true });
        if (!created) throw new Error("Não foi possível vincular a um card");
        dealId = created;
      }
      await linkMessageToProntuario({
        dealId,
        name,
        mediaUrl: prontuarioTarget.mediaUrl!,
        mediaMime: prontuarioTarget.mediaMime,
        messageType: prontuarioTarget.type,
        conversationId: selected.id,
        messageId: prontuarioTarget.id,
        instanceId: prontuarioTarget.instanceId,
      });
      setProntuarioTarget(null);
      setProntuarioName("");
      toast.success("Arquivo adicionado ao prontuário", {
        action: {
          label: "Ver prontuário",
          onClick: () => navigate(`/prontuarios?dealId=${encodeURIComponent(dealId!)}`),
        },
      });
    } catch (err) {
      toast.error(`Falha: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLinkingProntuario(false);
    }
  };

  const openProntuarioPage = () => {
    if (!selected) return;
    let dealId = selected.dealId;
    if (!dealId) {
      const created = createKanbanCardFromConversation({ silent: true });
      if (!created) {
        toast.error("Não foi possível abrir o prontuário");
        return;
      }
      dealId = created;
    }
    navigate(`/prontuarios?dealId=${encodeURIComponent(dealId)}`);
  };

  const toggleAI = (enabled: boolean) => {
    if (!selected) return;
    updateSelectedConversation({
      aiEnabled: enabled,
      aiAgentId: enabled ? selected.aiAgentId || activeAgents[0]?.id || agents[0]?.id : selected.aiAgentId,
    });
    toast.success(enabled ? "Agente de IA ligado" : "Agente de IA desligado");
  };

  const changeAIAgent = (agentId: string) => {
    if (!selected) return;
    updateSelectedConversation({ aiAgentId: agentId, aiEnabled: true });
    toast.success("Agente de IA alterado");
  };

  const saveInternalNotes = () => {
    if (!selected) return;
    updateSelectedConversation({ notes: notesDraft.trim() });
    toast.success("Observação interna salva");
  };

  const toggleResponsible = (sellerId: string) => {
    if (!selected || !isAdmin) return;
    const nextAssigned = assignedIds.includes(sellerId)
      ? assignedIds.filter(id => id !== sellerId)
      : [...assignedIds, sellerId];
    updateSelectedConversation({
      assignedSellerIds: nextAssigned,
      sellerId: nextAssigned[0] || selected.sellerId,
    });
  };

  const startConversation = async (params?: { instanceId?: string; phone?: string; customer?: string }) => {
    const instanceId = params?.instanceId || (newConversationOpen ? newConversationInstanceId : selected?.instanceId || newConversationInstanceId);
    const phone = (params?.phone || newConversationPhone).trim();
    const customer = (params?.customer || newConversationName).trim();
    if (!instanceId) {
      toast.error("Selecione uma instância");
      return;
    }
    if (!phone) {
      toast.error("Informe o telefone");
      return;
    }

    setStartingConversation(true);
    try {
      const conversation = await whatsappApi.startConversation({ instanceId, phone, customer });
      await refreshConversations();
      setSelectedId(conversation.id);
      setNewConversationOpen(false);
      setNewConversationPhone("");
      setNewConversationName("");
      toast.success("Conversa pronta para atendimento");
    } catch (err) {
      toast.error(`Não foi possível iniciar: ${(err as Error).message}`);
    } finally {
      setStartingConversation(false);
    }
  };

  const openNewConversationDialog = () => {
    setNewConversationInstanceId(selected?.instanceId || newConversationInstanceId || instancesList[0]?.id || "");
    setNewConversationPhone("");
    setNewConversationName("");
    setNewConversationOpen(true);
  };

  // Insere a mensagem pré-configurada no compositor com as variáveis já
  // resolvidas. Não envia direto: dá para revisar/editar antes.
  const applyQuickReply = (qr: QuickReply) => {
    if (!selected) return;
    const texto = renderTemplate(qr.corpo, {
      nome: selected.customer,
      nomeWhatsapp: selected.whatsappName,
      telefone: selected.phone,
      listaNome: leadInfo?.nome,
      listaCpf: leadInfo?.documento,
      listaTelefone: leadInfo?.telefone,
      atendente: currentUser?.name,
    });
    setDraftMessage(cur => (cur.trim() ? `${cur.trimEnd()}\n${texto}` : texto));
    setQuickOpen(false);
    requestAnimationFrame(() => {
      const ta = messageInputRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    });
  };

  const sendText = async () => {
    if (!selected || !selected.instanceId || !selected.chatId) return;
    const body = draftMessage.trim();
    if (!body) return;
    setSending(true);
    try {
      await whatsappApi.sendText(selected.instanceId, selected.chatId, body);
      setDraftMessage("");
    } catch (err) {
      toast.error(`Falha ao enviar: ${(err as Error).message}`);
    } finally {
      setSending(false);
      setSelectionToolbar(null);
      requestAnimationFrame(() => messageInputRef.current?.focus());
    }
  };

  // Calcula a posição do início da seleção dentro do textarea usando um espelho invisível.
  const getSelectionCoords = (textarea: HTMLTextAreaElement, position: number) => {
    const mirror = document.createElement("div");
    const computed = window.getComputedStyle(textarea);
    const props = [
      "boxSizing", "width", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
      "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "fontStyle", "fontVariant", "fontWeight",
      "fontStretch", "fontSize", "lineHeight", "fontFamily", "textAlign", "textTransform", "textIndent",
      "letterSpacing", "wordSpacing", "tabSize",
    ];
    mirror.style.position = "absolute";
    mirror.style.visibility = "hidden";
    mirror.style.whiteSpace = "pre-wrap";
    mirror.style.wordWrap = "break-word";
    mirror.style.overflowWrap = "break-word";
    props.forEach(p => { (mirror.style as unknown as Record<string, string>)[p] = computed.getPropertyValue(p); });
    mirror.textContent = textarea.value.substring(0, position);
    const marker = document.createElement("span");
    marker.textContent = textarea.value.substring(position) || ".";
    mirror.appendChild(marker);
    document.body.appendChild(mirror);
    const coords = { top: marker.offsetTop, left: marker.offsetLeft, height: parseInt(computed.lineHeight, 10) || 18 };
    document.body.removeChild(mirror);
    return coords;
  };

  const updateSelectionToolbar = () => {
    const ta = messageInputRef.current;
    if (!ta) return;
    const { selectionStart, selectionEnd } = ta;
    if (selectionStart === selectionEnd) {
      setSelectionToolbar(null);
      return;
    }
    const coords = getSelectionCoords(ta, selectionStart);
    setSelectionToolbar({
      top: coords.top - ta.scrollTop - 8,
      left: Math.max(coords.left - ta.scrollLeft, 0),
    });
  };

  // Envolve a seleção com marcadores de formatação do WhatsApp (* negrito, _ itálico).
  const wrapSelection = (marker: string) => {
    const ta = messageInputRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    if (start === end) return;
    const value = draftMessage;
    const next = value.slice(0, start) + marker + value.slice(start, end) + marker + value.slice(end);
    setDraftMessage(next);
    setSelectionToolbar(null);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + marker.length, end + marker.length);
    });
  };

  const copySelection = async () => {
    const ta = messageInputRef.current;
    if (!ta) return;
    const text = draftMessage.slice(ta.selectionStart, ta.selectionEnd);
    if (text) await navigator.clipboard.writeText(text);
    setSelectionToolbar(null);
    requestAnimationFrame(() => ta.focus());
  };

  const cutSelection = async () => {
    const ta = messageInputRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const text = draftMessage.slice(start, end);
    if (text) await navigator.clipboard.writeText(text);
    setDraftMessage(draftMessage.slice(0, start) + draftMessage.slice(end));
    setSelectionToolbar(null);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start, start);
    });
  };

  const sendSchedulingDays = async (days: string[]) => {
    if (!selected?.instanceId || !selected.chatId) return;
    const formatted = days
      .map(key => {
        const m = key.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!m) return key;
        const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
        const weekdays = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
        return `${m[3]}/${m[2]} (${weekdays[d.getDay()]})`;
      })
      .join(", ");
    const text = `Temos as seguintes datas disponíveis: ${formatted}. Qual prefere?`;
    try {
      await whatsappApi.sendText(selected.instanceId, selected.chatId, text);
      toast.success("Lista de dias enviada ao cliente.");
    } catch (err) {
      toast.error(`Falha ao enviar: ${(err as Error).message}`);
    }
  };

  const sendSchedulingTimes = async (dateKey: string, hours: number[]) => {
    if (!selected?.instanceId || !selected.chatId) return;
    if (hours.length === 0) {
      toast.error("Nenhum horário livre para enviar.");
      return;
    }
    const m = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const dayLabel = m ? `${m[3]}/${m[2]}` : dateKey;
    const formatted = hours.map(h => `${String(h).padStart(2, "0")}:00`).join(", ");
    const text = `Para o dia ${dayLabel}, temos os horários disponíveis: ${formatted}. Qual prefere?`;
    try {
      await whatsappApi.sendText(selected.instanceId, selected.chatId, text);
      toast.success("Lista de horários enviada ao cliente.");
    } catch (err) {
      toast.error(`Falha ao enviar: ${(err as Error).message}`);
    }
  };

  const confirmScheduling = async (dateKey: string, hour: number) => {
    if (!selected || !selected.dealId) {
      toast.error("Vincule esta conversa a um lead antes de agendar.");
      return;
    }
    const sellerId = selected.sellerId || currentUser?.id || "";
    if (!sellerId) {
      toast.error("Defina um responsável para a conversa.");
      return;
    }
    const startTime = `${String(hour).padStart(2, "0")}:00`;
    const endTime = `${String(hour + 1).padStart(2, "0")}:00`;
    const customer = selected.customer || selected.whatsappName || selected.phone || "Lead";
    addAppointment({
      id: `appt-${Date.now()}`,
      title: `Atendimento - ${customer}`,
      dealId: selected.dealId,
      date: dateKey,
      startTime,
      endTime,
      sellerId,
      description: "Agendado via Conversas (proposta de IA)",
      type: "retorno",
      status: "agendado",
      origin: "Conversa",
    });
    clearSchedulingProposal(selected.id);

    const [, mm, dd] = dateKey.split("-");
    const confirmText = `Confirmado para ${dd}/${mm} às ${startTime}. Até lá!`;
    if (selected.instanceId && selected.chatId) {
      try {
        await whatsappApi.sendText(selected.instanceId, selected.chatId, confirmText);
      } catch (err) {
        toast.error(`Agendamento criado, mas falha ao enviar confirmação: ${(err as Error).message}`);
        return;
      }
    }
    toast.success("Agendamento criado e confirmação enviada.");
  };

  const sendFile = async (kind: "image" | "video" | "audio" | "document", file: File) => {
    if (!selected || !selected.instanceId || !selected.chatId) return;
    setSending(true);
    try {
      const caption = (kind === "image" || kind === "video") ? draftMessage.trim() : "";
      await whatsappApi.sendMedia(selected.instanceId, selected.chatId, kind, file, caption);
      setDraftMessage("");
      toast.success({
        image: "Imagem enviada",
        video: "Vídeo enviado",
        audio: "Áudio enviado",
        document: "Documento enviado",
      }[kind]);
    } catch (err) {
      toast.error(`Falha: ${(err as Error).message}`);
    } finally {
      setSending(false);
    }
  };

  const openAttachPicker = (kind: "image" | "video" | "audio" | "document") => {
    setAttachKind(kind);
    setAttachOpen(false);
    setTimeout(() => attachInputRef.current?.click(), 0);
  };

  const startRecording = async () => {
    if (recording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      let mimeType = "audio/webm;codecs=opus";
      if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = "audio/webm";
      if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = "audio/ogg;codecs=opus";
      if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = "";
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks: Blob[] = [];
      recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        if (recordingTimerRef.current) window.clearInterval(recordingTimerRef.current);
        const cancelled = (recorder as MediaRecorder & { _cancelled?: boolean })._cancelled;
        setRecording(false);
        setRecordingSeconds(0);
        setRecordingStream(null);
        if (cancelled || chunks.length === 0) return;
        const blob = new Blob(chunks, { type: mimeType || "audio/webm" });
        const ext = (mimeType.includes("ogg") ? "ogg" : "webm");
        const file = new File([blob], `gravacao-${Date.now()}.${ext}`, { type: blob.type });
        await sendFile("audio", file);
      };
      mediaRecorderRef.current = recorder;
      recordingStartRef.current = Date.now();
      setRecording(true);
      setRecordingSeconds(0);
      setRecordingStream(stream);
      recordingTimerRef.current = window.setInterval(() => {
        setRecordingSeconds(Math.floor((Date.now() - recordingStartRef.current) / 1000));
      }, 250);
      recorder.start();
    } catch (err) {
      toast.error(`Não foi possível acessar o microfone: ${(err as Error).message}`);
    }
  };

  const stopRecording = (cancel = false) => {
    const r = mediaRecorderRef.current;
    if (!r) return;
    (r as MediaRecorder & { _cancelled?: boolean })._cancelled = cancel;
    if (r.state !== "inactive") r.stop();
  };

  const pad2 = (n: number) => String(n).padStart(2, "0");

  const loadScheduled = async (conversationId: string) => {
    setLoadingScheduled(true);
    try {
      const list = await whatsappApi.listScheduledMessages({ conversationId });
      setScheduledList(list);
    } catch (err) {
      toast.error(`Falha ao carregar agendamentos: ${(err as Error).message}`);
    } finally {
      setLoadingScheduled(false);
    }
  };

  const openScheduleDialog = () => {
    if (!selected) return;
    if (!isWaConversation) {
      toast.error("Vincule esta conversa a uma instância de WhatsApp para agendar mensagens.");
      return;
    }
    const base = new Date(Date.now() + 60 * 60 * 1000);
    setSchedBody("");
    setSchedDate(`${base.getFullYear()}-${pad2(base.getMonth() + 1)}-${pad2(base.getDate())}`);
    setSchedTime(`${pad2(base.getHours())}:${pad2(base.getMinutes())}`);
    setSchedCancelClient(true);
    setSchedCancelAgent(false);
    setLeadActionsOpen(false);
    setScheduleOpen(true);
    loadScheduled(selected.id);
  };

  const submitSchedule = async () => {
    if (!selected || !selected.instanceId || !selected.chatId) return;
    const body = schedBody.trim();
    if (!body) { toast.error("Digite a mensagem a ser agendada."); return; }
    if (!schedDate || !schedTime) { toast.error("Informe a data e a hora do envio."); return; }
    const when = new Date(`${schedDate}T${schedTime}`);
    if (Number.isNaN(when.getTime())) { toast.error("Data/hora inválida."); return; }
    if (when.getTime() < Date.now()) { toast.error("Escolha uma data/hora no futuro."); return; }
    setSavingSchedule(true);
    try {
      const created = await whatsappApi.createScheduledMessage({
        instanceId: selected.instanceId,
        chatId: selected.chatId,
        conversationId: selected.id,
        body,
        scheduledAt: when.toISOString(),
        cancelIfClientReplies: schedCancelClient,
        cancelIfAgentReplies: schedCancelAgent,
        createdBy: currentUser?.id,
      });
      setScheduledList(prev => [...prev, created].sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()));
      setSchedBody("");
      toast.success("Mensagem agendada com sucesso.");
    } catch (err) {
      toast.error(`Não foi possível agendar: ${(err as Error).message}`);
    } finally {
      setSavingSchedule(false);
    }
  };

  const cancelSchedule = async (item: ScheduledMessage) => {
    const purge = item.status !== "pending";
    try {
      const res = await whatsappApi.cancelScheduledMessage(item.id, { purge });
      if (purge) {
        setScheduledList(prev => prev.filter(s => s.id !== item.id));
        toast.success("Agendamento removido.");
      } else {
        setScheduledList(prev => prev.map(s => (s.id === item.id ? (res as ScheduledMessage) : s)));
        toast.success("Agendamento cancelado.");
      }
    } catch (err) {
      toast.error(`Falha: ${(err as Error).message}`);
    }
  };

  // Mantém a lista de agendamentos em dia enquanto o painel está aberto
  // (reflete cancelamentos automáticos por resposta do cliente/atendente).
  useEffect(() => {
    if (scheduleOpen && selected?.id) loadScheduled(selected.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waMessages.length]);

  return (
    <AppLayout title="Conversas" subtitle="Atendimento via WhatsApp">
      <div className="card-elevated flex min-h-[calc(100vh-180px)] flex-col overflow-hidden lg:h-[calc(100vh-180px)] lg:flex-row">
        <aside className="flex max-h-[46vh] w-full flex-col border-b border-border lg:max-h-none lg:w-80 lg:border-b-0 lg:border-r">
          <div className="border-b border-border p-3">
            <div className="flex gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={conversationSearch}
                  onChange={event => setConversationSearch(event.target.value)}
                  placeholder="Buscar conversa..."
                  className="border-transparent bg-secondary pl-9"
                />
              </div>
              <Button
                variant="outline"
                size="icon"
                title={sortOrder === "recentes" ? "Ordem: mais recentes primeiro (clique para inverter)" : "Ordem: mais antigas primeiro (clique para inverter)"}
                onClick={() => setSortOrder(cur => (cur === "recentes" ? "antigas" : "recentes"))}
              >
                {sortOrder === "recentes"
                  ? <ArrowDownWideNarrow className="h-4 w-4" />
                  : <ArrowUpNarrowWide className="h-4 w-4 text-primary" />}
              </Button>
              <Popover open={stageFilterOpen} onOpenChange={setStageFilterOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    title="Filtrar por etapa do funil"
                    className={cn("relative", stageFilter.size > 0 && "border-primary text-primary")}
                  >
                    <Filter className="h-4 w-4" />
                    {stageFilter.size > 0 && (
                      <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                        {stageFilter.size}
                      </span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-60 p-2">
                  <div className="mb-1 flex items-center justify-between px-1">
                    <span className="text-xs font-semibold uppercase text-muted-foreground">Etapas do funil</span>
                    {stageFilter.size > 0 && (
                      <button
                        type="button"
                        onClick={() => setStageFilter(new Set())}
                        className="text-[11px] font-medium text-primary hover:underline"
                      >
                        Limpar
                      </button>
                    )}
                  </div>
                  <div className="max-h-72 space-y-0.5 overflow-y-auto">
                    {stages.map(stage => (
                      <label
                        key={stage.id}
                        className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-secondary"
                      >
                        <Checkbox
                          checked={stageFilter.has(stage.id)}
                          onCheckedChange={() => setStageFilter(cur => toggleInSet(cur, stage.id))}
                        />
                        <span className="truncate">{stage.title}</span>
                      </label>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
              {isAdmin && (
                <Popover open={adminFilterOpen} onOpenChange={setAdminFilterOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      title="Filtrar por instância ou responsável"
                      className={cn("relative", adminFilterCount > 0 && "border-primary text-primary")}
                    >
                      <SlidersHorizontal className="h-4 w-4" />
                      {adminFilterCount > 0 && (
                        <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                          {adminFilterCount}
                        </span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-64 p-2">
                    <div className="mb-1 flex items-center justify-between px-1">
                      <span className="text-xs font-semibold uppercase text-muted-foreground">Instância</span>
                      {adminFilterCount > 0 && (
                        <button
                          type="button"
                          onClick={() => { setInstanceFilter(new Set()); setSellerFilter(new Set()); }}
                          className="text-[11px] font-medium text-primary hover:underline"
                        >
                          Limpar
                        </button>
                      )}
                    </div>
                    <div className="max-h-40 space-y-0.5 overflow-y-auto">
                      {instancesList.length === 0 && (
                        <p className="px-2 py-1.5 text-xs text-muted-foreground">Nenhuma instância cadastrada.</p>
                      )}
                      {instancesList.map(instance => (
                        <label
                          key={instance.id}
                          className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-secondary"
                        >
                          <Checkbox
                            checked={instanceFilter.has(instance.id)}
                            onCheckedChange={() => setInstanceFilter(cur => toggleInSet(cur, instance.id))}
                          />
                          <Smartphone className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate">{instance.name}</span>
                        </label>
                      ))}
                    </div>

                    <div className="mb-1 mt-2 border-t border-border px-1 pt-2">
                      <span className="text-xs font-semibold uppercase text-muted-foreground">Responsável</span>
                    </div>
                    <div className="max-h-40 space-y-0.5 overflow-y-auto">
                      {sellerOptions.map(user => (
                        <label
                          key={user.id}
                          className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-secondary"
                        >
                          <Checkbox
                            checked={sellerFilter.has(user.id)}
                            onCheckedChange={() => setSellerFilter(cur => toggleInSet(cur, user.id))}
                          />
                          <span className="truncate">{user.name}</span>
                        </label>
                      ))}
                    </div>
                    <p className="mt-2 border-t border-border px-1 pt-2 text-[10px] leading-snug text-muted-foreground">
                      O responsável só é conhecido quando a conversa tem um card no funil ou foi atribuída neste navegador.
                    </p>
                  </PopoverContent>
                </Popover>
              )}
              <Button variant="outline" size="icon" title="Iniciar conversa" onClick={openNewConversationDialog}>
                <MessageCirclePlus className="h-4 w-4" />
              </Button>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {statusFilters.map(filter => {
                const active = statusFilter === filter.id;
                const count = statusCounts[filter.id] ?? 0;
                return (
                  <button
                    key={filter.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setStatusFilter(filter.id)}
                    className={cn(
                      "inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-semibold transition",
                      active ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground",
                      !active && count === 0 && "opacity-60",
                    )}
                  >
                    {filter.label}
                    <span
                      className={cn(
                        "rounded px-1 text-[10px] font-bold tabular-nums",
                        active ? "bg-primary-foreground/20 text-primary-foreground" : "bg-background/70 text-muted-foreground",
                      )}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <div
            ref={conversationListRef}
            onScroll={event => { listScrollRef.current = event.currentTarget.scrollTop; }}
            className="flex-1 overflow-y-auto scrollbar-thin"
          >
            {visibleConversations.map(conversation => {
              const responsible = sellerOptions.find(user => user.id === conversation.sellerId);
              return (
                <button
                  key={conversation.id}
                  onClick={() => setSelectedId(conversation.id)}
                  className={cn("flex w-full items-start gap-3 border-b border-border/40 p-3 text-left transition-colors hover:bg-secondary/50",
                    selected?.id === conversation.id && "bg-primary-soft hover:bg-primary-soft")}
                >
                  <Avatar className="h-10 w-10">
                    {conversation.avatarUrl && <AvatarImage src={conversation.avatarUrl} alt={conversation.customer} />}
                    <AvatarFallback className="bg-gradient-primary text-xs font-semibold text-primary-foreground">{initials(conversation.customer)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-sm font-semibold">{conversation.customer}</span>
                        {conversation.instanceName && (
                          <span className="shrink-0 rounded-full bg-info-soft px-1.5 py-0.5 text-[9px] font-semibold text-info">
                            {conversation.instanceName}
                          </span>
                        )}
                      </div>
                      <span className="shrink-0 text-[10px] text-muted-foreground">{formatRelative(conversation.lastInteraction)}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      {conversation.whatsappName && conversation.whatsappName !== conversation.customer && (
                        <span className="truncate italic">~{conversation.whatsappName}</span>
                      )}
                      {conversation.phone && (
                        <>
                          {conversation.whatsappName && conversation.whatsappName !== conversation.customer && <span className="opacity-50">·</span>}
                          <span className="truncate">{conversation.phone}</span>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      {conversation.lastMessageFromMe && <AckIcon ack={conversation.lastMessageAck} />}
                      <p className="truncate text-xs text-muted-foreground">{conversation.lastMessage}</p>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <StatusBadge status={conversationStatus(conversation)} />
                      <ClientTemperatureBadge temp={conversation.temperature} />
                      <span className="text-[10px] text-muted-foreground">{responsible?.name.split(" ")[0]}</span>
                      {!conversation.dealId && <span className="rounded-full bg-warning-soft px-1.5 py-0.5 text-[9px] font-semibold text-warning">sem card</span>}
                      {conversation.unread && <span className="ml-auto h-2 w-2 rounded-full bg-destructive" />}
                    </div>
                  </div>
                </button>
              );
            })}
            {visibleConversations.length === 0 && (
              <div className="p-3">
                <EmptyState title="Você ainda não possui conversas" description="Assim que novos contatos chegarem, eles aparecerão aqui." />
              </div>
            )}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col bg-secondary/30">
          {selected ? (
            <>
              <div className="flex flex-wrap items-center gap-3 border-b border-border bg-card p-3">
                <button type="button" onClick={() => setLeadActionsOpen(true)} className="rounded-full transition hover:opacity-80" title="Opções do lead">
                  <Avatar className="h-10 w-10">
                    {selected.avatarUrl && <AvatarImage src={selected.avatarUrl} alt={selected.customer} />}
                    <AvatarFallback className="bg-gradient-primary text-xs font-semibold text-primary-foreground">{initials(selected.customer)}</AvatarFallback>
                  </Avatar>
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-sm font-semibold">{selected.customer}</div>
                    {selected.instanceName && (
                      <span className="rounded-full bg-info-soft px-2 py-0.5 text-[10px] font-semibold text-info">
                        {selected.instanceName}
                      </span>
                    )}
                    {selectedStatus && <StatusBadge status={selectedStatus} />}
                    <ClientTemperatureBadge temp={selected.temperature} />
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    {selected.whatsappName && selected.whatsappName !== selected.customer && (
                      <span className="italic">~{selected.whatsappName}</span>
                    )}
                    {selected.phone && (
                      <>
                        {selected.whatsappName && selected.whatsappName !== selected.customer && <span className="opacity-50">·</span>}
                        <span>{selected.phone}</span>
                      </>
                    )}
                  </div>
                </div>
                <Button variant="outline" className="gap-2" onClick={() => navigate(`/calendario?deal=${selected.dealId || ""}&lead=${encodeURIComponent(selected.customer)}&phone=${encodeURIComponent(selected.phone)}`)}>
                  <CalendarClock className="h-4 w-4" /> Agendar Atendimento
                </Button>
                {selectedDeal && (
                  <Button variant="outline" className="gap-2" asChild>
                    <Link to={`/kanban?deal=${selectedDeal.id}`}><KanbanSquare className="h-4 w-4" /> Ver Kanban</Link>
                  </Button>
                )}
                {!selectedDeal && (
                  <Button variant="outline" className="gap-2" onClick={() => createKanbanCardFromConversation()}>
                    <KanbanSquare className="h-4 w-4" /> Criar card
                  </Button>
                )}
                <Button variant="outline" className="gap-2" onClick={openProntuarioPage} title="Abrir prontuário">
                  <FolderOpen className="h-4 w-4" /> Prontuário
                </Button>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="icon" title="Mais opções">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-56 p-1">
                    <button onClick={() => setLeadActionsOpen(true)} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-secondary">
                      <Settings2 className="h-4 w-4 text-muted-foreground" /> Opções do lead
                    </button>
                    <button onClick={openScheduleDialog} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-secondary">
                      <CalendarClock className="h-4 w-4 text-primary" /> Agendamentos de mensagens
                    </button>
                    {isAdmin && (
                      <>
                        <div className="my-1 border-t border-border" />
                        <button onClick={() => setArchivedListOpen(true)} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-secondary">
                          <ArchiveRestore className="h-4 w-4 text-muted-foreground" /> Conversas arquivadas
                        </button>
                        <button onClick={() => setArchiveConfirmOpen(true)} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-destructive hover:bg-destructive/10">
                          <Archive className="h-4 w-4" /> Arquivar esta conversa
                        </button>
                      </>
                    )}
                  </PopoverContent>
                </Popover>
              </div>

              {leadInfo && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border bg-warning-soft/60 px-4 py-2 text-xs">
                  <span className="flex items-center gap-1.5 font-semibold text-warning">
                    <ClipboardList className="h-3.5 w-3.5" /> Observações da lista
                  </span>
                  {leadInfo.nome && (
                    <span>
                      <span className="text-muted-foreground">Nome: </span>
                      <span className="font-medium">{leadInfo.nome}</span>
                    </span>
                  )}
                  {leadInfo.documento && (
                    <span>
                      <span className="text-muted-foreground">CPF: </span>
                      <span className="font-mono font-medium">{formatCpf(leadInfo.documento)}</span>
                    </span>
                  )}
                </div>
              )}

              <div className="flex-1 space-y-3 overflow-y-auto p-6" ref={messagesContainerRef}>
                {isWaConversation ? (
                  waMessages.length === 0 ? (
                    <div className="mx-auto max-w-md rounded-xl bg-info-soft p-3 text-center text-xs text-info">
                      Nenhuma mensagem ainda nesta conversa.
                    </div>
                  ) : (
                    waMessages.map((message, index) => {
                      // Separador quando vira o dia (mensagens já vêm em ordem
                      // cronológica). Também no primeiro item, para sempre haver
                      // uma referência de data no topo do histórico visível.
                      const dia = new Date(message.timestamp * 1000);
                      const anterior = index > 0 ? new Date(waMessages[index - 1].timestamp * 1000) : null;
                      const mostrarSeparador = !anterior || dayKey(dia) !== dayKey(anterior);
                      // temMidia trata "arquivo sumiu do disco" igual a "nunca baixou",
                      // para nunca sobrar um balão vazio nem um ícone quebrado.
                      const temMidia = Boolean(message.mediaUrl) && !brokenMedia.has(message.id);
                      const placeholderMidia = mediaPlaceholder(message.type, message.isGif);
                      const exibeFigurinha = !message.deleted && message.type === "sticker" && temMidia;
                      return (
                      <Fragment key={message.id}>
                        {mostrarSeparador && (
                          <div className="sticky top-1 z-10 flex justify-center py-1">
                            <span className="rounded-full bg-secondary/90 px-3 py-1 text-[11px] font-medium text-muted-foreground shadow-sm backdrop-blur">
                              {formatDaySeparator(dia)}
                            </span>
                          </div>
                        )}
                      <div className={cn("flex", message.fromMe ? "justify-end" : "justify-start")}>
                        <div className={cn("max-w-[70%] rounded-2xl text-sm",
                          // Figurinha vai SEM balão, como no WhatsApp: o fundo
                          // violeta/branco do balão arruína o alfa da figurinha.
                          exibeFigurinha
                            ? "bg-transparent p-0 shadow-none"
                            : cn("px-4 py-2 shadow-sm", message.fromMe ? "rounded-br-sm bg-primary text-primary-foreground" : "rounded-bl-sm bg-card"))}>
                          {message.deleted && (
                            <div className="text-xs italic opacity-70">🚫 Mensagem apagada</div>
                          )}
                          {!message.deleted && message.type === "contact" && (message.contacts || (message.contact ? [message.contact] : [])).map((contact, index) => (
                            <div key={`${message.id}-contact-${index}`} className={cn(
                              "mb-1 w-64 max-w-full rounded-lg border p-3",
                              message.fromMe ? "border-primary-foreground/25 bg-primary-foreground/10" : "border-border bg-secondary/60",
                            )}>
                              <div className="flex items-start gap-3">
                                <div className={cn(
                                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
                                  message.fromMe ? "bg-primary-foreground/20" : "bg-primary-soft",
                                )}>
                                  <ContactIcon className="h-5 w-5" />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="truncate font-semibold">{contact.displayName || "Contato"}</div>
                                  {contact.phone && (
                                    <div className={cn("mt-0.5 flex items-center gap-1 text-xs", message.fromMe ? "text-primary-foreground/75" : "text-muted-foreground")}>
                                      <Phone className="h-3 w-3" />
                                      <span className="truncate">+{contact.phone}</span>
                                    </div>
                                  )}
                                </div>
                              </div>
                              <Button
                                type="button"
                                variant={message.fromMe ? "secondary" : "outline"}
                                size="sm"
                                className="mt-3 w-full gap-2"
                                disabled={!contact.phone || startingConversation}
                                onClick={() => startConversation({ phone: contact.phone, customer: contact.displayName })}
                              >
                                <MessageCirclePlus className="h-4 w-4" /> Iniciar conversa
                              </Button>
                            </div>
                          ))}
                          {!message.deleted && temMidia && (message.type === "image" || message.type === "sticker") && (
                            <button
                              type="button"
                              onClick={() => setViewer({ src: message.mediaUrl!, kind: "image" })}
                              className="mb-1 block overflow-hidden rounded-lg transition hover:opacity-90"
                              title="Clique para expandir"
                            >
                              <img
                                src={message.mediaUrl}
                                alt=""
                                onError={() => setBrokenMedia(prev => new Set(prev).add(message.id))}
                                className={cn("rounded-lg", message.type === "sticker" ? "max-h-40" : "max-h-72")}
                              />
                            </button>
                          )}
                          {!message.deleted && !temMidia && placeholderMidia && (
                            <div className={cn("mb-1 flex items-center gap-1.5 text-xs italic",
                              message.fromMe ? "text-primary-foreground/70" : "text-muted-foreground")}>
                              <ImageOff className="h-3.5 w-3.5 shrink-0" />
                              <span>{placeholderMidia} não foi baixada</span>
                            </div>
                          )}
                          {!message.deleted && temMidia && (message.type === "audio" || message.type === "ptt") && (
                            <div className="mb-1"><AudioMessage src={message.mediaUrl} mine={message.fromMe} /></div>
                          )}
                          {!message.deleted && temMidia && message.type === "video" && (
                            message.isGif ? (
                              <video src={message.mediaUrl} className="mb-1 max-h-72 rounded-lg" autoPlay loop muted playsInline />
                            ) : (
                              <button
                                type="button"
                                onClick={() => setViewer({ src: message.mediaUrl!, kind: "video" })}
                                className="relative mb-1 block overflow-hidden rounded-lg transition hover:opacity-90"
                                title="Clique para expandir"
                              >
                                <video src={message.mediaUrl} className="max-h-72 rounded-lg" preload="metadata" muted playsInline />
                                <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/60 text-white shadow-lg">
                                    <svg viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6 translate-x-[1px]"><path d="M8 5v14l11-7z" /></svg>
                                  </span>
                                </span>
                              </button>
                            )
                          )}
                          {!message.deleted && temMidia && message.type === "document" && (
                            <a href={message.mediaUrl} target="_blank" rel="noreferrer" className="mb-1 block text-xs underline">Abrir documento</a>
                          )}
                          {!message.deleted && message.body && message.type !== "contact" && <div className="whitespace-pre-wrap break-words">{message.body}</div>}
                          {!message.deleted && temMidia && (
                            <button
                              type="button"
                              onClick={() => openProntuarioLink(message)}
                              className={cn(
                                "mt-1 flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition",
                                message.fromMe && !exibeFigurinha
                                  ? "bg-primary-foreground/15 text-primary-foreground hover:bg-primary-foreground/25"
                                  : "bg-secondary text-foreground hover:bg-secondary/80",
                              )}
                              title="Vincular ao prontuário"
                            >
                              <FolderOpen className="h-3 w-3" /> Vincular ao prontuário
                            </button>
                          )}
                          <div className={cn("mt-1 flex items-center justify-end gap-1 text-[10px]",
                            // Sem balão, o branco do texto sumiria no fundo claro.
                            message.fromMe && !exibeFigurinha ? "text-primary-foreground/70" : "text-muted-foreground")}>
                            {message.edited && !message.deleted && <span className="italic">(editada)</span>}
                            <span>{formatTime(new Date(message.timestamp * 1000).toISOString())}</span>
                            {message.fromMe && (
                              message.ack >= 3
                                ? <CheckCheck className="h-3 w-3 text-info" />
                                : message.ack === 2
                                  ? <CheckCheck className="h-3 w-3" />
                                  : message.ack === 1
                                    ? <Check className="h-3 w-3" />
                                    : <Clock className="h-3 w-3" />
                            )}
                          </div>
                        </div>
                      </div>
                      </Fragment>
                      );
                    })
                  )
                ) : (
                  <div className="mx-auto flex max-w-md items-center gap-2 rounded-xl bg-info-soft p-3 text-xs text-info">
                    <Info className="h-4 w-4 shrink-0" /> Esta conversa ainda não está vinculada a uma instância de WhatsApp.
                  </div>
                )}
              </div>

              {selected && waPatches[selected.id]?.schedulingProposal && (
                <SchedulingProposalBar
                  proposal={waPatches[selected.id]!.schedulingProposal!}
                  appointments={appointments}
                  sellerId={selected.sellerId}
                  canSchedule={Boolean(selected.dealId)}
                  onPick={confirmScheduling}
                  onDismiss={() => clearSchedulingProposal(selected.id)}
                  onSendDays={sendSchedulingDays}
                  onSendTimes={sendSchedulingTimes}
                />
              )}

              <div className="flex items-center gap-2 border-t border-border bg-card p-3">
                {isWaConversation ? (
                  recording ? (
                    <>
                      <Button variant="ghost" size="icon" title="Cancelar gravação" onClick={() => stopRecording(true)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                      <div className="flex flex-1 items-center gap-3 rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
                        <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-destructive" />
                        <RecordingWaveform stream={recordingStream} className="h-7 flex-1" color="hsl(var(--destructive))" />
                        <span className="shrink-0 tabular-nums">{Math.floor(recordingSeconds / 60)}:{(recordingSeconds % 60).toString().padStart(2, "0")}</span>
                      </div>
                      <Button onClick={() => stopRecording(false)} className="gap-2 bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={sending}>
                        <Send className="h-4 w-4" /> Enviar
                      </Button>
                    </>
                  ) : (
                    <>
                      <input
                        ref={attachInputRef}
                        type="file"
                        accept={
                          attachKind === "image" ? "image/*"
                            : attachKind === "video" ? "video/*"
                              : attachKind === "audio" ? "audio/*"
                                : "*/*"
                        }
                        className="hidden"
                        onChange={e => {
                          const f = e.target.files?.[0];
                          if (f) sendFile(attachKind, f);
                          e.target.value = "";
                        }}
                      />
                      <Popover open={attachOpen} onOpenChange={setAttachOpen}>
                        <PopoverTrigger asChild>
                          <Button variant="ghost" size="icon" title="Anexar" disabled={sending}>
                            <Paperclip className="h-4 w-4" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent align="start" side="top" className="w-44 p-1">
                          <button onClick={() => openAttachPicker("image")} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-secondary">
                            <ImageIcon className="h-4 w-4 text-info" /> Foto
                          </button>
                          <button onClick={() => openAttachPicker("video")} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-secondary">
                            <Film className="h-4 w-4 text-success" /> Vídeo
                          </button>
                          <button onClick={() => openAttachPicker("audio")} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-secondary">
                            <Music className="h-4 w-4 text-warning" /> Áudio
                          </button>
                          <button onClick={() => openAttachPicker("document")} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-secondary">
                            <FileText className="h-4 w-4 text-primary" /> Documento
                          </button>
                        </PopoverContent>
                      </Popover>
                      <Popover open={quickOpen} onOpenChange={setQuickOpen}>
                        <PopoverTrigger asChild>
                          <Button variant="ghost" size="icon" title="Mensagens rápidas" disabled={sending}>
                            <MessageSquareText className="h-4 w-4" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent align="start" side="top" className="w-80 p-1">
                          {quickReplies.length === 0 ? (
                            <div className="p-3 text-center text-xs text-muted-foreground">
                              Nenhuma mensagem criada.<br />
                              Crie em Configurações &gt; Mensagens rápidas.
                            </div>
                          ) : (
                            <div className="max-h-72 overflow-y-auto">
                              {quickReplies.map(qr => (
                                <button
                                  key={qr.id}
                                  onClick={() => applyQuickReply(qr)}
                                  className="flex w-full flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left hover:bg-secondary"
                                >
                                  <span className="text-sm font-medium">{qr.titulo}</span>
                                  <span className="line-clamp-2 text-xs text-muted-foreground">
                                    {renderTemplate(qr.corpo, {
                                      nome: selected.customer,
                                      nomeWhatsapp: selected.whatsappName,
                                      telefone: selected.phone,
                                      listaNome: leadInfo?.nome,
                                      listaCpf: leadInfo?.documento,
                                      listaTelefone: leadInfo?.telefone,
                                      atendente: currentUser?.name,
                                    })}
                                  </span>
                                </button>
                              ))}
                            </div>
                          )}
                        </PopoverContent>
                      </Popover>
                      <Button variant="ghost" size="icon" title="Gravar áudio" onClick={startRecording} disabled={sending}>
                        <Mic className="h-4 w-4" />
                      </Button>
                      <div className="relative flex-1">
                        {selectionToolbar && (
                          <div
                            className="absolute z-20 flex -translate-x-1/2 -translate-y-full items-center gap-0.5 rounded-md border border-border bg-popover p-0.5 shadow-md"
                            style={{ top: selectionToolbar.top, left: selectionToolbar.left }}
                            onMouseDown={e => e.preventDefault()}
                          >
                            <button type="button" title="Copiar" onClick={copySelection} className="rounded p-1.5 hover:bg-secondary">
                              <Copy className="h-4 w-4" />
                            </button>
                            <button type="button" title="Recortar" onClick={cutSelection} className="rounded p-1.5 hover:bg-secondary">
                              <Scissors className="h-4 w-4" />
                            </button>
                            <button type="button" title="Negrito" onClick={() => wrapSelection("*")} className="rounded p-1.5 hover:bg-secondary">
                              <Bold className="h-4 w-4" />
                            </button>
                            <button type="button" title="Itálico" onClick={() => wrapSelection("_")} className="rounded p-1.5 hover:bg-secondary">
                              <Italic className="h-4 w-4" />
                            </button>
                          </div>
                        )}
                        <Textarea
                          ref={messageInputRef}
                          value={draftMessage}
                          onChange={e => setDraftMessage(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendText(); } }}
                          onSelect={updateSelectionToolbar}
                          onScroll={updateSelectionToolbar}
                          onBlur={() => setSelectionToolbar(null)}
                          placeholder="Digite uma mensagem..."
                          rows={1}
                          className="max-h-32 min-h-[40px] resize-none bg-secondary"
                          disabled={sending}
                        />
                      </div>
                      <Button onClick={sendText} disabled={sending || !draftMessage.trim()} className="gap-2">
                        <Send className="h-4 w-4" /> Enviar
                      </Button>
                    </>
                  )
                ) : (
                  <>
                    <Input disabled placeholder="Vincule esta conversa a uma instância de WhatsApp para enviar mensagens" className="bg-secondary" />
                    <Button disabled className="gap-2"><Paperclip className="h-4 w-4" /> Sem instância</Button>
                  </>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-muted-foreground">Selecione uma conversa</div>
          )}
        </div>

        <Dialog open={newConversationOpen} onOpenChange={setNewConversationOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="font-display">Iniciar conversa</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <div className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">Instância</div>
                <Select value={newConversationInstanceId} onValueChange={setNewConversationInstanceId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione a instância" />
                  </SelectTrigger>
                  <SelectContent>
                    {instancesList.map(instance => (
                      <SelectItem key={instance.id} value={instance.id}>{instance.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <div className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">Telefone</div>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={newConversationPhone}
                    onChange={event => setNewConversationPhone(event.target.value)}
                    placeholder="5511999999999"
                    className="pl-9"
                    autoFocus
                    onKeyDown={event => {
                      if (event.key === "Enter") startConversation();
                    }}
                  />
                </div>
              </div>
              <div>
                <div className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">Nome</div>
                <div className="relative">
                  <UserRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={newConversationName}
                    onChange={event => setNewConversationName(event.target.value)}
                    placeholder="Nome do contato"
                    className="pl-9"
                    onKeyDown={event => {
                      if (event.key === "Enter") startConversation();
                    }}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setNewConversationOpen(false)}>Cancelar</Button>
                <Button className="gap-2" onClick={() => startConversation()} disabled={startingConversation || !newConversationPhone.trim() || !newConversationInstanceId}>
                  <MessageCirclePlus className="h-4 w-4" /> Iniciar
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {selected && (
          <Dialog open={leadActionsOpen} onOpenChange={setLeadActionsOpen}>
            <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="font-display">Opções do lead</DialogTitle>
              </DialogHeader>
              <div className="mb-4 flex items-center gap-3 rounded-xl bg-secondary p-3">
                <Avatar className="h-12 w-12">
                  {selected.avatarUrl && <AvatarImage src={selected.avatarUrl} alt={selected.customer} />}
                  <AvatarFallback className="bg-gradient-primary font-semibold text-primary-foreground">{initials(selected.customer)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  {editingName ? (
                    <div className="flex items-center gap-1">
                      <Input
                        value={nameDraft}
                        onChange={event => setNameDraft(event.target.value)}
                        className="h-9 font-semibold"
                        autoFocus
                        onKeyDown={event => {
                          if (event.key === "Enter") saveLeadName();
                          if (event.key === "Escape") setEditingName(false);
                        }}
                      />
                      <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={saveLeadName}><Check className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => { setNameDraft(selected.customer); setEditingName(false); }}><X className="h-4 w-4" /></Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <div className="min-w-0 truncate font-semibold">{selected.customer}</div>
                      {canEditLeadName && (
                        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => setEditingName(true)} title="Editar nome do lead">
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  )}
                  {selected.whatsappName && (
                    <div className="text-[11px] italic text-muted-foreground">
                      Nome no WhatsApp: <span className="font-medium not-italic">{selected.whatsappName}</span>
                    </div>
                  )}
                  {selected.phone && (
                    <button
                      type="button"
                      onClick={() => { navigator.clipboard.writeText(selected.phone).then(() => toast.success("Número copiado")).catch(() => {}); }}
                      className="mt-0.5 text-left text-xs text-muted-foreground transition hover:text-foreground"
                      title="Clique para copiar"
                    >
                      📞 {selected.phone}
                    </button>
                  )}
                  {selected.chatId && (
                    <button
                      type="button"
                      onClick={() => { navigator.clipboard.writeText(selected.chatId!).then(() => toast.success("ID copiado")).catch(() => {}); }}
                      className="mt-0.5 block text-left text-[11px] text-muted-foreground/80 transition hover:text-foreground"
                      title="Clique para copiar"
                    >
                      ID WhatsApp: <span className="font-mono">{selected.chatId}</span>
                    </button>
                  )}
                </div>
              </div>

              <div className="grid gap-5 text-sm md:grid-cols-2">
                <div>
                  <div className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">Temperatura</div>
                  <Select value={selected.temperature} onValueChange={temperature => changeTemperature(temperature as Deal["temperature"])}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="quente">Quente</SelectItem>
                      <SelectItem value="morno">Morno</SelectItem>
                      <SelectItem value="frio">Frio</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <div className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">Etapa do funil</div>
                  <Select value={selected.stage || stages[0]?.id || ""} onValueChange={changeStage}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Selecione a etapa" /></SelectTrigger>
                    <SelectContent>
                      {stages.map(stage => (
                        <SelectItem key={stage.id} value={stage.id}>{stage.title}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="md:col-span-2">
                  <div className="mb-2 flex items-center gap-1 text-[10px] font-semibold uppercase text-muted-foreground">
                    <Bot className="h-3.5 w-3.5" /> Agente de IA
                  </div>
                  <div className="grid gap-3 rounded-xl border border-border/70 bg-background p-3 sm:grid-cols-[auto_1fr] sm:items-center">
                    <label className="flex items-center gap-2 text-sm font-medium">
                      <Switch checked={Boolean(selected.aiEnabled)} onCheckedChange={toggleAI} />
                      <span>{selected.aiEnabled ? "Ligado" : "Desligado"}</span>
                    </label>
                    <Select value={selected.aiAgentId || activeAgents[0]?.id || agents[0]?.id || ""} onValueChange={changeAIAgent} disabled={agents.length === 0}>
                      <SelectTrigger className="h-9"><SelectValue placeholder="Selecionar agente" /></SelectTrigger>
                      <SelectContent>
                        {agents.map(agent => (
                          <SelectItem key={agent.id} value={agent.id}>{agent.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className={cn("grid gap-4 md:col-span-2", isAdmin ? "md:w-fit md:grid-cols-[minmax(180px,auto)_auto] md:items-start" : "md:grid-cols-1")}>
                  <div>
                    <div className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">Responsáveis</div>
                    {assignedUsers.length ? (
                      <div className="space-y-1.5">
                        {assignedUsers.map(user => (
                          <div key={user.id} className="flex items-center gap-2">
                            <Avatar className="h-6 w-6"><AvatarFallback className="bg-primary-soft text-[10px] text-primary">{user.avatar}</AvatarFallback></Avatar>
                            <span>{user.name}</span>
                          </div>
                        ))}
                      </div>
                    ) : <div className="text-xs text-muted-foreground">Nenhum responsável atribuído.</div>}
                  </div>
                  {isAdmin && (
                    <div className="md:w-28">
                      <div className="mb-2 text-[10px] font-semibold uppercase text-muted-foreground">Atribuir acesso</div>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" size="icon" title="Atribuir vendedores">
                            <UserPlus className="h-4 w-4" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent align="end" className="w-[280px] p-2">
                          <div className="max-h-56 overflow-y-auto">
                            {sellerOptions.map(user => (
                              <label key={user.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-secondary">
                                <Checkbox checked={assignedIds.includes(user.id)} onCheckedChange={() => toggleResponsible(user.id)} />
                                <span className="truncate">{user.name}</span>
                              </label>
                            ))}
                          </div>
                        </PopoverContent>
                      </Popover>
                    </div>
                  )}
                </div>
                <div className="md:col-span-2">
                  <div className="mb-2 flex items-center gap-2">
                    <div className="text-[10px] font-semibold uppercase text-muted-foreground">Tags</div>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" size="icon" className="h-7 w-7" title="Gerenciar tags">
                          <Tag className="h-4 w-4" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent align="end" className="w-[320px] p-3">
                        <div className="mb-3 flex gap-2">
                          <Input id="new-conversation-tag" value={newTag} onChange={event => setNewTag(event.target.value)} placeholder="Nova tag" className="h-9" />
                          <Button variant="outline" size="icon" onClick={addTagToConversation}><Plus className="h-4 w-4" /></Button>
                        </div>
                        <div className="max-h-56 overflow-y-auto rounded-xl border border-border/70 bg-background p-2">
                          {tags.map(tag => (
                            <label key={tag} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-secondary">
                              <Checkbox checked={selected.tags.includes(tag)} onCheckedChange={() => toggleTag(tag)} />
                              <span className="truncate">{tag}</span>
                            </label>
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {selected.tags.map(tag => <TagBadge key={tag} label={tag} onRemove={() => toggleTag(tag)} />)}
                    {selected.tags.length === 0 && <span className="text-xs text-muted-foreground">Sem tags.</span>}
                  </div>
                </div>
                <div className="md:col-span-2">
                  <div className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">Observações internas</div>
                  <Textarea
                    value={notesDraft}
                    onChange={event => setNotesDraft(event.target.value)}
                    placeholder="Adicionar observação interna..."
                    rows={4}
                  />
                  <div className="mt-2 flex justify-end">
                    <Button variant="outline" size="sm" onClick={saveInternalNotes}>Salvar observação</Button>
                  </div>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>
      <ImageViewer src={viewer?.src || ""} kind={viewer?.kind} alt={selected?.customer || "midia"} open={Boolean(viewer)} onClose={() => setViewer(null)} />

      <Dialog open={Boolean(prontuarioTarget)} onOpenChange={open => { if (!open) { setProntuarioTarget(null); setProntuarioName(""); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Vincular ao prontuário</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="prontuario-link-name">Nome do arquivo</Label>
            <Input
              id="prontuario-link-name"
              value={prontuarioName}
              autoFocus
              onChange={e => setProntuarioName(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && !linkingProntuario) {
                  e.preventDefault();
                  confirmProntuarioLink();
                }
              }}
            />
            {selected && !selected.dealId && (
              <p className="text-[11px] text-muted-foreground">
                Esta conversa ainda não está vinculada a um card — um card será criado automaticamente no Kanban.
              </p>
            )}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => { setProntuarioTarget(null); setProntuarioName(""); }} disabled={linkingProntuario}>
              Cancelar
            </Button>
            <Button onClick={confirmProntuarioLink} disabled={linkingProntuario} className="gap-2">
              <FolderOpen className="h-4 w-4" /> {linkingProntuario ? "Vinculando..." : "Vincular"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-display">
              <CalendarClock className="h-5 w-5 text-primary" /> Agendamentos de mensagens
            </DialogTitle>
          </DialogHeader>
          {selected && (
            <p className="-mt-2 text-xs text-muted-foreground">
              Para <span className="font-medium text-foreground">{selected.customer}</span>
              {selected.phone ? ` · ${selected.phone}` : ""}
            </p>
          )}

          <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Nova mensagem agendada</div>
            <Textarea
              value={schedBody}
              onChange={e => setSchedBody(e.target.value)}
              placeholder="Digite a mensagem que será enviada automaticamente..."
              rows={3}
              className="resize-none"
            />
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <Label className="mb-1 block text-[11px] font-semibold uppercase text-muted-foreground">Data</Label>
                <Input type="date" value={schedDate} onChange={e => setSchedDate(e.target.value)} />
              </div>
              <div>
                <Label className="mb-1 block text-[11px] font-semibold uppercase text-muted-foreground">Hora</Label>
                <Input type="time" value={schedTime} onChange={e => setSchedTime(e.target.value)} />
              </div>
            </div>

            <div className="mt-3 space-y-2 rounded-lg border border-border/70 bg-background p-3">
              <div className="text-[11px] font-semibold uppercase text-muted-foreground">Opções</div>
              <label className="flex cursor-pointer items-start gap-2.5 text-sm">
                <Checkbox checked={schedCancelClient} onCheckedChange={v => setSchedCancelClient(Boolean(v))} className="mt-0.5" />
                <span>
                  Cancelar se o cliente enviar outra mensagem antes
                  <span className="block text-[11px] text-muted-foreground">Útil para lembretes que perdem o sentido se o cliente já respondeu.</span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2.5 text-sm">
                <Checkbox checked={schedCancelAgent} onCheckedChange={v => setSchedCancelAgent(Boolean(v))} className="mt-0.5" />
                <span>
                  Cancelar se o atendente enviar uma mensagem antes
                  <span className="block text-[11px] text-muted-foreground">Evita mensagens duplicadas caso o atendimento continue manualmente.</span>
                </span>
              </label>
            </div>

            <div className="mt-3 flex justify-end">
              <Button onClick={submitSchedule} disabled={savingSchedule || !schedBody.trim()} className="gap-2">
                {savingSchedule ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarPlus className="h-4 w-4" />}
                Agendar mensagem
              </Button>
            </div>
          </div>

          <div className="mt-1">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Agendamentos desta conversa
            </div>
            {loadingScheduled ? (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
              </div>
            ) : scheduledList.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                Nenhuma mensagem agendada ainda.
              </div>
            ) : (
              <div className="space-y-2">
                {scheduledList.map(item => {
                  const when = new Date(item.scheduledAt);
                  const whenLabel = Number.isNaN(when.getTime())
                    ? item.scheduledAt
                    : new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(when);
                  const statusMeta = {
                    pending: { label: "Agendada", cls: "bg-info-soft text-info", Icon: Clock },
                    sent: { label: "Enviada", cls: "bg-success-soft text-success", Icon: CheckCheck },
                    cancelled: { label: "Cancelada", cls: "bg-secondary text-muted-foreground", Icon: Ban },
                    failed: { label: "Falhou", cls: "bg-destructive/10 text-destructive", Icon: X },
                  }[item.status];
                  const StatusIcon = statusMeta.Icon;
                  return (
                    <div key={item.id} className="rounded-lg border border-border bg-card p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                          <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" /> {whenLabel}
                        </div>
                        <span className={cn("flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold", statusMeta.cls)}>
                          <StatusIcon className="h-3 w-3" /> {statusMeta.label}
                        </span>
                      </div>
                      <p className="mt-1.5 whitespace-pre-wrap break-words text-sm">{item.body}</p>
                      {(item.cancelIfClientReplies || item.cancelIfAgentReplies) && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {item.cancelIfClientReplies && (
                            <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground">cancela se cliente responder</span>
                          )}
                          {item.cancelIfAgentReplies && (
                            <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground">cancela se atendente responder</span>
                          )}
                        </div>
                      )}
                      {item.status === "cancelled" && item.cancelledReason && (
                        <div className="mt-1.5 text-[11px] text-muted-foreground">Motivo: {item.cancelledReason}</div>
                      )}
                      {item.status === "failed" && item.error && (
                        <div className="mt-1.5 text-[11px] text-destructive">Erro: {item.error}</div>
                      )}
                      <div className="mt-2 flex justify-end">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-destructive"
                          onClick={() => cancelSchedule(item)}
                        >
                          {item.status === "pending" ? <><Ban className="h-3.5 w-3.5" /> Cancelar</> : <><Trash2 className="h-3.5 w-3.5" /> Remover</>}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={archiveConfirmOpen} onOpenChange={setArchiveConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Arquivar conversa</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p>
              A conversa com <span className="font-semibold">{selected?.customer}</span> vai sair da lista de atendimentos.
            </p>
            <p className="text-muted-foreground">
              Nada é apagado: o histórico de mensagens continua salvo e você pode restaurar a conversa a qualquer momento
              em <span className="font-medium">Conversas arquivadas</span>. Se o contato mandar uma mensagem nova, ela
              volta para a lista automaticamente.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setArchiveConfirmOpen(false)}>Cancelar</Button>
            <Button variant="destructive" className="gap-2" onClick={handleArchiveConversation}>
              <Archive className="h-4 w-4" /> Arquivar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={archivedListOpen} onOpenChange={setArchivedListOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Conversas arquivadas</DialogTitle>
          </DialogHeader>
          {archivedLoading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
            </div>
          ) : archivedList.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Nenhuma conversa arquivada.</p>
          ) : (
            <div className="max-h-[60vh] space-y-1.5 overflow-y-auto">
              {archivedList.map(conversation => (
                <div key={conversation.id} className="flex items-center gap-3 rounded-lg border border-border/70 p-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{conversation.customer || conversation.phone}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {conversation.phone}
                      {instanceNameById.get(conversation.instanceId) && ` · ${instanceNameById.get(conversation.instanceId)}`}
                    </div>
                  </div>
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => handleRestoreConversation(conversation)}>
                    <ArchiveRestore className="h-3.5 w-3.5" /> Restaurar
                  </Button>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
