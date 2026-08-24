import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Appointment, SchedulingProposal } from "@/store/crm-store";
import { CalendarClock, ChevronLeft, Send, X } from "lucide-react";
import { computeFreeTimeButtons } from "@/lib/agenda";
import { cn } from "@/lib/utils";

const WEEKDAY_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

const parseDateKey = (key: string) => {
  const m = key.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
};

const formatDayLabel = (key: string) => {
  const d = parseDateKey(key);
  if (!d) return key;
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const formatWeekdayLabel = (key: string) => {
  const d = parseDateKey(key);
  if (!d) return "";
  return WEEKDAY_SHORT[d.getDay()];
};

interface Props {
  proposal: SchedulingProposal;
  appointments: Appointment[];
  sellerId?: string;
  canSchedule: boolean;
  onPick: (dateKey: string, hour: number) => void;
  onDismiss: () => void;
  onSendDays: (days: string[]) => void;
  onSendTimes: (dateKey: string, hours: number[]) => void;
}

export function SchedulingProposalBar({ proposal, appointments, sellerId, canSchedule, onPick, onDismiss, onSendDays, onSendTimes }: Props) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const freeHours = useMemo(
    () => (selectedDay ? computeFreeTimeButtons(selectedDay, appointments, sellerId) : []),
    [selectedDay, appointments, sellerId],
  );

  return (
    <div className="border-t border-border bg-info-soft/60 px-4 py-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-info">
          <CalendarClock className="h-4 w-4" />
          {selectedDay
            ? `Escolha um horário para ${formatDayLabel(selectedDay)}`
            : "O cliente quer agendar. Escolha um dia:"}
        </div>
        <div className="flex items-center gap-1">
          {selectedDay && (
            <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={() => setSelectedDay(null)}>
              <ChevronLeft className="h-3 w-3" /> Voltar
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={onDismiss} title="Dispensar">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {!canSchedule && (
        <div className="mb-2 rounded-md bg-warning-soft px-2 py-1 text-[11px] text-warning">
          Vincule esta conversa a um lead antes de agendar.
        </div>
      )}

      {!selectedDay ? (
        <div className="grid grid-cols-6 gap-2">
          {proposal.days.map(day => (
            <button
              key={day}
              type="button"
              onClick={() => setSelectedDay(day)}
              disabled={!canSchedule}
              className={cn(
                "flex flex-col items-center justify-center rounded-lg border border-border bg-card px-2 py-2 transition",
                canSchedule ? "hover:border-primary hover:bg-primary-soft" : "opacity-50 cursor-not-allowed",
              )}
            >
              <span className="text-sm font-bold">{formatDayLabel(day)}</span>
              <span className="text-[10px] text-muted-foreground">{formatWeekdayLabel(day)}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => onSendDays(proposal.days)}
            className="flex flex-col items-center justify-center gap-1 rounded-lg border border-primary bg-primary text-primary-foreground px-2 py-2 transition hover:bg-primary/90"
            title="Enviar a lista de dias para o cliente"
          >
            <Send className="h-3.5 w-3.5" />
            <span className="text-[10px] font-semibold leading-tight text-center">Enviar dias</span>
          </button>
        </div>
      ) : freeHours.length === 0 ? (
        <div className="rounded-md bg-card p-3 text-center text-xs text-muted-foreground">
          Nenhum horário livre neste dia. Escolha outra data.
        </div>
      ) : (
        <div className="grid grid-cols-6 gap-2">
          {freeHours.map(h => (
            <button
              key={h}
              type="button"
              onClick={() => onPick(selectedDay, h)}
              disabled={!canSchedule}
              className={cn(
                "rounded-lg border border-border bg-card px-2 py-2 text-sm font-semibold transition",
                canSchedule ? "hover:border-primary hover:bg-primary-soft" : "opacity-50 cursor-not-allowed",
              )}
            >
              {String(h).padStart(2, "0")}:00
            </button>
          ))}
          <button
            type="button"
            onClick={() => onSendTimes(selectedDay, freeHours)}
            className="flex items-center justify-center gap-1 rounded-lg border border-primary bg-primary px-2 py-2 text-primary-foreground transition hover:bg-primary/90"
            title="Enviar a lista de horários para o cliente"
          >
            <Send className="h-3.5 w-3.5" />
            <span className="text-[10px] font-semibold leading-tight">Enviar horários</span>
          </button>
        </div>
      )}
    </div>
  );
}
