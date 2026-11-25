import { resolveLiveTriageRuntime } from "@/lib/live-deps";
import { sendLeadAlert } from "@/lib/notify";
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
  onLeadTriaged: async (response) => {
    // n8n workflows own downstream email orchestration for source: "n8n" leads.
    if (response.lead.source === "n8n") {
      return;
    }
    await sendLeadAlert(response, {
      resendApiKey: process.env.RESEND_API_KEY,
      alertEmailTo: process.env.ALERT_EMAIL_TO,
      alertEmailFrom: process.env.ALERT_EMAIL_FROM,
      webhookUrl: process.env.ALERT_WEBHOOK_URL,
    });
  },
});
