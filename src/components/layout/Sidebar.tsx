import { NavLink } from "react-router-dom";
import { LayoutDashboard, Kanban, MessageSquare, CalendarDays, Bot, BarChart3, Settings, Sparkles, Smartphone, Megaphone, Send, Users, X, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { PermissionKey, useCRM } from "@/store/crm-store";
import { Button } from "@/components/ui/button";

const sections: {
  title: string;
  items: { to: string; label: string; icon: typeof LayoutDashboard; end?: boolean; permission?: PermissionKey }[];
}[] = [
  {
    title: "Atendimento",
    items: [
      { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true, permission: "Ver dashboard" },
      { to: "/conversas", label: "Conversas", icon: MessageSquare },
      { to: "/kanban", label: "Kanban", icon: Kanban },
      { to: "/calendario", label: "Calendário", icon: CalendarDays },
      { to: "/prontuarios", label: "Prontuários", icon: FolderOpen },
    ],
  },
  {
    title: "Automação",
    items: [
      { to: "/agentes", label: "Agentes", icon: Bot, permission: "Criar agentes" },
      { to: "/campanhas", label: "Campanhas", icon: Megaphone },
      { to: "/disparo-em-massa", label: "Disparo em massa", icon: Send, permission: "Alterar configurações da empresa" },
    ],
  },
  {
    title: "Gestão",
    items: [
      { to: "/relatorios", label: "Relatórios", icon: BarChart3, permission: "Ver relatórios" },
      { to: "/usuarios", label: "Usuários", icon: Users, permission: "Alterar configurações da empresa" },
      { to: "/instancias", label: "Instâncias", icon: Smartphone, permission: "Alterar configurações da empresa" },
      { to: "/configuracoes", label: "Configurações", icon: Settings, permission: "Alterar configurações da empresa" },
    ],
  },
];

export function Sidebar({ mobile = false, onClose }: { mobile?: boolean; onClose?: () => void }) {
  const { hasPermission } = useCRM();
  const visibleSections = sections
    .map(section => ({ ...section, items: section.items.filter(item => !item.permission || hasPermission(item.permission)) }))
    .filter(section => section.items.length > 0);

  return (
    <aside className={cn(
      "flex w-[248px] shrink-0 flex-col bg-gradient-sidebar text-sidebar-foreground p-4 h-screen",
      mobile ? "w-[280px]" : "hidden md:flex sticky top-0",
    )}>
      <div className="flex items-center gap-2 px-2 py-3 mb-6">
        <div className="w-9 h-9 rounded-xl bg-white/15 backdrop-blur flex items-center justify-center">
          <Sparkles className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-display font-bold text-base leading-tight">CRM WhatsApp</div>
          <div className="text-[11px] uppercase tracking-wider text-white/70 font-semibold">Pro</div>
        </div>
        {mobile && (
          <Button variant="ghost" size="icon" className="text-white hover:bg-white/10 hover:text-white" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      <nav className="flex flex-col gap-5">
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
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}
