import { useEffect } from "react";
import { toast } from "sonner";
import { getSocket } from "@/lib/whatsapp-socket";

/**
 * Avisos do agente de IA que agora nascem no servidor.
 *
 * O gatilho do agente saiu do navegador e foi para o backend, então os avisos
 * que antes eram emitidos localmente (transferência para humano, coleta de
 * dados) precisam chegar por socket. O ganho: o aviso aparece para QUEM ESTIVER
 * com o CRM aberto no momento, e não só para a aba que por acaso disparou a
 * resposta — antes, se a resposta saísse da máquina da secretária, o doutor não
 * ficava sabendo de nada.
 */
export function useAgentNotifications() {
  useEffect(() => {
    const socket = getSocket();

    const aoTransferir = (payload: { conversationId: string; agentName?: string }) => {
      const nome = payload?.agentName ? `"${payload.agentName}"` : "O agente";
      toast.info(`${nome} transferiu uma conversa para atendimento humano.`);
    };

    const aoColetar = (payload: { conversationId: string; campos: string[] }) => {
      if (!payload?.campos?.length) return;
      toast.success(`Agente coletou: ${payload.campos.join(", ")}`);
    };

    socket.on("agent:handoff", aoTransferir);
    socket.on("agent:extracted", aoColetar);
    return () => {
      socket.off("agent:handoff", aoTransferir);
      socket.off("agent:extracted", aoColetar);
    };
  }, []);
}
