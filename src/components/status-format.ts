import type { LeadStatus, SuggestedRoute } from "@/lib/schemas";

export interface StatusPresentation {
  readonly label: string;
  readonly shortLabel: string;
  readonly dotClass: string;
}

export function getStatusPresentation(status: LeadStatus): StatusPresentation {
  switch (status) {
    case "auto_routed":
      return {
        label: "Auto-routed",
        shortLabel: "Auto-routed",
        dotClass: "bg-[#16a34a]",
      };
    case "approved":
      return {
        label: "Approved",
        shortLabel: "Approved",
        dotClass: "bg-[#16a34a]",
      };
    case "needs_human_review":
      return {
        label: "Needs review",
        shortLabel: "Needs review",
        dotClass: "bg-[#d97706]",
      };
    case "auto_rejected":
      return {
        label: "Auto-rejected",
        shortLabel: "Spam",
        dotClass: "bg-[#dc2626]",
      };
    case "rejected":
      return {
        label: "Rejected",
        shortLabel: "Rejected",
        dotClass: "bg-[#71717a]",
      };
  }
}

export function formatRouteLabel(
  route: SuggestedRoute | null | undefined,
): string {
  switch (route) {
    case "sales_enterprise":
      return "Enterprise sales";
    case "sales_smb":
      return "SMB sales";
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
      return "Cleared 0.80 confidence threshold with verified domain context.";
    case "high_confidence_spam":
      return "Filtered automatically as high-confidence spam.";
    case "below_confidence_threshold":
      return "Held for review because confidence is below 0.80.";
    case "enrichment_unavailable":
      return "Held for review because the company site could not be fetched.";
    case "prompt_injection_flagged":
      return "Held for review after prompt-injection patterns were detected.";
    case "disposable_email_flagged":
      return "Held for review because the sender used a disposable email domain.";
    case "llm_unavailable":
      return "Held for review because the model was unavailable.";
    case "deduplicated_existing_lead":
      return "Matched an existing submission from the last 10 minutes.";
    default:
      return reason.replace(/_/g, " ");
  }
}

export function formatAuditAction(action: string): string {
  switch (action) {
    case "triage_auto_routed":
      return "Auto-routed";
    case "triage_auto_rejected":
      return "Filtered as spam";
    case "triage_needs_human_review":
      return "Escalated for review";
    case "human_approved":
      return "Approved";
    case "human_rejected":
      return "Rejected";
    case "hubspot_synced":
      return "Synced to HubSpot";
    case "hubspot_sync_failed":
      return "HubSpot sync failed";
    default:
      return action.replace(/_/g, " ");
  }
}

export function formatActor(actor: string): string {
  switch (actor) {
    case "triage_agent":
      return "Triage agent";
    case "human_operator":
      return "Operator";
    case "hubspot_sync":
      return "HubSpot CRM";
    default:
      return actor.replace(/_/g, " ");
  }
}

export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
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
  if (diffSec < 45) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}
