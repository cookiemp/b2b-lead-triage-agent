import { syncAndRecordLeadToHubSpot } from "@/lib/hubspot";
import { createLeadPatchHandler } from "@/lib/leads-handler";
import { resolveLiveLeadStore } from "@/lib/live-deps";

export const dynamic = "force-dynamic";

export const PATCH = createLeadPatchHandler({
  resolveStore: resolveLiveLeadStore,
  onLeadApproved: async (lead, store) => {
    const { updatedLead } = await syncAndRecordLeadToHubSpot({
      lead,
      trigger: "human_approved",
      store,
    });
    return updatedLead;
  },
});
