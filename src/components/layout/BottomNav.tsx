import { NavLink } from "react-router-dom";
import { LayoutDashboard, Kanban, MessageSquare, CalendarDays, ClipboardList, FolderOpen, Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCRM } from "@/store/crm-store";
import { canRoleAccess } from "@/lib/roles";
import { useInternalUnreadBadge } from "@/hooks/useInternalChat";

// Ordem de preferência dos atalhos da barra inferior. Pegamos os 4 primeiros
// que o cargo pode acessar — o doutor não tem /kanban, então pula pro próximo.
// A tabela de acesso é a mesma da Sidebar e do guard de rota (@/lib/roles).
const CANDIDATOS: { to: string; label: string; icon: typeof LayoutDashboard; end?: boolean }[] = [
  { to: "/conversas", label: "Conversas", icon: MessageSquare },
  { to: "/kanban", label: "Kanban", icon: Kanban },
  { to: "/calendario", label: "Agenda", icon: CalendarDays },
  { to: "/", label: "Painel", icon: LayoutDashboard, end: true },
  { to: "/secretaria", label: "Tarefas", icon: ClipboardList },
  { to: "/prontuarios", label: "Fichas", icon: FolderOpen },
];

export function BottomNav({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { currentUser } = useCRM();
  // O chat interno não cabe nos 4 atalhos, então o badge dele vive no "Mais" —
  // senão o usuário só descobre mensagem nova abrindo o menu.
  const internalUnread = useInternalUnreadBadge(currentUser?.id);
  const items = CANDIDATOS.filter(item => canRoleAccess(currentUser?.role, item.to)).slice(0, 4);

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 pb-safe backdrop-blur-xl md:hidden">
      <div className="flex items-stretch">
        {items.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1.5 transition-colors",
                isActive ? "text-primary" : "text-muted-foreground",
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon className={cn("h-5 w-5", isActive && "stroke-[2.5]")} />
                <span className="text-[10px] font-medium leading-none">{label}</span>
              </>
            )}
          </NavLink>
        ))}

        <button
          type="button"
          onClick={onOpenMenu}
          aria-label="Abrir menu completo"
          className="relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-muted-foreground"
        >
          <Menu className="h-5 w-5" />
          <span className="text-[10px] font-medium leading-none">Mais</span>
          {internalUnread > 0 && (
            <span className="absolute right-[22%] top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold text-destructive-foreground">
              {internalUnread > 9 ? "9+" : internalUnread}
            </span>
          )}
        </button>
      </div>
    </nav>
  );
}
