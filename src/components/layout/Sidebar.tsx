import { NavLink } from "react-router-dom";
import { LayoutDashboard, Kanban, MessageSquare, CalendarDays, Bot, BarChart3, Settings, Sparkles, Smartphone, Megaphone, Users, UsersRound, X, FolderOpen, Stethoscope, ClipboardList } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCRM } from "@/store/crm-store";
import { canRoleAccess } from "@/lib/roles";
import { useInternalUnreadBadge } from "@/hooks/useInternalChat";
import { Button } from "@/components/ui/button";

// O que cada item exige vem de ROUTE_ROLES (@/lib/roles) — a mesma tabela do
// guard de rota, para o menu nunca mostrar uma página que o guard vai barrar.
const sections: {
  title: string;
  items: { to: string; label: string; icon: typeof LayoutDashboard; end?: boolean }[];
}[] = [
  {
    title: "Atendimento",
    items: [
      { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
      { to: "/conversas", label: "Conversas", icon: MessageSquare },
      { to: "/equipe", label: "Equipe", icon: UsersRound },
      { to: "/kanban", label: "Kanban", icon: Kanban },
      { to: "/calendario", label: "Calendário", icon: CalendarDays },
      { to: "/prontuarios", label: "Prontuários", icon: FolderOpen },
      { to: "/consultas", label: "Consultas", icon: Stethoscope },
      { to: "/secretaria", label: "Secretaria", icon: ClipboardList },
    ],
  },
  {
    title: "Automação",
    items: [
      { to: "/agentes", label: "Agentes", icon: Bot },
      { to: "/campanhas", label: "Campanhas", icon: Megaphone },
    ],
  },
  {
    title: "Gestão",
    items: [
      { to: "/relatorios", label: "Relatórios", icon: BarChart3 },
      { to: "/usuarios", label: "Usuários", icon: Users },
      { to: "/instancias", label: "Instâncias", icon: Smartphone },
      { to: "/configuracoes", label: "Configurações", icon: Settings },
    ],
  },
];

export function Sidebar({ mobile = false, onClose }: { mobile?: boolean; onClose?: () => void }) {
  const { currentUser } = useCRM();
  // Não-lidas do chat interno, para o usuário ver que tem mensagem sem estar na página.
  const internalUnread = useInternalUnreadBadge(currentUser?.id);
  const visibleSections = sections
    .map(section => ({ ...section, items: section.items.filter(item => canRoleAccess(currentUser?.role, item.to)) }))
    .filter(section => section.items.length > 0);

  return (
    // No mobile quem controla a largura é o SheetContent que envolve isto —
    // por isso w-full aqui, e não um segundo w-[...] brigando com o w-[248px]
    // (mesma especificidade: quem vence dependeria da ordem do CSS gerado).
    <aside className={cn(
      "flex h-dvh shrink-0 flex-col overflow-y-auto bg-gradient-sidebar p-4 text-sidebar-foreground scrollbar-thin",
      mobile ? "w-full" : "sticky top-0 hidden w-[248px] md:flex",
    )}>
      <div className="mb-6 flex items-center gap-2 px-2 py-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15 backdrop-blur">
          <Sparkles className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-display text-base font-bold leading-tight">CRM WhatsApp</div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-white/70">Pro</div>
        </div>
        {mobile && (
          <Button variant="ghost" size="icon" className="text-white hover:bg-white/10 hover:text-white" onClick={onClose} aria-label="Fechar menu">
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      <nav className="flex flex-col gap-5 pb-6">
        {visibleSections.map(section => (
          <div key={section.title}>
            <div className="mb-2 px-3 text-[10px] font-bold uppercase tracking-wider text-white/55">{section.title}</div>
            <div className="flex flex-col gap-1">
              {section.items.map(({ to, label, icon: Icon, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  onClick={onClose}
                  className={({ isActive }) =>
                    cn(
                      "group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all",
                      isActive
                        ? "bg-white text-primary shadow-soft"
                        : "text-white/85 hover:bg-white/10 hover:text-white"
                    )
                  }
                >
                  <Icon className="w-[18px] h-[18px]" />
                  <span>{label}</span>
                  {to === "/equipe" && internalUnread > 0 && (
                    <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-bold text-destructive-foreground">
                      {internalUnread > 99 ? "99+" : internalUnread}
                    </span>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}
