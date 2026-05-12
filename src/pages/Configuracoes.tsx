import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { whatsappApi } from "@/lib/whatsapp-api";
import { Plus, Trash2, Pencil, KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";

const ROLES = ["Administrador", "Vendedora", "Financeiro", "Somente leitura"];

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
  role: "Vendedora",
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
  const sellerOptions = users.filter(user => user.active && user.role !== "Administrador");
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

  useEffect(() => {
    let cancelled = false;
    whatsappApi.getOpenaiStatus()
      .then(status => { if (!cancelled) setOpenaiConfigured(status.configured); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setOpenaiLoading(false); });
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
      toast.error(`Falha ao salvar: ${(err as Error).message}`);
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
      toast.error(`Falha ao salvar: ${(err as Error).message}`);
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
        toast.error(`Falha: ${(err as Error).message}`);
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
      toast.error(`Falha: ${(err as Error).message}`);
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
      toast.error(`Falha: ${(err as Error).message}`);
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
      toast.error((err as Error).message || "Falha ao alterar senha");
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
      toast.error((err as Error).message || "Falha ao salvar");
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
      toast.error((err as Error).message || "Falha ao remover");
    } finally {
      setOpenaiSaving(false);
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
          <div className="grid grid-cols-2 gap-4">
            <div><Label>Nome</Label><Input value={accountProfile.name} onChange={event => setAccountProfile({ ...accountProfile, name: event.target.value, avatar: accountProfile.avatar || initialsFromName(event.target.value) })} /></div>
            <div><Label>E-mail</Label><Input value={accountProfile.email} onChange={event => setAccountProfile({ ...accountProfile, email: event.target.value })} /></div>
            <div><Label>Telefone</Label><Input value={accountProfile.phone} onChange={event => setAccountProfile({ ...accountProfile, phone: event.target.value })} /></div>
            <div><Label>Cargo</Label><Input value={accountProfile.role} disabled /></div>
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

        <TabsContent value="users" className="card-elevated p-6 mt-4">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-display font-bold">Usuários da equipe</h3>
            <Button className="bg-gradient-primary gap-2" onClick={openNewUser}><Plus className="w-4 h-4" /> Novo usuário</Button>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase text-muted-foreground border-b">
              <th className="pb-3 font-semibold">Usuário</th><th className="pb-3 font-semibold">E-mail</th>
              <th className="pb-3 font-semibold">Cargo</th><th className="pb-3 font-semibold">Status</th><th></th>
            </tr></thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} className="border-b border-border/40">
                  <td className="py-3"><div className="flex items-center gap-2"><Avatar className="w-8 h-8"><AvatarImage src={u.photoUrl} alt={u.name} /><AvatarFallback className="bg-primary-soft text-primary text-xs font-semibold">{u.avatar}</AvatarFallback></Avatar>{u.name}</div></td>
                  <td className="py-3 text-muted-foreground">{u.email}</td>
                  <td className="py-3">{u.role}</td>
                  <td className="py-3"><span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${u.active ? "bg-success-soft text-success" : "bg-muted text-muted-foreground"}`}>{u.active ? "Ativo" : "Inativo"}</span></td>
                  <td className="py-3 text-right">
                    <Button size="icon" variant="ghost" onClick={() => openEditUser(u)}><Pencil className="w-3.5 h-3.5" /></Button>
                    <Switch checked={u.active} onCheckedChange={() => toggleUserActive(u)} className="ml-2" />
                    <Button size="icon" variant="ghost" className="text-destructive ml-1" onClick={() => removeUser(u.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
                  .filter(user => user.active && user.role !== "Administrador" && user.receivesNewLeads)
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
                          <div className="text-xs text-muted-foreground">{user.role}</div>
                        </div>
                      </label>
                    );
                  })}
                {users.filter(user => user.active && user.role !== "Administrador" && user.receivesNewLeads).length === 0 && (
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
                    <div key={day} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 rounded-lg border border-border/60 p-3">
                      <div className="flex items-center gap-3">
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
                        className="w-32"
                      />
                      <span className="text-xs text-muted-foreground">até</span>
                      <Input
                        type="time"
                        value={cfg.endTime}
                        disabled={!cfg.enabled}
                        onChange={event => setAgentSchedule(prev => ({
                          ...prev,
                          weekly: { ...prev.weekly, [day]: { ...prev.weekly[day], endTime: event.target.value } },
                        }))}
                        className="w-32"
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
      </Tabs>

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
              <Select value={editingUser.role} onValueChange={role => setEditingUser({ ...editingUser, role })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLES.map(role => <SelectItem key={role} value={role}>{role}</SelectItem>)}
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
