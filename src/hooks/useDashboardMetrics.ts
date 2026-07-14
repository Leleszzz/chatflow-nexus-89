import { useEffect, useMemo, useRef, useState } from "react";
import { useCRM } from "@/store/crm-store";
import { useWhatsAppConversations } from "@/hooks/useWhatsAppConversations";
import { whatsappApi, WAConversation, WAMessage } from "@/lib/whatsapp-api";
import { getSocket } from "@/lib/whatsapp-socket";
import { Deal, Temperature } from "@/lib/mock-data";

export type DashboardPeriod = "today" | "7d" | "30d" | "custom";

export type DashboardMetricsArgs = {
  period: DashboardPeriod;
  sellerIds: string[];
  allSellersSelected: boolean;
  customStart?: string;
  customEnd?: string;
};

export type SeriesPoint = { label: string; atendimentos: number; vendas: number };

export type DashboardSellerRow = {
  id: string;
  name: string;
  avatar: string;
  atendimentos: number;
  vendas: number;
  conversao: number;
  tempoMedio: string;
};

export type DashboardCritical = {
  id: string;
  dealId?: string;
  customer: string;
  sellerName: string;
  lastMessage: string;
  lastInteraction: string;
  temperature: Temperature;
};

export type DashboardRefusal = { name: string; reason: string; value: number };

export type DashboardTotals = {
  atendimentos: number;
  avgResponseSeconds: number | null;
  unread: number;
  revenue: number;
  conversionPct: number;
  temp: { quente: number; morno: number; frio: number };
};

export type DashboardMetrics = {
  range: { from: Date; to: Date };
  series: SeriesPoint[];
  previousSeries: SeriesPoint[];
  totals: DashboardTotals;
  previousTotals: DashboardTotals;
  refusal: DashboardRefusal[];
  ranking: DashboardSellerRow[];
  critical: DashboardCritical[];
  loading: boolean;
  messagesLoading: boolean;
};

export const REFUSAL_REASON_PARAMS: Record<string, string> = {
  "Preço alto": "Preço alto",
  "Sem orçamento": "Cliente sem orçamento",
  "Comprou com concorrente": "Comprou com concorrente",
  "Não respondeu mais": "Não respondeu mais",
  "Apenas pesquisando": "Está apenas pesquisando",
  "Outros": "Outros",
};

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

function resolveRange(args: DashboardMetricsArgs): { from: Date; to: Date } {
  const now = new Date();
  if (args.period === "today") return { from: startOfDay(now), to: now };
  if (args.period === "custom" && args.customStart && args.customEnd) {
    return { from: startOfDay(new Date(`${args.customStart}T00:00:00`)), to: endOfDay(new Date(`${args.customEnd}T00:00:00`)) };
  }
  const days = args.period === "7d" ? 7 : 30;
  const from = startOfDay(new Date(now.getTime() - (days - 1) * DAY_MS));
  return { from, to: now };
}

function previousRange(range: { from: Date; to: Date }): { from: Date; to: Date } {
  const span = range.to.getTime() - range.from.getTime();
  return { from: new Date(range.from.getTime() - span - 1), to: new Date(range.from.getTime() - 1) };
}

const normalizePhone = (p: string) => (p || "").replace(/\D/g, "");

function parseTs(value: string | number | undefined | null): number {
  if (value === undefined || value === null) return 0;
  if (typeof value === "number") return value < 1e12 ? value * 1000 : value;
  const t = Date.parse(value);
  return Number.isNaN(t) ? 0 : t;
}

const formatSecondsAsMinSec = (secs: number) =>
  `${Math.floor(secs / 60)}m ${Math.round(secs % 60)}s`;

export function useDashboardMetrics(args: DashboardMetricsArgs): DashboardMetrics {
  const { conversations, loading } = useWhatsAppConversations();
  const { deals, finished, teamUsers, canViewDeal } = useCRM();

  const { period, customStart, customEnd, allSellersSelected, sellerIds } = args;
  const sellerKey = useMemo(() => sellerIds.slice().sort().join(","), [sellerIds]);

  const range = useMemo(
    () => resolveRange({ period, customStart, customEnd, allSellersSelected, sellerIds }),
    [period, customStart, customEnd, allSellersSelected, sellerIds],
  );
  const prev = useMemo(() => previousRange(range), [range]);

  const sellerOk = (id?: string | null) =>
    allSellersSelected || (!!id && sellerIds.includes(id));

  const visibleDeals = useMemo(
    () => deals.filter(d => canViewDeal(d) && (allSellersSelected || sellerIds.includes(d.sellerId))),
    [deals, canViewDeal, allSellersSelected, sellerKey],
  );

  const dealByPhone = useMemo(() => {
    const map = new Map<string, Deal>();
    for (const d of visibleDeals) {
      const key = normalizePhone(d.phone);
      if (key) map.set(key, d);
    }
    return map;
  }, [visibleDeals]);

  const visibleConversations = useMemo(() => {
    if (allSellersSelected) return conversations;
    return conversations.filter(c => {
      const deal = dealByPhone.get(normalizePhone(c.phone));
      return deal ? sellerIds.includes(deal.sellerId) : false;
    });
  }, [conversations, dealByPhone, allSellersSelected, sellerKey]);

  const fromMs = range.from.getTime();
  const toMs = range.to.getTime();
  const prevFromMs = prev.from.getTime();
  const prevToMs = prev.to.getTime();
  const inRange = (ts: number) => ts >= fromMs && ts <= toMs;
  const inPrev = (ts: number) => ts >= prevFromMs && ts <= prevToMs;

  const [messagesMap, setMessagesMap] = useState<Record<string, WAMessage[]>>({});
  const [messagesLoading, setMessagesLoading] = useState(false);
  const fetchedKeyRef = useRef<string>("");

  const conversationIdsForFetch = useMemo(() => (
    [...visibleConversations]
      .sort((a, b) => parseTs(b.lastInteraction) - parseTs(a.lastInteraction))
      .slice(0, 30)
      .map(c => c.id)
  ), [visibleConversations]);

  const fetchKey = conversationIdsForFetch.join(",");

  useEffect(() => {
    if (!fetchKey || fetchKey === fetchedKeyRef.current) return;
    fetchedKeyRef.current = fetchKey;
    let cancelled = false;
    setMessagesLoading(true);
    Promise.all(conversationIdsForFetch.map(async id => {
      try {
        const msgs = await whatsappApi.getMessages(id, { limit: 50 });
        return [id, msgs] as const;
      } catch {
        return [id, [] as WAMessage[]] as const;
      }
    })).then(entries => {
      if (cancelled) return;
      const next: Record<string, WAMessage[]> = {};
      for (const [id, msgs] of entries) next[id] = msgs;
      setMessagesMap(next);
      setMessagesLoading(false);
    });
    return () => { cancelled = true; };
  }, [fetchKey, conversationIdsForFetch]);

  useEffect(() => {
    const socket = getSocket();
    const onNew = (payload: { conversation: WAConversation; message: WAMessage }) => {
      setMessagesMap(curr => {
        const list = curr[payload.conversation.id];
        if (!list) return curr;
        if (list.some(m => m.id === payload.message.id)) return curr;
        const merged = [...list, payload.message].sort((a, b) => parseTs(a.timestamp) - parseTs(b.timestamp));
        return { ...curr, [payload.conversation.id]: merged };
      });
    };
    socket.on("message:new", onNew);
    return () => { socket.off("message:new", onNew); };
  }, []);

  const avgResponseFor = (conversationsSubset: WAConversation[], windowFrom: number, windowTo: number): number | null => {
    let totalSec = 0;
    let count = 0;
    for (const conv of conversationsSubset) {
      const list = messagesMap[conv.id];
      if (!list || list.length < 2) continue;
      for (let i = 1; i < list.length; i++) {
        const prevMsg = list[i - 1];
        const cur = list[i];
        if (!cur.fromMe || prevMsg.fromMe) continue;
        const curTs = parseTs(cur.timestamp);
        if (curTs < windowFrom || curTs > windowTo) continue;
        const diff = (curTs - parseTs(prevMsg.timestamp)) / 1000;
        if (diff > 0 && diff < DAY_MS / 1000) {
          totalSec += diff;
          count++;
        }
      }
    }
    return count > 0 ? totalSec / count : null;
  };

  const isHourly = period === "today";

  const buildBuckets = (windowFrom: Date, windowTo: Date): SeriesPoint[] => {
    if (isHourly) {
      return Array.from({ length: 24 }, (_, h) => ({
        label: `${String(h).padStart(2, "0")}h`,
        atendimentos: 0,
        vendas: 0,
      }));
    }
    const baseDay = startOfDay(windowFrom);
    const totalDays = Math.max(1, Math.floor((endOfDay(windowTo).getTime() - baseDay.getTime()) / DAY_MS) + 1);
    return Array.from({ length: totalDays }, (_, i) => {
      const d = new Date(baseDay.getTime() + i * DAY_MS);
      return {
        label: `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`,
        atendimentos: 0,
        vendas: 0,
      };
    });
  };

  const bucketIndex = (ts: number, base: Date): number => {
    if (isHourly) {
      const d = new Date(ts);
      const sameDay = d.getFullYear() === base.getFullYear() && d.getMonth() === base.getMonth() && d.getDate() === base.getDate();
      return sameDay ? d.getHours() : -1;
    }
    const dayBase = startOfDay(base).getTime();
    const dayTs = startOfDay(new Date(ts)).getTime();
    return Math.floor((dayTs - dayBase) / DAY_MS);
  };

  const buildSeries = (windowFrom: Date, windowTo: Date, predicateTs: (ts: number) => boolean): SeriesPoint[] => {
    const pts = buildBuckets(windowFrom, windowTo);
    for (const c of visibleConversations) {
      const ts = parseTs(c.lastInteraction);
      if (!predicateTs(ts)) continue;
      const idx = bucketIndex(ts, windowFrom);
      if (idx >= 0 && idx < pts.length) pts[idx].atendimentos++;
    }
    for (const f of finished) {
      if (f.result !== "venda") continue;
      if (!sellerOk(f.operatorId)) continue;
      const ts = parseTs(f.finishedAt);
      if (!predicateTs(ts)) continue;
      const idx = bucketIndex(ts, windowFrom);
      if (idx >= 0 && idx < pts.length) pts[idx].vendas++;
    }
    return pts;
  };

  const series = useMemo(
    () => buildSeries(range.from, range.to, inRange),
    [visibleConversations, finished, range, allSellersSelected, sellerKey, isHourly],
  );

  const previousSeries = useMemo(
    () => buildSeries(prev.from, prev.to, inPrev),
    [visibleConversations, finished, prev, allSellersSelected, sellerKey, isHourly],
  );

  const totals = useMemo<DashboardTotals>(() => {
    const finishedInRange = finished.filter(f => sellerOk(f.operatorId) && inRange(parseTs(f.finishedAt)));
    const vendas = finishedInRange.filter(f => f.result === "venda");
    const recusas = finishedInRange.filter(f => f.result === "recusa");
    const revenue = vendas.reduce((sum, f) => sum + (f.amount || 0), 0);
    const conversionPct = (vendas.length + recusas.length) > 0
      ? (vendas.length / (vendas.length + recusas.length)) * 100
      : 0;
    const atendimentos = series.reduce((s, p) => s + p.atendimentos, 0);
    const unread = visibleConversations.filter(c => c.unread && c.lastMessageFromMe === false).length;
    return {
      atendimentos,
      avgResponseSeconds: avgResponseFor(visibleConversations, fromMs, toMs),
      unread,
      revenue,
      conversionPct,
      temp: {
        quente: visibleDeals.filter(d => d.temperature === "quente").length,
        morno: visibleDeals.filter(d => d.temperature === "morno").length,
        frio: visibleDeals.filter(d => d.temperature === "frio").length,
      },
    };
  }, [finished, series, visibleConversations, visibleDeals, messagesMap, range, allSellersSelected, sellerKey]);

  const previousTotals = useMemo<DashboardTotals>(() => {
    const finishedInPrev = finished.filter(f => sellerOk(f.operatorId) && inPrev(parseTs(f.finishedAt)));
    const vendas = finishedInPrev.filter(f => f.result === "venda");
    const recusas = finishedInPrev.filter(f => f.result === "recusa");
    const revenue = vendas.reduce((sum, f) => sum + (f.amount || 0), 0);
    const atendimentos = previousSeries.reduce((s, p) => s + p.atendimentos, 0);
    const conversionPct = (vendas.length + recusas.length) > 0
      ? (vendas.length / (vendas.length + recusas.length)) * 100
      : 0;
    return {
      atendimentos,
      avgResponseSeconds: avgResponseFor(visibleConversations, prevFromMs, prevToMs),
      unread: totals.unread,
      revenue,
      conversionPct,
      temp: totals.temp,
    };
  }, [finished, previousSeries, visibleConversations, messagesMap, prev, totals, allSellersSelected, sellerKey]);

  const refusal = useMemo<DashboardRefusal[]>(() => {
    const counts: Record<string, number> = {};
    for (const f of finished) {
      if (f.result !== "recusa") continue;
      if (!sellerOk(f.operatorId)) continue;
      if (!inRange(parseTs(f.finishedAt))) continue;
      const reason = (f.reason && f.reason.trim()) || "Outros";
      counts[reason] = (counts[reason] || 0) + 1;
    }
    return Object.entries(counts)
      .map(([name, value]) => ({ name, reason: REFUSAL_REASON_PARAMS[name] || name, value }))
      .sort((a, b) => b.value - a.value);
  }, [finished, range, allSellersSelected, sellerKey]);

  const ranking = useMemo<DashboardSellerRow[]>(() => {
    const sellers = teamUsers.filter(u => u.active && u.role === "Vendedora");
    const filtered = allSellersSelected ? sellers : sellers.filter(u => sellerIds.includes(u.id));
    return filtered.map(seller => {
      const sellerFinished = finished.filter(f => f.operatorId === seller.id && inRange(parseTs(f.finishedAt)));
      const vendas = sellerFinished.filter(f => f.result === "venda").length;
      const sellerPhones = new Set(
        deals.filter(d => d.sellerId === seller.id).map(d => normalizePhone(d.phone)).filter(Boolean),
      );
      const sellerConvs = conversations.filter(c =>
        sellerPhones.has(normalizePhone(c.phone)) && inRange(parseTs(c.lastInteraction)),
      );
      const atendimentos = Math.max(sellerConvs.length, sellerFinished.length);
      const conversao = atendimentos > 0 ? Math.round((vendas / atendimentos) * 100) : 0;
      const tempoMedioSec = avgResponseFor(sellerConvs, fromMs, toMs);
      return {
        id: seller.id,
        name: seller.name,
        avatar: seller.avatar,
        atendimentos,
        vendas,
        conversao,
        tempoMedio: tempoMedioSec !== null ? formatSecondsAsMinSec(tempoMedioSec) : "—",
      };
    }).sort((a, b) => b.vendas - a.vendas || b.atendimentos - a.atendimentos);
  }, [teamUsers, finished, deals, conversations, messagesMap, range, allSellersSelected, sellerKey]);

  const critical = useMemo<DashboardCritical[]>(() => {
    const items: DashboardCritical[] = [];
    for (const c of visibleConversations) {
      if (!c.unread || c.lastMessageFromMe === true) continue;
      const deal = dealByPhone.get(normalizePhone(c.phone));
      const seller = deal?.sellerId ? teamUsers.find(u => u.id === deal.sellerId) : undefined;
      const temperature: Temperature = deal?.temperature ?? "morno";
      items.push({
        id: c.id,
        dealId: deal?.id,
        customer: c.customer || deal?.customer || c.phone,
        sellerName: seller?.name || "Sem responsável",
        lastMessage: c.lastMessage,
        lastInteraction: c.lastInteraction,
        temperature,
      });
    }
    items.sort((a, b) => parseTs(a.lastInteraction) - parseTs(b.lastInteraction));
    const hot = items.filter(i => i.temperature === "quente");
    return (hot.length > 0 ? hot : items).slice(0, 5);
  }, [visibleConversations, dealByPhone, teamUsers]);

  return {
    range,
    series,
    previousSeries,
    totals,
    previousTotals,
    refusal,
    ranking,
    critical,
    loading,
    messagesLoading,
  };
}

export { formatSecondsAsMinSec };
