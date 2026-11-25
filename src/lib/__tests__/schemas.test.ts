import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  InboundLeadSchema,
  LeadDecisionSchema,
  LeadStatusSchema,
  TriageResultSchema,
  isSafePublicHttpUrl,
} from "@/lib/schemas";

describe("InboundLeadSchema", () => {
  const validLead = {
    name: "Elena Rostova",
    email: "Elena.Rostova@AcmeCloud.io",
    company_url: "https://acmecloud.io/about",
    message:
      "We have 120 SDRs and want to automate inbound lead qualification across HubSpot and Slack.",
  };

  it("accepts a valid payload and defaults source to web_demo with normalized email", () => {
    const parsed = InboundLeadSchema.safeParse(validLead);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    expect(parsed.data.email).toBe("elena.rostova@acmecloud.io");
    expect(parsed.data.source).toBe("web_demo");
  });

  it("accepts explicit webhook and n8n sources and optional idempotency_nonce", () => {
    for (const source of ["web_demo", "webhook", "n8n"] as const) {
      const parsed = InboundLeadSchema.safeParse({
        ...validLead,
        source,
        idempotency_nonce: "preset-run-123",
      });
      expect(parsed.success).toBe(true);
    }

    expect(
      InboundLeadSchema.safeParse({ ...validLead, idempotency_nonce: "   " })
        .success,
    ).toBe(false);
    expect(
      InboundLeadSchema.safeParse({
        ...validLead,
        idempotency_nonce: "a".repeat(65),
      }).success,
    ).toBe(false);
  });

  it("includes auto_rejected in canonical LeadStatusSchema", () => {
    expect(LeadStatusSchema.safeParse("auto_rejected").success).toBe(true);
    expect(LeadStatusSchema.safeParse("auto_routed").success).toBe(true);
  });

  it("rejects unknown source values", () => {
    const parsed = InboundLeadSchema.safeParse({
      ...validLead,
      source: "slack_bot",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects malformed email addresses", () => {
    for (const email of ["not-an-email", "missing@domain", "@example.com", ""]) {
      const parsed = InboundLeadSchema.safeParse({ ...validLead, email });
      expect(parsed.success).toBe(false);
    }
  });

  it("rejects missing or whitespace-only name and message", () => {
    expect(
      InboundLeadSchema.safeParse({ ...validLead, name: "   " }).success,
    ).toBe(false);
    expect(
      InboundLeadSchema.safeParse({ ...validLead, message: "  \n\t " }).success,
    ).toBe(false);
  });

  it("rejects malformed and non-http(s) URLs", () => {
    const invalidUrls = [
      "not-a-url",
      "ftp://acmecloud.io/files",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "https://user:pass@acmecloud.io",
    ];
    for (const company_url of invalidUrls) {
      const parsed = InboundLeadSchema.safeParse({ ...validLead, company_url });
      expect(parsed.success).toBe(false);
    }
  });

  it("blocks SSRF targets including localhost, private IPv4/IPv6, cloud metadata, and internal hosts", () => {
    const blockedUrls = [
      "http://localhost:3000",
      "http://sub.localhost/admin",
      "http://printer.local",
      "http://metadata.google.internal/computeMetadata/v1/",
      "http://redis:6379",
      "http://127.0.0.1/internal",
      "http://2130706433/", // decimal-encoded 127.0.0.1
      "http://0.0.0.0/",
      "http://10.0.0.12/",
      "http://172.16.5.4/",
      "http://172.31.255.255/",
      "http://192.168.1.1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://100.64.0.1/",
      "http://[::1]:8080/",
      "http://[fc00::1]/",
      "http://[fd12:3456:789a::1]/",
      "http://[fe80::1]/",
      "http://[::ffff:127.0.0.1]/",
    ];

    for (const url of blockedUrls) {
      expect(isSafePublicHttpUrl(url), `expected blocked: ${url}`).toBe(false);
      const parsed = InboundLeadSchema.safeParse({
        ...validLead,
        company_url: url,
      });
      expect(parsed.success).toBe(false);
    }
  });

  it("allows valid public http(s) URLs including public IPs", () => {
    const allowedUrls = [
      "https://stripe.com",
      "http://example.co.uk/pricing?plan=enterprise",
      "https://172.15.0.1/", // just outside 172.16.0.0/12
      "https://172.32.0.1/", // just outside 172.16.0.0/12
    ];

    for (const url of allowedUrls) {
      expect(isSafePublicHttpUrl(url), `expected allowed: ${url}`).toBe(true);
    }
  });
});

describe("TriageResultSchema", () => {
  const validTriage = {
    intent: "Enterprise workflow automation demo request",
    urgency: "high" as const,
    company_size_estimate: "200-500 employees",
    icp_score: 92,
    suggested_route: "sales_enterprise" as const,
    confidence_score: 0.91,
    reasoning:
      "Mid-market B2B SaaS company with clear HubSpot/Slack automation budget and timeline.",
    draft_reply:
      "Hi Elena, thanks for reaching out. Given AcmeCloud's 120-person SDR team, I'd love to walk through how we connect HubSpot and Slack for automated triage.",
  };

  it("accepts a valid triage result including boundary scores 0 and 1", () => {
    expect(TriageResultSchema.safeParse(validTriage).success).toBe(true);
    expect(
      TriageResultSchema.safeParse({
        ...validTriage,
        confidence_score: 0,
        icp_score: 0,
      }).success,
    ).toBe(true);
    expect(
      TriageResultSchema.safeParse({
        ...validTriage,
        confidence_score: 1,
        icp_score: 100,
      }).success,
    ).toBe(true);
  });

  it("rejects out-of-range confidence_score values", () => {
    expect(
      TriageResultSchema.safeParse({ ...validTriage, confidence_score: -0.01 })
        .success,
    ).toBe(false);
    expect(
      TriageResultSchema.safeParse({ ...validTriage, confidence_score: 1.01 })
        .success,
    ).toBe(false);
  });

  it("rejects out-of-range or non-integer icp_score values", () => {
    expect(
      TriageResultSchema.safeParse({ ...validTriage, icp_score: -1 }).success,
    ).toBe(false);
    expect(
      TriageResultSchema.safeParse({ ...validTriage, icp_score: 101 }).success,
    ).toBe(false);
    expect(
      TriageResultSchema.safeParse({ ...validTriage, icp_score: 85.5 }).success,
    ).toBe(false);
  });

  it("rejects invalid urgency, suggested_route, or missing draft_reply", () => {
    expect(
      TriageResultSchema.safeParse({ ...validTriage, urgency: "critical" })
        .success,
    ).toBe(false);
    expect(
      TriageResultSchema.safeParse({
        ...validTriage,
        suggested_route: "vip_bypass",
      }).success,
    ).toBe(false);
    expect(
      TriageResultSchema.safeParse({ ...validTriage, draft_reply: "   " })
        .success,
    ).toBe(false);
  });
});

describe("LeadDecisionSchema", () => {
  it("accepts approved/rejected with optional edited_draft_reply and defaults actor", () => {
    const parsed = LeadDecisionSchema.safeParse({
      status: "approved",
      edited_draft_reply: "Updated personalized follow-up.",
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.actor).toBe("human_operator");
  });

  it("rejects invalid decision statuses and blank edited drafts", () => {
    expect(
      LeadDecisionSchema.safeParse({ status: "auto_routed" }).success,
    ).toBe(false);
    expect(
      LeadDecisionSchema.safeParse({ status: "needs_human_review" }).success,
    ).toBe(false);
    expect(
      LeadDecisionSchema.safeParse({
        status: "approved",
        edited_draft_reply: "   ",
      }).success,
    ).toBe(false);
  });
});

describe("evals/leads_dataset.json integrity", () => {
  it("contains 20 synthetic cases that all pass InboundLeadSchema", () => {
    const raw = readFileSync(
      path.resolve(process.cwd(), "evals/leads_dataset.json"),
      "utf8",
    );
    const dataset = JSON.parse(raw) as Array<{
      id: string;
      lead: Record<string, unknown>;
    }>;

    expect(dataset).toHaveLength(20);
    for (const item of dataset) {
      const parsed = InboundLeadSchema.safeParse(item.lead);
      expect(parsed.success, `eval case ${item.id} failed InboundLeadSchema`).toBe(
        true,
      );
    }
  });
});
