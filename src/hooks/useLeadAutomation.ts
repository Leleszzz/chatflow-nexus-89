import { useEffect, useRef } from "react";
import { useCRM } from "@/store/crm-store";
import { useWhatsAppConversations } from "@/hooks/useWhatsAppConversations";

export function useLeadAutomation() {
  const { conversations: waConversations } = useWhatsAppConversations();
  const {
    conversationPatches,
    leadDistribution,
    agentSchedule,
    assignNextSeller,
    applyScheduledAgentIfActive,
    deals,
  } = useCRM();
  const processedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    for (const wa of waConversations) {
      if (processedRef.current.has(wa.id)) continue;
      const patch = conversationPatches[wa.id];
      const linkedDealId = patch?.dealId;
      const linkedDeal = linkedDealId ? deals.find(d => d.id === linkedDealId) : undefined;

      const alreadyAssigned = Boolean(
        linkedDeal?.sellerId || patch?.sellerId || patch?.dealId
      );
      const alreadyHasAI = Boolean(linkedDeal?.aiEnabled ?? patch?.aiEnabled);

      // A atribuição é resolvida no servidor (cursor atômico do rodízio); aqui
      // só disparamos. O resultado volta pelo socket.
      if (leadDistribution.enabled && !alreadyAssigned) assignNextSeller(wa.id);
      if (agentSchedule.enabled && !alreadyHasAI) applyScheduledAgentIfActive(wa.id);
      processedRef.current.add(wa.id);
    }
  }, [waConversations, conversationPatches, deals, leadDistribution, agentSchedule, assignNextSeller, applyScheduledAgentIfActive]);
}
