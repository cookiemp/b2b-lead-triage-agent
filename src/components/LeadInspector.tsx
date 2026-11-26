"use client";

import { useEffect, useState } from "react";
import {
  Check,
  Code2,
  Copy,
  ExternalLink,
  Loader2,
  ShieldAlert,
  X,
} from "lucide-react";
import type { LeadWithAuditLogs } from "@/lib/db";
import type { TriagePipelineResponse } from "@/lib/pipeline";
import {
  extractDomain,
  formatActor,
  formatAuditAction,
  formatRelativeTime,
  formatRouteLabel,
  formatRoutingReason,
  getInitials,
  getStatusPresentation,
} from "@/components/status-format";

interface LeadInspectorProps {
  readonly lead: LeadWithAuditLogs | null;
  readonly loading?: boolean;
  readonly lastRunMeta: TriagePipelineResponse | null;
  readonly onLeadUpdated: (leadId: string) => Promise<void>;
  readonly onOpenSimulator: () => void;
}

export function LeadInspector({
  lead,
  loading = false,
  lastRunMeta,
  onLeadUpdated,
  onOpenSimulator,
}: LeadInspectorProps) {
  const [draftEdit, setDraftEdit] = useState("");
  const [acting, setActing] = useState<"approved" | "rejected" | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [showJson, setShowJson] = useState(false);
  const [copiedReply, setCopiedReply] = useState(false);
  const [copiedTrace, setCopiedTrace] = useState(false);

  useEffect(() => {
    setDraftEdit(lead?.draft_reply ?? "");
    setErrorMessage(null);
    setFeedback(null);
    setShowJson(false);
  }, [lead?.id, lead?.draft_reply]);

  if (loading && lead === null) {
    return (
      <div
        aria-label="Loading lead details"
        className="flex min-h-0 flex-1 flex-col bg-[#ffffff]"
      >
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-[#ececef] px-6">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-[#e4e4e7]" />
            <div className="h-3 w-24 animate-pulse rounded bg-[#ececef]" />
          </div>
          <div className="flex items-center gap-2">
            <div className="h-5 w-14 animate-pulse rounded bg-[#f4f4f6]" />
            <div className="h-5 w-12 animate-pulse rounded bg-[#f4f4f6]" />
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto xl:grid-cols-[minmax(0,1fr)_272px]">
          <div className="min-w-0 px-6 py-7 sm:px-8">
            <div className="h-5 w-64 animate-pulse rounded bg-[#ececef]" />

            <div className="mt-4 flex items-center gap-3">
              <div className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-[#f4f4f6]" />
              <div className="space-y-1.5">
                <div className="h-3 w-44 animate-pulse rounded bg-[#ececef]" />
                <div className="h-2.5 w-28 animate-pulse rounded bg-[#f4f4f6]" />
              </div>
            </div>

            <div className="mt-7 max-w-[65ch] space-y-2.5">
              <div className="h-3.5 w-full animate-pulse rounded bg-[#f4f4f6]" />
              <div className="h-3.5 w-11/12 animate-pulse rounded bg-[#f4f4f6]" />
              <div className="h-3.5 w-3/4 animate-pulse rounded bg-[#f4f4f6]" />
            </div>

            <div className="mt-7 border-t border-[#ececef] pt-6">
              <div className="h-3 w-20 animate-pulse rounded bg-[#ececef]" />
              <div className="mt-3 max-w-[65ch] space-y-2">
                <div className="h-3 w-full animate-pulse rounded bg-[#f4f4f6]" />
                <div className="h-3 w-5/6 animate-pulse rounded bg-[#f4f4f6]" />
              </div>
            </div>

            <div className="mt-7 border-t border-[#ececef] pt-6">
              <div className="h-3 w-28 animate-pulse rounded bg-[#ececef]" />
              <div className="mt-2.5 h-28 w-full animate-pulse rounded-lg border border-[#ececef] bg-[#fafafa]" />
            </div>
          </div>

          <aside className="border-t border-[#ececef] bg-[#fafafa]/70 px-5 py-7 xl:border-t-0 xl:border-l">
            <div className="h-3 w-14 animate-pulse rounded bg-[#ececef]" />
            <div className="mt-4 space-y-3.5">
              {[0, 1, 2, 3, 4, 5].map((idx) => (
                <div key={idx} className="flex items-center justify-between">
                  <div className="h-3 w-20 animate-pulse rounded bg-[#ececef]" />
                  <div className="h-3 w-16 animate-pulse rounded bg-[#e4e4e7]" />
                </div>
              ))}
            </div>

            <div className="mt-6 border-t border-[#ececef] pt-5">
              <div className="h-3 w-24 animate-pulse rounded bg-[#ececef]" />
              <div className="mt-3 space-y-2">
                <div className="h-2.5 w-full animate-pulse rounded bg-[#ececef]" />
                <div className="h-2.5 w-11/12 animate-pulse rounded bg-[#ececef]" />
                <div className="h-2.5 w-3/4 animate-pulse rounded bg-[#ececef]" />
              </div>
            </div>

            <div className="mt-6 border-t border-[#ececef] pt-5">
              <div className="h-3 w-16 animate-pulse rounded bg-[#ececef]" />
              <div className="mt-3 space-y-3">
                <div className="h-3 w-32 animate-pulse rounded bg-[#ececef]" />
                <div className="h-3 w-24 animate-pulse rounded bg-[#ececef]" />
              </div>
            </div>
          </aside>
        </div>
      </div>
    );
  }

  if (lead === null) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center bg-[#ffffff] px-6 text-center">
        <p className="text-sm font-medium text-[#111113]">No lead selected</p>
        <p className="mt-1 max-w-xs text-xs leading-relaxed text-[#71717a]">
          Choose an inquiry from the list or submit a test lead to inspect its
          classification and draft reply.
        </p>
        <button
          type="button"
          onClick={onOpenSimulator}
          className="mt-4 cursor-pointer rounded-md bg-[#111113] px-3.5 py-2 text-xs font-medium text-[#ffffff] transition-colors hover:bg-[#27272a]"
        >
          New lead
        </button>
      </div>
    );
  }

  const activeRun =
    lastRunMeta && lastRunMeta.lead.id === lead.id ? lastRunMeta : null;
  const statusInfo = getStatusPresentation(lead.status);
  const triage = lead.triage_json;
  const isReviewable = lead.status === "needs_human_review";

  const latestTriageAudit = lead.audit_logs.find((a) =>
    a.action.startsWith("triage_"),
  );
  const auditModelUsed =
    typeof latestTriageAudit?.details_json?.model_used === "string"
      ? latestTriageAudit.details_json.model_used
      : null;
  const auditRoutingReason =
    typeof latestTriageAudit?.details_json?.routing_reason === "string"
      ? latestTriageAudit.details_json.routing_reason
      : null;

  const modelUsed =
    activeRun && !activeRun.deduplicated
      ? activeRun.model_used
      : auditModelUsed;
  const routingReason = activeRun
    ? activeRun.routing_reason
    : auditRoutingReason;

  async function handleDecision(status: "approved" | "rejected"): Promise<void> {
    if (!lead) return;
    setActing(status);
    setErrorMessage(null);
    setFeedback(null);

    const trimmed = draftEdit.trim();
    const original = (lead.draft_reply ?? "").trim();
    const payload: {
      status: "approved" | "rejected";
      edited_draft_reply?: string;
      actor: string;
    } = {
      status,
      actor: "human_operator",
    };
    if (trimmed.length > 0 && trimmed !== original) {
      payload.edited_draft_reply = trimmed;
    }

    try {
      const response = await fetch(`/api/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as { message?: string };
      if (!response.ok) {
        setErrorMessage(data.message || `Update failed (${response.status}).`);
        return;
      }

      setFeedback(
        status === "approved"
          ? "Lead approved and recorded in activity."
          : "Lead rejected and recorded in activity.",
      );
      await onLeadUpdated(lead.id);
    } catch {
      setErrorMessage("Network error while saving decision.");
    } finally {
      setActing(null);
    }
  }

  async function copyValue(
    text: string,
    kind: "reply" | "trace",
  ): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      if (kind === "reply") {
        setCopiedReply(true);
        setTimeout(() => setCopiedReply(false), 1600);
      } else {
        setCopiedTrace(true);
        setTimeout(() => setCopiedTrace(false), 1600);
      }
    } catch {
      // Clipboard API unavailable; fail silently.
    }
  }

  const confidencePct =
    lead.confidence_score !== null
      ? Math.round(lead.confidence_score * 100)
      : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#ffffff]">
      {/* Top 48px Action Bar */}
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-[#ececef] px-6">
        <div className="flex min-w-0 items-center gap-2 text-xs">
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusInfo.dotClass}`}
          />
          <span className="font-medium text-[#111113]">{statusInfo.label}</span>
          {activeRun && !activeRun.deduplicated && activeRun.model_used && (
            <span className="hidden text-[#71717a] sm:inline">
              via{" "}
              <span className="font-mono text-[11px] text-[#52525b]">
                {activeRun.model_used}
              </span>
            </span>
          )}
          {activeRun?.deduplicated && (
            <span className="hidden text-[#71717a] sm:inline">
              (deduplicated)
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {lead.langfuse_trace_id && (
            <button
              type="button"
              onClick={() => void copyValue(lead.langfuse_trace_id!, "trace")}
              className="hidden cursor-pointer items-center gap-1.5 rounded px-2 py-1 font-mono text-[11px] text-[#71717a] transition-colors hover:bg-[#f4f4f6] hover:text-[#111113] md:inline-flex"
              title="Copy Langfuse trace ID"
            >
              <span>{lead.langfuse_trace_id.slice(0, 8)}</span>
              {copiedTrace ? (
                <Check className="h-3 w-3 text-[#16a34a]" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowJson((v) => !v)}
            className={`inline-flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
              showJson
                ? "bg-[#f4f4f6] text-[#111113]"
                : "text-[#71717a] hover:bg-[#f4f4f6] hover:text-[#111113]"
            }`}
          >
            <Code2 className="h-3.5 w-3.5" />
            <span>JSON</span>
          </button>

          {isReviewable && (
            <>
              <div className="mx-1 h-4 w-px bg-[#ececef]" />
              <button
                type="button"
                disabled={acting !== null}
                onClick={() => void handleDecision("rejected")}
                className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-[#e4e4e7] bg-[#ffffff] px-2.5 py-1 text-xs font-medium text-[#52525b] transition-colors hover:border-[#d4d4d8] hover:text-[#111113] disabled:opacity-50"
              >
                {acting === "rejected" ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <X className="h-3 w-3" />
                )}
                <span>Reject</span>
              </button>
              <button
                type="button"
                disabled={acting !== null}
                onClick={() => void handleDecision("approved")}
                className="inline-flex cursor-pointer items-center gap-1 rounded-md bg-[#111113] px-3 py-1 text-xs font-medium text-[#ffffff] transition-colors hover:bg-[#27272a] disabled:opacity-50"
              >
                {acting === "approved" ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Check className="h-3 w-3" />
                )}
                <span>Approve</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Main Content + Right Properties Sidebar */}
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto xl:grid-cols-[minmax(0,1fr)_272px]">
        <div className="min-w-0 px-6 py-7 sm:px-8">
          {errorMessage && (
            <div className="mb-5 rounded-md border border-[#dc2626]/20 bg-[#fef2f2] px-3.5 py-2.5 text-xs text-[#b91c1c]">
              {errorMessage}
            </div>
          )}

          {feedback && (
            <div className="mb-5 rounded-md border border-[#16a34a]/20 bg-[#f0fdf4] px-3.5 py-2.5 text-xs text-[#15803d]">
              {feedback}
            </div>
          )}

          {/* Subject & Sender Row */}
          <h2 className="text-[18px] font-semibold tracking-[-0.015em] text-[#111113]">
            {triage?.intent ?? "Manual review required"}
          </h2>

          <div className="mt-3 flex items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#e4e4e7] bg-[#f4f4f6] text-[11px] font-medium text-[#52525b]">
              {getInitials(lead.name)}
            </div>
            <div className="min-w-0 text-xs">
              <div className="flex flex-wrap items-center gap-x-1.5">
                <span className="font-medium text-[#111113]">{lead.name}</span>
                <span className="text-[#71717a]">{lead.email}</span>
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[#71717a]">
                <a
                  href={lead.company_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 hover:text-[#111113] hover:underline"
                >
                  {extractDomain(lead.company_url)}
                  <ExternalLink className="h-2.5 w-2.5" />
                </a>
                <span>·</span>
                <span>{formatRelativeTime(lead.created_at)}</span>
              </div>
            </div>
          </div>

          {/* Security / Degraded Notice */}
          {(lead.prompt_injection_detected || triage === null) && (
            <div className="mt-6 flex items-start gap-2.5 rounded-md border border-[#dc2626]/20 bg-[#fef2f2]/70 px-3.5 py-2.5 text-xs leading-relaxed text-[#991b1b]">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {lead.prompt_injection_detected
                  ? "Prompt-injection patterns were detected in this submission. Routing was locked to manual review regardless of model confidence."
                  : "The model was unavailable when this inquiry arrived. The lead was saved directly to review so nothing was dropped."}
              </span>
            </div>
          )}

          {/* Inbound Message (Clean prose, whitespace over boxes) */}
          <div className="mt-6 max-w-[65ch] text-[14px] leading-[1.65] text-[#18181b] whitespace-pre-wrap">
            {lead.message}
          </div>

          {/* Grounded Summary */}
          {(triage || routingReason) && (
            <div className="mt-7 border-t border-[#ececef] pt-6">
              <div className="text-xs font-medium text-[#71717a]">
                Assessment
              </div>
              {triage && (
                <p className="mt-2 max-w-[65ch] text-[13px] leading-relaxed text-[#52525b]">
                  {triage.reasoning}
                </p>
              )}
              {routingReason && (
                <p className="mt-1.5 text-xs text-[#71717a]">
                  {formatRoutingReason(routingReason)}
                </p>
              )}
            </div>
          )}

          {/* Reply Composer */}
          <div className="mt-7 border-t border-[#ececef] pt-6">
            <div className="flex items-center justify-between">
              <label
                htmlFor="reply-composer"
                className="text-xs font-medium text-[#71717a]"
              >
                Reply to {lead.name}
              </label>
              {draftEdit.trim().length > 0 && (
                <button
                  type="button"
                  onClick={() => void copyValue(draftEdit, "reply")}
                  className="inline-flex cursor-pointer items-center gap-1 text-xs text-[#71717a] transition-colors hover:text-[#111113]"
                >
                  {copiedReply ? (
                    <>
                      <Check className="h-3 w-3 text-[#16a34a]" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              )}
            </div>

            <div className="mt-2.5 overflow-hidden rounded-lg border border-[#e4e4e7] bg-[#ffffff] transition-colors focus-within:border-[#a1a1aa]">
              <textarea
                id="reply-composer"
                rows={4}
                value={draftEdit}
                onChange={(e) => setDraftEdit(e.target.value)}
                disabled={!isReviewable}
                placeholder="Write a reply before approving..."
                className="w-full resize-y px-3.5 py-3 text-[13px] leading-relaxed text-[#111113] outline-none disabled:bg-[#fafafa] disabled:text-[#52525b]"
              />
              {isReviewable && (
                <div className="flex items-center justify-between border-t border-[#ececef] bg-[#fafafa] px-3.5 py-2">
                  <span className="text-[11px] text-[#71717a]">
                    To {lead.email}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={acting !== null}
                      onClick={() => void handleDecision("rejected")}
                      className="cursor-pointer rounded-md border border-[#e4e4e7] bg-[#ffffff] px-2.5 py-1 text-xs font-medium text-[#52525b] hover:text-[#111113] disabled:opacity-50"
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      disabled={acting !== null}
                      onClick={() => void handleDecision("approved")}
                      className="cursor-pointer rounded-md bg-[#111113] px-3 py-1 text-xs font-medium text-[#ffffff] hover:bg-[#27272a] disabled:opacity-50"
                    >
                      Approve
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Raw JSON Drawer */}
          {showJson && (
            <div className="mt-7 border-t border-[#ececef] pt-6">
              <div className="text-xs font-medium text-[#71717a]">
                Raw payload
              </div>
              <pre className="mt-2 max-h-80 overflow-auto rounded-md border border-[#ececef] bg-[#fafafa] p-4 font-mono text-[11px] leading-relaxed text-[#18181b]">
                {JSON.stringify(activeRun ?? lead, null, 2)}
              </pre>
            </div>
          )}
        </div>

        {/* Right Details & Activity Rail */}
        <aside className="border-t border-[#ececef] bg-[#fafafa]/70 px-5 py-7 xl:border-t-0 xl:border-l">
          <div className="text-xs font-medium text-[#71717a]">Details</div>

          <dl className="mt-3.5 space-y-3 text-xs">
            <div className="flex items-center justify-between gap-2">
              <dt className="text-[#71717a]">Route</dt>
              <dd className="font-medium text-[#111113]">
                {formatRouteLabel(triage?.suggested_route)}
              </dd>
            </div>

            <div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-[#71717a]">Confidence</dt>
                <dd className="font-mono text-[11px] font-medium tabular-nums text-[#111113]">
                  {lead.confidence_score !== null
                    ? lead.confidence_score.toFixed(2)
                    : "-"}
                </dd>
              </div>
              {confidencePct !== null && (
                <div className="relative mt-1.5 h-[3px] w-full bg-[#e4e4e7]">
                  <div
                    className={`h-full ${
                      confidencePct >= 80 ? "bg-[#111113]" : "bg-[#d97706]"
                    }`}
                    style={{
                      width: `${Math.min(100, Math.max(0, confidencePct))}%`,
                    }}
                  />
                  <div
                    className="absolute -top-0.5 -bottom-0.5 w-px bg-[#a1a1aa]"
                    style={{ left: "80%" }}
                    title="0.80 threshold"
                  />
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-2">
              <dt className="text-[#71717a]">ICP fit</dt>
              <dd className="font-mono text-[11px] font-medium tabular-nums text-[#111113]">
                {lead.icp_score !== null ? `${lead.icp_score} / 100` : "-"}
              </dd>
            </div>

            <div className="flex items-center justify-between gap-2">
              <dt className="text-[#71717a]">Urgency</dt>
              <dd className="capitalize text-[#111113]">
                {triage?.urgency ?? "-"}
              </dd>
            </div>

            <div className="flex items-center justify-between gap-2">
              <dt className="text-[#71717a]">Company size</dt>
              <dd className="text-[#111113]">
                {triage?.company_size_estimate ?? "Unknown"}
              </dd>
            </div>

            <div className="flex items-center justify-between gap-2">
              <dt className="text-[#71717a]">Source</dt>
              <dd className="text-[#52525b]">{lead.source.replace("_", " ")}</dd>
            </div>

            {modelUsed && (
              <div className="flex items-center justify-between gap-2">
                <dt className="text-[#71717a]">Model</dt>
                <dd className="font-mono text-[11px] text-[#52525b]">
                  {modelUsed}
                </dd>
              </div>
            )}

            {lead.hubspot_sync_status && (
              <div className="flex items-center justify-between gap-2">
                <dt className="text-[#71717a]">HubSpot CRM</dt>
                <dd className="inline-flex items-center gap-1.5 text-[#111113]">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      lead.hubspot_sync_status === "synced"
                        ? "bg-[#16a34a]"
                        : lead.hubspot_sync_status === "failed"
                          ? "bg-[#dc2626]"
                          : "bg-[#a1a1aa]"
                    }`}
                  />
                  <span className="capitalize">{lead.hubspot_sync_status}</span>
                </dd>
              </div>
            )}
          </dl>

          {/* Company Context */}
          <div className="mt-6 border-t border-[#ececef] pt-5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-[#71717a]">Company context</span>
              <span className="text-[11px] text-[#71717a]">
                {lead.enrichment_ok ? "Fetched" : "Unavailable"}
              </span>
            </div>
            <p className="mt-2 line-clamp-5 text-xs leading-relaxed text-[#52525b]">
              {lead.enriched_summary ??
                "Company website timed out or returned an error."}
            </p>
          </div>

          {/* Activity Timeline */}
          <div className="mt-6 border-t border-[#ececef] pt-5">
            <div className="text-xs font-medium text-[#71717a]">Activity</div>
            {lead.audit_logs.length === 0 ? (
              <p className="mt-2 text-xs text-[#71717a]">No activity yet.</p>
            ) : (
              <ol className="mt-3 space-y-3">
                {lead.audit_logs.map((entry) => (
                  <li key={entry.id} className="text-xs">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium text-[#111113]">
                        {formatAuditAction(entry.action)}
                      </span>
                      <span className="text-[11px] text-[#71717a]">
                        {formatRelativeTime(entry.created_at)}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-[#71717a]">
                      {formatActor(entry.actor)}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
