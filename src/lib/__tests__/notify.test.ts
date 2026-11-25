import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { sendLeadAlert } from "@/lib/notify";
import type { TriagePipelineResponse } from "@/lib/pipeline";
import type { LeadStatus } from "@/lib/schemas";

function makePipelineResponse(
  status: LeadStatus,
  deduplicated = false,
): TriagePipelineResponse {
  const now = new Date().toISOString();
  const lead = {
    id: randomUUID(),
    idempotency_key: "a".repeat(64),
    name: "Elena Rostova",
    email: "elena@linear.app",
    company_url: "https://linear.app",
    message: "We want to automate inbound lead qualification.",
    enriched_summary: "Linear builds issue tracking software.",
    enrichment_ok: true,
    prompt_injection_detected: false,
    triage_json: {
      intent: "Enterprise automation demo",
      urgency: "high" as const,
      company_size_estimate: "100-250",
      icp_score: 94,
      suggested_route:
        status === "auto_rejected"
          ? ("spam" as const)
          : ("sales_enterprise" as const),
      confidence_score: status === "needs_human_review" ? 0.65 : 0.94,
      reasoning: "Strong ICP fit.",
      draft_reply: "Hi Elena, let us schedule a walkthrough.",
    },
    icp_score: 94,
    confidence_score: status === "needs_human_review" ? 0.65 : 0.94,
    draft_reply: "Hi Elena, let us schedule a walkthrough.",
    status,
    source: "n8n" as const,
    langfuse_trace_id: "trace-123",
    created_at: now,
    updated_at: now,
  };

  if (deduplicated) {
    return {
      deduplicated: true,
      degraded: false,
      lead,
      routing_reason: "deduplicated_existing_lead",
    };
  }

  return {
    deduplicated: false,
    degraded: false,
    lead,
    enrichment: {
      ok: true,
      summary: "Linear builds issue tracking software.",
      sourceUrl: "https://linear.app",
      durationMs: 400,
    },
    routing_reason:
      status === "needs_human_review"
        ? "below_confidence_threshold"
        : status === "auto_rejected"
          ? "high_confidence_spam"
          : "high_confidence_verified",
    prompt_injection: { detected: false, source: "none", matchedPatterns: [] },
    email_domain: "corporate",
    model_used: "gemini-3.6-flash",
    fallback_attempts: [],
  };
}

describe("sendLeadAlert", () => {
  it("returns disabled when webhookUrl is unset", async () => {
    const fetchFn = vi.fn<typeof fetch>();
    const outcome = await sendLeadAlert(makePipelineResponse("auto_routed"), {
      webhookUrl: undefined,
      fetchFn,
    });
    expect(outcome).toEqual({ sent: false, reason: "disabled" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("skips auto_rejected spam and deduplicated hits", async () => {
    const fetchFn = vi.fn<typeof fetch>();

    const spamOutcome = await sendLeadAlert(
      makePipelineResponse("auto_rejected"),
      {
        webhookUrl: "https://discord.com/api/webhooks/123/abc",
        fetchFn,
      },
    );
    expect(spamOutcome).toEqual({ sent: false, reason: "skipped_status" });

    const dupOutcome = await sendLeadAlert(
      makePipelineResponse("auto_routed", true),
      {
        webhookUrl: "https://discord.com/api/webhooks/123/abc",
        fetchFn,
      },
    );
    expect(dupOutcome).toEqual({ sent: false, reason: "skipped_status" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("sends Discord embed payload for auto_routed and needs_human_review", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));

    const outcome = await sendLeadAlert(
      makePipelineResponse("needs_human_review"),
      {
        webhookUrl: "https://discord.com/api/webhooks/123/abc",
        fetchFn,
      },
    );

    expect(outcome).toEqual({ sent: true, provider: "discord" });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchFn.mock.calls[0]?.[1]?.body)) as {
      content: string;
      embeds: Array<{ title: string; description: string }>;
    };
    expect(body.content).toContain("[Needs Review]");
    expect(body.embeds[0]?.description).toContain("below_confidence_threshold");
  });

  it("sends Slack text payload for Slack webhook URLs", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("ok", { status: 200 }));

    const outcome = await sendLeadAlert(makePipelineResponse("auto_routed"), {
      webhookUrl: "https://hooks.slack.com/services/T00/B00/XXX",
      fetchFn,
    });

    expect(outcome).toEqual({ sent: true, provider: "slack" });
    const body = JSON.parse(String(fetchFn.mock.calls[0]?.[1]?.body)) as {
      text: string;
    };
    expect(body.text).toContain("[Auto-Routed]");
  });

  it("swallows timeouts and HTTP 500 errors safely without throwing", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const timeoutFetch = vi.fn<typeof fetch>().mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("Aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    );

    const timeoutOutcome = await sendLeadAlert(
      makePipelineResponse("auto_routed"),
      {
        webhookUrl: "https://hooks.slack.com/services/T00/B00/XXX",
        fetchFn: timeoutFetch,
        timeoutMs: 20,
      },
    );
    expect(timeoutOutcome).toEqual({ sent: false, reason: "timeout" });

    const errorFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("Bad Gateway", { status: 502 }));

    const errorOutcome = await sendLeadAlert(
      makePipelineResponse("auto_routed"),
      {
        webhookUrl: "https://hooks.slack.com/services/T00/B00/XXX",
        fetchFn: errorFetch,
      },
    );
    expect(errorOutcome).toEqual({
      sent: false,
      reason: "http_error",
      httpStatus: 502,
    });

    errSpy.mockRestore();
  });
});

describe("workflows/n8n-triage-workflow.json integrity", () => {
  it("is valid JSON wiring Webhook -> Triage API (X-Webhook-Secret) -> 3-way status switch", () => {
    const raw = readFileSync(
      path.resolve(process.cwd(), "workflows/n8n-triage-workflow.json"),
      "utf8",
    );
    const workflow = JSON.parse(raw) as {
      nodes: Array<{ name: string; parameters?: Record<string, unknown> }>;
      connections: Record<string, unknown>;
    };

    const nodeNames = workflow.nodes.map((n) => n.name);
    expect(nodeNames).toContain("Inbound Lead Webhook");
    expect(nodeNames).toContain("Call Triage API");
    expect(nodeNames).toContain("Route by Triage Status");
    expect(nodeNames).toContain("Notify Sales Channel");
    expect(nodeNames).toContain("Notify Human Review Queue");
    expect(nodeNames).toContain("Silent Spam Archive");
    expect(raw).toContain("X-Webhook-Secret");
    expect(raw).toContain("auto_rejected");
  });
});
