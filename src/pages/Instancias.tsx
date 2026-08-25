import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useCRM } from "@/store/crm-store";
import { useInstances } from "@/hooks/useInstances";
import { InstanceStatus, HistorySyncMode } from "@/lib/whatsapp-api";
import { cn } from "@/lib/utils";
import { Cable, Check, DownloadCloud, KeyRound, MessageSquare, Pencil, Power, QrCode, RefreshCcw, Smartphone, Trash2, Wifi, WifiOff, Loader2, X } from "lucide-react";
import { isAtendente, roleLabel } from "@/lib/roles";
import { toast } from "sonner";
import { mensagemDeErro } from "@/lib/erros";

const statusConfig: Record<InstanceStatus, { label: string; className: string; icon: typeof Wifi }> = {
  ativa: { label: "Ativa", className: "bg-success-soft text-success", icon: Wifi },
  desconectada: { label: "Desconectada", className: "bg-warning-soft text-warning", icon: WifiOff },
  desligada: { label: "Desligada", className: "bg-muted text-muted-foreground", icon: Power },
  conectando: { label: "Conectando", className: "bg-info-soft text-info", icon: Loader2 },
  "qr-pendente": { label: "Aguardando QR", className: "bg-warning-soft text-warning", icon: QrCode },
  "codigo-pendente": { label: "Aguardando código", className: "bg-warning-soft text-warning", icon: KeyRound },
};

const formatDateTime = (value: string) =>
  value
    ? new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value))
    : "—";

export default function Instancias() {
  const { isAdmin, teamUsers } = useCRM();
  const { instances, loading, error, qrByInstance, pairingCodeByInstance, createInstance, restartInstance, resyncHistory, deleteInstance, fetchQr, requestPairingCode, renameInstance, setInstanceOwner } = useInstances();
  const [resyncingId, setResyncingId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newHistorySync, setNewHistorySync] = useState<HistorySyncMode>("recent");
  const [creating, setCreating] = useState(false);
  const [qrInstanceId, setQrInstanceId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [connectMode, setConnectMode] = useState<"qr" | "code">("qr");
  const [phoneDraft, setPhoneDraft] = useState("");
  const [requestingCode, setRequestingCode] = useState(false);

  const activeCount = instances.filter(instance => instance.status === "ativa").length;
  const totalConversations = instances.reduce((sum, instance) => sum + (instance.conversations || 0), 0);

  if (!isAdmin) {
    return (
      <AppLayout title="Instancias" subtitle="Acesso restrito">
        <div className="card-elevated p-6 text-sm text-muted-foreground">
          Apenas administradores podem gerenciar instancias de WhatsApp.
        </div>
      </AppLayout>
    );
  }

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) {
      toast.error("Informe um nome para a instância");
      return;
    }
    setCreating(true);
    try {
      const created = await createInstance(name, newHistorySync);
      toast.success("Instância criada — escaneie o QR Code");
      setCreateOpen(false);
      setNewName("");
      setNewHistorySync("recent");
      setQrInstanceId(created.id);
    } catch (err) {
      toast.error(`Falha ao criar instância: ${mensagemDeErro(err)}`);
    } finally {
      setCreating(false);
    }
  };

  const handleRestart = async (id: string) => {
    try {
      await restartInstance(id);
      toast.success("Reconectando e verificando mensagens...");
    } catch (err) {
      toast.error(`Falha: ${mensagemDeErro(err)}`);
    }
  };

  // Admin não aparece como responsável: ele não tem canal próprio, acessa todos.
  const responsaveis = teamUsers.filter(user => user.active && isAtendente(user.role));

  const handleOwnerChange = async (id: string, ownerId: string | null) => {
    try {
      await setInstanceOwner(id, ownerId);
      toast.success(ownerId ? "Responsável atualizado" : "Responsável removido");
    } catch (err) {
      toast.error(`Falha: ${mensagemDeErro(err)}`);
    }
  };

  const handleResync = async (id: string, name: string) => {
    if (!confirm(`Re-sincronizar histórico de "${name}"?\n\nIsto apaga conversas e credenciais locais. Você precisará ESCANEAR O QR novamente — é a única forma do WhatsApp reenviar o histórico completo.`)) return;
    setResyncingId(id);
    try {
      await resyncHistory(id);
      toast.success("Sessão limpa — escaneie o QR para iniciar o sync completo do histórico");
    } catch (err) {
      toast.error(`Falha: ${mensagemDeErro(err)}`);
    } finally {
      setResyncingId(null);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Remover a instância "${name}"? Isso apaga sessão, conversas e mensagens.`)) return;
    try {
      await deleteInstance(id);
      toast.success("Instância removida");
    } catch (err) {
      toast.error(`Falha: ${mensagemDeErro(err)}`);
    }
  };

  const openQr = async (id: string) => {
    setQrInstanceId(id);
    setConnectMode("qr");
    setPhoneDraft("");
    if (!qrByInstance[id]) await fetchQr(id);
  };

  const handleRequestCode = async (id: string) => {
    const phone = phoneDraft.replace(/\D/g, "");
    if (phone.length < 10) {
      toast.error("Informe o número com DDI + DDD (somente dígitos). Ex.: 5511999998888");
      return;
    }
    setRequestingCode(true);
    try {
      await requestPairingCode(id, phone);
      toast.success("Código gerado — digite-o no WhatsApp");
    } catch (err) {
      toast.error(`Falha ao gerar código: ${mensagemDeErro(err)}`);
    } finally {
      setRequestingCode(false);
    }
  };

  const startRename = (id: string, currentName: string) => {
    setEditingId(id);
    setNameDraft(currentName);
  };
  const saveRename = async () => {
    if (!editingId) return;
    const name = nameDraft.trim();
    if (!name) {
      toast.error("Informe um nome");
      return;
    }
    try {
      await renameInstance(editingId, name);
      toast.success("Nome da instância atualizado");
      setEditingId(null);
    } catch (err) {
      toast.error(`Falha: ${mensagemDeErro(err)}`);
    }
  };
  const cancelRename = () => { setEditingId(null); setNameDraft(""); };

  const qrInstance = qrInstanceId ? instances.find(i => i.id === qrInstanceId) : null;
  const qrDataUrl = qrInstanceId ? qrByInstance[qrInstanceId] : null;
  const pairingCode = qrInstanceId ? pairingCodeByInstance[qrInstanceId] : null;

  return (
    <AppLayout title="Instancias" subtitle="Conecte e acompanhe canais de WhatsApp">
      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="card-elevated p-5">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-primary">
            <Smartphone className="h-5 w-5" />
          </div>
          <div className="text-2xl font-bold">{instances.length}</div>
          <div className="text-xs text-muted-foreground">instancias cadastradas</div>
        </div>
        <div className="card-elevated p-5">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-success-soft text-success">
            <Wifi className="h-5 w-5" />
          </div>
          <div className="text-2xl font-bold">{activeCount}</div>
          <div className="text-xs text-muted-foreground">ativas agora</div>
        </div>
        <div className="card-elevated p-5">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-info-soft text-info">
            <MessageSquare className="h-5 w-5" />
          </div>
          <div className="text-2xl font-bold">{totalConversations}</div>
          <div className="text-xs text-muted-foreground">conversas vinculadas</div>
        </div>
      </div>

      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-bold">Canais conectados</h2>
          <p className="text-xs text-muted-foreground">Acompanhe status, sincronizacao e volume de conversas de cada instancia.</p>
        </div>
        <Button className="gap-2 bg-gradient-primary" onClick={() => setCreateOpen(true)}>
          <Cable className="h-4 w-4" /> Nova instancia
        </Button>
      </div>

      {error && (
        <div className="mb-4 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
          Falha ao carregar instâncias: {error}
        </div>
      )}

      {loading ? (
        <div className="card-elevated p-6 text-sm text-muted-foreground">Carregando...</div>
      ) : instances.length === 0 ? (
        <div className="card-elevated p-6 text-sm text-muted-foreground">
          Nenhuma instância criada. Clique em "Nova instancia" para conectar um WhatsApp.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          {instances.map(instance => {
            const config = statusConfig[instance.status] ?? statusConfig.desconectada;
            const StatusIcon = config.icon;
            const spinning = instance.status === "conectando";

            return (
              <div key={instance.id} className="card-elevated p-5">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary">
                      <MessageSquare className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      {editingId === instance.id ? (
                        <div className="flex items-center gap-1">
                          <Input
                            value={nameDraft}
                            onChange={e => setNameDraft(e.target.value)}
                            autoFocus
                            className="h-8 font-display text-sm font-bold"
                            onKeyDown={e => {
                              if (e.key === "Enter") saveRename();
                              if (e.key === "Escape") cancelRename();
                            }}
                          />
                          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={saveRename} title="Salvar">
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={cancelRename} title="Cancelar">
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <h3 className="truncate font-display text-base font-bold">{instance.name}</h3>
                          <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => startRename(instance.id, instance.name)} title="Renomear">
                            <Pencil className="h-3 w-3" />
                          </Button>
                        </div>
                      )}
                      <p className="text-xs text-muted-foreground">{instance.phone || "—"}</p>
                    </div>
                  </div>
                  <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold", config.className)}>
                    <StatusIcon className={cn("h-3 w-3", spinning && "animate-spin")} /> {config.label}
                  </span>
                </div>

                <div className="mb-4 grid grid-cols-2 gap-3 rounded-xl bg-secondary p-3">
                  <div>
                    <div className="text-[10px] font-semibold uppercase text-muted-foreground">Ultima sync</div>
                    <div className="mt-1 text-sm font-medium">{formatDateTime(instance.lastSync)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold uppercase text-muted-foreground">Conversas</div>
                    <div className="mt-1 text-sm font-medium">{instance.conversations || 0}</div>
                  </div>
                </div>

                {/* Quem é dono do canal. O dono enxerga e usa a instância sem
                    precisar de liberação; os demais só entram pela lista
                    "Instâncias permitidas" em Usuários. */}
                <div className="mb-4">
                  <div className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">Responsável</div>
                  <Select
                    value={instance.ownerId || "__sem__"}
                    onValueChange={value => handleOwnerChange(instance.id, value === "__sem__" ? null : value)}
                  >
                    <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Sem responsável" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__sem__">Sem responsável</SelectItem>
                      {responsaveis.map(user => (
                        <SelectItem key={user.id} value={user.id}>{user.name} — {roleLabel(user.role)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {!instance.ownerId && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Sem responsável, só administradores enxergam este canal.
                    </p>
                  )}
                </div>

                <div className="mt-5 flex gap-2">
                  {instance.status === "conectando" || instance.status === "ativa" ? (
                    <div className="flex flex-1 items-center justify-center gap-2 rounded-md bg-secondary px-3 py-2 text-xs font-medium text-muted-foreground">
                      {instance.status === "conectando" ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Conectando...
                        </>
                      ) : (
                        <>
                          <Wifi className="h-3.5 w-3.5 text-success" /> Conectado
                        </>
                      )}
                    </div>
                  ) : (
                    <Button variant="outline" className="flex-1 gap-2" onClick={() => openQr(instance.id)}>
                      <QrCode className="h-4 w-4" /> Conectar
                    </Button>
                  )}
                  <Button variant="outline" size="icon" title="Reconectar" onClick={() => handleRestart(instance.id)}>
                    <RefreshCcw className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    title="Re-sincronizar histórico (apaga sessão e exige reescanear o QR para baixar tudo)"
                    onClick={() => handleResync(instance.id, instance.name)}
                    disabled={resyncingId === instance.id}
                  >
                    {resyncingId === instance.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <DownloadCloud className="h-4 w-4" />}
                  </Button>
                  <Button variant="outline" size="icon" title="Remover" onClick={() => handleDelete(instance.id, instance.name)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova instância de WhatsApp</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <label className="text-xs font-semibold uppercase text-muted-foreground">Nome</label>
            <Input
              autoFocus
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Ex.: WhatsApp Principal"
              onKeyDown={e => e.key === "Enter" && handleCreate()}
            />
            <label className="text-xs font-semibold uppercase text-muted-foreground">Conversas antigas</label>
            <div className="space-y-2">
              {([
                { value: "recent", label: "Importar conversas recentes", hint: "Traz o histórico recente que o telefone envia ao parear (recomendado)." },
                { value: "full", label: "Importar histórico completo", hint: "Sincroniza todo o histórico — pode demorar bastante em contas grandes." },
                { value: "none", label: "Não importar", hint: "Só mensagens novas a partir da conexão." },
              ] as { value: HistorySyncMode; label: string; hint: string }[]).map(opt => (
                <label
                  key={opt.value}
                  className={cn(
                    "flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 transition",
                    newHistorySync === opt.value ? "border-primary bg-primary-soft/40" : "border-border hover:bg-secondary/50",
                  )}
                >
                  <input
                    type="radio"
                    name="historySync"
                    value={opt.value}
                    checked={newHistorySync === opt.value}
                    onChange={() => setNewHistorySync(opt.value)}
                    className="mt-0.5 accent-primary"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{opt.label}</span>
                    <span className="block text-xs text-muted-foreground">{opt.hint}</span>
                  </span>
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Após criar, um QR Code aparecerá. Abra WhatsApp &gt; Aparelhos conectados &gt; Conectar aparelho.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={creating} className="gap-2">
              {creating && <Loader2 className="h-4 w-4 animate-spin" />} Criar e gerar QR
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(qrInstanceId)} onOpenChange={open => !open && setQrInstanceId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Conectar — {qrInstance?.name}</DialogTitle>
          </DialogHeader>
          {qrInstance?.status === "ativa" ? (
            <div className="rounded-xl bg-success-soft p-6 text-center text-sm text-success">
              Instância já está conectada ({qrInstance.phone}).
            </div>
          ) : (
            <>
              <div className="flex gap-1 rounded-lg bg-secondary p-1">
                <button
                  type="button"
                  onClick={() => setConnectMode("qr")}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition",
                    connectMode === "qr" ? "bg-background shadow-sm" : "text-muted-foreground",
                  )}
                >
                  <QrCode className="h-3.5 w-3.5" /> QR Code
                </button>
                <button
                  type="button"
                  onClick={() => setConnectMode("code")}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition",
                    connectMode === "code" ? "bg-background shadow-sm" : "text-muted-foreground",
                  )}
                >
                  <KeyRound className="h-3.5 w-3.5" /> Código
                </button>
              </div>

              {connectMode === "qr" ? (
                <div className="flex flex-col items-center gap-3 py-2">
                  {qrDataUrl ? (
                    <>
                      <img src={qrDataUrl} alt="QR Code" className="h-72 w-72 rounded-xl border" />
                      <p className="text-center text-xs text-muted-foreground">
                        WhatsApp &gt; Aparelhos conectados &gt; Conectar aparelho.<br/>
                        O QR atualiza automaticamente.
                      </p>
                    </>
                  ) : (
                    <div className="flex h-72 w-72 items-center justify-center rounded-xl border bg-secondary text-sm text-muted-foreground">
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Gerando QR...
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-3 py-2">
                  {pairingCode ? (
                    <div className="flex flex-col items-center gap-2 rounded-xl border bg-secondary p-6">
                      <span className="text-[10px] font-semibold uppercase text-muted-foreground">Seu código</span>
                      <span className="font-mono text-3xl font-bold tracking-[0.3em]">{pairingCode}</span>
                      <p className="text-center text-xs text-muted-foreground">
                        WhatsApp &gt; Aparelhos conectados &gt; Conectar aparelho &gt; Conectar com número de telefone.
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Informe o número da conta de WhatsApp com DDI + DDD (somente dígitos) para gerar um código de pareamento.
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Input
                      value={phoneDraft}
                      onChange={e => setPhoneDraft(e.target.value)}
                      placeholder="Ex.: 5511999998888"
                      inputMode="numeric"
                      onKeyDown={e => e.key === "Enter" && qrInstanceId && handleRequestCode(qrInstanceId)}
                    />
                    <Button
                      onClick={() => qrInstanceId && handleRequestCode(qrInstanceId)}
                      disabled={requestingCode}
                      className="gap-2 shrink-0"
                    >
                      {requestingCode && <Loader2 className="h-4 w-4 animate-spin" />}
                      {pairingCode ? "Gerar outro" : "Gerar código"}
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
