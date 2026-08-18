import { useEffect, useMemo, useRef, useState, WheelEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { DndContext, DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { useCRM } from "@/store/crm-store";
import { useWhatsAppConversations } from "@/hooks/useWhatsAppConversations";
import { Deal, DealStage } from "@/lib/mock-data";
import { KanbanColumn } from "@/components/kanban/KanbanColumn";
import { KanbanCard } from "@/components/kanban/KanbanCard";
import { DealDetailSheet } from "@/components/kanban/DealDetailSheet";
import { FinishDealModal } from "@/components/kanban/FinishDealModal";
import { NewDealModal } from "@/components/kanban/NewDealModal";
import { StageManagerDialog } from "@/components/kanban/StageManagerDialog";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ChevronDown, Plus, Search, Settings2, X } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function Kanban() {
  const { deals, moveDeal, stages, removeStage, appointments, canViewDeal, isAdmin, teamUsers, tags, conversationPatches } = useCRM();
  const { conversations: waConversations } = useWhatsAppConversations();
  const [searchParams, setSearchParams] = useSearchParams();
  const boardRef = useRef<HTMLDivElement>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [selected, setSelected] = useState<Deal | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const [newDealOpen, setNewDealOpen] = useState(false);
  const [stagesOpen, setStagesOpen] = useState(false);
  const [filterSellerIds, setFilterSellerIds] = useState<string[]>([]);
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [filterWaiting, setFilterWaiting] = useState("all");
  const [filterTemperature, setFilterTemperature] = useState(searchParams.get("temp") || "all");
  const [filterStart, setFilterStart] = useState("");
  const [filterEnd, setFilterEnd] = useState("");
  // Busca por cliente — disponível para todos, não só admin, e independente
  // dos filtros do funil.
  const [search, setSearch] = useState("");
  const selectedDeal = selected ? deals.find(deal => deal.id === selected.id) || selected : null;
  const openDealId = searchParams.get("deal");
  const sellerOptions = useMemo(() => teamUsers.filter(user => user.active && user.role !== "Administrador"), [teamUsers]);
  const activeFilters = [filterSellerIds.length > 0, filterTags.length > 0, filterWaiting !== "all", filterTemperature !== "all", Boolean(filterStart), Boolean(filterEnd)]
    .filter(Boolean).length;
  const sellerFilterLabel = filterSellerIds.length === 0
    ? "Todas"
    : filterSellerIds.length === 1
      ? sellerOptions.find(user => user.id === filterSellerIds[0])?.name || "1 vendedora"
      : `${filterSellerIds.length} vendedoras`;
  const tagFilterLabel = filterTags.length === 0
    ? "Todas"
    : filterTags.length === 1
      ? filterTags[0]
      : `${filterTags.length} tags`;

  const toggleSellerFilter = (sellerId: string) => {
    setFilterSellerIds(current => current.includes(sellerId)
      ? current.filter(id => id !== sellerId)
      : [...current, sellerId]);
  };

  const toggleTagFilter = (tag: string) => {
    setFilterTags(current => current.includes(tag)
      ? current.filter(item => item !== tag)
      : [...current, tag]);
  };

  const visibleDeals = useMemo(() => {
    const start = filterStart ? new Date(`${filterStart}T00:00:00`).getTime() : null;
    const end = filterEnd ? new Date(`${filterEnd}T23:59:59`).getTime() : null;
    const term = search.toLowerCase().trim();
    // Só dígitos: deixa achar "11 98765" digitando "1198765".
    const digits = term.replace(/\D/g, "");

    return deals.filter(deal => {
      const interaction = new Date(deal.lastInteraction).getTime();
      const responsibleIds = [deal.sellerId, ...(deal.assignedSellerIds || [])];
      const matchesSearch = !term
        || deal.customer.toLowerCase().includes(term)
        || deal.phone.toLowerCase().includes(term)
        || (digits.length >= 3 && deal.phone.replace(/\D/g, "").includes(digits))
        || deal.tags.some(tag => tag.toLowerCase().includes(term))
        || (deal.interest || "").toLowerCase().includes(term)
        || (deal.notes || "").toLowerCase().includes(term);
      return canViewDeal(deal)
        && matchesSearch
        && (!isAdmin || filterSellerIds.length === 0 || filterSellerIds.some(id => responsibleIds.includes(id)))
        && (!isAdmin || filterTags.length === 0 || filterTags.some(tag => deal.tags.includes(tag)))
        && (!isAdmin || filterWaiting === "all" || (filterWaiting === "cliente-aguardando" ? deal.unread : !deal.unread))
        && (filterTemperature === "all" || deal.temperature === filterTemperature)
        && (!isAdmin || !start || interaction >= start)
        && (!isAdmin || !end || interaction <= end);
    });
  }, [canViewDeal, deals, filterEnd, filterSellerIds, filterStart, filterTags, filterTemperature, filterWaiting, isAdmin, search]);

  const grouped = useMemo(() => {
    const map = new Map<DealStage, Deal[]>();
    stages.forEach(s => map.set(s.id, []));
    visibleDeals.forEach(d => map.get(d.stage)?.push(d));
    return map;
  }, [visibleDeals, stages]);

  // Foto do contato (avatar da conversa do WhatsApp) por deal. O vínculo deal<->conversa
  // vem do patch (patch.dealId); o telefone é um fallback quando o patch não existe.
  const avatarByDeal = useMemo(() => {
    const byDealId = new Map<string, string>();
    const byPhone = new Map<string, string>();
    for (const wa of waConversations) {
      if (!wa.avatarUrl) continue;
      const dealId = conversationPatches[wa.id]?.dealId;
      if (dealId) byDealId.set(dealId, wa.avatarUrl);
      const digits = (wa.phone || "").replace(/\D/g, "");
      if (digits) byPhone.set(digits, wa.avatarUrl);
    }
    return { byDealId, byPhone };
  }, [waConversations, conversationPatches]);

  const avatarForDeal = (deal: Deal) =>
    avatarByDeal.byDealId.get(deal.id) || avatarByDeal.byPhone.get((deal.phone || "").replace(/\D/g, "")) || undefined;

  const nextAppointmentByDeal = useMemo(() => {
    const now = new Date();
    const map = new Map<string, typeof appointments[number]>();
    appointments
      .filter(appointment => new Date(`${appointment.date}T${appointment.startTime}`) >= now)
      .sort((a, b) => `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`))
      .forEach(appointment => {
        if (!map.has(appointment.dealId)) map.set(appointment.dealId, appointment);
      });
    return map;
  }, [appointments]);

  useEffect(() => {
    if (!openDealId) return;
    const deal = deals.find(item => item.id === openDealId && canViewDeal(item));
    if (!deal) return;
    setSelected(deal);
    setSheetOpen(true);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("deal");
    setSearchParams(nextParams, { replace: true });
  }, [canViewDeal, deals, openDealId, searchParams, setSearchParams]);

  const handleRemoveStage = (id: string, title: string, count: number) => {
    if (!isAdmin) {
      toast.error("Somente administradores editam etapas");
      return;
    }
    if (id === "fechado" || id === "perdido") {
      toast.error("Esta etapa é usada para finalizar atendimentos e não pode ser removida");
      return;
    }
    const message = count > 0
      ? `Remover "${title}"? Os ${count} leads desta etapa serão movidos para a primeira etapa do funil.`
      : `Remover "${title}"?`;
    if (!window.confirm(message)) return;
    removeStage(id);
    toast.success("Etapa removida");
  };

  const handleDragEnd = (e: DragEndEvent) => {
    const dealId = e.active.id as string;
    const newStage = e.over?.id as DealStage | undefined;
    if (!newStage) return;
    const deal = visibleDeals.find(d => d.id === dealId);
    if (!deal || deal.stage === newStage) return;
    if (newStage === "fechado" || newStage === "perdido") {
      setSelected(deal);
      setFinishOpen(true);
      return;
    }
    moveDeal(dealId, newStage);
    toast.success(`Movido para ${stages.find(s => s.id === newStage)?.title}`);
  };

  const handleBoardWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;

    const columnScroll = (event.target as HTMLElement).closest<HTMLElement>("[data-kanban-column-scroll='true']");
    if (columnScroll) {
      return;
    }

    const board = boardRef.current;
    if (!board) return;

    event.preventDefault();
    board.scrollLeft += event.deltaY;
  };

  return (
    <AppLayout title="Kanban Comercial" subtitle="Arraste os cards entre as colunas">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Buscar cliente..."
              className="border-transparent bg-secondary pl-9 pr-8"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                title="Limpar busca"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="shrink-0 text-sm text-muted-foreground">
            {visibleDeals.length} {visibleDeals.length === 1 ? "conversa" : "conversas"} no funil
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="icon" className="relative" title="Filtros">
                    <Settings2 className="h-4 w-4" />
                    {activeFilters > 0 && (
                      <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                        {activeFilters}
                      </span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-[340px] p-4">
                  <div className="mb-3">
                    <div className="text-sm font-semibold">Filtros do funil</div>
                    <div className="text-xs text-muted-foreground">Refine a visualização dos leads.</div>
                  </div>
                  <div className="grid gap-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs">Periodo inicial</Label>
                        <Input type="date" value={filterStart} onChange={event => setFilterStart(event.target.value)} />
                      </div>
                      <div>
                        <Label className="text-xs">Periodo final</Label>
                        <Input type="date" value={filterEnd} onChange={event => setFilterEnd(event.target.value)} />
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs">Vendedora</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" className="h-10 w-full justify-between bg-background font-normal">
                            <span className="truncate">{sellerFilterLabel}</span>
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent align="start" className="w-[300px] p-2">
                          <label className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-secondary">
                            <Checkbox checked={filterSellerIds.length === 0} onCheckedChange={() => setFilterSellerIds([])} aria-label="Selecionar todas vendedoras" />
                            <span>Todas</span>
                          </label>
                          <div className="my-1 h-px bg-border" />
                          <div className="max-h-48 overflow-y-auto pr-1">
                            {sellerOptions.map(user => (
                              <label key={user.id} className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-secondary">
                                <Checkbox checked={filterSellerIds.includes(user.id)} onCheckedChange={() => toggleSellerFilter(user.id)} aria-label={`Selecionar ${user.name}`} />
                                <span className="truncate">{user.name}</span>
                              </label>
                            ))}
                          </div>
                        </PopoverContent>
                      </Popover>
                    </div>
                    <div>
                      <Label className="text-xs">Tag</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" className="h-10 w-full justify-between bg-background font-normal">
                            <span className="truncate">{tagFilterLabel}</span>
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent align="start" className="w-[300px] p-2">
                          <label className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-secondary">
                            <Checkbox checked={filterTags.length === 0} onCheckedChange={() => setFilterTags([])} aria-label="Selecionar todas tags" />
                            <span>Todas</span>
                          </label>
                          <div className="my-1 h-px bg-border" />
                          <div className="max-h-48 overflow-y-auto pr-1">
                            {tags.map(tag => (
                              <label key={tag} className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-secondary">
                                <Checkbox checked={filterTags.includes(tag)} onCheckedChange={() => toggleTagFilter(tag)} aria-label={`Selecionar tag ${tag}`} />
                                <span className="truncate">{tag}</span>
                              </label>
                            ))}
                          </div>
                        </PopoverContent>
                      </Popover>
                    </div>
                    <div>
                      <Label className="text-xs">Temperatura</Label>
                      <Select value={filterTemperature} onValueChange={setFilterTemperature}>
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
                      <Label className="text-xs">Retorno</Label>
                      <Select value={filterWaiting} onValueChange={setFilterWaiting}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Todos</SelectItem>
                          <SelectItem value="cliente-aguardando">Cliente aguardando</SelectItem>
                          <SelectItem value="aguardando-cliente">Aguardando cliente</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Button variant="outline" className="w-full" onClick={() => { setFilterStart(""); setFilterEnd(""); setFilterSellerIds([]); setFilterTags([]); setFilterTemperature("all"); setFilterWaiting("all"); }}>
                      Limpar filtros
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
              {stages.length === 0 && (
                <Button variant="outline" size="icon" title="Adicionar etapa" onClick={() => setStagesOpen(true)}>
                  <Plus className="h-4 w-4" />
                </Button>
              )}
            </>
          )}
          <Button className="bg-gradient-primary gap-2" onClick={() => setNewDealOpen(true)}>
            <Plus className="w-4 h-4" /> Criar atendimento
          </Button>
        </div>
      </div>
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div
          ref={boardRef}
          onWheel={handleBoardWheel}
          className="flex h-[calc(100vh-13.5rem)] min-h-[420px] gap-4 overflow-x-auto overflow-y-hidden overscroll-x-contain pb-4 scrollbar-thin -mx-6 lg:-mx-8 px-6 lg:px-8"
        >
          {stages.map(s => (
            <KanbanColumn
              key={s.id}
              id={s.id}
              title={s.title}
              color={s.color}
              count={grouped.get(s.id)?.length || 0}
              totalValue={(grouped.get(s.id) || []).reduce((sum, deal) => sum + (deal.estimatedValue || 0), 0)}
              canManageStages={isAdmin}
              onRename={() => setStagesOpen(true)}
              onRemove={() => handleRemoveStage(s.id, s.title, grouped.get(s.id)?.length || 0)}
            >
              {grouped.get(s.id)?.map(d => (
                <KanbanCard key={d.id} deal={d} avatarUrl={avatarForDeal(d)} nextAppointment={nextAppointmentByDeal.get(d.id)} draggable onClick={() => { setSelected(d); setSheetOpen(true); }} />
              ))}
            </KanbanColumn>
          ))}
        </div>
      </DndContext>

      <DealDetailSheet deal={selectedDeal} open={sheetOpen} onOpenChange={setSheetOpen}
        onFinish={() => { setSheetOpen(false); setFinishOpen(true); }} />
      <FinishDealModal deal={selectedDeal} open={finishOpen} onOpenChange={setFinishOpen} />
      <NewDealModal open={newDealOpen} onOpenChange={setNewDealOpen} />
      <StageManagerDialog open={stagesOpen} onOpenChange={setStagesOpen} />
    </AppLayout>
  );
}
