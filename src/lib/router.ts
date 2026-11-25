import type { EnrichmentOutcome } from "@/lib/enrichment";
import type { SuggestedRoute, TriageResult } from "@/lib/schemas";
import type {
  CombinedPromptInjectionScanResult,
  EmailDomainClass,
  PromptInjectionScanResult,
} from "@/lib/security";

export const CONFIDENCE_AUTO_ROUTE_THRESHOLD = 0.8;

export type RoutingReason =
  | "llm_unavailable"
  | "prompt_injection_flagged"
  | "high_confidence_spam"
  | "disposable_email_flagged"
  | "enrichment_unavailable"
  | "below_confidence_threshold"
  | "high_confidence_verified";

export interface RoutingDecision {
  readonly status: "auto_routed" | "auto_rejected" | "needs_human_review";
  readonly reason: RoutingReason;
  readonly suggestedRoute: SuggestedRoute | null;
}

/**
 * Deterministic 7-priority routing policy:
 * 0. LLM unavailable (triage === null) -> needs_human_review (never drop an inbound lead).
 * 1. Prompt injection detected (input OR scraped site) -> ALWAYS needs_human_review.
 * 2. High-confidence spam (>= 0.80) -> auto_rejected even if enrichment failed
 *    (keeps spam out of both sales alerts and the human queue).
 * 3. Disposable email domain -> needs_human_review.
 * 4. Enrichment unavailable -> needs_human_review (graceful degradation).
 * 5. Confidence < 0.80 -> needs_human_review.
 * 6. Confidence >= 0.80 AND enrichment ok -> auto_routed.
 */
export function decideLeadRoute(params: {
  readonly triage: TriageResult | null;
  readonly enrichment: EnrichmentOutcome;
  readonly promptInjection:
    | PromptInjectionScanResult
    | CombinedPromptInjectionScanResult;
  readonly emailDomain?: EmailDomainClass;
}): RoutingDecision {
  const {
    triage,
    enrichment,
    promptInjection,
    emailDomain = "corporate",
  } = params;

  if (triage === null) {
    return {
      status: "needs_human_review",
      reason: "llm_unavailable",
      suggestedRoute: null,
    };
  }

  if (promptInjection.detected) {
    return {
      status: "needs_human_review",
      reason: "prompt_injection_flagged",
      suggestedRoute: triage.suggested_route,
    };
  }

  if (
    triage.suggested_route === "spam" &&
    triage.confidence_score >= CONFIDENCE_AUTO_ROUTE_THRESHOLD
  ) {
    return {
      status: "auto_rejected",
      reason: "high_confidence_spam",
      suggestedRoute: triage.suggested_route,
    };
  }

  if (emailDomain === "disposable") {
    return {
      status: "needs_human_review",
      reason: "disposable_email_flagged",
      suggestedRoute: triage.suggested_route,
    };
  }

  if (!enrichment.ok) {
    return {
      status: "needs_human_review",
      reason: "enrichment_unavailable",
      suggestedRoute: triage.suggested_route,
    };
  }

  if (triage.confidence_score < CONFIDENCE_AUTO_ROUTE_THRESHOLD) {
    return {
      status: "needs_human_review",
      reason: "below_confidence_threshold",
      suggestedRoute: triage.suggested_route,
    };
  }

  return {
    status: "auto_routed",
    reason: "high_confidence_verified",
    suggestedRoute: triage.suggested_route,
  };
}
