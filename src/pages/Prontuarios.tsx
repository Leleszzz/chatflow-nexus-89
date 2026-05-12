import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  FileText,
  Folder,
  Image as ImageIcon,
  Search,
  Trash2,
  Upload,
  UploadCloud,
  Video as VideoIcon,
  Music as AudioIcon,
  MessageCircle,
  Kanban as KanbanIcon,
  CalendarDays,
  Pencil,
  ExternalLink,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ImageViewer } from "@/components/chat/ImageViewer";
import { AudioMessage } from "@/components/chat/AudioMessage";
import { useCRM } from "@/store/crm-store";
import { Deal } from "@/lib/mock-data";
import { ProntuarioAttachment, ProntuarioCategory } from "@/lib/whatsapp-api";
import { cn } from "@/lib/utils";

const initials = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join("") || "?";

const categoryLabel: Record<ProntuarioCategory, string> = {
  foto: "Foto",
  video: "Vídeo",
  audio: "Áudio",
  documento: "Documento",
  outro: "Outro",
};

const categoryIcon = (cat: ProntuarioCategory) => {
  if (cat === "foto") return ImageIcon;
  if (cat === "video") return VideoIcon;
  if (cat === "audio") return AudioIcon;
  return FileText;
};

const formatDate = (iso: string) => {
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
};

export default function Prontuarios() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    deals,
    canViewDeal,
    prontuarios,
    refreshProntuarios,
    getProntuariosByDeal,
    linkMessageToProntuario,
    uploadProntuarioFile,
    renameProntuario,
    removeProntuario,
    appointments,
  } = useCRM();

  const [search, setSearch] = useState("");
  const [selectedDealId, setSelectedDealId] = useState<string | null>(searchParams.get("dealId"));
  const [viewer, setViewer] = useState<{ src: string; kind: "image" | "video" } | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [pendingName, setPendingName] = useState("");
  const [renameTarget, setRenameTarget] = useState<ProntuarioAttachment | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    refreshProntuarios();
  }, [refreshProntuarios]);

  useEffect(() => {
    const dealId = searchParams.get("dealId");
    if (dealId && dealId !== selectedDealId) setSelectedDealId(dealId);
  }, [searchParams, selectedDealId]);

  const visibleDeals = useMemo(() => deals.filter(canViewDeal), [deals, canViewDeal]);

  const filteredDeals = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return visibleDeals;
    return visibleDeals.filter(deal => {
      const haystack = [deal.customer, deal.phone, ...(deal.tags || [])].join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }, [visibleDeals, search]);

  const selectedDeal: Deal | null = useMemo(
    () => visibleDeals.find(d => d.id === selectedDealId) || null,
    [visibleDeals, selectedDealId],
  );

  const dealAttachments = useMemo(
    () => (selectedDeal ? getProntuariosByDeal(selectedDeal.id) : []),
    [selectedDeal, getProntuariosByDeal],
  );

  const countsByDeal = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of prontuarios) {
      map.set(p.dealId, (map.get(p.dealId) || 0) + 1);
    }
    return map;
  }, [prontuarios]);

  const handleSelectDeal = (dealId: string) => {
    setSelectedDealId(dealId);
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set("dealId", dealId);
      return next;
    });
  };

  const startUploadFlow = (files: File[]) => {
    if (!selectedDeal) {
      toast.error("Selecione um cliente antes de enviar arquivos");
      return;
    }
    if (!files.length) return;
    setPendingFiles(files);
    setPendingName(files[0].name.replace(/\.[^.]+$/, ""));
  };

  const onPickFiles: React.ChangeEventHandler<HTMLInputElement> = e => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = "";
    startUploadFlow(files);
  };

  const onDrop: React.DragEventHandler<HTMLDivElement> = e => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files || []);
    startUploadFlow(files);
  };

  const confirmUpload = async () => {
    if (!selectedDeal || !pendingFiles.length) return;
    const file = pendingFiles[0];
    const rest = pendingFiles.slice(1);
    const name = pendingName.trim() || file.name;
    try {
      await uploadProntuarioFile({ dealId: selectedDeal.id, name, file });
      toast.success("Arquivo enviado ao prontuário");
      if (rest.length) {
        setPendingFiles(rest);
        setPendingName(rest[0].name.replace(/\.[^.]+$/, ""));
      } else {
        setPendingFiles([]);
        setPendingName("");
      }
    } catch (err) {
      toast.error(`Falha ao enviar: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const cancelUpload = () => {
    setPendingFiles([]);
    setPendingName("");
  };

  const confirmRename = async () => {
    if (!renameTarget) return;
    const name = renameValue.trim();
    if (!name) {
      toast.error("Informe um nome");
      return;
    }
    try {
      await renameProntuario(renameTarget.id, name);
      toast.success("Nome atualizado");
      setRenameTarget(null);
    } catch (err) {
      toast.error(`Falha ao renomear: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleDelete = async (attachment: ProntuarioAttachment) => {
    if (!window.confirm(`Excluir "${attachment.name}"?`)) return;
    try {
      await removeProntuario(attachment.id);
      toast.success("Arquivo removido");
    } catch (err) {
      toast.error(`Falha ao excluir: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const openConversation = () => {
    if (!selectedDeal) return;
    navigate(`/conversas?deal=${encodeURIComponent(selectedDeal.id)}`);
  };

  const openKanban = () => {
    if (!selectedDeal) return;
    navigate(`/kanban?deal=${encodeURIComponent(selectedDeal.id)}`);
  };

  const openCalendar = () => {
    if (!selectedDeal) return;
    navigate(`/calendario?deal=${encodeURIComponent(selectedDeal.id)}`);
  };

  const nextAppointment = useMemo(() => {
    if (!selectedDeal) return null;
    const now = Date.now();
    const upcoming = appointments
      .filter(a => a.dealId === selectedDeal.id)
      .map(a => ({ a, ts: new Date(`${a.date}T${a.startTime}`).getTime() }))
      .filter(({ ts }) => ts >= now)
      .sort((x, y) => x.ts - y.ts);
    return upcoming[0]?.a || null;
  }, [appointments, selectedDeal]);

  return (
    <AppLayout title="Prontuários" subtitle="Documentos, fotos e arquivos de cada cliente">
      <div className="grid h-[calc(100vh-180px)] grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
        {/* Coluna esquerda: lista de clientes */}
        <aside className="flex min-h-0 flex-col rounded-2xl border border-border bg-card">
          <div className="border-b border-border p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar cliente, telefone ou tag…"
                className="pl-9"
              />
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              {filteredDeals.length} cliente{filteredDeals.length === 1 ? "" : "s"} · {prontuarios.length} arquivo{prontuarios.length === 1 ? "" : "s"}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {filteredDeals.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                Nenhum cliente encontrado.
              </div>
            ) : (
              filteredDeals
                .slice()
                .sort((a, b) => (countsByDeal.get(b.id) || 0) - (countsByDeal.get(a.id) || 0))
                .map(deal => {
                  const count = countsByDeal.get(deal.id) || 0;
                  const isSelected = selectedDealId === deal.id;
                  return (
                    <button
                      key={deal.id}
                      type="button"
                      onClick={() => handleSelectDeal(deal.id)}
                      className={cn(
                        "mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition",
                        isSelected ? "bg-primary-soft text-primary" : "hover:bg-secondary/60",
                      )}
                    >
                      <Avatar className="h-9 w-9">
                        <AvatarImage src={deal.avatar} alt={deal.customer} />
                        <AvatarFallback>{initials(deal.customer)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{deal.customer}</div>
                        <div className="truncate text-xs text-muted-foreground">{deal.phone}</div>
                      </div>
                      {count > 0 && (
                        <Badge variant="secondary" className="shrink-0 rounded-full">
                          {count}
                        </Badge>
                      )}
                    </button>
                  );
                })
            )}
          </div>
        </aside>

        {/* Coluna direita: detalhe */}
        <section className="flex min-h-0 flex-col rounded-2xl border border-border bg-card">
          {!selectedDeal ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-10 text-center text-muted-foreground">
              <Folder className="h-10 w-10" />
              <div className="text-sm">Selecione um cliente à esquerda para ver os arquivos do prontuário.</div>
            </div>
          ) : (
            <>
              <header className="flex flex-wrap items-center gap-3 border-b border-border p-4">
                <Avatar className="h-12 w-12">
                  <AvatarImage src={selectedDeal.avatar} alt={selectedDeal.customer} />
                  <AvatarFallback>{initials(selectedDeal.customer)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-base font-semibold">{selectedDeal.customer}</div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>{selectedDeal.phone}</span>
                    <span>•</span>
                    <span>{dealAttachments.length} arquivo{dealAttachments.length === 1 ? "" : "s"}</span>
                    {nextAppointment && (
                      <>
                        <span>•</span>
                        <span>Próximo agendamento: {nextAppointment.date} {nextAppointment.startTime}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" className="gap-2" onClick={openConversation}>
                    <MessageCircle className="h-4 w-4" /> Conversa
                  </Button>
                  <Button variant="outline" size="sm" className="gap-2" onClick={openKanban}>
                    <KanbanIcon className="h-4 w-4" /> Kanban
                  </Button>
                  <Button variant="outline" size="sm" className="gap-2" onClick={openCalendar}>
                    <CalendarDays className="h-4 w-4" /> Agenda
                  </Button>
                </div>
              </header>

              <div className="flex-1 space-y-4 overflow-y-auto p-4">
                <div
                  onDragOver={e => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={onDrop}
                  className={cn(
                    "flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition",
                    dragOver ? "border-primary bg-primary-soft" : "border-border bg-secondary/30",
                  )}
                >
                  <UploadCloud className="h-8 w-8 text-muted-foreground" />
                  <div className="text-sm font-medium">Arraste arquivos aqui</div>
                  <div className="text-xs text-muted-foreground">ou</div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="h-4 w-4" /> Selecionar arquivo
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={onPickFiles}
                  />
                </div>

                {dealAttachments.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
                    Nenhum arquivo ainda. Envie o primeiro arrastando aqui ou clicando em "Selecionar arquivo".
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {dealAttachments.map(att => {
                      const Icon = categoryIcon(att.category);
                      return (
                        <div key={att.id} className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card transition hover:shadow-md">
                          <div className="aspect-video w-full bg-secondary/40">
                            {att.category === "foto" ? (
                              <button
                                type="button"
                                onClick={() => setViewer({ src: att.mediaUrl, kind: "image" })}
                                className="flex h-full w-full items-center justify-center overflow-hidden"
                                title="Expandir"
                              >
                                <img src={att.mediaUrl} alt={att.name} className="h-full w-full object-cover" />
                              </button>
                            ) : att.category === "video" ? (
                              <button
                                type="button"
                                onClick={() => setViewer({ src: att.mediaUrl, kind: "video" })}
                                className="relative flex h-full w-full items-center justify-center"
                                title="Reproduzir"
                              >
                                <video src={att.mediaUrl} className="h-full w-full object-cover" preload="metadata" muted playsInline />
                                <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/60 text-white">
                                    <svg viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6"><path d="M8 5v14l11-7z" /></svg>
                                  </span>
                                </span>
                              </button>
                            ) : att.category === "audio" ? (
                              <div className="flex h-full w-full items-center justify-center p-3">
                                <AudioMessage src={att.mediaUrl} mine={false} />
                              </div>
                            ) : (
                              <a
                                href={att.mediaUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground hover:text-foreground"
                              >
                                <Icon className="h-10 w-10" />
                                <span className="text-xs">Abrir</span>
                              </a>
                            )}
                          </div>
                          <div className="flex flex-1 flex-col gap-2 p-3">
                            <div className="flex items-start gap-2">
                              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-medium" title={att.name}>{att.name}</div>
                                <div className="text-[11px] text-muted-foreground">
                                  {categoryLabel[att.category]} · {att.source === "whatsapp" ? "WhatsApp" : "Upload"} · {formatDate(att.uploadedAt)}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 gap-1 px-2 text-xs"
                                onClick={() => {
                                  setRenameTarget(att);
                                  setRenameValue(att.name);
                                }}
                              >
                                <Pencil className="h-3 w-3" /> Renomear
                              </Button>
                              <Button asChild variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs">
                                <a href={att.mediaUrl} target="_blank" rel="noreferrer">
                                  <ExternalLink className="h-3 w-3" /> Abrir
                                </a>
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="ml-auto h-7 gap-1 px-2 text-xs text-destructive hover:text-destructive"
                                onClick={() => handleDelete(att)}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </div>

      {viewer && (
        <ImageViewer
          src={viewer.src}
          kind={viewer.kind}
          open={Boolean(viewer)}
          onClose={() => setViewer(null)}
        />
      )}

      {/* Modal de upload: pede só o nome */}
      <Dialog open={pendingFiles.length > 0} onOpenChange={open => { if (!open) cancelUpload(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nomear arquivo</DialogTitle>
            <DialogDescription>
              {pendingFiles.length > 1
                ? `Enviando ${pendingFiles.length} arquivos — ${pendingFiles[0]?.name}`
                : pendingFiles[0]?.name}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="prontuario-name">Nome para o prontuário</Label>
            <Input
              id="prontuario-name"
              value={pendingName}
              autoFocus
              onChange={e => setPendingName(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  confirmUpload();
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={cancelUpload} className="gap-2">
              <X className="h-4 w-4" /> Cancelar
            </Button>
            <Button onClick={confirmUpload} className="gap-2">
              <Upload className="h-4 w-4" /> Enviar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal de renomear */}
      <Dialog open={Boolean(renameTarget)} onOpenChange={open => { if (!open) setRenameTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Renomear arquivo</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="prontuario-rename">Novo nome</Label>
            <Input
              id="prontuario-rename"
              value={renameValue}
              autoFocus
              onChange={e => setRenameValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  confirmRename();
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)}>Cancelar</Button>
            <Button onClick={confirmRename}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
