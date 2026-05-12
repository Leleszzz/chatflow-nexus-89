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

      let didSomething = false;
      if (leadDistribution.enabled && !alreadyAssigned) {
        if (assignNextSeller(wa.id)) didSomething = true;
      }
      if (agentSchedule.enabled && !alreadyHasAI) {
        if (applyScheduledAgentIfActive(wa.id)) didSomething = true;
      }
      processedRef.current.add(wa.id);
      void didSomething;
    }
  }, [waConversations, conversationPatches, deals, leadDistribution, agentSchedule, assignNextSeller, applyScheduledAgentIfActive]);
}
