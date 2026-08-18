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
import Login from "./pages/Login";
import NotFound from "./pages/NotFound.tsx";

const App = () => (
  <TooltipProvider>
    <Toaster />
    <Sonner position="top-right" />
    <CRMProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<Dashboard />} />
          <Route path="/kanban" element={<Kanban />} />
          <Route path="/conversas" element={<Conversas />} />
          <Route path="/equipe" element={<Equipe />} />
          <Route path="/calendario" element={<Calendario />} />
          <Route path="/prontuarios" element={<Prontuarios />} />
          <Route path="/agentes" element={<Agentes />} />
          <Route path="/instancias" element={<Instancias />} />
          <Route path="/campanhas" element={<Campanhas />} />
          <Route path="/relatorios" element={<Relatorios />} />
          <Route path="/usuarios" element={<Usuarios />} />
          <Route path="/configuracoes" element={<Configuracoes />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </CRMProvider>
  </TooltipProvider>
);

export default App;
