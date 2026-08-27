import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CustomFieldsManager } from "@/components/shared/CustomFieldsManager";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  TeamUser,
  useCRM,
  WEEKDAY_LABELS,
  DayOfWeek,
  LeadDistributionStrategy,
} from "@/store/crm-store";
import { whatsappApi, LeadListStats, QuickReply, TranscriptionStatus, TranscriptionProvider } from "@/lib/whatsapp-api";
import { TEMPLATE_VARIABLES, renderTemplate, variaveisDesconhecidas } from "@/lib/message-template";
import { Plus, Trash2, Pencil, KeyRound, Loader2, Upload, FileText, MessageSquareText, Stethoscope } from "lucide-react";
import { toast } from "sonner";
import { ROLES, ROLE_OPTIONS, roleLabel, isAtendente, isSecretariaRole, type Role } from "@/lib/roles";
import { mensagemDeErro } from "@/lib/erros";
import { ResponsiveTable } from "@/components/shared/ResponsiveTable";


const initialsFromName = (name: string) =>
  name.split(" ").filter(Boolean).map(part => part[0]).join("").slice(0, 2).toUpperCase();

const readImageFile = (file: File, onLoad: (dataUrl: string) => void) => {
  if (!file.type.startsWith("image/")) {
    toast.error("Selecione uma imagem");
    return;
  }

  const reader = new FileReader();
  reader.onload = () => onLoad(String(reader.result));
  reader.readAsDataURL(file);
};

type EditingUser = Partial<TeamUser> & { id: string; password?: string };

const emptyUser: EditingUser = {
  id: "new",
  name: "",
  username: "",
  avatar: "",
  email: "",
  phone: "",
  role: ROLES.SECRETARIA,
  password: "",
  active: true,
  allowedTags: [],
  allowedConversationIds: [],
  allowedInstanceIds: [],
  receivesNewLeads: true,
};

export default function Configuracoes() {
  const {
    teamUsers: users,
    setTeamUsers: setUsers,
    refreshTeamUsers,
    accountProfile,
    setAccountProfile,
    currentUser,
    hasPermission,
    changePassword,
    agents,
    leadDistribution,
    setLeadDistribution,
    agentSchedule,
    setAgentSchedule,
  } = useCRM();
  const [userDialogOpen, setUserDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<EditingUser>(emptyUser);
  const sellerOptions = users.filter(user => user.active && isAtendente(user.role));
  const accountPhotoInputRef = useRef<HTMLInputElement>(null);
  const userPhotoInputRef = useRef<HTMLInputElement>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  const [openaiConfigured, setOpenaiConfigured] = useState(false);
  const [openaiInput, setOpenaiInput] = useState("");
  const [openaiSaving, setOpenaiSaving] = useState(false);
  const [openaiLoading, setOpenaiLoading] = useState(true);
  const [transcription, setTranscription] = useState<TranscriptionStatus | null>(null);
  const [transcriptionKey, setTranscriptionKey] = useState("");
  const [transcriptionSaving, setTranscriptionSaving] = useState(false);

  const [leadStats, setLeadStats] = useState<LeadListStats>({ total: 0, ultimaImportacao: "" });
  const [leadImporting, setLeadImporting] = useState(false);
  const leadFileRef = useRef<HTMLInputElement>(null);

  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [qrDialogOpen, setQrDialogOpen] = useState(false);
  const [qrEditing, setQrEditing] = useState<{ id: string | null; titulo: string; corpo: string }>({ id: null, titulo: "", corpo: "" });
  const [qrSaving, setQrSaving] = useState(false);
  const qrBodyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    whatsappApi.getOpenaiStatus()
      .then(status => { if (!cancelled) setOpenaiConfigured(status.configured); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setOpenaiLoading(false); });
    whatsappApi.getTranscriptionStatus()
      .then(status => { if (!cancelled) setTranscription(status); })
      .catch(() => {});
    whatsappApi.leadListStats()
      .then(stats => { if (!cancelled) setLeadStats(stats); })
      .catch(() => {});
    whatsappApi.listQuickReplies()
      .then(list => { if (!cancelled) setQuickReplies(list); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const openNewUser = () => {
    setEditingUser(emptyUser);
    setUserDialogOpen(true);
  };

  const openEditUser = (user: TeamUser) => {
    setEditingUser({ ...user, password: "" });
    setUserDialogOpen(true);
  };

  const saveUser = async () => {
    if (!editingUser.name?.trim()) return toast.error("Informe o nome do usuário");
    if (!editingUser.email?.trim()) return toast.error("Informe o e-mail do usuário");
    if (editingUser.id === "new" && !editingUser.password?.trim()) return toast.error("Informe a senha do usuário");

    const avatar = editingUser.avatar?.trim() || initialsFromName(editingUser.name || "");
    const username = editingUser.username?.trim() || (editingUser.email || "").split("@")[0];
    const payload = {
      name: editingUser.name,
      email: editingUser.email,
      phone: editingUser.phone,
      role: editingUser.role,
      avatar,
      username,
      photoUrl: editingUser.photoUrl,
      active: editingUser.active,
      allowedTags: editingUser.allowedTags,
      allowedConversationIds: editingUser.allowedConversationIds,
      allowedInstanceIds: editingUser.allowedInstanceIds,
      receivesNewLeads: editingUser.receivesNewLeads,
      ...(editingUser.password?.trim() ? { password: editingUser.password } : {}),
    };

    try {
      if (editingUser.id === "new") {
        await whatsappApi.createUser(payload);
        toast.success("Usuário criado");
      } else {
        await whatsappApi.updateUser(editingUser.id, payload);
        if (editingUser.id === currentUser?.id) {
          setAccountProfile(prev => ({
            ...prev,
            name: payload.name || prev.name,
            email: payload.email || prev.email,
            phone: payload.phone || prev.phone,
            role: payload.role || prev.role,
            avatar: payload.avatar || prev.avatar,
            photoUrl: payload.photoUrl,
          }));
        }
        toast.success("Usuário atualizado");
      }
      await refreshTeamUsers();
      setUserDialogOpen(false);
    } catch (err) {
      toast.error(`Falha ao salvar: ${mensagemDeErro(err)}`);
    }
  };

  const saveAccount = async () => {
    if (!currentUser?.id) return;
    const avatar = initialsFromName(accountProfile.name);
    const nextProfile = { ...accountProfile, avatar };
    setAccountProfile(nextProfile);
    try {
      await whatsappApi.updateUser(currentUser.id, {
        name: nextProfile.name,
        email: nextProfile.email,
        phone: nextProfile.phone,
        avatar: nextProfile.avatar,
        photoUrl: nextProfile.photoUrl,
      });
      await refreshTeamUsers();
      toast.success("Alterações salvas!");
    } catch (err) {
      toast.error(`Falha ao salvar: ${mensagemDeErro(err)}`);
    }
  };

  const updateAccountPhoto = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !currentUser?.id) return;
    readImageFile(file, async photoUrl => {
      setAccountProfile(prev => ({ ...prev, photoUrl }));
      try {
        await whatsappApi.updateUser(currentUser.id, { photoUrl });
        await refreshTeamUsers();
        toast.success("Foto atualizada");
      } catch (err) {
        toast.error(`Falha: ${mensagemDeErro(err)}`);
      }
    });
    event.target.value = "";
  };

  const updateEditingUserPhoto = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    readImageFile(file, photoUrl => setEditingUser(prev => ({ ...prev, photoUrl })));
    event.target.value = "";
  };

  const toggleUserActive = async (user: TeamUser) => {
    try {
      await whatsappApi.updateUser(user.id, { active: !user.active });
      await refreshTeamUsers();
    } catch (err) {
      toast.error(`Falha: ${mensagemDeErro(err)}`);
    }
  };

  const removeUser = async (id: string) => {
    if (id === "admin") {
      toast.error("A conta admin inicial não pode ser excluída");
      return;
    }
    if (!window.confirm("Remover este usuário?")) return;
    try {
      await whatsappApi.deleteUser(id);
      await refreshTeamUsers();
      toast.success("Usuário excluído");
    } catch (err) {
      toast.error(`Falha: ${mensagemDeErro(err)}`);
    }
  };

  const handleChangePassword = async (event: FormEvent) => {
    event.preventDefault();
    if (!currentPassword || !newPassword) {
      toast.error("Preencha senha atual e nova senha");
      return;
    }
    if (newPassword.length < 6) {
      toast.error("A nova senha deve ter pelo menos 6 caracteres");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("A confirmação não bate com a nova senha");
      return;
    }
    setChangingPassword(true);
    try {
      await changePassword(currentPassword, newPassword);
      toast.success("Senha alterada");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      toast.error(mensagemDeErro(err) || "Falha ao alterar senha");
    } finally {
      setChangingPassword(false);
    }
  };

  const handleSaveOpenaiKey = async () => {
    const apiKey = openaiInput.trim();
    if (!apiKey) {
      toast.error("Informe a API key");
      return;
    }
    setOpenaiSaving(true);
    try {
      await whatsappApi.saveOpenaiKey(apiKey);
      setOpenaiConfigured(true);
      setOpenaiInput("");
      toast.success("Chave da OpenAI salva");
    } catch (err) {
      toast.error(mensagemDeErro(err) || "Falha ao salvar");
    } finally {
      setOpenaiSaving(false);
    }
  };

  const handleRemoveOpenaiKey = async () => {
    if (!window.confirm("Remover a chave da OpenAI? O 'Testar agente' deixará de funcionar até salvar uma nova.")) return;
    setOpenaiSaving(true);
    try {
      await whatsappApi.deleteOpenaiKey();
      setOpenaiConfigured(false);
      toast.success("Chave removida");
    } catch (err) {
      toast.error(mensagemDeErro(err) || "Falha ao remover");
    } finally {
      setOpenaiSaving(false);
    }
  };

  const salvarTranscricao = async (patch: Parameters<typeof whatsappApi.saveTranscriptionSettings>[0]) => {
    setTranscriptionSaving(true);
    try {
      const atualizado = await whatsappApi.saveTranscriptionSettings(patch);
      setTranscription(atualizado);
      setTranscriptionKey("");
      toast.success("Configuração de transcrição salva");
    } catch (err) {
      toast.error(mensagemDeErro(err) || "Falha ao salvar");
    } finally {
      setTranscriptionSaving(false);
    }
  };

  const removerChaveTranscricao = async (provider: TranscriptionProvider) => {
    if (!window.confirm("Remover esta chave? A gravação de consultas para de funcionar até salvar uma nova.")) return;
    setTranscriptionSaving(true);
    try {
      setTranscription(await whatsappApi.deleteTranscriptionKey(provider));
      toast.success("Chave removida");
    } catch (err) {
      toast.error(mensagemDeErro(err) || "Falha ao remover");
    } finally {
      setTranscriptionSaving(false);
    }
  };

  const openNewQuickReply = () => {
    setQrEditing({ id: null, titulo: "", corpo: "" });
    setQrDialogOpen(true);
  };

  const openEditQuickReply = (qr: QuickReply) => {
    setQrEditing({ id: qr.id, titulo: qr.titulo, corpo: qr.corpo });
    setQrDialogOpen(true);
  };

  // Insere a variável onde o cursor está (não no fim do texto).
  const insertVariable = (chave: string) => {
    const ta = qrBodyRef.current;
    const token = `{{${chave}}}`;
    if (!ta) {
      setQrEditing(cur => ({ ...cur, corpo: cur.corpo + token }));
      return;
    }
    const { selectionStart, selectionEnd, value } = ta;
    const novo = value.slice(0, selectionStart) + token + value.slice(selectionEnd);
    setQrEditing(cur => ({ ...cur, corpo: novo }));
    requestAnimationFrame(() => {
      ta.focus();
      const pos = selectionStart + token.length;
      ta.setSelectionRange(pos, pos);
    });
  };

  const handleSaveQuickReply = async () => {
    const titulo = qrEditing.titulo.trim();
    const corpo = qrEditing.corpo.trim();
    if (!titulo || !corpo) {
      toast.error("Informe o título e a mensagem");
      return;
    }
    const desconhecidas = variaveisDesconhecidas(corpo);
    if (desconhecidas.length) {
      toast.error(`Variável inexistente: ${desconhecidas.map(v => `{{${v}}}`).join(", ")}`);
      return;
    }
    setQrSaving(true);
    try {
      if (qrEditing.id) {
        const updated = await whatsappApi.updateQuickReply(qrEditing.id, { titulo, corpo });
        setQuickReplies(cur => cur.map(q => (q.id === updated.id ? updated : q)));
        toast.success("Mensagem atualizada");
      } else {
        const created = await whatsappApi.createQuickReply({ titulo, corpo });
        setQuickReplies(cur => [...cur, created]);
        toast.success("Mensagem criada");
      }
      setQrDialogOpen(false);
    } catch (err) {
      toast.error(mensagemDeErro(err) || "Falha ao salvar");
    } finally {
      setQrSaving(false);
    }
  };

  const handleDeleteQuickReply = async (qr: QuickReply) => {
    if (!window.confirm(`Apagar a mensagem "${qr.titulo}"?`)) return;
    try {
      await whatsappApi.deleteQuickReply(qr.id);
      setQuickReplies(cur => cur.filter(q => q.id !== qr.id));
      toast.success("Mensagem removida");
    } catch (err) {
      toast.error(mensagemDeErro(err) || "Falha ao remover");
    }
  };

  const handleImportLeads = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ""; // permite reimportar o mesmo arquivo
    if (!file) return;
    setLeadImporting(true);
    try {
      const r = await whatsappApi.importLeadList(file);
      setLeadStats({ total: r.total, ultimaImportacao: r.ultimaImportacao });
      const ignorados = r.ignorados ? ` · ${r.ignorados} linha(s) ignorada(s)` : "";
      toast.success(`${r.lidos} registro(s) lidos — ${r.inseridos} novo(s), ${r.atualizados} atualizado(s)${ignorados}`);
    } catch (err) {
      toast.error(mensagemDeErro(err) || "Falha ao importar");
    } finally {
      setLeadImporting(false);
    }
  };

  const handleClearLeads = async () => {
    if (!window.confirm(`Apagar a lista importada (${leadStats.total} registro(s))? As observações somem das conversas.`)) return;
    try {
      await whatsappApi.clearLeadList();
      setLeadStats({ total: 0, ultimaImportacao: "" });
      toast.success("Lista removida");
    } catch (err) {
      toast.error(mensagemDeErro(err) || "Falha ao remover");
    }
  };

  if (!hasPermission("Alterar configurações da empresa")) {
    return (
      <AppLayout title="Configurações" subtitle="Acesso restrito">
        <div className="card-elevated p-6 text-sm text-muted-foreground">
          Seu usuário não tem permissão para alterar configurações da empresa.
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Configurações" subtitle="Gerencie sua conta, equipe e integrações">
      <Tabs defaultValue="account">
        <TabsList className="bg-card border border-border/60 p-1 h-auto flex-wrap">
          <TabsTrigger value="account">Minha conta</TabsTrigger>
          <TabsTrigger value="security">Segurança</TabsTrigger>
          <TabsTrigger value="users">Usuários</TabsTrigger>
          <TabsTrigger value="automation">Distribuição & Agente</TabsTrigger>
          <TabsTrigger value="openai">OpenAI</TabsTrigger>
          <TabsTrigger value="transcricao">Transcrição</TabsTrigger>
          <TabsTrigger value="leads">Lista de leads</TabsTrigger>
          <TabsTrigger value="mensagens">Mensagens rápidas</TabsTrigger>
          <TabsTrigger value="campos">Campos do lead</TabsTrigger>
        </TabsList>

        <TabsContent value="account" className="card-elevated p-6 mt-4 max-w-2xl">
          <div className="flex items-center gap-4 mb-6">
            <Avatar className="w-20 h-20">
              <AvatarImage src={accountProfile.photoUrl} alt={accountProfile.name} />
              <AvatarFallback className="bg-gradient-primary text-primary-foreground text-xl font-bold">{accountProfile.avatar}</AvatarFallback>
            </Avatar>
            <input ref={accountPhotoInputRef} type="file" accept="image/*" className="hidden" onChange={updateAccountPhoto} />
            <Button variant="outline" onClick={() => accountPhotoInputRef.current?.click()}>Alterar foto</Button>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div><Label>Nome</Label><Input value={accountProfile.name} onChange={event => setAccountProfile({ ...accountProfile, name: event.target.value, avatar: accountProfile.avatar || initialsFromName(event.target.value) })} /></div>
            <div><Label>E-mail</Label><Input value={accountProfile.email} onChange={event => setAccountProfile({ ...accountProfile, email: event.target.value })} /></div>
            <div><Label>Telefone</Label><Input value={accountProfile.phone} onChange={event => setAccountProfile({ ...accountProfile, phone: event.target.value })} /></div>
            <div><Label>Cargo</Label><Input value={roleLabel(accountProfile.role)} disabled /></div>
          </div>
          <Button onClick={saveAccount} className="mt-6 bg-gradient-primary">Salvar alterações</Button>
        </TabsContent>

        <TabsContent value="security" className="card-elevated p-6 mt-4 max-w-xl">
          <form onSubmit={handleChangePassword} className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <KeyRound className="h-4 w-4 text-primary" />
              Para sua segurança, informe a senha atual antes de definir uma nova.
            </div>
            <div>
              <Label htmlFor="current-password">Senha atual</Label>
              <Input
                id="current-password"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={event => setCurrentPassword(event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="new-password">Nova senha</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={event => setNewPassword(event.target.value)}
              />
              <p className="mt-1 text-xs text-muted-foreground">Mínimo de 6 caracteres.</p>
            </div>
            <div>
              <Label htmlFor="confirm-password">Confirmar nova senha</Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={event => setConfirmPassword(event.target.value)}
              />
            </div>
            <Button type="submit" className="bg-gradient-primary gap-2" disabled={changingPassword}>
              {changingPassword && <Loader2 className="h-4 w-4 animate-spin" />} Atualizar senha
            </Button>
          </form>
        </TabsContent>

        <TabsContent value="users" className="card-elevated mt-4 p-4 sm:p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-display font-bold">Usuários da equipe</h3>
            <Button className="gap-2 bg-gradient-primary" onClick={openNewUser}><Plus className="h-4 w-4" /> Novo usuário</Button>
          </div>
          <ResponsiveTable
            rows={users}
            rowKey={u => u.id}
            emptyMessage="Nenhum usuário cadastrado."
            className="-mx-2"
            columns={[
              {
                key: "usuario",
                header: "Usuário",
                primary: true,
                cell: u => (
                  <div className="flex items-center gap-2">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={u.photoUrl} alt={u.name} />
                      <AvatarFallback className="bg-primary-soft text-xs font-semibold text-primary">{u.avatar}</AvatarFallback>
                    </Avatar>
                    {u.name}
                  </div>
                ),
              },
              { key: "email", header: "E-mail", cell: u => <span className="break-all text-muted-foreground">{u.email}</span> },
              { key: "cargo", header: "Cargo", cell: u => roleLabel(u.role) },
              {
                key: "status",
                header: "Status",
                cell: u => (
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${u.active ? "bg-success-soft text-success" : "bg-muted text-muted-foreground"}`}>
                    {u.active ? "Ativo" : "Inativo"}
                  </span>
                ),
              },
              {
                key: "acoes",
                header: "Ações",
                className: "text-right",
                cell: u => (
                  <div className="flex items-center justify-end gap-1">
                    <Button size="icon" variant="ghost" onClick={() => openEditUser(u)} aria-label={`Editar ${u.name}`}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Switch checked={u.active} onCheckedChange={() => toggleUserActive(u)} aria-label={`Ativar ${u.name}`} />
                    <Button size="icon" variant="ghost" className="text-destructive" onClick={() => removeUser(u.id)} aria-label={`Remover ${u.name}`}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                ),
              },
            ]}
          />
        </TabsContent>

        <TabsContent value="automation" className="card-elevated p-6 mt-4 max-w-3xl space-y-8">
          <section className="space-y-4">
            <div>
              <h3 className="font-display font-bold">Distribuição automática de novos leads</h3>
              <p className="text-sm text-muted-foreground">Atribui automaticamente um atendente quando uma nova conversa do WhatsApp chega.</p>
            </div>

            <div className="flex items-center justify-between rounded-xl bg-secondary p-3">
              <div>
                <div className="text-sm font-semibold">Ativar distribuição automática</div>
                <div className="text-xs text-muted-foreground">Quando ligada, leads novos sem responsável recebem um atendente automaticamente.</div>
              </div>
              <Switch
                checked={leadDistribution.enabled}
                onCheckedChange={enabled => setLeadDistribution(prev => ({ ...prev, enabled }))}
              />
            </div>

            <div>
              <Label className="mb-2 block">Estratégia</Label>
              <RadioGroup
                value={leadDistribution.strategy}
                onValueChange={value => setLeadDistribution(prev => ({ ...prev, strategy: value as LeadDistributionStrategy }))}
                className="grid gap-2 sm:grid-cols-2"
              >
                <label htmlFor="strategy-rr" className="flex items-start gap-3 rounded-lg border border-border/60 p-3 cursor-pointer hover:bg-secondary/60">
                  <RadioGroupItem value="round-robin" id="strategy-rr" className="mt-0.5" />
                  <div>
                    <div className="text-sm font-semibold">Rodízio (round-robin)</div>
                    <div className="text-xs text-muted-foreground">Distribui em sequência cíclica entre os elegíveis.</div>
                  </div>
                </label>
                <label htmlFor="strategy-lb" className="flex items-start gap-3 rounded-lg border border-border/60 p-3 cursor-pointer hover:bg-secondary/60">
                  <RadioGroupItem value="load-balanced" id="strategy-lb" className="mt-0.5" />
                  <div>
                    <div className="text-sm font-semibold">Menor carga</div>
                    <div className="text-xs text-muted-foreground">Atribui ao usuário com menos conversas abertas no momento.</div>
                  </div>
                </label>
              </RadioGroup>
            </div>

            <div>
              <Label className="mb-2 block">Atendentes elegíveis</Label>
              <p className="text-xs text-muted-foreground mb-2">Deixe vazio para usar todos os usuários ativos com &quot;Recebe novos leads&quot; ligado.</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {users
                  .filter(user => user.active && isSecretariaRole(user.role) && user.receivesNewLeads)
                  .map(user => {
                    const checked = leadDistribution.eligibleUserIds.includes(user.id);
                    return (
                      <label key={user.id} htmlFor={`elig-${user.id}`} className="flex items-center gap-3 rounded-lg border border-border/60 p-3 cursor-pointer hover:bg-secondary/60">
                        <Checkbox
                          id={`elig-${user.id}`}
                          checked={checked}
                          onCheckedChange={value => setLeadDistribution(prev => ({
                            ...prev,
                            eligibleUserIds: value
                              ? Array.from(new Set([...prev.eligibleUserIds, user.id]))
                              : prev.eligibleUserIds.filter(id => id !== user.id),
                          }))}
                        />
                        <div>
                          <div className="text-sm font-semibold">{user.name}</div>
                          <div className="text-xs text-muted-foreground">{roleLabel(user.role)}</div>
                        </div>
                      </label>
                    );
                  })}
                {users.filter(user => user.active && isSecretariaRole(user.role) && user.receivesNewLeads).length === 0 && (
                  <div className="text-xs text-muted-foreground rounded-lg border border-dashed border-border/60 p-3 sm:col-span-2">
                    Nenhum usuário com &quot;Recebe novos leads&quot; ativo. Ajuste em Usuários para habilitar candidatos.
                  </div>
                )}
              </div>
            </div>

            <Button onClick={() => toast.success("Distribuição automática salva")} className="bg-gradient-primary">Salvar</Button>
          </section>

          <Separator />

          <section className="space-y-4">
            <div>
              <h3 className="font-display font-bold">Agente automático por horário</h3>
              <p className="text-sm text-muted-foreground">Ativa um agente de IA em novos leads dentro da janela configurada por dia da semana.</p>
            </div>

            <div className="flex items-center justify-between rounded-xl bg-secondary p-3">
              <div>
                <div className="text-sm font-semibold">Ativar agente programado</div>
                <div className="text-xs text-muted-foreground">Quando ligada, todo novo lead que chegar dentro da janela recebe o agente automaticamente.</div>
              </div>
              <Switch
                checked={agentSchedule.enabled}
                onCheckedChange={enabled => setAgentSchedule(prev => ({ ...prev, enabled }))}
              />
            </div>

            <div>
              <Label className="mb-2 block">Agente</Label>
              <Select
                value={agentSchedule.agentId || ""}
                onValueChange={agentId => setAgentSchedule(prev => ({ ...prev, agentId }))}
              >
                <SelectTrigger><SelectValue placeholder="Selecione um agente" /></SelectTrigger>
                <SelectContent>
                  {agents.map(agent => <SelectItem key={agent.id} value={agent.id}>{agent.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="mb-2 block">Janela de atuação por dia</Label>
              <div className="space-y-2">
                {([0, 1, 2, 3, 4, 5, 6] as DayOfWeek[]).map(day => {
                  const cfg = agentSchedule.weekly[day];
                  return (
                    <div key={day} className="grid grid-cols-[1fr_auto_1fr] items-center gap-x-3 gap-y-2 rounded-lg border border-border/60 p-3 sm:grid-cols-[1fr_auto_auto_auto]">
                      <div className="col-span-3 flex items-center gap-3 sm:col-span-1">
                        <Switch
                          checked={cfg.enabled}
                          onCheckedChange={enabled => setAgentSchedule(prev => ({
                            ...prev,
                            weekly: { ...prev.weekly, [day]: { ...prev.weekly[day], enabled } },
                          }))}
                        />
                        <div className="text-sm font-semibold">{WEEKDAY_LABELS[day]}</div>
                      </div>
                      <Input
                        type="time"
                        value={cfg.startTime}
                        disabled={!cfg.enabled}
                        onChange={event => setAgentSchedule(prev => ({
                          ...prev,
                          weekly: { ...prev.weekly, [day]: { ...prev.weekly[day], startTime: event.target.value } },
                        }))}
                        className="w-full sm:w-32"
                      />
                      <span className="text-center text-xs text-muted-foreground">até</span>
                      <Input
                        type="time"
                        value={cfg.endTime}
                        disabled={!cfg.enabled}
                        onChange={event => setAgentSchedule(prev => ({
                          ...prev,
                          weekly: { ...prev.weekly, [day]: { ...prev.weekly[day], endTime: event.target.value } },
                        }))}
                        className="w-full sm:w-32"
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            <Button
              onClick={() => {
                if (agentSchedule.enabled && !agentSchedule.agentId) {
                  toast.error("Selecione um agente antes de salvar");
                  return;
                }
                toast.success("Agente programado salvo");
              }}
              className="bg-gradient-primary"
            >
              Salvar
            </Button>
          </section>
        </TabsContent>

        <TabsContent value="openai" className="card-elevated p-6 mt-4 max-w-2xl space-y-4">
          <div>
            <h3 className="font-display font-bold">OpenAI</h3>
            <p className="text-sm text-muted-foreground">A chave é armazenada no servidor e usada pelo botão &quot;Testar agente&quot; em Agentes.</p>
          </div>
          <div className="rounded-xl border border-border/60 bg-secondary/40 p-3 text-sm">
            Status: {openaiLoading
              ? <span className="text-muted-foreground">verificando…</span>
              : openaiConfigured
                ? <span className="font-semibold text-success">Chave configurada</span>
                : <span className="font-semibold text-warning">Sem chave configurada</span>}
          </div>
          <div>
            <Label htmlFor="openai-key">OpenAI API Key</Label>
            <Input
              id="openai-key"
              type="password"
              placeholder="sk-..."
              value={openaiInput}
              onChange={event => setOpenaiInput(event.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={handleSaveOpenaiKey} className="bg-gradient-primary gap-2" disabled={openaiSaving || !openaiInput.trim()}>
              {openaiSaving && <Loader2 className="h-4 w-4 animate-spin" />} Salvar API key
            </Button>
            {openaiConfigured && (
              <Button variant="outline" onClick={handleRemoveOpenaiKey} disabled={openaiSaving} className="text-destructive hover:text-destructive">
                Remover chave
              </Button>
            )}
          </div>
        </TabsContent>

        <TabsContent value="transcricao" className="card-elevated p-6 mt-4 max-w-2xl space-y-4">
          <div>
            <h3 className="font-display font-bold flex items-center gap-2">
              <Stethoscope className="h-4 w-4 text-primary" /> Transcrição de consultas
            </h3>
            <p className="text-sm text-muted-foreground">
              Define quem transcreve o áudio das consultas gravadas em Consultas e separa quem está falando.
              A chave fica no servidor e nunca volta para o navegador.
            </p>
          </div>

          {!transcription ? (
            <div className="rounded-xl border border-border/60 bg-secondary/40 p-3 text-sm text-muted-foreground">
              Carregando…
            </div>
          ) : (
            <>
              <div className="space-y-3">
                <Label>Motor de transcrição</Label>
                <RadioGroup
                  value={transcription.provider}
                  onValueChange={value => salvarTranscricao({ provider: value as TranscriptionProvider })}
                  className="gap-3"
                >
                  <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border/60 p-3">
                    <RadioGroupItem value="groq" id="motor-groq" className="mt-1" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">Groq — Whisper large-v3 turbo</div>
                      <p className="text-xs text-muted-foreground">
                        Grátis até 8h de áudio por dia, depois US$ 0,04/hora. Quem separa os falantes é o
                        GPT lendo a transcrição, então a divisão entre as pessoas é aproximada.
                      </p>
                      <div className="mt-1 text-xs">
                        {transcription.groqConfigured
                          ? <span className="font-semibold text-success">Chave configurada</span>
                          : <span className="font-semibold text-warning">Sem chave</span>}
                      </div>
                    </div>
                  </label>
                  <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border/60 p-3">
                    <RadioGroupItem value="assemblyai" id="motor-assemblyai" className="mt-1" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">AssemblyAI — diarização nativa</div>
                      <p className="text-xs text-muted-foreground">
                        US$ 0,17/hora (~R$ 0,46 por consulta de 30 min). Separa as pessoas pela voz, não
                        pelo texto — mais confiável, e reconhece um acompanhante na sala.
                      </p>
                      <div className="mt-1 text-xs">
                        {transcription.assemblyaiConfigured
                          ? <span className="font-semibold text-success">Chave configurada</span>
                          : <span className="font-semibold text-warning">Sem chave</span>}
                      </div>
                    </div>
                  </label>
                </RadioGroup>
              </div>

              <Separator />

              <div>
                <Label htmlFor="transcription-key">
                  Chave da API {transcription.provider === "groq" ? "do Groq" : "da AssemblyAI"}
                </Label>
                <Input
                  id="transcription-key"
                  type="password"
                  placeholder={transcription.provider === "groq" ? "gsk_..." : "chave da AssemblyAI"}
                  value={transcriptionKey}
                  onChange={event => setTranscriptionKey(event.target.value)}
                  autoComplete="off"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  {transcription.provider === "groq"
                    ? "Crie em console.groq.com/keys — o plano gratuito já serve."
                    : "Crie em assemblyai.com/app — exige cartão cadastrado."}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  className="bg-gradient-primary gap-2"
                  disabled={transcriptionSaving || !transcriptionKey.trim()}
                  onClick={() => salvarTranscricao(
                    transcription.provider === "groq"
                      ? { groqApiKey: transcriptionKey.trim() }
                      : { assemblyaiApiKey: transcriptionKey.trim() },
                  )}
                >
                  {transcriptionSaving && <Loader2 className="h-4 w-4 animate-spin" />} Salvar chave
                </Button>
                {(transcription.provider === "groq" ? transcription.groqConfigured : transcription.assemblyaiConfigured) && (
                  <Button
                    variant="outline"
                    disabled={transcriptionSaving}
                    className="text-destructive hover:text-destructive"
                    onClick={() => removerChaveTranscricao(transcription.provider)}
                  >
                    Remover chave
                  </Button>
                )}
              </div>

              <Separator />

              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <Label htmlFor="auto-summary">Resumo clínico automático</Label>
                  <p className="text-xs text-muted-foreground">
                    Gera queixa, histórico, avaliação e conduta logo depois de transcrever. Usa a chave da
                    OpenAI da outra aba e custa cerca de R$ 0,03 por consulta.
                  </p>
                </div>
                <Switch
                  id="auto-summary"
                  checked={transcription.autoSummary}
                  disabled={transcriptionSaving}
                  onCheckedChange={checked => salvarTranscricao({ autoSummary: checked })}
                />
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="leads" className="card-elevated p-6 mt-4 max-w-2xl space-y-4">
          <div>
            <h3 className="font-display font-bold">Lista de leads (TXT)</h3>
            <p className="text-sm text-muted-foreground">
              Importe o arquivo com os contatos que já chamaram ou vão chamar. Quando um número da lista abrir
              uma conversa, os dados aparecem como observação no card do lead — sem alterar nenhuma informação existente.
            </p>
          </div>

          <div className="rounded-xl border border-border/60 bg-secondary/40 p-3 text-sm">
            {leadStats.total > 0 ? (
              <>
                <span className="font-semibold text-success">{leadStats.total.toLocaleString("pt-BR")} registro(s) na lista</span>
                {leadStats.ultimaImportacao && (
                  <span className="text-muted-foreground">
                    {" "}· última importação em {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(leadStats.ultimaImportacao))}
                  </span>
                )}
              </>
            ) : (
              <span className="text-muted-foreground">Nenhuma lista importada ainda.</span>
            )}
          </div>

          <div className="rounded-xl border border-dashed border-border p-4">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
              <FileText className="h-3.5 w-3.5" /> Formato esperado
            </div>
            <pre className="overflow-x-auto rounded-lg bg-secondary/60 p-3 text-xs leading-relaxed">
{`NM_PSSA|NU_DOCUMENTO|NU_FONE_TERMINAL
VALDINETE SANTOS|34615783809|27997230505
ANDRESSA PEREIRA SCHNEIDER|5845229758|27999060983`}
            </pre>
            <p className="mt-2 text-xs text-muted-foreground">
              Campos separados por <code>|</code>, com cabeçalho. O telefone pode vir com ou sem o DDI 55 — o
              casamento com a conversa ignora o nono dígito, então números antigos também são encontrados.
            </p>
          </div>

          <input
            ref={leadFileRef}
            type="file"
            accept=".txt,.csv,text/plain"
            className="hidden"
            onChange={handleImportLeads}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => leadFileRef.current?.click()}
              disabled={leadImporting}
              className="bg-gradient-primary gap-2"
            >
              {leadImporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {leadStats.total > 0 ? "Importar outro arquivo" : "Importar TXT"}
            </Button>
            {leadStats.total > 0 && (
              <Button variant="outline" onClick={handleClearLeads} disabled={leadImporting} className="text-destructive hover:text-destructive">
                Apagar lista
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Importar de novo <strong>soma</strong> à lista: números novos são adicionados e os já existentes são atualizados. Nada é apagado.
          </p>
        </TabsContent>

        <TabsContent value="mensagens" className="card-elevated p-6 mt-4 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-display font-bold">Mensagens rápidas</h3>
              <p className="text-sm text-muted-foreground">
                Ficam disponíveis no chat, no botão <MessageSquareText className="inline h-3.5 w-3.5" /> ao lado do campo de digitação.
                As variáveis são trocadas pelos dados do lead na hora de inserir.
              </p>
            </div>
            <Button onClick={openNewQuickReply} className="bg-gradient-primary gap-2">
              <Plus className="h-4 w-4" /> Nova mensagem
            </Button>
          </div>

          {quickReplies.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              Nenhuma mensagem criada ainda.
            </div>
          ) : (
            <div className="space-y-2">
              {quickReplies.map(qr => (
                <div key={qr.id} className="flex items-start gap-3 rounded-xl border border-border/60 bg-secondary/30 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">{qr.titulo}</div>
                    <div className="mt-0.5 whitespace-pre-wrap break-words text-xs text-muted-foreground">{qr.corpo}</div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button variant="ghost" size="icon" onClick={() => openEditQuickReply(qr)} title="Editar">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => handleDeleteQuickReply(qr)} title="Apagar" className="text-destructive hover:text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="campos" className="card-elevated p-6 mt-4">
          <CustomFieldsManager />
        </TabsContent>
      </Tabs>

      <Dialog open={qrDialogOpen} onOpenChange={setQrDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-display">
              {qrEditing.id ? "Editar mensagem rápida" : "Nova mensagem rápida"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="qr-titulo">Título (só você vê, serve para achar no chat)</Label>
              <Input
                id="qr-titulo"
                value={qrEditing.titulo}
                onChange={e => setQrEditing(cur => ({ ...cur, titulo: e.target.value }))}
                placeholder="Ex.: Primeira abordagem"
                autoFocus
              />
            </div>

            <div>
              <Label htmlFor="qr-corpo">Mensagem</Label>
              <textarea
                id="qr-corpo"
                ref={qrBodyRef}
                value={qrEditing.corpo}
                onChange={e => setQrEditing(cur => ({ ...cur, corpo: e.target.value }))}
                rows={5}
                placeholder="Ex.: {{saudacao}}, {{primeiro_nome}}! Aqui é {{atendente}}."
                className="mt-1 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            <div>
              <div className="mb-1.5 text-xs font-semibold uppercase text-muted-foreground">
                Variáveis — clique para inserir no cursor
              </div>
              {(["WhatsApp", "Lista importada", "Outros"] as const).map(grupo => (
                <div key={grupo} className="mb-2">
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">{grupo}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {TEMPLATE_VARIABLES.filter(v => v.grupo === grupo).map(v => (
                      <button
                        key={v.chave}
                        type="button"
                        onClick={() => insertVariable(v.chave)}
                        title={v.descricao}
                        className="rounded-full border border-border bg-secondary/60 px-2.5 py-1 font-mono text-[11px] transition hover:border-primary hover:bg-primary-soft"
                      >
                        {`{{${v.chave}}}`}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <p className="text-xs text-muted-foreground">
                Variável sem valor (ex.: o lead não está na lista importada) vira texto vazio — nunca é enviada crua ao cliente.
              </p>
            </div>

            <div>
              <div className="mb-1.5 text-xs font-semibold uppercase text-muted-foreground">Prévia (com dados de exemplo)</div>
              <div className="whitespace-pre-wrap rounded-xl bg-primary px-4 py-2 text-sm text-primary-foreground">
                {renderTemplate(qrEditing.corpo, {
                  nome: "Maria Silva Santos",
                  nomeWhatsapp: "Maria 🌻",
                  telefone: "+55 27 99723-0505",
                  listaNome: "MARIA SILVA SANTOS",
                  listaCpf: "34615783809",
                  listaTelefone: "27997230505",
                  atendente: accountProfile.name,
                }) || <span className="opacity-60">A mensagem aparece aqui…</span>}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setQrDialogOpen(false)} disabled={qrSaving}>Cancelar</Button>
            <Button onClick={handleSaveQuickReply} disabled={qrSaving} className="bg-gradient-primary gap-2">
              {qrSaving && <Loader2 className="h-4 w-4 animate-spin" />} Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={userDialogOpen} onOpenChange={setUserDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display">{editingUser.id === "new" ? "Novo usuário" : "Editar usuário"}</DialogTitle>
          </DialogHeader>
          <div className="flex items-center gap-3">
            <Avatar className="h-14 w-14">
              <AvatarImage src={editingUser.photoUrl} alt={editingUser.name} />
              <AvatarFallback className="bg-primary-soft text-primary font-semibold">{editingUser.avatar || initialsFromName(editingUser.name || "")}</AvatarFallback>
            </Avatar>
            <input ref={userPhotoInputRef} type="file" accept="image/*" className="hidden" onChange={updateEditingUserPhoto} />
            <Button type="button" variant="outline" onClick={() => userPhotoInputRef.current?.click()}>Alterar foto</Button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="userName">Nome *</Label>
              <Input id="userName" value={editingUser.name || ""} onChange={event => setEditingUser({ ...editingUser, name: event.target.value })} />
            </div>
            <div>
              <Label htmlFor="userEmail">E-mail *</Label>
              <Input id="userEmail" type="email" value={editingUser.email || ""} onChange={event => setEditingUser({ ...editingUser, email: event.target.value })} />
            </div>
            <div>
              <Label htmlFor="userLogin">Login</Label>
              <Input id="userLogin" value={editingUser.username || ""} onChange={event => setEditingUser({ ...editingUser, username: event.target.value })} placeholder="ana.paula" />
            </div>
            <div>
              <Label htmlFor="userPassword">Senha {editingUser.id === "new" ? "*" : "(deixe em branco para manter)"}</Label>
              <Input id="userPassword" type="password" value={editingUser.password || ""} onChange={event => setEditingUser({ ...editingUser, password: event.target.value })} />
            </div>
            <div>
              <Label htmlFor="userPhone">Telefone</Label>
              <Input id="userPhone" value={editingUser.phone || ""} onChange={event => setEditingUser({ ...editingUser, phone: event.target.value })} />
            </div>
            <div>
              <Label>Cargo</Label>
              <Select value={editingUser.role} onValueChange={role => setEditingUser({ ...editingUser, role: role as Role })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map(opt => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="userAvatar">Iniciais</Label>
              <Input id="userAvatar" maxLength={2} value={editingUser.avatar || ""} onChange={event => setEditingUser({ ...editingUser, avatar: event.target.value.toUpperCase() })} placeholder="AP" />
            </div>
            <div className="sm:col-span-2 flex items-center justify-between rounded-xl bg-secondary p-3">
              <div>
                <div className="text-sm font-semibold">Usuário ativo</div>
                <div className="text-xs text-muted-foreground">Permite acesso à plataforma</div>
              </div>
              <Switch checked={editingUser.active ?? true} onCheckedChange={active => setEditingUser({ ...editingUser, active })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUserDialogOpen(false)}>Cancelar</Button>
            <Button className="bg-gradient-primary" onClick={saveUser}>Salvar usuário</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
