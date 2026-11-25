import type { LeadStatus, SuggestedRoute } from "@/lib/schemas";

export interface StatusPresentation {
  readonly label: string;
  readonly dotClass: string;
  readonly textClass: string;
}

export function getStatusPresentation(status: LeadStatus): StatusPresentation {
  switch (status) {
    case "auto_routed":
      return {
        label: "Auto-Routed",
        dotClass: "bg-[#166534]",
        textClass: "text-[#166534]",
      };
    case "approved":
      return {
        label: "Approved",
        dotClass: "bg-[#166534]",
        textClass: "text-[#166534]",
      };
    case "needs_human_review":
      return {
        label: "Needs Human Review",
        dotClass: "bg-[#b45309]",
        textClass: "text-[#b45309]",
      };
    case "auto_rejected":
      return {
        label: "Auto-Rejected (Spam)",
        dotClass: "bg-[#991b1b]",
        textClass: "text-[#991b1b]",
      };
    case "rejected":
      return {
        label: "Rejected",
        dotClass: "bg-[#991b1b]",
        textClass: "text-[#991b1b]",
      };
  }
}

export function formatRouteLabel(route: SuggestedRoute | null | undefined): string {
  switch (route) {
    case "sales_enterprise":
      return "Sales · Enterprise";
    case "sales_smb":
      return "Sales · SMB";
    case "support":
      return "Customer Support";
    case "spam":
      return "Spam Filter";
    default:
      return "Unassigned";
  }
}

export function formatRoutingReason(reason: string): string {
  switch (reason) {
    case "high_confidence_verified":
      return "Confidence ≥ 0.80 with verified company enrichment";
    case "high_confidence_spam":
      return "High-confidence spam filtered automatically";
    case "below_confidence_threshold":
      return "Confidence below 0.80 threshold — escalated for review";
    case "enrichment_unavailable":
      return "Company site enrichment unavailable — degraded safely to review";
    case "prompt_injection_flagged":
      return "Prompt-injection tripwire triggered — deterministic override to review";
    case "disposable_email_flagged":
      return "Disposable email domain flagged — escalated for review";
    case "llm_unavailable":
      return "LLM unavailable — lead persisted safely without dropping";
    case "deduplicated_existing_lead":
      return "Duplicate submission within 10-minute idempotency window";
    default:
      return reason.replace(/_/g, " ");
  }
}

export function formatRelativeTime(isoDate: string): string {
  const ts = Date.parse(isoDate);
  if (Number.isNaN(ts)) return isoDate;
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}
