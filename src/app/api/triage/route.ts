import { resolveLiveTriageRuntime } from "@/lib/live-deps";
import { createTriagePostHandler } from "@/lib/triage-handler";

export const maxDuration = 30;

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export const POST = createTriagePostHandler({
  resolveDeps: () => resolveLiveTriageRuntime()?.deps ?? null,
  checkDailyDemoQuota: async () => {
    const runtime = resolveLiveTriageRuntime();
    if (runtime === null) {
      return { allowed: true };
    }
    const sinceIso = new Date(Date.now() - TWENTY_FOUR_HOURS_MS).toISOString();
    const count = await runtime.store.countRecentDemoLeads(sinceIso);
    if (count >= runtime.demoDailyCap) {
      return { allowed: false, retryAfterSec: 3600 };
    }
    return { allowed: true };
  },
});
