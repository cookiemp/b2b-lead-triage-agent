import { describe, expect, it } from "vitest";
import type { EnrichmentOutcome } from "@/lib/enrichment";
import { decideLeadRoute } from "@/lib/router";
import type { TriageResult } from "@/lib/schemas";
import type { CombinedPromptInjectionScanResult } from "@/lib/security";

const baseTriage: TriageResult = {
  intent: "Enterprise inbound automation evaluation",
  urgency: "high",
  company_size_estimate: "200-500",
  icp_score: 90,
  suggested_route: "sales_enterprise",
  confidence_score: 0.9,
  reasoning: "Clear enterprise ICP fit with concrete workflow requirements.",
  draft_reply: "Hi there, thanks for reaching out—let's schedule a walkthrough.",
};

const okEnrichment: EnrichmentOutcome = {
  ok: true,
  summary: "Acme Cloud builds B2B developer tooling.",
  sourceUrl: "https://acmecloud.io",
  durationMs: 420,
};

const failedEnrichment: EnrichmentOutcome = {
  ok: false,
  reason: "timeout",
  fallback: true,
  durationMs: 4500,
};

const cleanScan: CombinedPromptInjectionScanResult = {
  detected: false,
  source: "none",
  matchedPatterns: [],
};

const flaggedScan: CombinedPromptInjectionScanResult = {
  detected: true,
  source: "lead_input",
  matchedPatterns: ["ignore_or_forget_instructions"],
};

describe("decideLeadRoute", () => {
  it("routes to needs_human_review with llm_unavailable when triage is null", () => {
    const decision = decideLeadRoute({
      triage: null,
      enrichment: okEnrichment,
      promptInjection: cleanScan,
    });
    expect(decision).toEqual({
      status: "needs_human_review",
      reason: "llm_unavailable",
      suggestedRoute: null,
    });
  });

  it("routes confidence_score = 0.80 with ok enrichment to auto_routed", () => {
    const decision = decideLeadRoute({
      triage: { ...baseTriage, confidence_score: 0.8 },
      enrichment: okEnrichment,
      promptInjection: cleanScan,
    });
    expect(decision).toEqual({
      status: "auto_routed",
      reason: "high_confidence_verified",
      suggestedRoute: "sales_enterprise",
    });
  });

  it("routes confidence_score = 0.79 with ok enrichment to needs_human_review", () => {
    const decision = decideLeadRoute({
      triage: { ...baseTriage, confidence_score: 0.79 },
      enrichment: okEnrichment,
      promptInjection: cleanScan,
    });
    expect(decision).toEqual({
      status: "needs_human_review",
      reason: "below_confidence_threshold",
      suggestedRoute: "sales_enterprise",
    });
  });

  it("forces needs_human_review when enrichment fails for non-spam leads", () => {
    const decision = decideLeadRoute({
      triage: { ...baseTriage, confidence_score: 0.96 },
      enrichment: failedEnrichment,
      promptInjection: cleanScan,
    });
    expect(decision).toEqual({
      status: "needs_human_review",
      reason: "enrichment_unavailable",
      suggestedRoute: "sales_enterprise",
    });
  });

  it("auto-rejects high-confidence spam even when enrichment fails (separate from auto_routed)", () => {
    const decision = decideLeadRoute({
      triage: {
        ...baseTriage,
        suggested_route: "spam",
        confidence_score: 0.88,
        icp_score: 2,
      },
      enrichment: failedEnrichment,
      promptInjection: cleanScan,
    });
    expect(decision).toEqual({
      status: "auto_rejected",
      reason: "high_confidence_spam",
      suggestedRoute: "spam",
    });
  });

  it("sends low-confidence spam (< 0.80) to needs_human_review", () => {
    const decision = decideLeadRoute({
      triage: {
        ...baseTriage,
        suggested_route: "spam",
        confidence_score: 0.79,
      },
      enrichment: okEnrichment,
      promptInjection: cleanScan,
    });
    expect(decision).toEqual({
      status: "needs_human_review",
      reason: "below_confidence_threshold",
      suggestedRoute: "spam",
    });
  });

  it("flags disposable email domains for human review on non-spam leads", () => {
    const decision = decideLeadRoute({
      triage: { ...baseTriage, confidence_score: 0.95 },
      enrichment: okEnrichment,
      promptInjection: cleanScan,
      emailDomain: "disposable",
    });
    expect(decision).toEqual({
      status: "needs_human_review",
      reason: "disposable_email_flagged",
      suggestedRoute: "sales_enterprise",
    });
  });

  it("always overrides to needs_human_review when prompt injection is detected", () => {
    const decision = decideLeadRoute({
      triage: { ...baseTriage, confidence_score: 0.99 },
      enrichment: okEnrichment,
      promptInjection: flaggedScan,
    });
    expect(decision).toEqual({
      status: "needs_human_review",
      reason: "prompt_injection_flagged",
      suggestedRoute: "sales_enterprise",
    });
  });
});
