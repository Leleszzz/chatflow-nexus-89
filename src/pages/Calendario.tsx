import { FormEvent, MouseEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subMonths,
  subWeeks,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarClock, ChevronDown, ChevronLeft, ChevronRight, Clock, Edit3, FolderOpen, Plus, Trash2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Appointment, AppointmentType, useCRM } from "@/store/crm-store";
import { clamp, minutesFromTime, novoHorarioAoArrastar, timeFromMinutes } from "@/lib/agenda";
import { cn } from "@/lib/utils";

type CalendarView = "day" | "week" | "month";

const HOURS = Array.from({ length: 12 }, (_, index) => index + 8);
const HOUR_HEIGHT = 64;

const APPOINTMENT_TYPES: { value: AppointmentType; label: string; className: string }[] = [
  { value: "retorno", label: "Retorno", className: "bg-destructive-soft text-destructive border-destructive/20" },
  { value: "ligacao", label: "Ligação", className: "bg-info-soft text-info border-info/20" },
  { value: "reuniao", label: "Reunião", className: "bg-primary-soft text-primary border-primary/20" },
  { value: "follow-up", label: "Follow-up", className: "bg-warning-soft text-warning border-warning/20" },
  { value: "demonstracao", label: "Demonstração", className: "bg-success-soft text-success border-success/20" },
  { value: "pos-venda", label: "Pós-venda", className: "bg-success-soft text-success border-success/20" },
  { value: "retorno-comercial", label: "Retorno comercial", className: "bg-destructive-soft text-destructive border-destructive/20" },
  { value: "outro", label: "Outro", className: "bg-secondary text-foreground border-border" },
];

const toDateKey = (date: Date) => format(date, "yyyy-MM-dd");
const fromDateKey = (date: string) => {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day);
};
const formatDateTime = (appointment: Appointment) => `${format(fromDateKey(appointment.date), "dd/MM/yyyy")} às ${appointment.startTime}`;

const emptyForm = (dealId: string, sellerId: string, date = toDateKey(new Date()), startTime = "09:00", durationMinutes = 30) => ({
  title: "",
  dealId,
  date,
  startTime,
  endTime: timeFromMinutes(minutesFromTime(startTime) + durationMinutes),
  sellerId,
  description: "",
  type: "retorno" as AppointmentType,
  status: "agendado" as Appointment["status"],
  origin: "Conversa",
});

// Um agendamento na grade de horários. O arrasto é o mesmo do Kanban
// (@dnd-kit + PointerSensor), então clicar continua abrindo o cadastro: só vira
// arrasto depois de 5px de movimento.
function TimedAppointmentEvent({ appointment, top, height, typeStyle, canDrag, onOpen }: {
  appointment: Appointment;
  top: number;
  height: number;
  typeStyle?: string;
  canDrag: boolean;
  onOpen: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: appointment.id,
    disabled: !canDrag,
  });

  return (
    <button
      ref={setNodeRef}
      type="button"
      data-appointment-event="true"
      onClick={event => {
        event.stopPropagation();
        onOpen();
      }}
      {...(canDrag ? listeners : {})}
      {...(canDrag ? attributes : {})}
      className={cn(
        "pointer-events-auto absolute w-[calc(100%-8px)] rounded-md border px-2 py-1 text-left text-[11px] shadow-sm transition-shadow hover:shadow-md",
        canDrag ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
        isDragging ? "z-30 shadow-lg ring-2 ring-primary/40" : "z-10",
        typeStyle,
      )}
      style={{
        top,
        height,
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
      }}
      title={`${appointment.title} - ${appointment.startTime}`}
    >
      <div className="truncate font-semibold">{appointment.title}</div>
      <div className="truncate opacity-80">{appointment.startTime} - {appointment.endTime}</div>
    </button>
  );
}

// A mesma etiqueta, na visão de mês: lá só existe o dia, então o arrasto muda a
// data e preserva o horário.
function MonthAppointmentChip({ appointment, typeStyle, canDrag, onOpen }: {
  appointment: Appointment;
  typeStyle?: string;
  canDrag: boolean;
  onOpen: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: appointment.id,
    disabled: !canDrag,
  });

  return (
    <span
      ref={setNodeRef}
      role="button"
      tabIndex={0}
      onClick={event => {
        event.stopPropagation();
        onOpen();
      }}
      {...(canDrag ? listeners : {})}
      {...(canDrag ? attributes : {})}
      className={cn(
        "block truncate rounded border px-2 py-1 text-[11px] font-medium",
        canDrag ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
        isDragging && "relative z-30 shadow-lg ring-2 ring-primary/40",
        typeStyle,
      )}
      style={{ transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined }}
    >
      {appointment.startTime} {appointment.title}
    </span>
  );
}

// Colunas e células que recebem o agendamento solto. O id carrega a visão e a
// data — handleDragEnd lê os dois para saber se ajusta só o dia ou o horário.
function DropDayColumn({ dateKey, height, onSlotClick, children }: {
  dateKey: string;
  height: number;
  onSlotClick: (event: MouseEvent<HTMLDivElement>) => void;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `dia:${dateKey}` });
  return (
    <div
      ref={setNodeRef}
      className={cn("relative border-r border-border/70", isOver && "ring-2 ring-inset ring-primary/50")}
      onClick={onSlotClick}
      style={{ height }}
    >
      {children}
    </div>
  );
}

function DropMonthCell({ dateKey, className, onClick, children }: {
  dateKey: string;
  className: string;
  onClick: () => void;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `mes:${dateKey}` });
  return (
    <div
      ref={setNodeRef}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={event => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onClick();
      }}
      className={cn(className, isOver && "ring-2 ring-inset ring-primary/50")}
    >
      {children}
    </div>
  );
}

export default function Calendario() {
  const { appointments, addAppointment, updateAppointment, removeAppointment, deals, teamUsers, currentUser, isAdmin, canViewDeal } = useCRM();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [view, setView] = useState<CalendarView>("week");
  const [cursor, setCursor] = useState(() => new Date());
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Appointment | null>(null);
  const prefillKeyRef = useRef("");
  const selectableDeals = useMemo(() => deals.filter(canViewDeal), [canViewDeal, deals]);
  const sellerOptions = useMemo(() => teamUsers.filter(user => user.active && user.role !== "Administrador"), [teamUsers]);
  const filterSellerOptions = useMemo(() => isAdmin ? sellerOptions : sellerOptions.filter(user => user.id === currentUser?.id), [currentUser?.id, isAdmin, sellerOptions]);
  const defaultSellerId = isAdmin ? sellerOptions[0]?.id || "" : currentUser?.id || "";
  const [form, setForm] = useState(() => emptyForm(selectableDeals[0]?.id || "", defaultSellerId));
  // Mesma folga do Kanban: até 5px ainda é clique, depois vira arrasto.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  // Ao soltar, o navegador ainda dispara um `click` no ancestral comum — que na
  // grade é a própria coluna, e abriria o «novo agendamento» por cima do que
  // acabou de ser movido. Esta marca faz o clique seguinte ser ignorado.
  const dragEndedAtRef = useRef(0);
  const acabouDeArrastar = () => Date.now() - dragEndedAtRef.current < 250;
  const [filterSellerIds, setFilterSellerIds] = useState<string[]>(() => isAdmin ? [] : currentUser?.id ? [currentUser.id] : []);
  const [filterType, setFilterType] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");

  const filteredAppointments = useMemo(() => appointments.filter(appointment => {
    if (!isAdmin && appointment.sellerId !== currentUser?.id) return false;
    return (filterSellerIds.length === 0 || filterSellerIds.includes(appointment.sellerId))
      && (filterType === "all" || appointment.type === filterType)
      && (filterStatus === "all" || (appointment.status || "agendado") === filterStatus);
  }), [appointments, currentUser?.id, filterSellerIds, filterStatus, filterType, isAdmin]);

  const sortedAppointments = useMemo(
    () => [...filteredAppointments].sort((a, b) => `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`)),
    [filteredAppointments],
  );

  const sellerFilterLabel = filterSellerIds.length === 0
    ? "Todas vendedoras"
    : filterSellerIds.length === 1
      ? sellerOptions.find(seller => seller.id === filterSellerIds[0])?.name || "1 vendedora"
      : `${filterSellerIds.length} vendedoras`;

  const toggleSellerFilter = (sellerId: string) => {
    setFilterSellerIds(current => current.includes(sellerId)
      ? current.filter(id => id !== sellerId)
      : [...current, sellerId]);
  };

  const visibleTitle = useMemo(() => {
    if (view === "day") return format(cursor, "dd 'de' MMMM, yyyy", { locale: ptBR });
    if (view === "month") return format(cursor, "MMMM yyyy", { locale: ptBR });
    const start = startOfWeek(cursor, { weekStartsOn: 1 });
    const end = addDays(start, 6);
    return `${format(start, "dd MMM", { locale: ptBR })} - ${format(end, "dd MMM, yyyy", { locale: ptBR })}`;
  }, [cursor, view]);

  const openCreate = (date = toDateKey(cursor), startTime = "09:00", durationMinutes = 30) => {
    setEditing(null);
    setForm({ ...emptyForm(selectableDeals[0]?.id || "", defaultSellerId, date, startTime, durationMinutes) });
    setModalOpen(true);
  };

  useEffect(() => {
    const dealId = searchParams.get("deal");
    const prefillKey = searchParams.toString();
    if (prefillKeyRef.current === prefillKey) return;
    const deal = dealId ? selectableDeals.find(item => item.id === dealId) : null;
    const leadName = searchParams.get("lead");
    const phone = searchParams.get("phone");
    if (!deal && !leadName) return;
    prefillKeyRef.current = prefillKey;

    const date = toDateKey(new Date());
    const sellerId = deal?.sellerId || defaultSellerId;
    setEditing(null);
    setForm({
      ...emptyForm(deal?.id || selectableDeals[0]?.id || "", sellerId, date, "10:00"),
      title: `Retorno - ${deal?.customer || leadName}`,
      description: phone ? `Origem: conversa WhatsApp. Telefone: ${phone}` : "Origem: conversa WhatsApp.",
      type: "retorno",
      origin: "Conversa",
    });
    setModalOpen(true);
  }, [defaultSellerId, searchParams, selectableDeals]);

  const suggestFreeSlots = (date: string, startTime: string, sellerId: string) => {
    const start = minutesFromTime(startTime);
    const options = [start + 30, start + 60, start + 90]
      .map(timeFromMinutes)
      .filter(time => !appointments.some(appointment =>
        appointment.date === date &&
        appointment.sellerId === sellerId &&
        minutesFromTime(time) < minutesFromTime(appointment.endTime) &&
        minutesFromTime(time) + 30 > minutesFromTime(appointment.startTime)
      ))
      .slice(0, 2);
    return options;
  };

  const openEdit = (appointment: Appointment) => {
    if (acabouDeArrastar()) return;
    if (!isAdmin && appointment.sellerId !== currentUser?.id) {
      toast.info("Este agendamento é de outra vendedora e fica disponível apenas para consulta.");
      return;
    }
    setEditing(appointment);
    setForm({
      title: appointment.title,
      dealId: appointment.dealId,
      date: appointment.date,
      startTime: appointment.startTime,
      endTime: appointment.endTime,
      sellerId: appointment.sellerId,
      description: appointment.description,
      type: appointment.type,
      status: appointment.status || "agendado",
      origin: appointment.origin || "Conversa",
    });
    setModalOpen(true);
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!form.title.trim() || !form.dealId || !form.sellerId) {
      toast.error("Preencha título, lead e responsável");
      return;
    }
    if (minutesFromTime(form.endTime) <= minutesFromTime(form.startTime)) {
      toast.error("Horário final deve ser depois do inicial");
      return;
    }
    const hasConflict = appointments.some(appointment => {
      if (editing?.id === appointment.id || appointment.date !== form.date) return false;
      if (appointment.sellerId !== form.sellerId) return false;
      return minutesFromTime(form.startTime) < minutesFromTime(appointment.endTime)
        && minutesFromTime(form.endTime) > minutesFromTime(appointment.startTime);
    });

    if (hasConflict) {
      const suggestions = suggestFreeSlots(form.date, form.startTime, form.sellerId);
      toast.error(`${form.startTime} está ocupado.${suggestions.length ? ` Tente ${suggestions.join(" ou ")}.` : " Escolha outro intervalo."}`);
      return;
    }

    const payload = { ...form, sellerId: isAdmin ? form.sellerId : currentUser?.id || form.sellerId, title: form.title.trim() };

    if (editing) {
      updateAppointment(editing.id, payload);
      toast.success("Agendamento atualizado");
    } else {
      addAppointment({ ...payload, id: `appt-${Date.now()}` });
      toast.success("Agendamento criado");
    }
    setModalOpen(false);
  };

  const podeMover = (appointment: Appointment) => isAdmin || appointment.sellerId === currentUser?.id;

  const moveAppointment = (appointmentId: string, date: string, startTime?: string) => {
    const appointment = appointments.find(item => item.id === appointmentId);
    if (!appointment) return;
    if (!podeMover(appointment)) {
      toast.info("Este agendamento é de outra vendedora e fica disponível apenas para consulta.");
      return;
    }

    const patch: Partial<Appointment> = { date };
    if (startTime) {
      const duration = Math.max(15, minutesFromTime(appointment.endTime) - minutesFromTime(appointment.startTime));
      patch.startTime = startTime;
      patch.endTime = timeFromMinutes(minutesFromTime(startTime) + duration);
    }
    const nextStart = patch.startTime || appointment.startTime;
    const nextEnd = patch.endTime || appointment.endTime;
    // O choque é dentro da agenda de cada vendedora — a mesma regra do
    // formulário. Sem o recorte por responsável, o horário de uma travava o de
    // todas e o arrasto era recusado sem motivo.
    const hasConflict = appointments.some(item => item.id !== appointment.id
      && item.date === date
      && item.sellerId === appointment.sellerId
      && minutesFromTime(nextStart) < minutesFromTime(item.endTime)
      && minutesFromTime(nextEnd) > minutesFromTime(item.startTime));

    if (hasConflict) {
      toast.error("Já existe agendamento neste horário.");
      return;
    }

    updateAppointment(appointment.id, patch);
    toast.success(`Reagendado para ${format(fromDateKey(date), "dd/MM")} às ${nextStart}`);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    dragEndedAtRef.current = Date.now();

    const appointment = appointments.find(item => item.id === String(event.active.id));
    const overId = event.over ? String(event.over.id) : "";
    if (!appointment || !overId) return;

    const corte = overId.indexOf(":");
    const alvo = overId.slice(0, corte);
    const date = overId.slice(corte + 1);
    if (!date) return;

    // Mês só tem resolução de dia: mantém o horário e muda a data.
    if (alvo === "mes") {
      if (date === appointment.date) return;
      moveAppointment(appointment.id, date);
      return;
    }

    // Dia/semana: o quanto o card subiu ou desceu define o novo horário.
    const inicioDaGrade = HOURS[0] * 60;
    const startTime = novoHorarioAoArrastar({
      startTime: appointment.startTime,
      endTime: appointment.endTime,
      deltaY: event.delta.y,
      hourHeight: HOUR_HEIGHT,
      gradeInicio: inicioDaGrade,
      gradeFim: inicioDaGrade + HOURS.length * 60,
    });

    if (date === appointment.date && startTime === appointment.startTime) return;
    moveAppointment(appointment.id, date, startTime);
  };

  const handleTimedSlotClick = (event: MouseEvent<HTMLDivElement>, date: string) => {
    if (acabouDeArrastar()) return;
    if ((event.target as HTMLElement).closest("[data-appointment-event='true']")) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const minutesFromStart = (clamp(event.clientY - rect.top, 0, rect.height) / HOUR_HEIGHT) * 60;
    const dayStart = HOURS[0] * 60;
    const dayEnd = dayStart + HOURS.length * 60;
    const snappedMinutes = Math.floor(minutesFromStart / 15) * 15;
    const startTime = timeFromMinutes(clamp(dayStart + snappedMinutes, dayStart, dayEnd - 60));

    openCreate(date, startTime, 60);
  };

  const goPrevious = () => {
    if (view === "day") setCursor(prev => addDays(prev, -1));
    if (view === "week") setCursor(prev => subWeeks(prev, 1));
    if (view === "month") setCursor(prev => subMonths(prev, 1));
  };

  const goNext = () => {
    if (view === "day") setCursor(prev => addDays(prev, 1));
    if (view === "week") setCursor(prev => addWeeks(prev, 1));
    if (view === "month") setCursor(prev => addMonths(prev, 1));
  };

  const appointmentsForDate = (date: Date) => sortedAppointments.filter(appointment => appointment.date === toDateKey(date));

  const renderTimedEvents = (date: Date) => (
    <div className="pointer-events-none absolute inset-x-1 top-0 bottom-0">
      {appointmentsForDate(date).map(appointment => {
        const start = minutesFromTime(appointment.startTime);
        const end = minutesFromTime(appointment.endTime);
        const top = ((start - HOURS[0] * 60) / 60) * HOUR_HEIGHT;
        const height = Math.max(((end - start) / 60) * HOUR_HEIGHT, 34);
        return (
          <TimedAppointmentEvent
            key={appointment.id}
            appointment={appointment}
            top={top}
            height={height}
            typeStyle={APPOINTMENT_TYPES.find(type => type.value === appointment.type)?.className}
            canDrag={podeMover(appointment)}
            onOpen={() => openEdit(appointment)}
          />
        );
      })}
    </div>
  );

  const weekDays = useMemo(() => {
    const start = startOfWeek(cursor, { weekStartsOn: 1 });
    return Array.from({ length: 7 }, (_, index) => addDays(start, index));
  }, [cursor]);

  const monthDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [cursor]);

  return (
      <AppLayout title="Calendário" subtitle="Agendamentos comerciais integrados ao CRM">
      <div className="space-y-4">
        <div className="flex flex-col gap-3 rounded-xl border border-border/70 bg-card p-3 shadow-sm lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="icon" onClick={goPrevious} title="Anterior">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button type="button" variant="outline" onClick={() => setCursor(new Date())}>Hoje</Button>
            <Button type="button" variant="outline" size="icon" onClick={goNext} title="Próximo">
              <ChevronRight className="h-4 w-4" />
            </Button>
            <div className="ml-2 min-w-0 font-display text-lg font-bold capitalize">{visibleTitle}</div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="justify-between gap-2">
                  <span className="max-w-44 truncate">{sellerFilterLabel}</span>
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-[300px] p-2">
                {isAdmin && (
                  <>
                    <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-secondary">
                      <Checkbox checked={filterSellerIds.length === 0} onCheckedChange={() => setFilterSellerIds([])} />
                      <span>Todas vendedoras</span>
                    </label>
                    <div className="my-1 h-px bg-border" />
                  </>
                )}
                <div className="max-h-56 overflow-y-auto">
                  {filterSellerOptions.map(seller => (
                    <label key={seller.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-secondary">
                      <Checkbox checked={filterSellerIds.includes(seller.id)} onCheckedChange={() => toggleSellerFilter(seller.id)} />
                      <span className="truncate">{seller.name}</span>
                    </label>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="h-9 w-[150px]"><SelectValue placeholder="Tipo" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos tipos</SelectItem>
                {APPOINTMENT_TYPES.map(option => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="h-9 w-[150px]"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos status</SelectItem>
                <SelectItem value="agendado">Agendado</SelectItem>
                <SelectItem value="concluido">Concluído</SelectItem>
                <SelectItem value="cancelado">Cancelado</SelectItem>
              </SelectContent>
            </Select>
            <div className="grid grid-cols-3 rounded-lg border border-border bg-secondary/60 p-1 text-sm">
              {(["day", "week", "month"] as CalendarView[]).map(item => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setView(item)}
                  className={cn("rounded-md px-3 py-1.5 font-medium transition", view === item ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
                >
                  {item === "day" ? "Dia" : item === "week" ? "Semana" : "Mês"}
                </button>
              ))}
            </div>
            <Button type="button" className="gap-2 bg-gradient-primary" onClick={() => openCreate()}>
              <Plus className="h-4 w-4" /> Novo agendamento
            </Button>
          </div>
        </div>

        <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragEnd={handleDragEnd}>
        {view === "month" ? (
          <div className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm">
            <div className="grid grid-cols-7 border-b border-border bg-secondary/40 text-center text-xs font-semibold uppercase text-muted-foreground">
              {["Seg", "Ter", "Qua", "Qui", "Sex", "Sab", "Dom"].map(day => <div key={day} className="p-2">{day}</div>)}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-7">
              {monthDays.map(day => {
                const dayAppointments = appointmentsForDate(day);
                return (
                  <DropMonthCell
                    key={day.toISOString()}
                    dateKey={toDateKey(day)}
                    onClick={() => {
                      if (acabouDeArrastar()) return;
                      openCreate(toDateKey(day), "09:00");
                    }}
                    className={cn(
                      "min-h-28 cursor-pointer border-b border-r border-border/60 bg-card p-2 text-left transition hover:bg-secondary/50",
                      !isSameMonth(day, cursor) && "bg-secondary/30 text-muted-foreground",
                    )}
                  >
                    <div className={cn("mb-2 flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold", isSameDay(day, new Date()) && "bg-primary text-primary-foreground")}>
                      {format(day, "d")}
                    </div>
                    <div className="space-y-1">
                      {dayAppointments.slice(0, 3).map(appointment => (
                        <MonthAppointmentChip
                          key={appointment.id}
                          appointment={appointment}
                          typeStyle={APPOINTMENT_TYPES.find(type => type.value === appointment.type)?.className}
                          canDrag={podeMover(appointment)}
                          onOpen={() => openEdit(appointment)}
                        />
                      ))}
                      {dayAppointments.length > 3 && <div className="text-[11px] text-muted-foreground">+{dayAppointments.length - 3} agendamentos</div>}
                    </div>
                  </DropMonthCell>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border/70 bg-card shadow-sm scrollbar-thin">
            <div className="min-w-[760px]">
              <div
                className="grid"
                style={{ gridTemplateColumns: `72px repeat(${view === "day" ? 1 : 7}, minmax(120px, 1fr))` }}
              >
                <div className="border-b border-r border-border bg-secondary/40 p-3" />
                {(view === "day" ? [cursor] : weekDays).map(day => (
                  <button
                    key={day.toISOString()}
                    type="button"
                    onClick={() => setCursor(day)}
                    className="border-b border-r border-border bg-secondary/40 p-3 text-left hover:bg-secondary"
                  >
                    <div className="text-xs font-semibold uppercase text-muted-foreground">{format(day, "EEE", { locale: ptBR })}</div>
                    <div className={cn("mt-1 inline-flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold", isSameDay(day, new Date()) && "bg-primary text-primary-foreground")}>
                      {format(day, "d")}
                    </div>
                  </button>
                ))}
              </div>

              <div
                className="grid"
                style={{ gridTemplateColumns: `72px repeat(${view === "day" ? 1 : 7}, minmax(120px, 1fr))` }}
              >
                <div className="border-r border-border">
                  {HOURS.map(hour => (
                    <div key={hour} className="h-16 border-b border-border/70 px-3 pt-2 text-right text-xs font-medium text-muted-foreground">
                      {String(hour).padStart(2, "0")}:00
                    </div>
                  ))}
                </div>

                {(view === "day" ? [cursor] : weekDays).map(day => (
                  <DropDayColumn
                    key={day.toISOString()}
                    dateKey={toDateKey(day)}
                    height={HOURS.length * HOUR_HEIGHT}
                    onSlotClick={event => handleTimedSlotClick(event, toDateKey(day))}
                  >
                    {HOURS.map(hour => (
                      <div
                        key={hour}
                        className="h-16 w-full border-b border-border/70 bg-card hover:bg-secondary/40"
                      />
                    ))}
                    {renderTimedEvents(day)}
                  </DropDayColumn>
                ))}
              </div>
            </div>
          </div>
        )}
        </DndContext>

        <div className="grid gap-3 lg:grid-cols-3">
          {sortedAppointments.slice(0, 6).map(appointment => {
            const deal = deals.find(item => item.id === appointment.dealId);
            const seller = teamUsers.find(item => item.id === appointment.sellerId);
            const typeLabel = APPOINTMENT_TYPES.find(type => type.value === appointment.type)?.label || "Outro";
            return (
              <button
                key={appointment.id}
                type="button"
                onClick={() => openEdit(appointment)}
                className="rounded-xl border border-border/70 bg-card p-4 text-left shadow-sm transition hover:border-primary/25 hover:shadow-md"
              >
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{appointment.title}</div>
                    <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" />
                      {formatDateTime(appointment)}
                    </div>
                  </div>
                  <Edit3 className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <UserRound className="h-3.5 w-3.5" />
                  <span className="truncate">{deal?.customer}</span>
                  <span className="h-1 w-1 rounded-full bg-muted-foreground/50" />
                  <span className="truncate">{seller?.name}</span>
                  <span className="h-1 w-1 rounded-full bg-muted-foreground/50" />
                  <span className="truncate">{typeLabel} · {appointment.status || "agendado"}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarClock className="h-5 w-5 text-primary" />
              {editing ? "Detalhes do agendamento" : "Novo agendamento"}
            </DialogTitle>
            <DialogDescription>Associe o compromisso a um lead existente no CRM.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label htmlFor="appointment-title">Título do agendamento</Label>
                <Input id="appointment-title" value={form.title} onChange={event => setForm(prev => ({ ...prev, title: event.target.value }))} />
              </div>
              <div>
                <Label>Lead/cliente relacionado</Label>
                <Select value={form.dealId} onValueChange={dealId => setForm(prev => ({ ...prev, dealId }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {selectableDeals.map(deal => <SelectItem key={deal.id} value={deal.id}>{deal.customer}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Responsável/vendedora</Label>
                <Select value={isAdmin ? form.sellerId : currentUser?.id || form.sellerId} onValueChange={sellerId => setForm(prev => ({ ...prev, sellerId }))} disabled={!isAdmin}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {sellerOptions.map(seller => <SelectItem key={seller.id} value={seller.id}>{seller.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="appointment-date">Data</Label>
                <Input id="appointment-date" type="date" value={form.date} onChange={event => setForm(prev => ({ ...prev, date: event.target.value }))} />
              </div>
              <div>
                <Label htmlFor="appointment-start">Horário inicial</Label>
                <Input id="appointment-start" type="time" value={form.startTime} onChange={event => setForm(prev => ({ ...prev, startTime: event.target.value }))} />
              </div>
              <div>
                <Label htmlFor="appointment-end">Horário final</Label>
                <Input id="appointment-end" type="time" value={form.endTime} onChange={event => setForm(prev => ({ ...prev, endTime: event.target.value }))} />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="appointment-description">Descrição/observações</Label>
                <Textarea id="appointment-description" rows={4} value={form.description} onChange={event => setForm(prev => ({ ...prev, description: event.target.value }))} />
              </div>
            </div>
            <DialogFooter className="gap-2 sm:justify-between sm:space-x-0">
              <div className="flex flex-wrap gap-2">
                {editing && (
                  <Button
                    type="button"
                    variant="outline"
                    className="gap-2 text-destructive hover:text-destructive"
                    onClick={() => {
                      removeAppointment(editing.id);
                      setModalOpen(false);
                      toast.success("Agendamento excluído");
                    }}
                  >
                    <Trash2 className="h-4 w-4" /> Excluir
                  </Button>
                )}
                {form.dealId && (
                  <Button
                    type="button"
                    variant="outline"
                    className="gap-2"
                    onClick={() => {
                      setModalOpen(false);
                      navigate(`/prontuarios?dealId=${encodeURIComponent(form.dealId)}`);
                    }}
                  >
                    <FolderOpen className="h-4 w-4" /> Prontuário
                  </Button>
                )}
              </div>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>Cancelar</Button>
                <Button type="submit" className="bg-gradient-primary">{editing ? "Salvar alterações" : "Criar agendamento"}</Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
