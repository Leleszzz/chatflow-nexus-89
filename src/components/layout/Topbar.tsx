import { LogOut, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useCRM } from "@/store/crm-store";
import { roleLabel } from "@/lib/roles";

export function Topbar({ title, subtitle, onOpenMenu }: { title: string; subtitle?: string; onOpenMenu?: () => void }) {
  const { accountProfile, logout } = useCRM();

  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 pt-safe backdrop-blur-xl">
      <div className="flex h-16 items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Button variant="outline" size="icon" className="shrink-0 rounded-xl md:hidden" onClick={onOpenMenu} aria-label="Abrir menu">
            <Menu className="h-4 w-4" />
          </Button>
          {/* Antes era hidden lg:block — o título simplesmente sumia entre
              768px e 1024px, deixando a barra sem nenhuma indicação de tela. */}
          <div className="min-w-0">
            <h1 className="truncate font-display text-base font-bold leading-tight sm:text-lg">{title}</h1>
            {subtitle && <p className="hidden truncate text-xs text-muted-foreground sm:block">{subtitle}</p>}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3 sm:border-l sm:border-border sm:pl-3">
          <div className="hidden text-right sm:block">
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
