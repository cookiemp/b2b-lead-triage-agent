import type { LeadStatus, SuggestedRoute } from "@/lib/schemas";

export interface StatusPresentation {
  readonly label: string;
  readonly shortLabel: string;
  readonly dotClass: string;
  readonly textClass: string;
  readonly surfaceClass: string;
}

export function getStatusPresentation(status: LeadStatus): StatusPresentation {
  switch (status) {
    case "auto_routed":
      return {
        label: "Auto-Routed",
        shortLabel: "Auto-Routed",
        dotClass: "bg-[#059669]",
        textClass: "text-[#047857]",
        surfaceClass: "bg-[#ecfdf5] text-[#047857]",
      };
    case "approved":
      return {
        label: "Approved",
        shortLabel: "Approved",
        dotClass: "bg-[#059669]",
        textClass: "text-[#047857]",
        surfaceClass: "bg-[#ecfdf5] text-[#047857]",
      };
    case "needs_human_review":
      return {
        label: "Needs Review",
        shortLabel: "Review",
        dotClass: "bg-[#d97706]",
        textClass: "text-[#b45309]",
        surfaceClass: "bg-[#fffbeb] text-[#b45309]",
      };
    case "auto_rejected":
      return {
        label: "Auto-Rejected",
        shortLabel: "Spam",
        dotClass: "bg-[#dc2626]",
        textClass: "text-[#b91c1c]",
        surfaceClass: "bg-[#fef2f2] text-[#b91c1c]",
      };
    case "rejected":
      return {
        label: "Rejected",
        shortLabel: "Rejected",
        dotClass: "bg-[#dc2626]",
        textClass: "text-[#b91c1c]",
        surfaceClass: "bg-[#fef2f2] text-[#b91c1c]",
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
      return "Support";
    case "spam":
      return "Spam";
    default:
      return "Unassigned";
  }
}

export function formatRoutingReason(reason: string): string {
  switch (reason) {
    case "high_confidence_verified":
      return "Confidence ≥ 0.80 with verified domain enrichment";
    case "high_confidence_spam":
      return "High-confidence spam auto-filtered";
    case "below_confidence_threshold":
      return "Confidence below 0.80 gate — escalated";
    case "enrichment_unavailable":
      return "Domain enrichment unavailable — degraded to review";
    case "prompt_injection_flagged":
      return "Prompt-injection tripwire — deterministic override";
    case "disposable_email_flagged":
      return "Disposable email domain — escalated";
    case "llm_unavailable":
      return "LLM unavailable — saved safely for manual review";
    case "deduplicated_existing_lead":
      return "Duplicate within 10-minute idempotency window";
    default:
      return reason.replace(/_/g, " ");
  }
}

export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function formatRelativeTime(isoDate: string): string {
  const ts = Date.parse(isoDate);
  if (Number.isNaN(ts)) return isoDate;
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return `${diffSec}s`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d`;
}
