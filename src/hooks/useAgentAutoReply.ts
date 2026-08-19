import { useEffect, useRef } from "react";
import { useCRM } from "@/store/crm-store";
import { getSocket } from "@/lib/whatsapp-socket";
import { whatsappApi, WAConversation, WAMessage } from "@/lib/whatsapp-api";
import { Agent } from "@/lib/mock-data";
import { toast } from "sonner";

const DEBOUNCE_MS = 2500;
const CONTEXT_LIMIT = 15;

const normalizeText = (raw: string) =>
  raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

const matchesBlockWord = (text: string, blockWords: string[] | undefined) => {
  if (!Array.isArray(blockWords) || blockWords.length === 0) return false;
  const haystack = normalizeText(text);
  return blockWords.some(word => {
    const needle = normalizeText(String(word || "").trim());
    return needle.length > 0 && haystack.includes(needle);
  });
};

export function useAgentAutoReply() {
  const {
    agents,
    deals,
    conversationPatches,
    setConversationPatch,
    updateDeal,
    refreshAgentUsage,
  } = useCRM();
  const crmRef = useRef({
    agents,
    deals,
    conversationPatches,
    setConversationPatch,
    updateDeal,
    refreshAgentUsage,
  });

  useEffect(() => {
    crmRef.current = {
      agents,
      deals,
      conversationPatches,
      setConversationPatch,
      updateDeal,
      refreshAgentUsage,
    };
  }, [agents, deals, conversationPatches, setConversationPatch, updateDeal, refreshAgentUsage]);

  useEffect(() => {
    const socket = getSocket();
    const timers = new Map<string, number>();
    const inFlight = new Set<string>();
    const pending = new Set<string>();
    const processed = new Set<string>();

    const resolveAgent = (conversationId: string): { agent: Agent; dealId?: string } | null => {
      const { agents: a, deals: d, conversationPatches: cp } = crmRef.current;
      const patch = cp[conversationId];
      const linkedDeal = patch?.dealId ? d.find(x => x.id === patch.dealId) : undefined;
      const aiEnabled = linkedDeal?.aiEnabled ?? patch?.aiEnabled;
      const aiAgentId = linkedDeal?.aiAgentId ?? patch?.aiAgentId;
      if (!aiEnabled || !aiAgentId) return null;
      const agent = a.find(x => x.id === aiAgentId);
      if (!agent || !agent.active) return null;
      return { agent, dealId: linkedDeal?.id };
    };

    const triggerReply = async (conversation: WAConversation) => {
      const resolved = resolveAgent(conversation.id);
      if (!resolved) return;
      const { agent, dealId } = resolved;
      if (!conversation.instanceId || !conversation.chatId) return;
      if (inFlight.has(conversation.id)) {
        pending.add(conversation.id);
        return;
      }
      inFlight.add(conversation.id);
      try {
        const response = await whatsappApi.agentRespond({
          instanceId: conversation.instanceId,
          chatId: conversation.chatId,
          model: agent.model,
          temperature: agent.temperature,
          systemPrompt: agent.prompt,
          contextLimit: CONTEXT_LIMIT,
          agentId: agent.id,
          nowIso: new Date().toISOString(),
          // Sem o lead vinculado o backend não tem onde gravar o que extrair.
          dealId,
        });
        if (response?.extracted && Object.keys(response.extracted).length) {
          // O backend já persistiu e emitiu deal:update; aqui é só o aviso.
          toast.success(`Agente coletou: ${Object.keys(response.extracted).join(", ")}`);
        }
        if (response?.scheduling?.days?.length) {
          crmRef.current.setConversationPatch(conversation.id, {
            aiEnabled: false,
            schedulingProposal: {
              baseDateIso: response.scheduling.baseDateIso,
              days: response.scheduling.days,
              createdAt: new Date().toISOString(),
            },
          });
          if (dealId) crmRef.current.updateDeal(dealId, { aiEnabled: false });
          const existing = timers.get(conversation.id);
          if (existing) {
            window.clearTimeout(existing);
            timers.delete(conversation.id);
          }
          pending.delete(conversation.id);
          toast.info("Agente desligado: escolha um horário no painel para o cliente.");
        }
        crmRef.current.refreshAgentUsage().catch(() => {});
      } catch (err) {
        console.warn("[agent-auto-reply] failed:", (err as Error).message);
      } finally {
        inFlight.delete(conversation.id);
        if (pending.has(conversation.id)) {
          pending.delete(conversation.id);
          schedule(conversation);
        }
      }
    };

    const schedule = (conversation: WAConversation) => {
      const existing = timers.get(conversation.id);
      if (existing) window.clearTimeout(existing);
      const t = window.setTimeout(() => {
        timers.delete(conversation.id);
        void triggerReply(conversation);
      }, DEBOUNCE_MS);
      timers.set(conversation.id, t);
    };

    const handleHandoff = async (conversation: WAConversation, agent: Agent, dealId?: string) => {
      try {
        crmRef.current.setConversationPatch(conversation.id, { aiEnabled: false });
        if (dealId) crmRef.current.updateDeal(dealId, { aiEnabled: false });
        const text = (agent.handoffMessage || "").trim();
        if (text && conversation.instanceId && conversation.chatId) {
          await whatsappApi.sendText(conversation.instanceId, conversation.chatId, text);
        }
        toast.info(`Agente "${agent.name}" transferiu a conversa para atendimento humano.`);
      } catch (err) {
        console.warn("[agent-auto-reply] handoff failed:", (err as Error).message);
      }
    };

    const onMessage = (payload: { conversation: WAConversation; message: WAMessage }) => {
      const message = payload?.message;
      const conversation = payload?.conversation;
      if (!message || !conversation) return;
      if (message.fromMe) return;
      if (processed.has(message.id)) return;
      processed.add(message.id);
      if (processed.size > 5000) {
        const keep = Array.from(processed).slice(-2500);
        processed.clear();
        keep.forEach(id => processed.add(id));
      }

      const resolved = resolveAgent(conversation.id);
      if (!resolved) return;
      const { agent, dealId } = resolved;

      if (matchesBlockWord(message.body || "", agent.blockWords)) {
        const existing = timers.get(conversation.id);
        if (existing) {
          window.clearTimeout(existing);
          timers.delete(conversation.id);
        }
        pending.delete(conversation.id);
        void handleHandoff(conversation, agent, dealId);
        return;
      }

      schedule(conversation);
    };

    socket.on("message:new", onMessage);
    return () => {
      socket.off("message:new", onMessage);
      for (const t of timers.values()) window.clearTimeout(t);
      timers.clear();
    };
  }, []);
}
