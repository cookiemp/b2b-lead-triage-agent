"use client";

import { useEffect, useState } from "react";
import {
  Check,
  Code2,
  Copy,
  ExternalLink,
  Globe,
  Loader2,
  ShieldAlert,
  Sparkles,
  X,
} from "lucide-react";
import type { LeadWithAuditLogs } from "@/lib/db";
import type { TriagePipelineResponse } from "@/lib/pipeline";
import {
  extractDomain,
  formatRelativeTime,
  formatRouteLabel,
  formatRoutingReason,
  getStatusPresentation,
} from "@/components/status-format";

interface LeadInspectorProps {
  readonly lead: LeadWithAuditLogs | null;
  readonly lastRunMeta: TriagePipelineResponse | null;
  readonly onLeadUpdated: (leadId: string) => Promise<void>;
  readonly onOpenSimulator: () => void;
}

export function LeadInspector({
  lead,
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

  if (lead === null) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center bg-[#ffffff] px-6 text-center">
        <p className="text-sm font-medium text-[#111113]">No lead selected</p>
        <p className="mt-1 max-w-xs text-xs text-[#71717a]">
          Select an inquiry from the inbox or simulate a live B2B lead to
          inspect enrichment, Gemini classification, and Langfuse telemetry.
        </p>
        <button
          type="button"
          onClick={onOpenSimulator}
          className="mt-4 cursor-pointer rounded-md bg-[#111113] px-3.5 py-2 text-xs font-medium text-[#ffffff] transition-colors hover:bg-[#27272a]"
        >
          Simulate Inbound Lead
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
          ? "Approved and logged to audit trail."
          : "Rejected and logged to audit trail.",
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
      {/* Sticky 48px Inspector Header */}
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-[#e8e8ec] px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] font-medium ${statusInfo.surfaceClass}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${statusInfo.dotClass}`} />
            {statusInfo.label}
          </span>
          {routingReason && (
            <span className="hidden truncate text-xs text-[#71717a] sm:inline">
              {formatRoutingReason(routingReason)}
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {lead.langfuse_trace_id && (
            <button
              type="button"
              onClick={() => void copyValue(lead.langfuse_trace_id!, "trace")}
              className="hidden cursor-pointer items-center gap-1.5 rounded border border-[#e8e8ec] px-2 py-1 font-mono text-[11px] text-[#52525b] transition-colors hover:border-[#d4d4dc] hover:text-[#111113] md:inline-flex"
              title="Copy Langfuse OTLP trace ID"
            >
              <span>{lead.langfuse_trace_id.slice(0, 8)}</span>
              {copiedTrace ? (
                <Check className="h-3 w-3 text-[#059669]" />
              ) : (
                <Copy className="h-3 w-3 text-[#71717a]" />
              )}
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowJson((v) => !v)}
            className={`inline-flex cursor-pointer items-center gap-1 rounded border px-2 py-1 text-[11px] font-medium transition-colors ${
              showJson
                ? "border-[#111113] bg-[#111113] text-[#ffffff]"
                : "border-[#e8e8ec] text-[#52525b] hover:border-[#d4d4dc] hover:text-[#111113]"
            }`}
          >
            <Code2 className="h-3 w-3" />
            <span>JSON</span>
          </button>

          {isReviewable && (
            <>
              <div className="mx-0.5 h-4 w-px bg-[#e8e8ec]" />
              <button
                type="button"
                disabled={acting !== null}
                onClick={() => void handleDecision("rejected")}
                className="inline-flex cursor-pointer items-center gap-1 rounded border border-[#e8e8ec] px-2.5 py-1 text-xs font-medium text-[#b91c1c] transition-colors hover:border-[#dc2626]/40 hover:bg-[#fef2f2] disabled:opacity-50"
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
                className="inline-flex cursor-pointer items-center gap-1 rounded bg-[#111113] px-2.5 py-1 text-xs font-medium text-[#ffffff] transition-colors hover:bg-[#27272a] disabled:opacity-50"
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

      {/* Scrollable Inspector Body: Main Thread + Right Properties Rail */}
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto xl:grid-cols-[minmax(0,1fr)_280px]">
        {/* Main Thread */}
        <div className="min-w-0 px-6 py-6">
          {/* Fresh live-run notice */}
          {activeRun && (
            <div className="mb-5 flex flex-wrap items-center justify-between gap-2 rounded-md border border-[#e8e8ec] bg-[#f8f8f9] px-3.5 py-2 text-xs text-[#52525b]">
              <span className="inline-flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-[#111113]" />
                {activeRun.deduplicated ? (
                  <span>
                    Returned cached result (10-minute idempotency window hit).
                  </span>
                ) : (
                  <span>
                    Live pipeline run completed via{" "}
                    <span className="font-mono font-medium text-[#111113]">
                      {activeRun.model_used ?? "fallback"}
                    </span>
                    {activeRun.fallback_attempts.length > 0 &&
                      ` (auto-recovered after ${activeRun.fallback_attempts.length} fallback)`}
                    .
                  </span>
                )}
              </span>
            </div>
          )}

          {errorMessage && (
            <div className="mb-4 rounded-md border border-[#dc2626]/20 bg-[#fef2f2] px-3.5 py-2.5 text-xs text-[#b91c1c]">
              {errorMessage}
            </div>
          )}

          {feedback && (
            <div className="mb-4 rounded-md border border-[#059669]/20 bg-[#ecfdf5] px-3.5 py-2.5 text-xs text-[#047857]">
              {feedback}
            </div>
          )}

          {/* Subject / Lead Header */}
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-[#111113]">
              {triage?.intent ?? "Manual Review Required (Degraded Triage)"}
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#52525b]">
              <span className="font-medium text-[#111113]">{lead.name}</span>
              <span className="text-[#71717a]">&lt;{lead.email}&gt;</span>
              <span className="text-[#d4d4dc]">·</span>
              <a
                href={lead.company_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-mono text-[11px] text-[#52525b] hover:text-[#111113] hover:underline"
              >
                {extractDomain(lead.company_url)}
                <ExternalLink className="h-3 w-3" />
              </a>
              <span className="text-[#d4d4dc]">·</span>
              <span className="text-[#71717a]">
                {formatRelativeTime(lead.created_at)} ago
              </span>
            </div>
          </div>

          {/* Security / Degraded Alert */}
          {(lead.prompt_injection_detected || triage === null) && (
            <div className="mt-5 flex items-start gap-2.5 rounded-md border border-[#dc2626]/20 bg-[#fef2f2] px-3.5 py-2.5 text-xs text-[#b91c1c]">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                {lead.prompt_injection_detected ? (
                  <span>
                    <strong className="font-semibold">
                      Prompt-injection tripwire triggered.
                    </strong>{" "}
                    Deterministic router overrode LLM confidence and locked this
                    lead in Human Review.
                  </span>
                ) : (
                  <span>
                    <strong className="font-semibold">
                      Upstream LLM unavailable.
                    </strong>{" "}
                    Lead was persisted safely instead of dropping with HTTP 502.
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Inbound Message */}
          <div className="mt-6">
            <div className="text-[11px] font-medium tracking-wide text-[#71717a] uppercase">
              Inbound Inquiry
            </div>
            <div className="mt-2 rounded-md border border-[#e8e8ec] bg-[#f8f8f9] px-4 py-3.5 text-sm leading-relaxed text-[#111113] whitespace-pre-wrap">
              {lead.message}
            </div>
          </div>

          {/* Grounded AI Reasoning */}
          {triage && (
            <div className="mt-6">
              <div className="text-[11px] font-medium tracking-wide text-[#71717a] uppercase">
                Triage Assessment
              </div>
              <p className="mt-2 max-w-[65ch] text-sm leading-relaxed text-[#52525b]">
                {triage.reasoning}
              </p>
            </div>
          )}

          {/* Reply Composer */}
          <div className="mt-6">
            <div className="flex items-center justify-between">
              <label
                htmlFor="reply-composer"
                className="text-[11px] font-medium tracking-wide text-[#71717a] uppercase"
              >
                Draft Reply {isReviewable && "· Editable"}
              </label>
              {draftEdit.trim().length > 0 && (
                <button
                  type="button"
                  onClick={() => void copyValue(draftEdit, "reply")}
                  className="inline-flex cursor-pointer items-center gap-1 text-xs text-[#52525b] hover:text-[#111113]"
                >
                  {copiedReply ? (
                    <>
                      <Check className="h-3 w-3 text-[#059669]" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" />
                      <span>Copy draft</span>
                    </>
                  )}
                </button>
              )}
            </div>

            <div className="mt-2 overflow-hidden rounded-md border border-[#e8e8ec] bg-[#ffffff] focus-within:border-[#111113]">
              <div className="flex items-center justify-between border-b border-[#e8e8ec] bg-[#f8f8f9] px-3.5 py-2 text-xs text-[#71717a]">
                <span>
                  To:{" "}
                  <span className="font-mono text-[#111113]">{lead.email}</span>
                </span>
                <span className="text-[11px]">
                  {isReviewable ? "Pending operator approval" : statusInfo.label}
                </span>
              </div>
              <textarea
                id="reply-composer"
                rows={4}
                value={draftEdit}
                onChange={(e) => setDraftEdit(e.target.value)}
                disabled={!isReviewable}
                placeholder="Write a tailored response before approving..."
                className="w-full resize-y px-3.5 py-3 text-sm leading-relaxed text-[#111113] outline-none disabled:bg-[#f8f8f9]/50 disabled:text-[#52525b]"
              />
              {isReviewable && (
                <div className="flex items-center justify-between border-t border-[#e8e8ec] bg-[#f8f8f9] px-3.5 py-2">
                  <span className="text-[11px] text-[#71717a]">
                    Edits are saved to Supabase &amp; recorded in audit logs.
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={acting !== null}
                      onClick={() => void handleDecision("rejected")}
                      className="cursor-pointer rounded border border-[#d4d4dc] bg-[#ffffff] px-2.5 py-1 text-xs font-medium text-[#b91c1c] hover:bg-[#fef2f2] disabled:opacity-50"
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      disabled={acting !== null}
                      onClick={() => void handleDecision("approved")}
                      className="cursor-pointer rounded bg-[#111113] px-3 py-1 text-xs font-medium text-[#ffffff] hover:bg-[#27272a] disabled:opacity-50"
                    >
                      Approve &amp; Finalize
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Collapsible Raw JSON */}
          {showJson && (
            <div className="mt-6">
              <div className="text-[11px] font-medium tracking-wide text-[#71717a] uppercase">
                Raw API Payload
              </div>
              <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-[#111113] p-4 font-mono text-[11px] leading-relaxed text-[#f4f4f6]">
                {JSON.stringify(activeRun ?? lead, null, 2)}
              </pre>
            </div>
          )}
        </div>

        {/* Right Properties & Audit Rail */}
        <aside className="border-t border-[#e8e8ec] bg-[#f8f8f9]/60 px-5 py-6 xl:border-t-0 xl:border-l">
          <div className="text-[11px] font-medium tracking-wide text-[#71717a] uppercase">
            Properties
          </div>

          <dl className="mt-3 space-y-3 text-xs">
            <div className="flex items-center justify-between gap-2">
              <dt className="text-[#71717a]">Route</dt>
              <dd className="font-medium text-[#111113]">
                {formatRouteLabel(triage?.suggested_route)}
              </dd>
            </div>

            <div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-[#71717a]">Confidence</dt>
                <dd className="font-mono font-medium tabular-nums text-[#111113]">
                  {lead.confidence_score !== null
                    ? `${lead.confidence_score.toFixed(2)} / 1.00`
                    : "—"}
                </dd>
              </div>
              {confidencePct !== null && (
                <div className="relative mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[#e8e8ec]">
                  <div
                    className={`h-full rounded-full ${
                      confidencePct >= 80 ? "bg-[#059669]" : "bg-[#d97706]"
                    }`}
                    style={{ width: `${Math.min(100, Math.max(0, confidencePct))}%` }}
                  />
                  <div
                    className="absolute top-0 bottom-0 w-px bg-[#111113]/40"
                    style={{ left: "80%" }}
                    title="0.80 Auto-Route Gate"
                  />
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-2">
              <dt className="text-[#71717a]">ICP Score</dt>
              <dd className="font-mono font-medium tabular-nums text-[#111113]">
                {lead.icp_score !== null ? `${lead.icp_score} / 100` : "—"}
              </dd>
            </div>

            <div className="flex items-center justify-between gap-2">
              <dt className="text-[#71717a]">Urgency</dt>
              <dd className="capitalize text-[#111113]">
                {triage?.urgency ?? "—"}
              </dd>
            </div>

            <div className="flex items-center justify-between gap-2">
              <dt className="text-[#71717a]">Company Size</dt>
              <dd className="text-[#111113]">
                {triage?.company_size_estimate ?? "Unknown"}
              </dd>
            </div>

            <div className="flex items-center justify-between gap-2">
              <dt className="text-[#71717a]">Source</dt>
              <dd className="font-mono text-[11px] text-[#52525b]">
                {lead.source}
              </dd>
            </div>

            {modelUsed && (
              <div className="flex items-center justify-between gap-2">
                <dt className="text-[#71717a]">Model</dt>
                <dd className="font-mono text-[11px] text-[#111113]">
                  {modelUsed}
                </dd>
              </div>
            )}
          </dl>

          {/* Enriched Company Brief */}
          <div className="mt-6 border-t border-[#e8e8ec] pt-5">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-[#71717a] uppercase">
                <Globe className="h-3 w-3" />
                Enrichment
              </span>
              <span className="text-[11px] text-[#52525b]">
                {lead.enrichment_ok ? "Verified" : "Fallback"}
              </span>
            </div>
            <p className="mt-2 line-clamp-5 text-xs leading-relaxed text-[#52525b]">
              {lead.enriched_summary ??
                "Site timed out or returned an error within the 5.5s Jina Reader budget."}
            </p>
          </div>

          {/* Audit Timeline */}
          <div className="mt-6 border-t border-[#e8e8ec] pt-5">
            <div className="text-[11px] font-medium tracking-wide text-[#71717a] uppercase">
              Audit Trail
            </div>
            {lead.audit_logs.length === 0 ? (
              <p className="mt-2 text-xs text-[#71717a]">No entries yet.</p>
            ) : (
              <ol className="mt-3 space-y-2.5">
                {lead.audit_logs.map((entry) => (
                  <li key={entry.id} className="text-xs">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-mono text-[11px] font-medium text-[#111113]">
                        {entry.action}
                      </span>
                      <span className="font-mono text-[10px] text-[#71717a]">
                        {formatRelativeTime(entry.created_at)}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-[#71717a]">
                      by {entry.actor}
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
