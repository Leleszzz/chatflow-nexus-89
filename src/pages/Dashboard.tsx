import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { format, subDays } from "date-fns";
import { AppLayout } from "@/components/layout/AppLayout";
import { MetricCard } from "@/components/shared/MetricCard";
import { ClientTemperatureBadge } from "@/components/shared/Badges";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useCRM } from "@/store/crm-store";
import { useDashboardMetrics, formatSecondsAsMinSec } from "@/hooks/useDashboardMetrics";
import { Line, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, CartesianGrid, Area, AreaChart } from "recharts";
import { MessageCircle, Clock, AlertTriangle, ShoppingBag, TrendingUp, Flame, Thermometer, Snowflake, ChevronDown, ChevronRight } from "lucide-react";
import { isAtendente } from "@/lib/roles";
import { ResponsiveTable } from "@/components/shared/ResponsiveTable";

const PERIODS = [
  { id: "today", label: "Hoje", days: 1 },
  { id: "7d", label: "7 dias", days: 7 },
  { id: "30d", label: "30 dias", days: 30 },
  { id: "custom", label: "Personalizado", days: 30 },
] as const;

const PIE_COLORS = ["hsl(var(--primary))", "hsl(var(--info))", "hsl(var(--warning))", "hsl(var(--hot))", "hsl(var(--success))", "hsl(var(--muted-foreground))"];

const formatBRL = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(value);
const formatSignedInteger = (value: number) => `${value >= 0 ? "+" : ""}${Math.round(value)}`;
const formatSignedBRL = (value: number) => `${value >= 0 ? "+" : "-"}${formatBRL(Math.abs(value))}`;

function buildMetricDelta(current: number, previous: number, valueFormatter = formatSignedInteger) {
  const difference = current - previous;
  const percent = previous ? (difference / previous) * 100 : current ? 100 : 0;
  return {
    percent: `${Math.abs(percent).toFixed(1)}%`,
    value: valueFormatter(difference),
    positive: difference >= 0,
  };
}

function formatTimeWithoutResponse(lastInteraction: string) {
  const lastInteractionTime = new Date(lastInteraction).getTime();
  if (Number.isNaN(lastInteractionTime)) return "Sem registro";

  const totalMinutes = Math.max(0, Math.floor((Date.now() - lastInteractionTime) / 60000));
  if (totalMinutes < 1) return "Agora";
  if (totalMinutes < 60) return `${totalMinutes}min`;

  const totalHours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;
  if (totalHours < 24) {
    return remainingMinutes ? `${totalHours}h ${remainingMinutes}min` : `${totalHours}h`;
  }

  const days = Math.floor(totalHours / 24);
  const remainingHours = totalHours % 24;
  return remainingHours ? `${days}d ${remainingHours}h` : `${days}d`;
}

export default function Dashboard() {
  const [period, setPeriod] = useState<typeof PERIODS[number]["id"]>("7d");
  const today = useMemo(() => new Date(), []);
  const [customStart, setCustomStart] = useState(() => format(subDays(today, 30), "yyyy-MM-dd"));
  const [customEnd, setCustomEnd] = useState(() => format(today, "yyyy-MM-dd"));
  const { teamUsers, currentUser, isAdmin } = useCRM();
  const navigate = useNavigate();

  const sellers = useMemo(
    () => teamUsers.filter(u => u.active && isAtendente(u.role)),
    [teamUsers],
  );
  const SELLER_IDS = useMemo(() => sellers.map(s => s.id), [sellers]);

  const [selectedSellerIds, setSelectedSellerIds] = useState<string[]>([]);
  const effectiveSelectedSellerIds = selectedSellerIds.length === 0 ? SELLER_IDS : selectedSellerIds;

  const effectiveSellerIds = useMemo(
    () => (isAdmin ? effectiveSelectedSellerIds : currentUser?.id ? [currentUser.id] : []),
    [currentUser?.id, isAdmin, effectiveSelectedSellerIds],
  );
  const allSellersSelected = isAdmin && effectiveSellerIds.length === SELLER_IDS.length && SELLER_IDS.length > 0;
  const sellerParam = allSellersSelected ? "all" : effectiveSellerIds.join(",");
  const sellerFilterLabel = allSellersSelected
    ? "Todas vendedoras"
    : effectiveSellerIds.length === 1
      ? sellers.find(s => s.id === effectiveSellerIds[0])?.name ?? currentUser?.name ?? "1 vendedora"
      : `${effectiveSellerIds.length} vendedoras`;

  const metrics = useDashboardMetrics({
    period,
    sellerIds: effectiveSellerIds,
    allSellersSelected,
    customStart,
    customEnd,
  });

  const { series, previousSeries, totals, previousTotals, refusal, ranking, critical, messagesLoading } = metrics;

  const metricDeltas = useMemo(() => {
    const avg = totals.avgResponseSeconds;
    const prevAvg = previousTotals.avgResponseSeconds;
    return {
      atendimentos: buildMetricDelta(totals.atendimentos, previousTotals.atendimentos),
      resposta: avg !== null && prevAvg !== null
        ? buildMetricDelta(Math.round(avg), Math.round(prevAvg), v => `${formatSignedInteger(v)}s`)
        : { percent: "0.0%", value: "—", positive: true },
      unread: buildMetricDelta(totals.unread, previousTotals.unread),
      revenue: buildMetricDelta(totals.revenue, previousTotals.revenue, formatSignedBRL),
      conversion: buildMetricDelta(
        Number(totals.conversionPct.toFixed(1)),
        Number(previousTotals.conversionPct.toFixed(1)),
        v => `${v >= 0 ? "+" : ""}${v.toFixed(1)}pp`,
      ),
      quente: buildMetricDelta(totals.temp.quente, previousTotals.temp.quente),
      morno: buildMetricDelta(totals.temp.morno, previousTotals.temp.morno),
      frio: buildMetricDelta(totals.temp.frio, previousTotals.temp.frio),
    };
  }, [totals, previousTotals]);

  const conversionLabel = `${totals.conversionPct.toFixed(1)}%`;
  const avgResponseLabel = totals.avgResponseSeconds !== null
    ? formatSecondsAsMinSec(totals.avgResponseSeconds)
    : (messagesLoading ? "…" : "—");

  const openRefusalReport = (reason: string) => {
    const params = new URLSearchParams({
      report: "atendimentos",
      period,
      seller: sellerParam,
      reason,
    });
    if (period === "custom") {
      params.set("start", customStart);
      params.set("end", customEnd);
    }
    navigate(`/relatorios?${params.toString()}`);
  };

  const toggleSeller = (sellerId: string) => {
    setSelectedSellerIds(current => {
      const base = current.length === 0 ? SELLER_IDS : current;
      const next = base.includes(sellerId)
        ? base.filter(id => id !== sellerId)
        : [...base, sellerId];
      return next.length ? next : base;
    });
  };

  const toggleAllSellers = () => {
    setSelectedSellerIds(current => {
      const isAll = (current.length === 0 || current.length === SELLER_IDS.length);
      return isAll ? (SELLER_IDS[0] ? [SELLER_IDS[0]] : []) : [];
    });
  };

  const days = period === "today" ? 1 : period === "7d" ? 7 : period === "30d" ? 30 : Math.max(1, series.length);

  return (
    <AppLayout title="Dashboard" subtitle="Visão geral do seu atendimento comercial">
      <div className="flex flex-wrap items-end gap-3 mb-6">
        {isAdmin && SELLER_IDS.length > 0 && <div>
          <Label className="text-xs text-muted-foreground">Atendente</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-full justify-between rounded-xl bg-card font-normal sm:w-[220px]">
                <span className="truncate">{sellerFilterLabel}</span>
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[240px] p-2">
              <label className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-secondary">
                <Checkbox checked={allSellersSelected} onCheckedChange={toggleAllSellers} aria-label="Selecionar todas vendedoras" />
                <span>Todas vendedoras</span>
              </label>
              <div className="my-1 h-px bg-border" />
              {sellers.map(s => (
                <label key={s.id} className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-secondary">
                  <Checkbox checked={effectiveSellerIds.includes(s.id)} onCheckedChange={() => toggleSeller(s.id)} aria-label={`Selecionar ${s.name}`} />
                  <span>{s.name}</span>
                </label>
              ))}
            </PopoverContent>
          </Popover>
        </div>}

        <div className="flex items-center gap-1 bg-card rounded-xl p-1 border border-border/60">
          {PERIODS.map(p => (
            <button key={p.id} onClick={() => setPeriod(p.id)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${period === p.id ? "bg-primary text-primary-foreground shadow-soft" : "text-muted-foreground hover:text-foreground"}`}>
              {p.label}
            </button>
          ))}
        </div>

        {period === "custom" && (
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <Label htmlFor="start" className="text-xs text-muted-foreground">Início</Label>
              <Input id="start" type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="h-9 bg-card" />
            </div>
            <div>
              <Label htmlFor="end" className="text-xs text-muted-foreground">Fim</Label>
              <Input id="end" type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="h-9 bg-card" />
            </div>
          </div>
        )}
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard onClick={() => navigate("/conversas")} icon={<MessageCircle className="w-5 h-5" />} label="Total de atendimentos" value={String(totals.atendimentos)} delta={metricDeltas.atendimentos.percent} deltaValue={metricDeltas.atendimentos.value} deltaPositive={metricDeltas.atendimentos.positive} accent="primary" />
        <MetricCard onClick={() => navigate("/relatorios?report=vendedoras")} icon={<Clock className="w-5 h-5" />} label="Tempo médio de resposta" value={avgResponseLabel} delta={metricDeltas.resposta.percent} deltaValue={metricDeltas.resposta.value} deltaPositive={!metricDeltas.resposta.positive} accent="info" />
        <MetricCard onClick={() => navigate("/conversas?status=sem-resposta")} icon={<AlertTriangle className="w-5 h-5" />} label="Conversas sem resposta" value={String(totals.unread)} delta={metricDeltas.unread.percent} deltaValue={metricDeltas.unread.value} deltaPositive={false} accent="destructive" />
        <MetricCard onClick={() => navigate("/relatorios?report=vendas&result=venda")} icon={<ShoppingBag className="w-5 h-5" />} label="Vendas realizadas" value={formatBRL(totals.revenue)} delta={metricDeltas.revenue.percent} deltaValue={metricDeltas.revenue.value} deltaPositive={metricDeltas.revenue.positive} accent="success" />
        <MetricCard onClick={() => navigate("/relatorios?report=kanban")} icon={<TrendingUp className="w-5 h-5" />} label="Taxa de conversão" value={conversionLabel} delta={metricDeltas.conversion.percent} deltaValue={metricDeltas.conversion.value} deltaPositive={metricDeltas.conversion.positive} accent="primary" />
        <MetricCard onClick={() => navigate("/kanban?temp=quente")} icon={<Flame className="w-5 h-5" />} label="Clientes quentes" value={String(totals.temp.quente)} delta={metricDeltas.quente.percent} deltaValue={metricDeltas.quente.value} deltaPositive={metricDeltas.quente.positive} accent="destructive" />
        <MetricCard onClick={() => navigate("/kanban?temp=morno")} icon={<Thermometer className="w-5 h-5" />} label="Clientes mornos" value={String(totals.temp.morno)} delta={metricDeltas.morno.percent} deltaValue={metricDeltas.morno.value} deltaPositive={metricDeltas.morno.positive} accent="warning" />
        <MetricCard onClick={() => navigate("/kanban?temp=frio")} icon={<Snowflake className="w-5 h-5" />} label="Clientes frios" value={String(totals.temp.frio)} delta={metricDeltas.frio.percent} deltaValue={metricDeltas.frio.value} deltaPositive={false} accent="info" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="card-elevated p-4 sm:p-6 lg:col-span-2">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="font-display font-bold text-base">Atendimentos por {period === "today" ? "hora" : "dia"}</h3>
              <p className="text-xs text-muted-foreground">{period === "today" ? "Evolução de hoje, hora em hora" : `Evolução nos últimos ${days} dias`}</p>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={series}>
              <defs>
                <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={24} />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))" }} />
              <Area type="monotone" dataKey="atendimentos" stroke="hsl(var(--primary))" strokeWidth={2.5} fill="url(#g1)" />
              <Line type="monotone" dataKey="vendas" stroke="hsl(var(--success))" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="card-elevated p-4 sm:p-6">
          <h3 className="font-display font-bold text-base">Motivos de recusa</h3>
          <p className="text-xs text-muted-foreground mb-2">Por que perdemos vendas</p>
          {refusal.length === 0 ? (
            <div className="text-xs text-muted-foreground py-12 text-center">Nenhuma recusa registrada no período.</div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={230}>
                <PieChart>
                  <Pie
                    data={refusal}
                    dataKey="value"
                    innerRadius={50}
                    outerRadius={85}
                    paddingAngle={2}
                    cursor="pointer"
                    onClick={(entry) => openRefusalReport((entry as { reason: string }).reason)}
                  >
                    {refusal.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))" }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                {refusal.map((r, i) => (
                  <button
                    key={r.name}
                    type="button"
                    className="flex items-center gap-1.5 rounded-md text-left text-[11px] transition-colors hover:bg-secondary"
                    onClick={() => openRefusalReport(r.reason)}
                  >
                    <div className="w-2 h-2 rounded-full" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                    <span className="text-muted-foreground truncate">{r.name}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card-elevated p-4 sm:p-6 lg:col-span-2">
          <h3 className="font-display font-bold text-base mb-4">Ranking de vendedoras</h3>
          <ResponsiveTable
            rows={ranking}
            rowKey={s => s.id}
            emptyMessage="Nenhuma vendedora ativa para este filtro."
            className="-mx-2"
            columns={[
              {
                key: "vendedora",
                header: "Vendedora",
                primary: true,
                cell: s => (
                  <div className="flex items-center gap-2.5">
                    <div className="w-4 text-xs font-bold text-muted-foreground">{ranking.indexOf(s) + 1}º</div>
                    <Avatar className="h-8 w-8"><AvatarFallback className="bg-primary-soft text-xs font-semibold text-primary">{s.avatar}</AvatarFallback></Avatar>
                    <span className="font-semibold">{s.name}</span>
                  </div>
                ),
              },
              { key: "atendimentos", header: "Atendimentos", cell: s => <span className="font-semibold">{s.atendimentos}</span> },
              { key: "vendas", header: "Vendas", cell: s => <span className="font-semibold text-success">{s.vendas}</span> },
              {
                key: "conversao",
                header: "Conversão",
                cell: s => (
                  <div className="flex items-center justify-end gap-2 md:justify-start">
                    <div className="h-1.5 w-16 overflow-hidden rounded-full bg-secondary">
                      <div className="h-full bg-gradient-primary" style={{ width: `${Math.min(s.conversao * 3, 100)}%` }} />
                    </div>
                    <span className="text-xs font-semibold">{s.conversao}%</span>
                  </div>
                ),
              },
              { key: "tempo", header: "Tempo médio", cell: s => <span className="text-muted-foreground">{s.tempoMedio}</span> },
            ]}
          />
        </div>

        <div className="card-elevated p-4 sm:p-6">
          <h3 className="font-display font-bold text-base mb-1">Conversas críticas</h3>
          <p className="text-xs text-muted-foreground mb-4">Aguardando resposta</p>
          <div className="space-y-2.5">
            {critical.map(d => {
              const waitingTime = formatTimeWithoutResponse(d.lastInteraction);
              return (
                <div key={d.id} className="p-3 rounded-xl bg-secondary/60 border border-border/40 hover:bg-secondary transition-colors">
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <div className="min-w-0">
                      <div className="font-semibold text-sm truncate">{d.customer}</div>
                      <div className="text-[11px] font-semibold text-foreground truncate">Vendedor: {d.sellerName}</div>
                    </div>
                    <ClientTemperatureBadge temp={d.temperature} />
                  </div>
                  <p className="text-xs text-muted-foreground truncate mb-2">{d.lastMessage}</p>
                  <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                    <Clock className="w-3 h-3" />
                    <span>Sem resposta há {waitingTime}</span>
                  </div>
                  <Button size="sm" variant="ghost" className="h-7 text-xs px-2 -ml-2 text-primary hover:text-primary"
                    onClick={() => navigate(d.dealId ? `/conversas?deal=${d.dealId}` : `/conversas?conversation=${d.id}`)}>
                    Abrir conversa <ChevronRight className="w-3 h-3 ml-1" />
                  </Button>
                </div>
              );
            })}
            {critical.length === 0 && <div className="text-xs text-muted-foreground py-6 text-center">Nenhuma conversa crítica para este filtro.</div>}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
