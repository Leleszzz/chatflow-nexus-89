import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useCRM } from "@/store/crm-store";
import { useInstances } from "@/hooks/useInstances";
import { InstanceStatus } from "@/lib/whatsapp-api";
import { cn } from "@/lib/utils";
import { Cable, Check, DownloadCloud, MessageSquare, Pencil, Power, QrCode, RefreshCcw, Smartphone, Trash2, Wifi, WifiOff, Loader2, X } from "lucide-react";
import { toast } from "sonner";

const statusConfig: Record<InstanceStatus, { label: string; className: string; icon: typeof Wifi }> = {
  ativa: { label: "Ativa", className: "bg-success-soft text-success", icon: Wifi },
  desconectada: { label: "Desconectada", className: "bg-warning-soft text-warning", icon: WifiOff },
  desligada: { label: "Desligada", className: "bg-muted text-muted-foreground", icon: Power },
  conectando: { label: "Conectando", className: "bg-info-soft text-info", icon: Loader2 },
  "qr-pendente": { label: "Aguardando QR", className: "bg-warning-soft text-warning", icon: QrCode },
};

const formatDateTime = (value: string) =>
  value
    ? new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value))
    : "—";

export default function Instancias() {
  const { isAdmin } = useCRM();
  const { instances, loading, error, qrByInstance, createInstance, restartInstance, resyncHistory, deleteInstance, fetchQr, renameInstance } = useInstances();
  const [resyncingId, setResyncingId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [qrInstanceId, setQrInstanceId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");

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
      const created = await createInstance(name);
      toast.success("Instância criada — escaneie o QR Code");
      setCreateOpen(false);
      setNewName("");
      setQrInstanceId(created.id);
    } catch (err) {
      toast.error(`Falha ao criar instância: ${(err as Error).message}`);
    } finally {
      setCreating(false);
    }
  };

  const handleRestart = async (id: string) => {
    try {
      await restartInstance(id);
      toast.success("Reconectando...");
    } catch (err) {
      toast.error(`Falha: ${(err as Error).message}`);
    }
  };

  const handleResync = async (id: string, name: string) => {
    if (!confirm(`Re-sincronizar histórico de "${name}"?\n\nIsto apaga conversas e credenciais locais. Você precisará ESCANEAR O QR novamente — é a única forma do WhatsApp reenviar o histórico completo.`)) return;
    setResyncingId(id);
    try {
      await resyncHistory(id);
      toast.success("Sessão limpa — escaneie o QR para iniciar o sync completo do histórico");
    } catch (err) {
      toast.error(`Falha: ${(err as Error).message}`);
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
      toast.error(`Falha: ${(err as Error).message}`);
    }
  };

  const openQr = async (id: string) => {
    setQrInstanceId(id);
    if (!qrByInstance[id]) await fetchQr(id);
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
      toast.error(`Falha: ${(err as Error).message}`);
    }
  };
  const cancelRename = () => { setEditingId(null); setNameDraft(""); };

  const qrInstance = qrInstanceId ? instances.find(i => i.id === qrInstanceId) : null;
  const qrDataUrl = qrInstanceId ? qrByInstance[qrInstanceId] : null;

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
                      <QrCode className="h-4 w-4" /> QR Code
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
            <DialogTitle>QR Code — {qrInstance?.name}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-3 py-2">
            {qrInstance?.status === "ativa" ? (
              <div className="rounded-xl bg-success-soft p-6 text-center text-sm text-success">
                Instância já está conectada ({qrInstance.phone}).
              </div>
            ) : qrDataUrl ? (
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
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
