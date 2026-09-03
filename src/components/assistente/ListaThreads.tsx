import { MoreVertical, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { AssistantThread } from "@/lib/whatsapp-api";
import { cn } from "@/lib/utils";

const quando = (iso: string | null) => {
  if (!iso) return "";
  const data = new Date(iso);
  const hoje = new Date();
  const mesmoDia = data.toDateString() === hoje.toDateString();
  return mesmoDia
    ? data.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : data.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
};

export function ListaThreads({
  threads, ativa, onSelecionar, onNova, onExcluir, className,
}: {
  threads: AssistantThread[];
  ativa: string | null;
  onSelecionar: (id: string) => void;
  onNova: () => void;
  onExcluir: (id: string) => void;
  className?: string;
}) {
  return (
    <aside className={cn("flex flex-col border-border", className)}>
      <div className="border-b border-border p-3">
        <Button onClick={onNova} className="w-full gap-2" size="sm">
          <Plus className="h-4 w-4" />
          Nova conversa
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-2 scrollbar-thin">
        {threads.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            Suas conversas com o assistente ficam guardadas aqui.
          </p>
        ) : (
          <ul className="space-y-1">
            {threads.map(thread => (
              <li key={thread.id} className="group relative">
                <button
                  type="button"
                  onClick={() => onSelecionar(thread.id)}
                  className={cn(
                    "w-full rounded-lg px-3 py-2 pr-8 text-left transition",
                    thread.id === ativa ? "bg-primary-soft text-primary" : "hover:bg-secondary",
                  )}
                >
                  <div className="truncate text-sm font-medium">{thread.titulo}</div>
                  <div className="text-[11px] text-muted-foreground">{quando(thread.lastMessageAt)}</div>
                </button>

                {/* Popover no lugar de dropdown-menu: o projeto não tem esse
                    componente shadcn, e o padrão da casa (ver o menu "⋮" de
                    Conversas) é justamente Popover + botões. */}
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="ghost"
                      size="iconSm"
                      className="absolute right-1 top-1.5 opacity-0 transition group-hover:opacity-100 data-[state=open]:opacity-100"
                      title="Opções da conversa"
                    >
                      <MoreVertical className="h-3.5 w-3.5" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-44 p-1">
                    <button
                      type="button"
                      onClick={() => onExcluir(thread.id)}
                      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-destructive hover:bg-destructive-soft"
                    >
                      <Trash2 className="h-4 w-4" />
                      Excluir conversa
                    </button>
                  </PopoverContent>
                </Popover>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
