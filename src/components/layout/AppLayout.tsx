import { ReactNode, useState } from "react";
import { Navigate } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { useCRM } from "@/store/crm-store";
import { useLeadAutomation } from "@/hooks/useLeadAutomation";
import { useAgentNotifications } from "@/hooks/useAgentNotifications";

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

  if (!authReady) return null;
  if (!currentUser) return <Navigate to="/login" replace />;

  return (
    <div className="flex min-h-screen w-full bg-background">
      <LeadAutomationRunner />
      <Sidebar />
      {mobileSidebarOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label="Fechar menu"
            className="absolute inset-0 bg-foreground/35"
            onClick={() => setMobileSidebarOpen(false)}
          />
          <div className="relative h-full">
            <Sidebar mobile onClose={() => setMobileSidebarOpen(false)} />
          </div>
        </div>
      )}
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar title={title} subtitle={subtitle} onOpenMenu={() => setMobileSidebarOpen(true)} />
        <main className="flex-1 px-6 lg:px-8 py-6 animate-fade-in">{children}</main>
      </div>
    </div>
  );
}
