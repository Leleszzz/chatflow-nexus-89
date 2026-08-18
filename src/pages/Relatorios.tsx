import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useCRM } from "@/store/crm-store";
import { csvNumber, downloadCsv } from "@/lib/csv";
import { ClientTemperatureBadge, TagBadge } from "@/components/shared/Badges";
import { Download, Play, FileText, Users, Bot, Flame, AlertTriangle, History, ShoppingBag, X } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

const REPORTS = [
  { id: "atendimentos", name: "Atendimentos", desc: "Todos os atendimentos do período", icon: FileText },
  { id: "vendas", name: "Vendas", desc: "Vendas realizadas com valor e produto", icon: ShoppingBag },
  { id: "recusas", name: "Recusas", desc: "Vendas perdidas e seus motivos", icon: X },
  { id: "sem-resposta", name: "Conversas sem resposta", desc: "Clientes aguardando retorno", icon: AlertTriangle },
  { id: "vendedoras", name: "Performance por vendedora", desc: "Métricas individuais da equipe", icon: Users },
  { id: "agentes", name: "Performance por agente IA", desc: "Eficiência dos agentes automáticos", icon: Bot },
  { id: "quentes", name: "Clientes quentes", desc: "Leads com alta probabilidade de compra", icon: Flame },
  { id: "kanban", name: "Histórico completo do Kanban", desc: "Movimentações entre etapas", icon: History },
];

const TEMPERATURE_LABELS: Record<string, string> = { quente: "Quente", morno: "Morno", frio: "Frio" };

const daysByPeriod: Record<string, number> = { today: 1, "7d": 7, "30d": 30, "90d": 90 };
const refusalByStage: Record<string, string> = {
  perdido: "Comprou com concorrente",
  "aguardando-resposta": "Não respondeu mais",
};

const getRefusalReason = (deal: { stage: string; tags: string[]; notes?: string; lastMessage: string }) => {
  const searchable = `${deal.lastMessage} ${deal.notes || ""} ${deal.tags.join(" ")}`.toLowerCase();
  if (searchable.includes("preço") || searchable.includes("preco") || searchable.includes("caro") || searchable.includes("desconto")) return "Preço alto";
  if (searchable.includes("orçamento") || searchable.includes("orcamento")) return "Cliente sem orçamento";
  if (searchable.includes("concorrente") || searchable.includes("fornecedor")) return "Comprou com concorrente";
  if (searchable.includes("pesquisando")) return "Está apenas pesquisando";
  return refusalByStage[deal.stage] || "Outros";
};

export default function Relatorios() {
  const { deals, agents, stages, canViewDeal, isAdmin, currentUser, hasPermission, teamUsers, finished } = useCRM();
  const [searchParams] = useSearchParams();
  const [selected, setSelected] = useState(searchParams.get("report") || "atendimentos");
  const [period, setPeriod] = useState(searchParams.get("period") || "30d");
  const [customStart, setCustomStart] = useState(searchParams.get("start") || "2026-04-01");
  const [customEnd, setCustomEnd] = useState(searchParams.get("end") || "2026-04-28");
  const [seller, setSeller] = useState(searchParams.get("seller") || "all");
  const [stage, setStage] = useState(searchParams.get("stage") || "all");
  const [temperature, setTemperature] = useState(searchParams.get("temp") || "all");
  const [result, setResult] = useState(searchParams.get("result") || "all");
  const [reason, setReason] = useState(searchParams.get("reason") || "all");
  const [channel, setChannel] = useState(searchParams.get("channel") || "all");
  const [minValue, setMinValue] = useState(searchParams.get("minValue") || "");

  const filteredDeals = useMemo(() => {
    const cutoff = Date.now() - (daysByPeriod[period] ?? 30) * 86400000;
    const startDate = new Date(`${customStart}T00:00:00`).getTime();
    const endDate = new Date(`${customEnd}T23:59:59`).getTime();
    return deals.filter(deal => {
      const interactionTime = +new Date(deal.lastInteraction);
      const dealResult = deal.stage === "fechado" ? "venda" : deal.stage === "perdido" ? "recusa" : "andamento";
      const dealReason = getRefusalReason(deal);
      const dealChannel = deal.tags.includes("Presencial") ? "presencial" : deal.tags.includes("Instagram") ? "instagram" : "wpp1";
      const matchesPeriod = period === "custom"
        ? interactionTime >= startDate && interactionTime <= endDate
        : interactionTime >= cutoff;

      return canViewDeal(deal)
        && matchesPeriod
        && (!isAdmin || seller === "all" || deal.sellerId === seller)
        && (stage === "all" || deal.stage === stage)
        && (temperature === "all" || deal.temperature === temperature)
        && (result === "all" || dealResult === result)
        && (reason === "all" || dealReason === reason)
        && (channel === "all" || dealChannel === channel)
        && (!minValue || (deal.estimatedValue || 0) >= Number(minValue));
    });
  }, [canViewDeal, deals, period, customStart, customEnd, seller, stage, temperature, result, reason, channel, minValue, isAdmin]);

  const reportRows = useMemo(() => {
    if (selected === "vendas") return filteredDeals.filter(deal => deal.stage === "fechado");
    if (selected === "recusas") return filteredDeals.filter(deal => deal.stage === "perdido");
    if (selected === "sem-resposta") return filteredDeals.filter(deal => deal.unread);
    if (selected === "quentes") return filteredDeals.filter(deal => deal.temperature === "quente");
    return filteredDeals;
  }, [filteredDeals, selected]);

  const totalValue = reportRows.reduce((sum, deal) => sum + (deal.estimatedValue || 0), 0);
  const closedCount = reportRows.filter(deal => deal.stage === "fechado").length;
  const conversion = reportRows.length ? ((closedCount / reportRows.length) * 100).toFixed(1) : "0.0";
  const avgTicket = closedCount ? totalValue / closedCount : 0;

  const sellersList = useMemo(
    () => teamUsers.filter(user => user.active && user.role === "Vendedora"),
    [teamUsers],
  );
  const visibleSellers = isAdmin ? sellersList : sellersList.filter(sellerItem => sellerItem.id === currentUser?.id);
  const sellerPerformance = visibleSellers.map(s => {
    const sellerDeals = filteredDeals.filter(deal => deal.sellerId === s.id);
    const sellerClosed = sellerDeals.filter(deal => deal.stage === "fechado").length;
    return {
      ...s,
      atendimentos: sellerDeals.length,
      vendas: sellerClosed,
      conversao: sellerDeals.length ? ((sellerClosed / sellerDeals.length) * 100).toFixed(1) : "0.0",
      valor: sellerDeals.reduce((sum, deal) => sum + (deal.estimatedValue || 0), 0),
    };
  });

  const agentPerformance = agents.map(agent => ({
    name: agent.name,
    channel: agent.channel,
    conversations: agent.conversations,
    active: agent.active,
  }));

  const refusalReasonsFromData = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of finished) {
      if (item.result !== "recusa") continue;
      const reasonLabel = (item.reason || "Outros").trim() || "Outros";
      counts.set(reasonLabel, (counts.get(reasonLabel) || 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [finished]);

  const insights = useMemo(() => {
    const out: string[] = [];
    const topSeller = [...sellerPerformance].sort((a, b) => Number(b.conversao) - Number(a.conversao))[0];
    if (topSeller && Number(topSeller.conversao) > 0) {
      out.push(`${topSeller.name} teve a melhor conversão do período (${topSeller.conversao}%).`);
    }
    if (refusalReasonsFromData.length) {
      out.push(`O motivo de perda mais comum foi ${refusalReasonsFromData[0][0].toLowerCase()}.`);
    }
    if (!out.length) out.push("Sem registros suficientes no período para gerar insights.");
    return out;
  }, [sellerPerformance, refusalReasonsFromData]);

  const refusalSelectOptions = refusalReasonsFromData.map(([reason]) => reason);

  // Cada relatório exporta as colunas do que está na tela. Antes, todos os 8
  // tipos emitiam as mesmas colunas de lead — em "por vendedora"/"por agente" o
  // CSV saía com dados diferentes dos que o usuário estava vendo.
  const buildCsv = (): { header: string[]; rows: Array<Array<string | number>> } | null => {
    if (selected === "vendedoras") {
      return {
        header: ["Vendedora", "Atendimentos", "Vendas", "Conversão (%)", "Valor total (R$)"],
        rows: sellerPerformance.map(s => [s.name, s.atendimentos, s.vendas, csvNumber(Number(s.conversao), 1), csvNumber(s.valor)]),
      };
    }

    if (selected === "agentes") {
      return {
        header: ["Agente", "Canal", "Conversas", "Ativo"],
        rows: agentPerformance.map(a => [a.name, a.channel, a.conversations, a.active ? "Sim" : "Não"]),
      };
    }

    // "kanban" prometia histórico de movimentação entre etapas, mas esse
    // registro não existe em lugar nenhum do sistema. Melhor recusar do que
    // exportar linhas de lead fingindo ser histórico.
    if (selected === "kanban") return null;

    const isRefusalReport = selected === "recusas";
    const header = ["Data", "Cliente", "Telefone", "Vendedora", "Etapa", "Temperatura", "Valor estimado (R$)", "Tags"];
    if (isRefusalReport) header.splice(5, 0, "Motivo da perda");

    const rows = reportRows.map(deal => {
      const sellerName = teamUsers.find(s => s.id === deal.sellerId)?.name || "";
      const stageName = stages.find(s => s.id === deal.stage)?.title || "";
      const row: Array<string | number> = [
        format(new Date(deal.lastInteraction), "dd/MM/yyyy HH:mm"),
        deal.customer,
        deal.phone,
        sellerName,
        stageName,
        TEMPERATURE_LABELS[deal.temperature] || deal.temperature,
        csvNumber(deal.estimatedValue || 0),
        deal.tags.join(" | "),
      ];
      if (isRefusalReport) row.splice(5, 0, getRefusalReason(deal));
      return row;
    });

    return { header, rows };
  };

  const exportCsv = () => {
    if (!hasPermission("Exportar dados")) {
      toast.error("Seu usuário não tem permissão para exportar dados");
      return;
    }

    const report = buildCsv();
    if (!report) {
      toast.error("O histórico de movimentações do Kanban ainda não é registrado, então não há o que exportar neste relatório");
      return;
    }
    if (!report.rows.length) {
      toast.error("Nenhum registro no período e filtros selecionados");
      return;
    }

    const reportName = REPORTS.find(r => r.id === selected)?.name || selected;
    const stamp = format(new Date(), "yyyy-MM-dd");
    downloadCsv(`relatorio-${selected}-${stamp}.csv`, [report.header, ...report.rows]);
    toast.success(`${reportName}: ${report.rows.length} ${report.rows.length === 1 ? "linha exportada" : "linhas exportadas"}`);
  };

  if (!hasPermission("Ver relatórios")) {
    return (
      <AppLayout title="Relatórios" subtitle="Acesso restrito">
        <div className="card-elevated p-6 text-sm text-muted-foreground">
          Seu usuário não tem permissão para visualizar relatórios.
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Relatórios" subtitle="Filtre e exporte os dados que precisar">
      <div className="card-elevated p-5 mb-5">
        <h3 className="font-semibold text-sm mb-3">Filtros</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          <div><Label className="text-xs">Período</Label><Select value={period} onValueChange={setPeriod}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
            <SelectItem value="today">Hoje</SelectItem><SelectItem value="7d">7 dias</SelectItem><SelectItem value="30d">30 dias</SelectItem><SelectItem value="90d">90 dias</SelectItem><SelectItem value="custom">Personalizado</SelectItem>
          </SelectContent></Select></div>
          {period === "custom" && (
            <>
              <div><Label className="text-xs">Início</Label><Input type="date" value={customStart} onChange={event => setCustomStart(event.target.value)} /></div>
              <div><Label className="text-xs">Fim</Label><Input type="date" value={customEnd} onChange={event => setCustomEnd(event.target.value)} /></div>
            </>
          )}
          {isAdmin && <div><Label className="text-xs">Vendedora</Label><Select value={seller} onValueChange={setSeller}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
            <SelectItem value="all">Todas</SelectItem>{sellersList.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
          </SelectContent></Select></div>}
          <div><Label className="text-xs">Status</Label><Select value={stage} onValueChange={setStage}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
            <SelectItem value="all">Todos</SelectItem>{stages.map(s => <SelectItem key={s.id} value={s.id}>{s.title}</SelectItem>)}
          </SelectContent></Select></div>
          <div><Label className="text-xs">Temperatura</Label><Select value={temperature} onValueChange={setTemperature}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
            <SelectItem value="all">Todas</SelectItem><SelectItem value="quente">Quente</SelectItem><SelectItem value="morno">Morno</SelectItem><SelectItem value="frio">Frio</SelectItem>
          </SelectContent></Select></div>
          <div><Label className="text-xs">Resultado</Label><Select value={result} onValueChange={setResult}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
            <SelectItem value="all">Todos</SelectItem><SelectItem value="venda">Venda</SelectItem><SelectItem value="recusa">Recusa</SelectItem>
          </SelectContent></Select></div>
          <div><Label className="text-xs">Motivo recusa</Label><Select value={reason} onValueChange={setReason}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
            <SelectItem value="all">Todos</SelectItem>{refusalSelectOptions.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
            {refusalSelectOptions.length === 0 && <SelectItem value="__none" disabled>Sem registros</SelectItem>}
          </SelectContent></Select></div>
          <div><Label className="text-xs">Canal</Label><Select value={channel} onValueChange={setChannel}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
            <SelectItem value="all">Todos</SelectItem><SelectItem value="wpp1">WhatsApp Principal</SelectItem><SelectItem value="instagram">Instagram</SelectItem><SelectItem value="presencial">Presencial</SelectItem>
          </SelectContent></Select></div>
          <div><Label className="text-xs">Valor mínimo</Label><Input type="number" placeholder="R$ 0" value={minValue} onChange={event => setMinValue(event.target.value)} /></div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <div className="card-elevated p-4"><div className="text-xs text-muted-foreground">Resultados</div><div className="text-2xl font-bold">{reportRows.length}</div></div>
        <div className="card-elevated p-4"><div className="text-xs text-muted-foreground">Valor em carteira</div><div className="text-2xl font-bold">R$ {Math.round(totalValue).toLocaleString("pt-BR")}</div></div>
        <div className="card-elevated p-4"><div className="text-xs text-muted-foreground">Conversão</div><div className="text-2xl font-bold">{conversion}%</div></div>
        <div className="card-elevated p-4"><div className="text-xs text-muted-foreground">Ticket médio</div><div className="text-2xl font-bold">R$ {Math.round(avgTicket).toLocaleString("pt-BR")}</div></div>
      </div>

      <section className="card-elevated mb-6 p-5">
        <div className="mb-3 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-primary" />
          <h2 className="font-display text-base font-bold">Insights automáticos</h2>
        </div>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
          {insights.map(insight => (
            <div key={insight} className="rounded-xl border border-border/70 bg-background p-3 text-sm text-muted-foreground">
              {insight}
            </div>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {REPORTS.map(r => (
          <button key={r.id} onClick={() => setSelected(r.id)}
            className={`text-left card-elevated p-4 transition-all hover:shadow-soft ${selected === r.id ? "ring-2 ring-primary border-primary" : ""}`}>
            <div className="w-9 h-9 rounded-lg bg-primary-soft text-primary flex items-center justify-center mb-2"><r.icon className="w-4 h-4" /></div>
            <div className="font-semibold text-sm">{r.name}</div>
            <div className="text-xs text-muted-foreground line-clamp-2">{r.desc}</div>
          </button>
        ))}
      </div>

      <div className="card-elevated p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="font-display font-bold">{REPORTS.find(r => r.id === selected)?.name}</h3>
            <p className="text-xs text-muted-foreground">Preview dos registros filtrados · {reportRows.length} resultados</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="gap-2" onClick={() => toast.success(`${reportRows.length} registros carregados`)}><Play className="w-4 h-4" /> Gerar</Button>
            <Button
              className="gap-2 bg-gradient-primary"
              onClick={exportCsv}
              disabled={selected === "kanban"}
              title={selected === "kanban" ? "O histórico de movimentações do Kanban ainda não é registrado" : "Exportar CSV"}
            >
              <Download className="w-4 h-4" /> Exportar CSV
            </Button>
          </div>
        </div>

        {selected === "vendedoras" ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
            {sellerPerformance.map(s => (
              <div key={s.id} className="rounded-xl border border-border bg-secondary/40 p-4">
                <div className="font-semibold">{s.name}</div>
                <div className="text-xs text-muted-foreground mt-1">{s.atendimentos} atendimentos · {s.vendas} vendas</div>
                <div className="text-sm font-bold mt-3">{s.conversao}% conversão</div>
                <div className="text-xs text-success mt-1">R$ {s.valor.toLocaleString("pt-BR")}</div>
              </div>
            ))}
          </div>
        ) : selected === "agentes" ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            {agentPerformance.map(agent => (
              <div key={agent.name} className="rounded-xl border border-border bg-secondary/40 p-4">
                <div className="flex items-center justify-between">
                  <div className="font-semibold truncate">{agent.name}</div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${agent.active ? "bg-success-soft text-success" : "bg-muted text-muted-foreground"}`}>
                    {agent.active ? "Ativo" : "Inativo"}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">{agent.channel}</div>
                <div className="mt-3 text-xs">
                  <div className="font-bold text-base">{agent.conversations}</div>
                  <div className="text-muted-foreground">Conversas atendidas</div>
                </div>
              </div>
            ))}
            {agentPerformance.length === 0 && <div className="md:col-span-2 xl:col-span-4 py-6 text-center text-sm text-muted-foreground">Nenhum agente cadastrado.</div>}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs uppercase text-muted-foreground border-b">
                <th className="py-2.5 font-semibold pr-3">Data</th><th className="py-2.5 font-semibold pr-3">Cliente</th>
                <th className="py-2.5 font-semibold pr-3">WhatsApp</th><th className="py-2.5 font-semibold pr-3">Vendedora</th>
                <th className="py-2.5 font-semibold pr-3">Etapa</th><th className="py-2.5 font-semibold pr-3">Temperatura</th>
                <th className="py-2.5 font-semibold pr-3">Valor</th><th className="py-2.5 font-semibold pr-3">Tags</th>
              </tr></thead>
              <tbody>
                {reportRows.map(d => {
                  const sellerName = teamUsers.find(s => s.id === d.sellerId)?.name;
                  const stageName = stages.find(s => s.id === d.stage)?.title;
                  return (
                    <tr key={d.id} className="border-b border-border/40 hover:bg-secondary/40">
                      <td className="py-3 pr-3 text-muted-foreground text-xs">{format(new Date(d.lastInteraction), "dd/MM/yy HH:mm")}</td>
                      <td className="py-3 pr-3 font-medium truncate max-w-[160px]">{d.customer}</td>
                      <td className="py-3 pr-3 text-muted-foreground text-xs">{d.phone}</td>
                      <td className="py-3 pr-3">{sellerName}</td>
                      <td className="py-3 pr-3 text-xs">{stageName}</td>
                      <td className="py-3 pr-3"><ClientTemperatureBadge temp={d.temperature} /></td>
                      <td className="py-3 pr-3 font-semibold">{d.estimatedValue ? `R$ ${d.estimatedValue.toLocaleString("pt-BR")}` : "-"}</td>
                      <td className="py-3 pr-3"><div className="flex gap-1 flex-wrap">{d.tags.slice(0, 2).map(t => <TagBadge key={t} label={t} />)}</div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {reportRows.length === 0 && <div className="py-10 text-center text-sm text-muted-foreground">Nenhum registro encontrado para os filtros atuais.</div>}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
