import { ReactNode, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { BottomNav } from "./BottomNav";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useCRM } from "@/store/crm-store";
import { useLeadAutomation } from "@/hooks/useLeadAutomation";
import { useAgentNotifications } from "@/hooks/useAgentNotifications";
import { useViewportInset } from "@/hooks/useViewportInset";
import { useIsMobile } from "@/hooks/use-mobile";

function LeadAutomationRunner() {
  useLeadAutomation();
  // Avisos do agente chegam por socket agora que ele roda no servidor.
  useAgentNotifications();
  // O gatilho automatico do agente de IA saiu daqui e foi para o BACKEND
  // (backend/src/whatsapp/agent-auto-reply.js). Enquanto morava no navegador,
  // o agente parava de responder quando todo mundo fechava o CRM — e com
  // varias abas abertas disparava a mesma resposta varias vezes.
  return null;
}

export function AppLayout({ children, title, subtitle }: { children: ReactNode; title: string; subtitle?: string }) {
  const { currentUser, authReady } = useCRM();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  // Publica a altura do teclado virtual em --kb-inset; a classe .app-pane
  // desconta isso para o composer do chat não ficar atrás do teclado.
  useViewportInset();

  // Girar o aparelho (ou redimensionar a janela) com o drawer aberto deixaria
  // a sidebar fixa e o drawer sobrepostos, com o overlay travando o scroll.
  const isMobile = useIsMobile();
  useEffect(() => {
    if (!isMobile) setMobileSidebarOpen(false);
  }, [isMobile]);

  if (!authReady) return null;
  if (!currentUser) return <Navigate to="/login" replace />;

  return (
    <div className="flex min-h-dvh w-full bg-background">
      <LeadAutomationRunner />
      <Sidebar />

      {/* Drawer do menu no mobile. O Sheet (Radix) traz focus trap, Esc,
          trava de scroll do body e animação — o overlay feito na mão que
          existia aqui não tinha nada disso. */}
      <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
        <SheetContent
          side="left"
          hideClose
          className="w-[86vw] max-w-[320px] border-0 p-0 sm:max-w-[320px]"
        >
          <SheetTitle className="sr-only">Menu de navegação</SheetTitle>
          <Sidebar mobile onClose={() => setMobileSidebarOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar title={title} subtitle={subtitle} onOpenMenu={() => setMobileSidebarOpen(true)} />
        {/* pt/pb separados de propósito: com `py-*` o `sm:py-6` sobrescreveria
            o padding de baixo entre 640px e 767px — faixa em que a BottomNav
            ainda aparece (md:hidden) — e ela cobriria o fim do conteúdo. */}
        <main className="flex-1 animate-fade-in px-4 pb-[calc(4.5rem+env(safe-area-inset-bottom))] pt-4 sm:px-6 sm:pt-6 md:pb-6 lg:px-8">
          {children}
        </main>
      </div>

      <BottomNav onOpenMenu={() => setMobileSidebarOpen(true)} />
    </div>
  );
}
