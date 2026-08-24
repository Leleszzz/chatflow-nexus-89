import { LogOut, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useCRM } from "@/store/crm-store";
import { roleLabel } from "@/lib/roles";

export function Topbar({ title, subtitle, onOpenMenu }: { title: string; subtitle?: string; onOpenMenu?: () => void }) {
  const { accountProfile, logout } = useCRM();

  return (
    <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-xl border-b border-border/60">
      <div className="flex items-center justify-between gap-3 px-4 sm:px-6 lg:px-8 h-16">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="outline" size="icon" className="md:hidden rounded-xl" onClick={onOpenMenu} aria-label="Abrir menu">
            <Menu className="h-4 w-4" />
          </Button>
          <div className="hidden lg:block min-w-0">
            <h1 className="font-display text-lg font-bold leading-tight">{title}</h1>
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          </div>
        </div>

        <div className="flex items-center gap-3 pl-3 border-l border-border">
          <div className="hidden sm:block text-right">
            <div className="text-sm font-semibold leading-tight">{accountProfile.name}</div>
            <div className="text-xs text-muted-foreground">{roleLabel(accountProfile.role)}</div>
          </div>
          <Avatar className="w-9 h-9 ring-2 ring-primary/20">
            <AvatarImage src={accountProfile.photoUrl} alt={accountProfile.name} />
            <AvatarFallback className="bg-gradient-primary text-primary-foreground font-semibold text-sm">{accountProfile.avatar}</AvatarFallback>
          </Avatar>
          <Button variant="ghost" size="icon" className="rounded-xl" onClick={logout} title="Sair">
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </header>
  );
}
