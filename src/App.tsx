import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CRMProvider } from "@/store/crm-store";
import Dashboard from "./pages/Dashboard";
import Kanban from "./pages/Kanban";
import Conversas from "./pages/Conversas";
import Equipe from "./pages/Equipe";
import Calendario from "./pages/Calendario";
import Agentes from "./pages/Agentes";
import Instancias from "./pages/Instancias";
import Campanhas from "./pages/Campanhas";
import Relatorios from "./pages/Relatorios";
import Usuarios from "./pages/Usuarios";
import Configuracoes from "./pages/Configuracoes";
import Prontuarios from "./pages/Prontuarios";
import Consultas from "./pages/Consultas";
import Login from "./pages/Login";
import NotFound from "./pages/NotFound.tsx";
import { RequireRole } from "@/components/layout/RequireRole";

const App = () => (
  <TooltipProvider>
    <Toaster />
    <Sonner position="top-right" />
    <CRMProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<RequireRole path="/" title="Dashboard"><Dashboard /></RequireRole>} />
          <Route path="/kanban" element={<RequireRole path="/kanban" title="Kanban"><Kanban /></RequireRole>} />
          <Route path="/conversas" element={<RequireRole path="/conversas" title="Conversas"><Conversas /></RequireRole>} />
          <Route path="/equipe" element={<RequireRole path="/equipe" title="Equipe"><Equipe /></RequireRole>} />
          <Route path="/calendario" element={<RequireRole path="/calendario" title="Calendário"><Calendario /></RequireRole>} />
          <Route path="/prontuarios" element={<RequireRole path="/prontuarios" title="Prontuários"><Prontuarios /></RequireRole>} />
          <Route path="/consultas" element={<RequireRole path="/consultas" title="Consultas"><Consultas /></RequireRole>} />
          <Route path="/agentes" element={<RequireRole path="/agentes" title="Agentes"><Agentes /></RequireRole>} />
          <Route path="/instancias" element={<RequireRole path="/instancias" title="Instâncias"><Instancias /></RequireRole>} />
          <Route path="/campanhas" element={<RequireRole path="/campanhas" title="Campanhas"><Campanhas /></RequireRole>} />
          <Route path="/relatorios" element={<RequireRole path="/relatorios" title="Relatórios"><Relatorios /></RequireRole>} />
          <Route path="/usuarios" element={<RequireRole path="/usuarios" title="Usuários"><Usuarios /></RequireRole>} />
          <Route path="/configuracoes" element={<RequireRole path="/configuracoes" title="Configurações"><Configuracoes /></RequireRole>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </CRMProvider>
  </TooltipProvider>
);

export default App;
