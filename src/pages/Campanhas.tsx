import { useMemo, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCRM } from "@/store/crm-store";
import { cn } from "@/lib/utils";
import { downloadCsv } from "@/lib/csv";
import { BadgeCheck, Download, MessageSquareText, Pause, Play, RotateCcw, Search, Send, Square, X } from "lucide-react";
import { toast } from "sonner";

type CampaignStatus = "rascunho" | "aguardando-revisao" | "agendada" | "rodando" | "pausada" | "finalizada" | "erro";

type CampaignSummary = {
  id: string;
  name: string;
  audience: number;
  sent: number;
  responses: number;
  status: CampaignStatus;
  createdAt: string;
  message: string;
  reportRows: CampaignReportRow[];
};

type CampaignReportRow = {
  name: string;
  phone: string;
  origin: string;
  status: string;
};

const runningCampaigns: CampaignSummary[] = [
  { id: "c1", name: "Retorno leads quentes", audience: 64, sent: 42, responses: 13, status: "aguardando-revisao", createdAt: "2026-04-30T09:10:00", message: "Retorno para leads quentes", reportRows: [] },
  { id: "c2", name: "Orcamento sem resposta", audience: 38, sent: 38, responses: 7, status: "pausada", createdAt: "2026-04-29T15:20:00", message: "Follow-up de orcamento", reportRows: [] },
];

const previousCampaigns: CampaignSummary[] = [
  { id: "c3", name: "Reativacao Instagram", audience: 120, sent: 120, responses: 31, status: "finalizada", createdAt: "2026-04-26T11:00:00", message: "Reativacao de Instagram", reportRows: [] },
  { id: "c4", name: "Clientes frios 30 dias", audience: 86, sent: 86, responses: 14, status: "finalizada", createdAt: "2026-04-22T10:30:00", message: "Clientes frios 30 dias", reportRows: [] },
  { id: "c5", name: "Follow-up pos proposta", audience: 52, sent: 52, responses: 18, status: "finalizada", createdAt: "2026-04-18T16:40:00", message: "Follow-up pos proposta", reportRows: [] },
];

const syntaxOptions = [
  { label: "Nome do cliente", token: "{{nome_cliente}}" },
  { label: "Numero", token: "{{numero_cliente}}" },
];

const daysSince = (value: string) => {
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return 0;
  return Math.floor((Date.now() - time) / 86400000);
};

const responseRate = (campaign: CampaignSummary) =>
  campaign.sent ? Math.round((campaign.responses / campaign.sent) * 100) : 0;

const buildFallbackReportRows = (campaign: CampaignSummary): CampaignReportRow[] =>
  Array.from({ length: Math.min(campaign.audience, 12) }, (_, index) => ({
    name: `Contato ${index + 1}`,
    phone: `+55 11 9${String(index + 1).padStart(4, "0")}-${String(1000 + index).padStart(4, "0")}`,
    origin: campaign.name,
    status: index < campaign.responses ? "respondeu" : "enviado",
  }));

const renderPreview = (message: string, deal?: { customer: string; phone: string }) =>
  message
    .replaceAll("{{nome_cliente}}", deal?.customer || "Marina Souza")
    .replaceAll("{{numero_cliente}}", deal?.phone || "+55 11 99999-0000");

function CampaignList({
  title,
  items,
  mode,
  onTogglePause,
  onStop,
  onDownload,
  onRedo,
}: {
  title: string;
  items: CampaignSummary[];
  mode: "running" | "previous";
  onTogglePause?: (campaignId: string) => void;
  onStop?: (campaignId: string) => void;
  onDownload?: (campaign: CampaignSummary) => void;
  onRedo?: (campaign: CampaignSummary) => void;
}) {
  return (
    <section className="card-elevated p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-base font-bold">{title}</h2>
        <span className="rounded-full bg-secondary px-2 py-1 text-[10px] font-semibold text-muted-foreground">{items.length}</span>
      </div>
      <div className="space-y-3">
        {items.map(campaign => {
          const rate = responseRate(campaign);
          return (
            <div key={campaign.id} className="rounded-xl border border-border/60 bg-background p-4">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{campaign.name}</div>
                  <div className="text-xs text-muted-foreground">{campaign.sent}/{campaign.audience} envios</div>
                </div>
                <span className={cn(
                  "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                  campaign.status === "rascunho" && "bg-muted text-muted-foreground",
                  campaign.status === "aguardando-revisao" && "bg-warning-soft text-warning",
                  campaign.status === "agendada" && "bg-info-soft text-info",
                  campaign.status === "rodando" && "bg-success-soft text-success",
                  campaign.status === "pausada" && "bg-warning-soft text-warning",
                  campaign.status === "finalizada" && "bg-muted text-muted-foreground",
                  campaign.status === "erro" && "bg-destructive-soft text-destructive",
                )}>
                  {campaign.status.replaceAll("-", " ")}
                </span>
              </div>
              <div className="mb-2 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Taxa de resposta</span>
                <span className="font-semibold">{rate}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-secondary">
                <div className="h-full rounded-full bg-primary" style={{ width: `${rate}%` }} />
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {mode === "running" ? (
                  <>
                    <Button variant="outline" size="sm" className="gap-2" onClick={() => onTogglePause?.(campaign.id)}>
                      {campaign.status === "pausada" ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                      {campaign.status === "pausada" ? "Reativar" : "Pausar"}
                    </Button>
                    <Button variant="outline" size="sm" className="gap-2" onClick={() => onStop?.(campaign.id)}>
                      <Square className="h-4 w-4" /> Parar
                    </Button>
                  </>
                ) : (
                  <>
                    <Button variant="outline" size="sm" className="gap-2" onClick={() => onDownload?.(campaign)}>
                      <Download className="h-4 w-4" /> Ver relatório
                    </Button>
                    <Button variant="outline" size="sm" className="gap-2" onClick={() => onRedo?.(campaign)}>
                      <RotateCcw className="h-4 w-4" /> Refazer
                    </Button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function Campanhas() {
  const { deals, tags, teamUsers, canViewDeal } = useCRM();
  const [activeCampaigns, setActiveCampaigns] = useState<CampaignSummary[]>(runningCampaigns);
  const [closedCampaigns, setClosedCampaigns] = useState<CampaignSummary[]>(previousCampaigns);
  const [name, setName] = useState("Remarketing sem resposta");
  const [selectedSellerIds, setSelectedSellerIds] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [clientFilter, setClientFilter] = useState("all");
  const [temperature, setTemperature] = useState("all");
  const [lastContact, setLastContact] = useState("all");
  const [returnStatus, setReturnStatus] = useState("all");
  const [message, setMessage] = useState("Oi {{nome_cliente}}, tudo bem? Vi que nosso ultimo contato ficou em aberto e queria saber se ainda posso te ajudar pelo WhatsApp {{numero_cliente}}.");
  const [selectedDealIds, setSelectedDealIds] = useState<string[]>([]);
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [customerPickerSearch, setCustomerPickerSearch] = useState("");

  const sellerOptions = useMemo(() => teamUsers.filter(user => user.active && user.role !== "Administrador"), [teamUsers]);
  const manualSelectionActive = selectedDealIds.length > 0;
  const audience = useMemo(() => deals.filter(deal => {
    const days = daysSince(deal.lastInteraction);
    if (!canViewDeal(deal)) return false;
    if (manualSelectionActive) return selectedDealIds.includes(deal.id);
    return (selectedSellerIds.length === 0 || selectedSellerIds.includes(deal.sellerId))
      && (selectedTags.length === 0 || selectedTags.some(tag => deal.tags.includes(tag)))
      && (clientFilter === "all"
        || (clientFilter === "retornar-hoje" && deal.tags.includes("Retornar hoje"))
        || (clientFilter === "sem-resposta" && deal.stage === "aguardando-resposta")
        || (clientFilter === "proposta-pendente" && deal.tags.includes("Enviar proposta"))
        || (clientFilter === "nao-lidos" && deal.unread))
      && (temperature === "all" || deal.temperature === temperature)
      && (returnStatus === "all" || (returnStatus === "cliente-aguardando" ? deal.unread : !deal.unread))
      && (lastContact === "all"
        || (lastContact === "7d" && days >= 7)
        || (lastContact === "15d" && days >= 15)
        || (lastContact === "30d" && days >= 30));
  }), [canViewDeal, clientFilter, deals, lastContact, manualSelectionActive, returnStatus, selectedDealIds, selectedSellerIds, selectedTags, temperature]);
  const totalAudience = audience.length;
  const previewDeal = audience[0];
  const customerPickerDeals = useMemo(() => {
    const term = customerPickerSearch.toLowerCase().trim();
    return deals.filter(deal => canViewDeal(deal) && (!term || [deal.customer, deal.phone, deal.tags.join(" ")].join(" ").toLowerCase().includes(term)));
  }, [canViewDeal, customerPickerSearch, deals]);

  const toggleSeller = (sellerId: string) => {
    setSelectedSellerIds(current => current.includes(sellerId) ? current.filter(id => id !== sellerId) : [...current, sellerId]);
  };

  const toggleTag = (tag: string) => {
    setSelectedTags(current => current.includes(tag) ? current.filter(item => item !== tag) : [...current, tag]);
  };

  const toggleManualDeal = (dealId: string) => {
    setSelectedDealIds(current => current.includes(dealId) ? current.filter(id => id !== dealId) : [...current, dealId]);
  };

  const insertToken = (token: string) => {
    setMessage(current => `${current}${current.endsWith(" ") || !current ? "" : " "}${token}`);
  };

  const createCampaign = () => {
    if (!name.trim()) return toast.error("Informe o nome da campanha");
    if (!message.trim()) return toast.error("Informe a mensagem da campanha");
    if (totalAudience === 0) return toast.error("Nenhum lead encontrado para a seleção atual");
    const reportRows: CampaignReportRow[] = [
      ...audience.map(deal => ({
        name: deal.customer,
        phone: deal.phone,
        origin: manualSelectionActive ? "Seleção manual" : "Filtro CRM",
        status: "pendente",
      })),
    ];
    setActiveCampaigns(current => [{
      id: `c-${Date.now()}`,
      name: name.trim(),
      audience: totalAudience,
      sent: 0,
      responses: 0,
      status: "aguardando-revisao",
      createdAt: new Date().toISOString(),
      message: message.trim(),
      reportRows,
    }, ...current]);
    toast.success("Campanha criada e aguardando revisão");
  };

  const toggleCampaignPause = (campaignId: string) => {
    setActiveCampaigns(current => current.map(campaign =>
      campaign.id === campaignId
        ? { ...campaign, status: campaign.status === "pausada" ? "rodando" : "pausada" }
        : campaign
    ));
  };

  const stopCampaign = (campaignId: string) => {
    const campaign = activeCampaigns.find(item => item.id === campaignId);
    if (!campaign) return;
    setActiveCampaigns(current => current.filter(item => item.id !== campaignId));
    setClosedCampaigns(current => [{ ...campaign, status: "finalizada" }, ...current]);
    toast.success("Campanha parada e movida para anteriores");
  };

  const downloadCampaignReport = (campaign: CampaignSummary) => {
    const rows = campaign.reportRows.length ? campaign.reportRows : buildFallbackReportRows(campaign);
    downloadCsv(`relatorio-${campaign.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`, [
      ["campanha", "criada_em", "publico", "enviados", "respostas", "nome", "telefone", "origem", "status"],
      ...rows.map(row => [
        campaign.name,
        new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(campaign.createdAt)),
        campaign.audience,
        campaign.sent,
        campaign.responses,
        row.name,
        row.phone,
        row.origin,
        row.status,
      ]),
    ]);
  };

  const redoCampaign = (campaign: CampaignSummary) => {
    setName(campaign.name);
    setMessage(campaign.message);
    window.scrollTo({ top: 0, behavior: "smooth" });
    toast.success("Campanha carregada para refazer");
  };

  return (
    <AppLayout title="Campanhas" subtitle="Crie listas de remarketing e acompanhe respostas">
      <section className="card-elevated mb-6 p-6">
        <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="font-display text-lg font-bold">Nova campanha de remarketing</h2>
            <p className="text-sm text-muted-foreground">Monte público, revise mensagem, acompanhe taxa de resposta e conversões.</p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-secondary px-4 py-3">
              <div className="text-lg font-bold">{totalAudience}</div>
              <div className="text-[10px] font-semibold uppercase text-muted-foreground">leads</div>
            </div>
            <div className="rounded-xl bg-secondary px-4 py-3">
              <div className="text-lg font-bold">{selectedTags.length || tags.length}</div>
              <div className="text-[10px] font-semibold uppercase text-muted-foreground">tags</div>
            </div>
            <div className="rounded-xl bg-secondary px-4 py-3">
              <div className="text-lg font-bold">{activeCampaigns.filter(item => item.status === "aguardando-revisao").length}</div>
              <div className="text-[10px] font-semibold uppercase text-muted-foreground">revisão</div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-5">
            <div>
              <Label>Nome da campanha</Label>
              <Input value={name} onChange={event => setName(event.target.value)} />
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div>
                <Label>Clientes selecionados</Label>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" className="flex-1 justify-between" onClick={() => setCustomerPickerOpen(true)}>
                    {manualSelectionActive ? `${selectedDealIds.length} selecionados` : "Selecionar cliente por cliente"}
                    <Search className="h-4 w-4 text-muted-foreground" />
                  </Button>
                  {manualSelectionActive && (
                    <Button type="button" variant="outline" size="icon" onClick={() => setSelectedDealIds([])} title="Remover seleção manual">
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
              <div>
                <Label>Periodo do ultimo contato</Label>
                <Select value={lastContact} onValueChange={setLastContact} disabled={manualSelectionActive}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Qualquer periodo</SelectItem>
                    <SelectItem value="7d">Ha 7 dias ou mais</SelectItem>
                    <SelectItem value="15d">Ha 15 dias ou mais</SelectItem>
                    <SelectItem value="30d">Ha 30 dias ou mais</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Temperatura</Label>
                <Select value={temperature} onValueChange={setTemperature} disabled={manualSelectionActive}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas</SelectItem>
                    <SelectItem value="quente">Quente</SelectItem>
                    <SelectItem value="morno">Morno</SelectItem>
                    <SelectItem value="frio">Frio</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Retorno</Label>
                <Select value={returnStatus} onValueChange={setReturnStatus} disabled={manualSelectionActive}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="cliente-aguardando">Cliente aguardando</SelectItem>
                    <SelectItem value="aguardando-cliente">Aguardando cliente</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <Label>Vendedores</Label>
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={manualSelectionActive} onClick={() => setSelectedSellerIds([])}>Todos</Button>
                </div>
                <div className="max-h-44 overflow-y-auto rounded-xl border border-border/70 bg-background p-2">
                  {sellerOptions.map(seller => (
                    <label key={seller.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-secondary">
                      <Checkbox disabled={manualSelectionActive} checked={selectedSellerIds.includes(seller.id)} onCheckedChange={() => toggleSeller(seller.id)} />
                      <span className="truncate">{seller.name}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <Label>Tags</Label>
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={manualSelectionActive} onClick={() => setSelectedTags([])}>Todas</Button>
                </div>
                <div className="max-h-44 overflow-y-auto rounded-xl border border-border/70 bg-background p-2">
                  {tags.map(tag => (
                    <label key={tag} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-secondary">
                      <Checkbox disabled={manualSelectionActive} checked={selectedTags.includes(tag)} onCheckedChange={() => toggleTag(tag)} />
                      <span className="truncate">{tag}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <Label>Mensagem personalizada</Label>
              <Textarea value={message} onChange={event => setMessage(event.target.value)} rows={8} className="mt-1" />
            </div>
            <div className="flex flex-wrap gap-2">
              {syntaxOptions.map(option => (
                <Button key={option.token} type="button" variant="outline" size="sm" className="gap-2" onClick={() => insertToken(option.token)}>
                  <BadgeCheck className="h-3.5 w-3.5" /> {option.label}
                </Button>
              ))}
            </div>
            <div className="rounded-xl bg-secondary p-4">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                <MessageSquareText className="h-4 w-4" /> Previa da mensagem
              </div>
              <div className="whitespace-pre-wrap text-sm">{renderPreview(message, previewDeal)}</div>
            </div>
            <Button className="w-full gap-2 bg-gradient-primary" onClick={createCampaign}>
              <Send className="h-4 w-4" /> Preparar campanha
            </Button>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <CampaignList title="Campanhas rodando atualmente" items={activeCampaigns} mode="running" onTogglePause={toggleCampaignPause} onStop={stopCampaign} />
        <CampaignList title="Campanhas anteriores" items={closedCampaigns} mode="previous" onDownload={downloadCampaignReport} onRedo={redoCampaign} />
      </div>

      <Dialog open={customerPickerOpen} onOpenChange={setCustomerPickerOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Selecionar clientes</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={customerPickerSearch} onChange={event => setCustomerPickerSearch(event.target.value)} placeholder="Buscar por nome, telefone ou tag" className="pl-9" />
            </div>
            <div className="flex items-center justify-between rounded-xl bg-secondary p-3 text-sm">
              <span>{selectedDealIds.length} clientes selecionados</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setSelectedDealIds(customerPickerDeals.map(deal => deal.id))}>Selecionar visíveis</Button>
                <Button variant="outline" size="sm" onClick={() => setSelectedDealIds([])}>Limpar</Button>
              </div>
            </div>
            <div className="max-h-[420px] overflow-y-auto rounded-xl border border-border/70 p-2">
              {customerPickerDeals.map(deal => (
                <label key={deal.id} className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2 text-sm hover:bg-secondary">
                  <Checkbox checked={selectedDealIds.includes(deal.id)} onCheckedChange={() => toggleManualDeal(deal.id)} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{deal.customer}</span>
                    <span className="block truncate text-xs text-muted-foreground">{deal.phone} · {deal.tags.join(", ")}</span>
                  </span>
                </label>
              ))}
            </div>
            <Button className="w-full bg-gradient-primary" onClick={() => setCustomerPickerOpen(false)}>Aplicar seleção</Button>
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
