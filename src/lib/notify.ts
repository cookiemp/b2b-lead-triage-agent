import type { TriagePipelineResponse } from "@/lib/pipeline";

export const DEFAULT_NOTIFY_TIMEOUT_MS = 3000;

export type NotifyOutcome =
  | { readonly sent: true; readonly provider: "discord" | "slack" }
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
  readonly webhookUrl: string | null | undefined;
  readonly appBaseUrl?: string;
  readonly fetchFn?: typeof fetch;
  readonly timeoutMs?: number;
}

function isDiscordWebhook(webhookUrl: string): boolean {
  try {
    const host = new URL(webhookUrl).hostname.toLowerCase();
    return host === "discord.com" || host === "discordapp.com" || host.endsWith(".discord.com");
  } catch {
    return false;
  }
}

function buildAlertSummary(
  response: Exclude<TriagePipelineResponse, { readonly deduplicated: true }>,
  appBaseUrl: string,
): {
  readonly title: string;
  readonly lines: readonly string[];
  readonly accentColor: number;
} {
  const { lead, routing_reason } = response;
  const triage = lead.triage_json;
  const isReview = lead.status === "needs_human_review";

  const title = isReview
    ? `[Needs Review] ${lead.name} (${lead.email})`
    : `[Auto-Routed] ${lead.name} (${lead.email})`;

  const lines = [
    `Company: ${lead.company_url}`,
    `Route: ${triage?.suggested_route ?? "unassigned"} | Urgency: ${triage?.urgency ?? "unknown"}`,
    `Confidence: ${lead.confidence_score !== null ? lead.confidence_score.toFixed(2) : "n/a"} | ICP: ${lead.icp_score !== null ? `${lead.icp_score}/100` : "n/a"}`,
    `Reason: ${routing_reason}`,
    ...(lead.prompt_injection_detected
      ? ["Security: prompt-injection tripwire triggered"]
      : []),
    `Inbox: ${appBaseUrl}`,
  ];

  return {
    title,
    lines,
    accentColor: isReview ? 0xd97706 : 0x16a34a,
  };
}

/**
 * Sends a non-blocking outbound alert to Discord or Slack when a newly triaged lead
 * is `auto_routed` or `needs_human_review`.
 * Skips `auto_rejected` spam and deduplicated hits. Never throws.
 */
export async function sendLeadAlert(
  response: TriagePipelineResponse,
  options: NotifyOptions,
): Promise<NotifyOutcome> {
  const webhookUrl = options.webhookUrl?.trim();
  if (!webhookUrl) {
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

  const provider = isDiscordWebhook(webhookUrl) ? "discord" : "slack";
  const summary = buildAlertSummary(response, appBaseUrl);

  const body =
    provider === "discord"
      ? {
          content: summary.title,
          embeds: [
            {
              title: summary.title,
              description: summary.lines.join("\n"),
              color: summary.accentColor,
            },
          ],
        }
      : {
          text: `${summary.title}\n${summary.lines.join("\n")}`,
        };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchFn(webhookUrl, {
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
      "Outbound alert webhook failed:",
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
