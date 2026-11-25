import type { TriagePipelineResponse } from "@/lib/pipeline";

export const DEFAULT_NOTIFY_TIMEOUT_MS = 3500;
export const DEFAULT_RESEND_FROM = "Lead Triage <onboarding@resend.dev>";

export type NotifyOutcome =
  | { readonly sent: true; readonly provider: "resend" | "discord" | "slack" }
  | {
      readonly sent: false;
      readonly reason:
        | "disabled"
        | "skipped_status"
        | "timeout"
        | "http_error"
        | "network_error";
      readonly httpStatus?: number;
    };

export interface NotifyOptions {
  readonly resendApiKey?: string | null;
  readonly alertEmailTo?: string | null;
  readonly alertEmailFrom?: string | null;
  readonly webhookUrl?: string | null;
  readonly appBaseUrl?: string;
  readonly fetchFn?: typeof fetch;
  readonly timeoutMs?: number;
}

function isDiscordWebhook(webhookUrl: string): boolean {
  try {
    const host = new URL(webhookUrl).hostname.toLowerCase();
    return (
      host === "discord.com" ||
      host === "discordapp.com" ||
      host.endsWith(".discord.com")
    );
  } catch {
    return false;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildAlertContent(
  response: Exclude<TriagePipelineResponse, { readonly deduplicated: true }>,
  appBaseUrl: string,
): {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  readonly accentColor: number;
} {
  const { lead, routing_reason } = response;
  const triage = lead.triage_json;
  const isReview = lead.status === "needs_human_review";

  const subject = isReview
    ? `[Needs Review] ${lead.name} (${lead.email})`
    : `[Auto-Routed] ${lead.name} (${lead.email})`;

  const lines = [
    `Lead: ${lead.name} <${lead.email}>`,
    `Company: ${lead.company_url}`,
    `Route: ${triage?.suggested_route ?? "unassigned"} | Urgency: ${triage?.urgency ?? "unknown"}`,
    `Confidence: ${lead.confidence_score !== null ? lead.confidence_score.toFixed(2) : "n/a"} | ICP: ${lead.icp_score !== null ? `${lead.icp_score}/100` : "n/a"}`,
    `Reason: ${routing_reason}`,
    ...(lead.prompt_injection_detected
      ? ["Security: prompt-injection tripwire triggered"]
      : []),
    ...(lead.draft_reply ? ["", "Draft reply:", lead.draft_reply] : []),
    "",
    `Open inbox: ${appBaseUrl}`,
  ];

  const html = [
    `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #111113; max-width: 560px; line-height: 1.5;">`,
    `<h2 style="font-size: 16px; margin: 0 0 12px;">${escapeHtml(subject)}</h2>`,
    `<p style="font-size: 13px; color: #52525b; margin: 0 0 16px;">`,
    `<strong>Company:</strong> ${escapeHtml(lead.company_url)}<br/>`,
    `<strong>Route:</strong> ${escapeHtml(triage?.suggested_route ?? "unassigned")} (${escapeHtml(triage?.urgency ?? "unknown")} urgency)<br/>`,
    `<strong>Confidence:</strong> ${lead.confidence_score !== null ? lead.confidence_score.toFixed(2) : "n/a"} &middot; <strong>ICP:</strong> ${lead.icp_score !== null ? `${lead.icp_score}/100` : "n/a"}<br/>`,
    `<strong>Reason:</strong> ${escapeHtml(routing_reason)}`,
    lead.prompt_injection_detected
      ? `<br/><strong style="color: #b91c1c;">Security:</strong> Prompt-injection tripwire triggered`
      : "",
    `</p>`,
    lead.draft_reply
      ? `<div style="background: #f4f4f6; border-radius: 6px; padding: 12px 14px; font-size: 13px; margin: 0 0 16px;"><strong>Draft reply</strong><br/>${escapeHtml(lead.draft_reply)}</div>`
      : "",
    `<a href="${escapeHtml(appBaseUrl)}" style="display: inline-block; background: #111113; color: #ffffff; text-decoration: none; font-size: 12px; font-weight: 500; padding: 8px 14px; border-radius: 6px;">Open Operations Inbox</a>`,
    `</div>`,
  ].join("");

  return {
    subject,
    text: lines.join("\n"),
    html,
    accentColor: isReview ? 0xd97706 : 0x16a34a,
  };
}

/**
 * Sends a non-blocking outbound alert when a newly triaged lead is `auto_routed`
 * or `needs_human_review`. Prefers Resend Email when RESEND_API_KEY + ALERT_EMAIL_TO
 * are configured; falls back to optional Discord/Slack ALERT_WEBHOOK_URL.
 * Skips `auto_rejected` spam and deduplicated hits. Never throws.
 */
export async function sendLeadAlert(
  response: TriagePipelineResponse,
  options: NotifyOptions,
): Promise<NotifyOutcome> {
  const resendApiKey = options.resendApiKey?.trim();
  const alertEmailTo = options.alertEmailTo?.trim();
  const webhookUrl = options.webhookUrl?.trim();

  const useResend = Boolean(resendApiKey && alertEmailTo);
  if (!useResend && !webhookUrl) {
    return { sent: false, reason: "disabled" };
  }

  if (response.deduplicated) {
    return { sent: false, reason: "skipped_status" };
  }

  if (
    response.lead.status !== "auto_routed" &&
    response.lead.status !== "needs_human_review"
  ) {
    return { sent: false, reason: "skipped_status" };
  }

  const fetchFn = options.fetchFn ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_NOTIFY_TIMEOUT_MS;
  const appBaseUrl =
    options.appBaseUrl ?? "https://b2b-lead-triage-agent.vercel.app";
  const content = buildAlertContent(response, appBaseUrl);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    if (useResend && resendApiKey && alertEmailTo) {
      const from = options.alertEmailFrom?.trim() || DEFAULT_RESEND_FROM;
      const res = await fetchFn("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [alertEmailTo],
          subject: content.subject,
          text: content.text,
          html: content.html,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        console.error(`Resend alert email returned HTTP ${res.status}`);
        return { sent: false, reason: "http_error", httpStatus: res.status };
      }

      return { sent: true, provider: "resend" };
    }

    const targetWebhook = webhookUrl!;
    const provider = isDiscordWebhook(targetWebhook) ? "discord" : "slack";
    const body =
      provider === "discord"
        ? {
            content: content.subject,
            embeds: [
              {
                title: content.subject,
                description: content.text,
                color: content.accentColor,
              },
            ],
          }
        : {
            text: `${content.subject}\n${content.text}`,
          };

    const res = await fetchFn(targetWebhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      console.error(`Outbound alert webhook returned HTTP ${res.status}`);
      return { sent: false, reason: "http_error", httpStatus: res.status };
    }

    return { sent: true, provider };
  } catch (error: unknown) {
    const isTimeout =
      error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError");
    console.error(
      "Outbound alert failed:",
      error instanceof Error ? error.message : String(error),
    );
    return {
      sent: false,
      reason: isTimeout ? "timeout" : "network_error",
    };
  } finally {
    clearTimeout(timer);
  }
}
