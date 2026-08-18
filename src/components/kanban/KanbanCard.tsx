import { useDraggable } from "@dnd-kit/core";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Deal } from "@/lib/mock-data";
import { ClientTemperatureBadge, TagBadge } from "@/components/shared/Badges";
import { Clock, Phone } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Appointment, useCRM } from "@/store/crm-store";
import { cn } from "@/lib/utils";

const initials = (name: string) => (name || "").trim().slice(0, 2).toUpperCase() || "?";

export function KanbanCard({ deal, avatarUrl, onClick, draggable = true }: { deal: Deal; avatarUrl?: string; nextAppointment?: Appointment; onClick: () => void; draggable?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: deal.id, disabled: !draggable });
  const { teamUsers } = useCRM();
  const sellerIds = Array.from(new Set([deal.sellerId, ...(deal.assignedSellerIds || [])].filter(Boolean)));
  const linkedSellers = sellerIds.map(id => teamUsers.find(seller => seller.id === id)).filter(Boolean);
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(draggable ? listeners : {})}
      {...(draggable ? attributes : {})}
      onClick={onClick}
      className={cn(
        "group cursor-grab rounded-xl border border-border/70 bg-card p-3 shadow-sm transition-all hover:border-primary/25 hover:shadow-soft active:cursor-grabbing",
        isDragging ? "rotate-1 opacity-60 ring-2 ring-primary/30" : "",
      )}
    >
      <div className="mb-2 flex items-start gap-2">
        <Avatar className="h-9 w-9 shrink-0">
          {avatarUrl && <AvatarImage src={avatarUrl} alt={deal.customer} />}
          <AvatarFallback className="bg-gradient-primary text-[10px] font-semibold text-primary-foreground">{initials(deal.customer)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{deal.customer}</div>
          <div className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
            <Phone className="h-3 w-3" />
            <span className="truncate">{deal.phone}</span>
          </div>
        </div>
        {deal.unread && <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-destructive" title="Cliente aguardando" />}
      </div>

      <div className="mb-2 rounded-lg bg-secondary/60 p-2">
        <div className="text-[10px] font-semibold uppercase text-muted-foreground">Interesse</div>
        <div className="line-clamp-2 text-xs text-foreground">{deal.interest || deal.lastMessage || "Nao informado"}</div>
      </div>

      <div className="mb-2 flex flex-wrap gap-1">
        {deal.tags.length ? deal.tags.slice(0, 3).map(tag => <TagBadge key={tag} label={tag} />) : <span className="text-[10px] text-muted-foreground">Sem tags</span>}
        {deal.tags.length > 3 && <span className="text-[10px] text-muted-foreground">+{deal.tags.length - 3}</span>}
      </div>

      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          {linkedSellers.slice(0, 3).map(seller => (
            <Avatar key={seller.id} className="h-5 w-5">
              <AvatarImage src={seller.photoUrl} alt={seller.name} />
              <AvatarFallback className="bg-primary-soft text-[9px] font-semibold text-primary">{seller.avatar}</AvatarFallback>
            </Avatar>
          ))}
          <span className="truncate text-[10px] text-muted-foreground">
            {linkedSellers.length ? linkedSellers.map(seller => seller.name.split(" ")[0]).join(", ") : "Sem vendedor"}
          </span>
        </div>
        <ClientTemperatureBadge temp={deal.temperature} />
      </div>

      <div className="flex items-center gap-1 border-t border-border/40 pt-2 text-[10px] text-muted-foreground">
        <Clock className="h-2.5 w-2.5" />
        Ultima interacao {formatDistanceToNow(new Date(deal.lastInteraction), { locale: ptBR, addSuffix: true })}
      </div>
    </div>
  );
}
