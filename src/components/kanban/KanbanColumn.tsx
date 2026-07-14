import { useDroppable } from "@dnd-kit/core";
import { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2 } from "lucide-react";
import { headerClassFor } from "@/lib/kanban-colors";

const formatBRL = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

export function KanbanColumn({ id, title, count, color, totalValue, canManageStages = false, onRename, onRemove, children }: {
  id: string;
  title: string;
  count: number;
  color: string;
  totalValue: number;
  canManageStages?: boolean;
  onRename: () => void;
  onRemove: () => void;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div className="flex h-full min-h-0 w-72 flex-shrink-0 flex-col">
      <div className={cn("mb-3 rounded-xl border border-border/70 px-3 py-3 shadow-sm", headerClassFor(color))}>
        <div className="relative flex min-h-7 items-center justify-center px-14">
          <h3 className="min-w-0 max-w-full text-center text-sm font-semibold leading-tight truncate">{title}</h3>
          {canManageStages && (
            <div className="absolute right-0 flex justify-end gap-1">
              <Button type="button" size="icon" variant="ghost" className="h-6 w-6 text-current hover:text-current" title="Editar etapa" onClick={onRename}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button type="button" size="icon" variant="ghost" className="h-6 w-6 text-current hover:text-current" title="Remover etapa" onClick={onRemove}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>
        {id === "fechado" && (
          <div className="mt-1 text-center text-[11px] font-medium text-current opacity-80">
            Total: {formatBRL(totalValue)}
          </div>
        )}
        <div className="mt-1 text-center text-[11px] text-current opacity-80">
          {count} {count === 1 ? "negócio" : "negócios"}
        </div>
      </div>
      <div ref={setNodeRef}
        data-kanban-column-scroll="true"
        className={cn("min-h-[200px] flex-1 space-y-2 overflow-y-auto overscroll-contain rounded-2xl p-2 pr-1 transition-colors scrollbar-thin",
          isOver ? "bg-primary-soft border-2 border-dashed border-primary" : "bg-secondary/40 border-2 border-dashed border-transparent")}>
        {children}
        {count === 0 && (
          <div className="flex h-28 items-center justify-center rounded-xl border border-dashed border-border bg-card/70 px-4 text-center text-xs text-muted-foreground">
            Nenhum lead nesta etapa.
          </div>
        )}
      </div>
    </div>
  );
}
