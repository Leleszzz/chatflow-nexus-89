import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Ban, Download, MessageSquareText, Pause, Play, RefreshCw, Send, Trash2, Users } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCRM } from "@/store/crm-store";
import { useInstances } from "@/hooks/useInstances";
import { getSocket } from "@/lib/whatsapp-socket";
import { Campaign, CampaignPreview, whatsappApi } from "@/lib/whatsapp-api";
import { renderTemplate, TEMPLATE_VARIABLES, variaveisDesconhecidas } from "@/lib/message-template";
import { CellValue, downloadXlsx } from "@/lib/xlsx";
import { cn } from "@/lib/utils";

// Só as variáveis que uma campanha consegue preencher: não há lista importada
// nem conversa aberta no momento do disparo.
const CAMPAIGN_VARIABLES = TEMPLATE_VARIABLES.filter(v =>
  ["nome", "primeiro_nome", "nome_whatsapp", "telefone", "saudacao", "atendente"].includes(v.chave));

const STATUS_LABEL: Record<Campaign["status"], string> = {
  rascunho: "Rascunho",
  rodando: "Enviando",
  pausada: "Pausada",
  finalizada: "Finalizada",
  cancelada: "Cancelada",
};

const STATUS_CLASS: Record<Campaign["status"], string> = {
  rascunho: "bg-muted text-muted-foreground",
  rodando: "bg-success-soft text-success",
  pausada: "bg-warning-soft text-warning",
  finalizada: "bg-muted text-muted-foreground",
  cancelada: "bg-destructive-soft text-destructive",
};

const formatDateTime = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));

/** Estimativa de duração: nº de pendentes × intervalo entre envios. */
const estimateDuration = (pending: number, throttleMs: number) => {
  const totalMin = Math.round((pending * throttleMs) / 60000);
  if (totalMin < 1) return "menos de 1 min";
  if (totalMin < 60) return `~${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m ? `~${h}h${String(m).padStart(2, "0")}` : `~${h}h`;
};

export default function Campanhas() {
  const { currentUser, isAdmin } = useCRM();
  const { instances } = useInstances();

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState("");
  const [message, setMessage] = useState(
    "{{saudacao}}, {{primeiro_nome}}! Tudo bem? Passando para saber se ainda posso te ajudar por aqui.",
  );
  const [instanceIds, setInstanceIds] = useState<string[]>([]);
  const [inactiveDays, setInactiveDays] = useState("7");
  const [onlyClientLast, setOnlyClientLast] = useState(false);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [throttleSec, setThrottleSec] = useState("40");
  const [minThrottleMs, setMinThrottleMs] = useState(15000);

  const [preview, setPreview] = useState<CampaignPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setCampaigns(await whatsappApi.listCampaigns());
    } catch (err) {
      toast.error(`Não foi possível carregar as campanhas: ${err instanceof Error ? err.message : "erro"}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    whatsappApi.campaignLimits()
      .then(l => { setMinThrottleMs(l.minThrottleMs); setThrottleSec(String(Math.round(l.defaultThrottleMs / 1000))); })
      .catch(() => { /* mantém o default local */ });
  }, []);

  // O worker envia em segundo plano; sem isto a tela ficaria congelada durante
  // uma campanha que leva horas.
  useEffect(() => {
    const socket = getSocket();
    const onUpdate = () => refresh();
    socket.on("campaign:update", onUpdate);
    return () => { socket.off("campaign:update", onUpdate); };
  }, [refresh]);

  const unknownVars = useMemo(() => variaveisDesconhecidas(message), [message]);
  const throttleMs = Math.max(Number(throttleSec) * 1000 || 0, minThrottleMs);

  const previewContext = {
    nome: preview?.sample[0]?.customer || "Maria Souza",
    nomeWhatsapp: preview?.sample[0]?.whatsappName || "Maria",
    telefone: preview?.sample[0]?.phone || "+55 11 99999-0000",
    atendente: currentUser?.name || "",
  };

  const audienceFilters = () => ({
    instanceIds,
    inactiveDays: Number(inactiveDays) || 0,
    onlyClientLast,
    onlyUnread,
  });

  const runPreview = async () => {
    setPreviewing(true);
    try {
      setPreview(await whatsappApi.previewCampaignAudience(audienceFilters()));
    } catch (err) {
      toast.error(`Falha ao simular o público: ${err instanceof Error ? err.message : "erro"}`);
    } finally {
      setPreviewing(false);
    }
  };

  const create = async (andStart: boolean) => {
    if (!name.trim()) return toast.error("Dê um nome à campanha");
    if (!message.trim()) return toast.error("Escreva a mensagem");
    if (unknownVars.length) return toast.error(`Variável desconhecida: {{${unknownVars[0]}}}`);
    if (!preview || preview.total === 0) return toast.error("Simule o público antes — está vazio ou não foi calculado");

    setBusy(true);
    try {
      const campaign = await whatsappApi.createCampaign({
        name: name.trim(),
        message: message.trim(),
        throttleMs,
        ...audienceFilters(),
      });
      if (andStart) await whatsappApi.startCampaign(campaign.id);
      await refresh();
      setName("");
      setPreview(null);
      toast.success(andStart
        ? `Campanha "${campaign.name}" iniciada para ${campaign.total} contatos`
        : `Campanha "${campaign.name}" criada como rascunho`);
    } catch (err) {
      toast.error(`Não foi possível criar: ${err instanceof Error ? err.message : "erro"}`);
    } finally {
      setBusy(false);
    }
  };

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      await refresh();
      toast.success(ok);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "erro");
    } finally {
      setBusy(false);
    }
  };

  const removeCampaign = (campaign: Campaign) => {
    if (!window.confirm(`Excluir a campanha "${campaign.name}"? O histórico de envios vai junto.`)) return;
    act(() => whatsappApi.deleteCampaign(campaign.id), "Campanha excluída");
  };

  // Relatório com os destinatários reais — sem nenhum dado inventado.
  const downloadReport = async (campaign: Campaign) => {
    try {
      const targets = await whatsappApi.listCampaignTargets(campaign.id);
      if (!targets.length) return toast.error("Esta campanha não tem contatos");
      // Datas e números vão CRUS: a célula do .xlsx é tipada e quem formata é
      // o Excel, conforme o locale de quem abre.
      const header = ["Cliente", "Telefone", "Status", "Enviado em", "Respondeu em", "Erro"];
      const rows: CellValue[][] = targets.map(t => [
        t.customer,
        t.phone,
        t.status,
        t.sentAt ? new Date(t.sentAt) : "",
        t.repliedAt ? new Date(t.repliedAt) : "",
        t.error || "",
      ]);
      const resumo: CellValue[][] = [
        [],
        ["Campanha", campaign.name],
        ["Criada em", new Date(campaign.createdAt)],
        ["Público", campaign.total],
        ["Enviadas", campaign.sent],
        ["Falhas", campaign.failed],
        ["Respostas", campaign.replied],
        ["Taxa de resposta (%)", campaign.sent ? (campaign.replied / campaign.sent) * 100 : 0],
      ];
      const slug = campaign.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      await downloadXlsx(`campanha-${slug}.xlsx`, header, [...rows, ...resumo]);
      toast.success(`${targets.length} contatos exportados`);
    } catch (err) {
      toast.error(`Falha ao exportar: ${err instanceof Error ? err.message : "erro"}`);
    }
  };

  if (!isAdmin) {
    return (
      <AppLayout title="Campanhas" subtitle="Acesso restrito">
        <div className="card-elevated p-6 text-sm text-muted-foreground">
          Apenas administradores podem criar e disparar campanhas de remarketing.
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Campanhas" subtitle="Remarketing para clientes que já falaram com você">
      <section className="card-elevated mb-6 p-6">
        <div className="mb-5">
          <h2 className="font-display text-lg font-bold">Nova campanha de remarketing</h2>
          <p className="text-sm text-muted-foreground">
            O público sai das conversas que já existem no CRM. Não é possível enviar para quem nunca falou com você.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_1fr]">
          <div className="space-y-4">
            <div>
              <Label htmlFor="cmp-name">Nome da campanha</Label>
              <Input id="cmp-name" value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Retomada de orçamentos" />
            </div>

            <div className="rounded-xl border border-border/70 p-4">
              <div className="mb-3 text-sm font-semibold">Quem vai receber</div>
              <div className="space-y-3">
                <div>
                  <Label className="text-xs">Sem contato há</Label>
                  <Select value={inactiveDays} onValueChange={v => { setInactiveDays(v); setPreview(null); }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">Qualquer período</SelectItem>
                      <SelectItem value="3">3 dias ou mais</SelectItem>
                      <SelectItem value="7">7 dias ou mais</SelectItem>
                      <SelectItem value="15">15 dias ou mais</SelectItem>
                      <SelectItem value="30">30 dias ou mais</SelectItem>
                      <SelectItem value="60">60 dias ou mais</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {instances.length > 1 && (
                  <div>
                    <Label className="text-xs">Instâncias</Label>
                    <div className="mt-1 max-h-32 space-y-0.5 overflow-y-auto rounded-lg border border-border p-1">
                      {instances.map(inst => (
                        <label key={inst.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-secondary">
                          <Checkbox
                            checked={instanceIds.includes(inst.id)}
                            onCheckedChange={() => {
                              setInstanceIds(cur => cur.includes(inst.id) ? cur.filter(i => i !== inst.id) : [...cur, inst.id]);
                              setPreview(null);
                            }}
                          />
                          <span className="truncate">{inst.name}</span>
                        </label>
                      ))}
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">Nenhuma marcada = todas.</p>
                  </div>
                )}

                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox checked={onlyClientLast} onCheckedChange={() => { setOnlyClientLast(v => !v); setPreview(null); }} />
                  Só quem falou por último (ficou sem resposta)
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox checked={onlyUnread} onCheckedChange={() => { setOnlyUnread(v => !v); setPreview(null); }} />
                  Só conversas não lidas
                </label>
              </div>

              <Button variant="outline" className="mt-3 w-full gap-2" onClick={runPreview} disabled={previewing}>
                {previewing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
                Simular público
              </Button>

              {preview && (
                <div className="mt-3 rounded-lg bg-secondary p-3 text-sm">
                  <div className="font-semibold">
                    {preview.total} {preview.total === 1 ? "contato" : "contatos"}
                  </div>
                  {preview.total > 0 && (
                    <>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Duração estimada: {estimateDuration(preview.total, throttleMs)}
                      </div>
                      <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                        {preview.sample.slice(0, 5).map(c => (
                          <div key={c.id} className="truncate">· {c.customer} — {c.phone}</div>
                        ))}
                        {preview.total > 5 && <div>· e mais {preview.total - 5}...</div>}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            <div>
              <Label htmlFor="cmp-throttle">Intervalo entre envios (segundos)</Label>
              <Input
                id="cmp-throttle"
                type="number"
                min={Math.round(minThrottleMs / 1000)}
                value={throttleSec}
                onChange={e => setThrottleSec(e.target.value)}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Mínimo {Math.round(minThrottleMs / 1000)}s. Enviar rápido demais aumenta muito o risco de o número ser bloqueado pelo WhatsApp.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <Label htmlFor="cmp-msg">Mensagem</Label>
              <Textarea id="cmp-msg" value={message} onChange={e => setMessage(e.target.value)} rows={7} className="mt-1" />
            </div>

            <div className="flex flex-wrap gap-1.5">
              {CAMPAIGN_VARIABLES.map(v => (
                <button
                  key={v.chave}
                  type="button"
                  title={v.descricao}
                  onClick={() => setMessage(cur => `${cur}${cur && !cur.endsWith(" ") ? " " : ""}{{${v.chave}}}`)}
                  className="rounded-md bg-secondary px-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
                >
                  {`{{${v.chave}}}`}
                </button>
              ))}
            </div>

            {unknownVars.length > 0 && (
              <div className="flex items-start gap-2 rounded-lg bg-destructive-soft p-3 text-xs text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>Variável desconhecida: {unknownVars.map(v => `{{${v}}}`).join(", ")}. Ela sairia vazia para o cliente.</span>
              </div>
            )}

            <div className="rounded-xl bg-secondary p-4">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                <MessageSquareText className="h-4 w-4" /> Prévia
              </div>
              <div className="whitespace-pre-wrap text-sm">{renderTemplate(message, previewContext)}</div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="outline" className="flex-1" onClick={() => create(false)} disabled={busy}>
                Salvar rascunho
              </Button>
              <Button className="flex-1 gap-2 bg-gradient-primary" onClick={() => create(true)} disabled={busy}>
                <Send className="h-4 w-4" /> Criar e iniciar
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className="card-elevated p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-base font-bold">Campanhas</h2>
          <Button variant="ghost" size="sm" className="gap-2" onClick={refresh}>
            <RefreshCw className="h-3.5 w-3.5" /> Atualizar
          </Button>
        </div>

        {loading && <p className="py-6 text-center text-sm text-muted-foreground">Carregando...</p>}
        {!loading && campaigns.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma campanha ainda.</p>
        )}

        <div className="space-y-3">
          {campaigns.map(campaign => {
            const done = campaign.sent + campaign.failed;
            const progress = campaign.total ? Math.round((done / campaign.total) * 100) : 0;
            const rate = campaign.sent ? Math.round((campaign.replied / campaign.sent) * 100) : 0;
            const pending = campaign.total - done;
            return (
              <div key={campaign.id} className="rounded-xl border border-border/60 bg-background p-4">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{campaign.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {done}/{campaign.total} processados · {campaign.replied} respostas ({rate}%)
                      {campaign.failed > 0 && <span className="text-destructive"> · {campaign.failed} falhas</span>}
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      Criada em {formatDateTime(campaign.createdAt)}
                      {campaign.status === "rodando" && pending > 0 && ` · restam ${estimateDuration(pending, campaign.throttleMs)}`}
                    </div>
                  </div>
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold", STATUS_CLASS[campaign.status])}>
                    {STATUS_LABEL[campaign.status]}
                  </span>
                </div>

                <div className="h-2 overflow-hidden rounded-full bg-secondary">
                  <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {campaign.status === "rascunho" && (
                    <Button size="sm" className="gap-2 bg-gradient-primary" disabled={busy}
                      onClick={() => act(() => whatsappApi.startCampaign(campaign.id), "Campanha iniciada")}>
                      <Play className="h-3.5 w-3.5" /> Iniciar
                    </Button>
                  )}
                  {campaign.status === "rodando" && (
                    <Button variant="outline" size="sm" className="gap-2" disabled={busy}
                      onClick={() => act(() => whatsappApi.pauseCampaign(campaign.id), "Campanha pausada")}>
                      <Pause className="h-3.5 w-3.5" /> Pausar
                    </Button>
                  )}
                  {campaign.status === "pausada" && (
                    <Button size="sm" className="gap-2 bg-gradient-primary" disabled={busy}
                      onClick={() => act(() => whatsappApi.startCampaign(campaign.id), "Campanha retomada")}>
                      <Play className="h-3.5 w-3.5" /> Retomar
                    </Button>
                  )}
                  {(campaign.status === "rodando" || campaign.status === "pausada") && (
                    <Button variant="outline" size="sm" className="gap-2 text-muted-foreground hover:text-destructive" disabled={busy}
                      onClick={() => act(() => whatsappApi.cancelCampaign(campaign.id), "Campanha cancelada")}>
                      <Ban className="h-3.5 w-3.5" /> Cancelar
                    </Button>
                  )}
                  <Button variant="outline" size="sm" className="gap-2" onClick={() => downloadReport(campaign)}>
                    <Download className="h-3.5 w-3.5" /> Relatório
                  </Button>
                  {campaign.status !== "rodando" && (
                    <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground hover:text-destructive" disabled={busy}
                      onClick={() => removeCampaign(campaign)}>
                      <Trash2 className="h-3.5 w-3.5" /> Excluir
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </AppLayout>
  );
}
