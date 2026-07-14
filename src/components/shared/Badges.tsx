import { cn } from "@/lib/utils";
import { AlertTriangle, CheckCircle2, Clock3, Flame, PauseCircle, Snowflake, Thermometer, X } from "lucide-react";
import { Temperature } from "@/lib/mock-data";

export type ConversationStatus = "nova" | "sem-resposta" | "em-atendimento" | "aguardando-cliente" | "finalizada" | "lead-parado";

const statusConfig: Record<ConversationStatus, { label: string; cls: string; icon: typeof Clock3 }> = {
  "nova": { label: "Nova", icon: Clock3, cls: "bg-info-soft text-info" },
  "sem-resposta": { label: "Sem resposta", icon: AlertTriangle, cls: "bg-destructive-soft text-destructive" },
  "em-atendimento": { label: "Em atendimento", icon: Clock3, cls: "bg-primary-soft text-primary" },
  "aguardando-cliente": { label: "Aguardando cliente", icon: PauseCircle, cls: "bg-warning-soft text-warning" },
  "finalizada": { label: "Finalizada", icon: CheckCircle2, cls: "bg-success-soft text-success" },
  "lead-parado": { label: "Lead parado", icon: AlertTriangle, cls: "bg-warning-soft text-warning" },
};

export function ClientTemperatureBadge({ temp, size = "sm" }: { temp: Temperature; size?: "sm" | "md" }) {
  const cfg = {
    quente: { label: "Quente", icon: Flame, cls: "bg-hot-soft text-hot" },
    morno: { label: "Morno", icon: Thermometer, cls: "bg-warm-soft text-warm" },
    frio: { label: "Frio", icon: Snowflake, cls: "bg-cold-soft text-cold" },
  }[temp];
  const Icon = cfg.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full font-semibold", cfg.cls,
      size === "sm" ? "text-[10px] px-2 py-0.5" : "text-xs px-2.5 py-1")}>
      <Icon className="w-3 h-3" /> {cfg.label}
    </span>
  );
}

export function TagBadge({ label, onRemove }: { label: string; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-primary-soft text-primary text-[10px] font-semibold px-2 py-0.5">
      {label}
      {onRemove && (
        <button onClick={onRemove} className="hover:text-primary/70"><X className="w-2.5 h-2.5" /></button>
      )}
    </span>
  );
}

export function StatusBadge({ status }: { status: ConversationStatus }) {
  const cfg = statusConfig[status];
  const Icon = cfg.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold", cfg.cls)}>
      <Icon className="h-3 w-3" /> {cfg.label}
    </span>
  );
}
