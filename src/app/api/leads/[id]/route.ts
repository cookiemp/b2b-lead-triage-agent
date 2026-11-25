import { createLeadPatchHandler } from "@/lib/leads-handler";
import { resolveLiveLeadStore } from "@/lib/live-deps";

export const dynamic = "force-dynamic";

export const PATCH = createLeadPatchHandler({
  resolveStore: resolveLiveLeadStore,
});
