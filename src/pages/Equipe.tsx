import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { LogOut, MessageSquarePlus, Search, Send, Users, UsersRound } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { EmptyState } from "@/components/shared/EmptyState";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useInternalMessages, useInternalThreads } from "@/hooks/useInternalChat";
import { InternalThread, whatsappApi } from "@/lib/whatsapp-api";
import { cn } from "@/lib/utils";
import { useCRM } from "@/store/crm-store";
import { roleLabel } from "@/lib/roles";

const initials = (name: string) => (name || "").trim().slice(0, 2).toUpperCase() || "?";

const formatTime = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

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

const relativeTime = (iso?: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? formatDistanceToNow(d, { locale: ptBR, addSuffix: true }) : "";
};

export default function Equipe() {
  const { currentUser, teamUsers } = useCRM();
  const { threads, loading, markRead, refresh } = useInternalThreads(currentUser?.id);
  const [selectedId, setSelectedId] = useState<string>("");
  const { messages, loading: loadingMessages, setMessages } = useInternalMessages(selectedId || null, currentUser?.id);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [search, setSearch] = useState("");
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [groupMembers, setGroupMembers] = useState<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Colegas disponíveis para conversar — nunca o próprio usuário.
  const colleagues = useMemo(
    () => teamUsers.filter(user => user.active && user.id !== currentUser?.id),
    [teamUsers, currentUser?.id],
  );
  const userById = useMemo(() => new Map(teamUsers.map(user => [user.id, user])), [teamUsers]);

  // Numa DM o título é o nome do outro participante; num grupo, o nome dado.
  const titleFor = (thread: InternalThread) => {
    if (thread.type === "group") return thread.name || "Grupo";
    const otherId = thread.memberIds.find(id => id !== currentUser?.id);
    return userById.get(otherId || "")?.name || "Usuário removido";
  };

  const subtitleFor = (thread: InternalThread) => {
    if (thread.type !== "group") {
      const outro = userById.get(thread.memberIds.find(id => id !== currentUser?.id) || "");
      return outro ? roleLabel(outro.role) : "";
    }
    return `${thread.memberIds.length} participantes`;
  };

  const visibleThreads = useMemo(() => {
    const term = search.toLowerCase().trim();
    if (!term) return threads;
    return threads.filter(thread =>
      titleFor(thread).toLowerCase().includes(term) ||
      (thread.lastMessage?.body || "").toLowerCase().includes(term));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threads, search, userById, currentUser?.id]);

  const selected = threads.find(thread => thread.id === selectedId) || null;

  // Abrir a conversa zera o não-lida. Só dispara quando há o que marcar, para
  // não bater na API a cada render.
  useEffect(() => {
    if (selected && (selected.unreadCount || 0) > 0) markRead(selected.id);
  }, [selected, markRead]);

  useLayoutEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, selectedId]);

  const openDm = async (userId: string) => {
    try {
      const thread = await whatsappApi.openInternalDm(userId);
      await refresh();
      setSelectedId(thread.id);
      setNewChatOpen(false);
    } catch (err) {
      toast.error(`Não foi possível abrir a conversa: ${err instanceof Error ? err.message : "erro desconhecido"}`);
    }
  };

  const createGroup = async () => {
    const name = groupName.trim();
    if (!name) return toast.error("Dê um nome ao grupo");
    if (groupMembers.size === 0) return toast.error("Escolha pelo menos um participante");
    try {
      const thread = await whatsappApi.createInternalGroup({ name, memberIds: [...groupMembers] });
      await refresh();
      setSelectedId(thread.id);
      setGroupOpen(false);
      setGroupName("");
      setGroupMembers(new Set());
      toast.success(`Grupo "${thread.name}" criado`);
    } catch (err) {
      toast.error(`Não foi possível criar o grupo: ${err instanceof Error ? err.message : "erro desconhecido"}`);
    }
  };

  const leaveGroup = async () => {
    if (!selected || selected.type !== "group") return;
    if (!window.confirm(`Sair do grupo "${selected.name}"? Você deixará de receber as mensagens.`)) return;
    try {
      await whatsappApi.leaveInternalGroup(selected.id);
      setSelectedId("");
      await refresh();
      toast.success("Você saiu do grupo");
    } catch (err) {
      toast.error(`Não foi possível sair: ${err instanceof Error ? err.message : "erro desconhecido"}`);
    }
  };

  const send = async () => {
    const body = draft.trim();
    if (!body || !selected || sending) return;
    setSending(true);
    try {
      const message = await whatsappApi.sendInternalMessage(selected.id, body);
      // Insere na hora; o evento de socket chega depois e é ignorado por id.
      setMessages(curr => (curr.some(m => m.id === message.id) ? curr : [...curr, message]));
      setDraft("");
    } catch (err) {
      toast.error(`Não foi possível enviar: ${err instanceof Error ? err.message : "erro desconhecido"}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <AppLayout title="Equipe" subtitle="Conversas internas entre usuários">
      <div className="card-elevated flex min-h-[calc(100vh-180px)] flex-col overflow-hidden lg:h-[calc(100vh-180px)] lg:flex-row">
        <aside className="flex max-h-[46vh] w-full flex-col border-b border-border lg:max-h-none lg:w-80 lg:border-b-0 lg:border-r">
          <div className="border-b border-border p-3">
            <div className="flex gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={event => setSearch(event.target.value)}
                  placeholder="Buscar conversa..."
                  className="border-transparent bg-secondary pl-9"
                />
              </div>
              <Button variant="outline" size="icon" title="Nova conversa" onClick={() => setNewChatOpen(true)}>
                <MessageSquarePlus className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" title="Novo grupo" onClick={() => setGroupOpen(true)}>
                <UsersRound className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto scrollbar-thin">
            {loading && <p className="p-4 text-sm text-muted-foreground">Carregando...</p>}
            {!loading && visibleThreads.length === 0 && (
              <p className="p-4 text-sm text-muted-foreground">
                {search ? "Nenhuma conversa encontrada." : "Nenhuma conversa ainda. Comece uma pelo botão acima."}
              </p>
            )}
            {visibleThreads.map(thread => {
              const active = thread.id === selectedId;
              const unread = thread.unreadCount || 0;
              return (
                <button
                  key={thread.id}
                  type="button"
                  onClick={() => setSelectedId(thread.id)}
                  className={cn(
                    "flex w-full items-start gap-3 border-b border-border/50 px-3 py-2.5 text-left transition",
                    active ? "bg-primary-soft" : "hover:bg-secondary",
                  )}
                >
                  <Avatar className="h-9 w-9 shrink-0">
                    {thread.type === "dm" && (
                      <AvatarImage src={userById.get(thread.memberIds.find(id => id !== currentUser?.id) || "")?.photoUrl} />
                    )}
                    <AvatarFallback className={cn(
                      "text-[10px] font-semibold",
                      thread.type === "group" ? "bg-info-soft text-info" : "bg-gradient-primary text-primary-foreground",
                    )}>
                      {thread.type === "group" ? <Users className="h-4 w-4" /> : initials(titleFor(thread))}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold">{titleFor(thread)}</span>
                      {unread > 0 && (
                        <span className="ml-auto flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                          {unread}
                        </span>
                      )}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {thread.lastMessage
                        ? `${thread.lastMessage.senderId === currentUser?.id ? "Você: " : ""}${thread.lastMessage.body}`
                        : "Sem mensagens"}
                    </div>
                    {thread.lastMessageAt && (
                      <div className="mt-0.5 text-[10px] text-muted-foreground">{relativeTime(thread.lastMessageAt)}</div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          {!selected ? (
            <div className="flex flex-1 items-center justify-center p-6">
              <EmptyState
                icon={<Users className="h-5 w-5" />}
                title="Nenhuma conversa aberta"
                description="Escolha uma conversa na lista ou inicie uma nova com alguém da equipe."
                actionLabel="Nova conversa"
                onAction={() => setNewChatOpen(true)}
              />
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 border-b border-border px-4 py-3">
                <Avatar className="h-9 w-9">
                  <AvatarFallback className={cn(
                    "text-[10px] font-semibold",
                    selected.type === "group" ? "bg-info-soft text-info" : "bg-gradient-primary text-primary-foreground",
                  )}>
                    {selected.type === "group" ? <Users className="h-4 w-4" /> : initials(titleFor(selected))}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{titleFor(selected)}</div>
                  <div className="truncate text-xs text-muted-foreground">{subtitleFor(selected)}</div>
                </div>
                {selected.type === "group" && (
                  <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-destructive" onClick={leaveGroup}>
                    <LogOut className="h-3.5 w-3.5" /> Sair do grupo
                  </Button>
                )}
              </div>

              <div className="flex-1 space-y-1 overflow-y-auto bg-secondary/30 px-4 py-4 scrollbar-thin">
                {loadingMessages && <p className="text-center text-xs text-muted-foreground">Carregando mensagens...</p>}
                {!loadingMessages && messages.length === 0 && (
                  <p className="text-center text-xs text-muted-foreground">Nenhuma mensagem ainda. Diga oi.</p>
                )}
                {messages.map((message, index) => {
                  const mine = message.senderId === currentUser?.id;
                  const sender = userById.get(message.senderId);
                  const prev = messages[index - 1];
                  const newDay = !prev || dayKey(new Date(prev.createdAt)) !== dayKey(new Date(message.createdAt));
                  // Em grupo, só mostra o nome quando muda de remetente.
                  const showSender = selected.type === "group" && !mine && (newDay || prev?.senderId !== message.senderId);
                  return (
                    <Fragment key={message.id}>
                      {newDay && (
                        <div className="flex justify-center py-2">
                          <span className="rounded-full bg-background px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                            {formatDaySeparator(new Date(message.createdAt))}
                          </span>
                        </div>
                      )}
                      <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
                        <div className={cn(
                          "max-w-[75%] rounded-xl px-3 py-2 text-sm shadow-sm",
                          mine ? "bg-primary text-primary-foreground" : "bg-card text-foreground",
                        )}>
                          {showSender && (
                            <div className="mb-0.5 text-[11px] font-semibold text-info">{sender?.name || "Usuário removido"}</div>
                          )}
                          <div className="whitespace-pre-wrap break-words">{message.body}</div>
                          <div className={cn(
                            "mt-0.5 text-right text-[10px]",
                            mine ? "text-primary-foreground/70" : "text-muted-foreground",
                          )}>
                            {formatTime(message.createdAt)}
                          </div>
                        </div>
                      </div>
                    </Fragment>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              <div className="flex items-end gap-2 border-t border-border p-3">
                <Textarea
                  value={draft}
                  onChange={event => setDraft(event.target.value)}
                  onKeyDown={event => {
                    // Enter envia; Shift+Enter quebra linha, como no resto do app.
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      send();
                    }
                  }}
                  placeholder="Escreva uma mensagem..."
                  rows={1}
                  className="max-h-32 min-h-[40px] flex-1 resize-none bg-secondary"
                />
                <Button className="gap-2 bg-gradient-primary" onClick={send} disabled={!draft.trim() || sending}>
                  <Send className="h-4 w-4" /> Enviar
                </Button>
              </div>
            </>
          )}
        </section>
      </div>

      <Dialog open={newChatOpen} onOpenChange={setNewChatOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nova conversa</DialogTitle>
          </DialogHeader>
          {colleagues.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Não há outros usuários ativos na equipe.</p>
          ) : (
            <div className="max-h-[55vh] space-y-1 overflow-y-auto">
              {colleagues.map(user => (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => openDm(user.id)}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-secondary"
                >
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={user.photoUrl} alt={user.name} />
                    <AvatarFallback className="bg-primary-soft text-[10px] font-semibold text-primary">{user.avatar}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{user.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{roleLabel(user.role)}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={groupOpen} onOpenChange={setGroupOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Novo grupo</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="group-name">Nome do grupo</Label>
              <Input
                id="group-name"
                value={groupName}
                onChange={event => setGroupName(event.target.value)}
                placeholder="Ex: Comercial"
              />
            </div>
            <div>
              <Label>Participantes</Label>
              <div className="mt-1 max-h-64 space-y-0.5 overflow-y-auto rounded-lg border border-border p-1">
                {colleagues.map(user => (
                  <label key={user.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-secondary">
                    <Checkbox
                      checked={groupMembers.has(user.id)}
                      onCheckedChange={() => setGroupMembers(curr => {
                        const next = new Set(curr);
                        if (next.has(user.id)) next.delete(user.id);
                        else next.add(user.id);
                        return next;
                      })}
                    />
                    <span className="truncate">{user.name}</span>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">{roleLabel(user.role)}</span>
                  </label>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">Você entra no grupo automaticamente.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGroupOpen(false)}>Cancelar</Button>
            <Button className="bg-gradient-primary" onClick={createGroup}>Criar grupo</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
