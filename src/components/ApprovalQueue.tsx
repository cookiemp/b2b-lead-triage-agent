"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Check,
  ExternalLink,
  Loader2,
  RefreshCw,
  ShieldAlert,
  X,
} from "lucide-react";
import type { LeadWithAuditLogs } from "@/lib/db";
import {
  formatRelativeTime,
  formatRouteLabel,
  getStatusPresentation,
} from "@/components/status-format";

interface ApprovalQueueProps {
  readonly focusLeadId: string | null;
  readonly refreshToken: number;
  readonly onQueueMutated: () => void;
}

type QueueFilter = "needs_human_review" | "all";

export function ApprovalQueue({
  focusLeadId,
  refreshToken,
  onQueueMutated,
}: ApprovalQueueProps) {
  const [filter, setFilter] = useState<QueueFilter>("needs_human_review");
  const [leads, setLeads] = useState<readonly LeadWithAuditLogs[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(focusLeadId);
  const [draftEdit, setDraftEdit] = useState("");
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [acting, setActing] = useState<"approved" | "rejected" | null>(null);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  const loadLeads = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const qs =
        filter === "needs_human_review"
          ? "?status=needs_human_review&limit=50"
          : "?limit=50";
      const response = await fetch(`/api/leads${qs}`, { cache: "no-store" });
      const data = (await response.json()) as {
        leads?: LeadWithAuditLogs[];
        message?: string;
      };
      if (!response.ok) {
        setErrorMessage(
          data.message || `Failed to load leads (${response.status}).`,
        );
        setLeads([]);
        return;
      }

      const items = data.leads ?? [];
      setLeads(items);

      setSelectedId((prev) => {
        if (focusLeadId && items.some((l) => l.id === focusLeadId)) {
          return focusLeadId;
        }
        if (prev && items.some((l) => l.id === prev)) {
          return prev;
        }
        return items[0]?.id ?? null;
      });
    } catch {
      setErrorMessage("Network error while loading leads.");
    } finally {
      setLoading(false);
    }
  }, [filter, focusLeadId]);

  useEffect(() => {
    void loadLeads();
  }, [loadLeads, refreshToken]);

  const selectedLead = leads.find((l) => l.id === selectedId) ?? null;

  useEffect(() => {
    setDraftEdit(selectedLead?.draft_reply ?? "");
    setActionFeedback(null);
  }, [selectedLead?.id, selectedLead?.draft_reply]);

  async function handleDecision(status: "approved" | "rejected"): Promise<void> {
    if (!selectedLead) return;
    setActing(status);
    setErrorMessage(null);
    setActionFeedback(null);

    const trimmedDraft = draftEdit.trim();
    const originalDraft = (selectedLead.draft_reply ?? "").trim();
    const payload: {
      status: "approved" | "rejected";
      edited_draft_reply?: string;
      actor: string;
    } = {
      status,
      actor: "human_operator",
    };
    if (trimmedDraft.length > 0 && trimmedDraft !== originalDraft) {
      payload.edited_draft_reply = trimmedDraft;
    }

    try {
      const response = await fetch(`/api/leads/${selectedLead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as { message?: string };
      if (!response.ok) {
        setErrorMessage(data.message || `Update failed (${response.status}).`);
        return;
      }

      setActionFeedback(
        status === "approved"
          ? "Lead approved and audit trail recorded."
          : "Lead rejected and audit trail recorded.",
      );
      onQueueMutated();
      await loadLeads();
    } catch {
      setErrorMessage("Network error while saving decision.");
    } finally {
      setActing(null);
    }
  }

  return (
    <div>
      {/* Filter & Refresh Controls */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-md border border-[#e7e5e0] bg-[#ffffff] p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setFilter("needs_human_review")}
            className={`cursor-pointer rounded px-3 py-1.5 font-medium transition-colors ${
              filter === "needs_human_review"
                ? "bg-[#171614] text-[#fafaf8]"
                : "text-[#57534e] hover:text-[#171614]"
            }`}
          >
            Pending Review
          </button>
          <button
            type="button"
            onClick={() => setFilter("all")}
            className={`cursor-pointer rounded px-3 py-1.5 font-medium transition-colors ${
              filter === "all"
                ? "bg-[#171614] text-[#fafaf8]"
                : "text-[#57534e] hover:text-[#171614]"
            }`}
          >
            All Recent Leads
          </button>
        </div>

        <button
          type="button"
          onClick={() => void loadLeads()}
          disabled={loading}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[#e7e5e0] bg-[#ffffff] px-3 py-1.5 text-xs font-medium text-[#57534e] transition-colors hover:border-[#d6d3cc] hover:text-[#171614] disabled:opacity-60"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          <span>Refresh</span>
        </button>
      </div>

      {errorMessage && (
        <div className="mb-5 rounded-md border border-[#991b1b]/20 bg-[#991b1b]/5 px-4 py-3 text-xs text-[#991b1b]">
          {errorMessage}
        </div>
      )}

      {actionFeedback && (
        <div className="mb-5 rounded-md border border-[#166534]/20 bg-[#166534]/5 px-4 py-3 text-xs text-[#166534]">
          {actionFeedback}
        </div>
      )}

      {loading && leads.length === 0 ? (
        <div className="flex min-h-[320px] items-center justify-center rounded-lg border border-[#e7e5e0] bg-[#ffffff] text-sm text-[#78716c]">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading leads from Supabase…
        </div>
      ) : leads.length === 0 ? (
        <div className="flex min-h-[320px] flex-col items-center justify-center rounded-lg border border-dashed border-[#d6d3cc] bg-[#ffffff]/60 p-8 text-center">
          <h3 className="font-serif text-xl font-medium text-[#171614]">
            {filter === "needs_human_review"
              ? "Approval queue is clear"
              : "No leads recorded yet"}
          </h3>
          <p className="mt-1.5 max-w-[46ch] text-sm text-[#57534e]">
            {filter === "needs_human_review"
              ? "All escalated leads have been reviewed. Submit an Ambiguous or Prompt Injection preset in Live Triage to test the human-in-the-loop gate."
              : "Run a test preset in the Live Triage tab to populate Supabase."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
          {/* Left Rail: Scannable Queue List */}
          <div className="lg:col-span-4">
            <div className="divide-y divide-[#e7e5e0] overflow-hidden rounded-lg border border-[#e7e5e0] bg-[#ffffff]">
              {leads.map((lead) => {
                const isSelected = lead.id === selectedLead?.id;
                const statusInfo = getStatusPresentation(lead.status);
                return (
                  <button
                    key={lead.id}
                    type="button"
                    onClick={() => setSelectedId(lead.id)}
                    className={`w-full cursor-pointer px-4 py-3.5 text-left transition-colors ${
                      isSelected
                        ? "bg-[#f4f3ef]"
                        : "bg-[#ffffff] hover:bg-[#fafaf8]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-[#171614]">
                        {lead.name}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] text-[#78716c]">
                        {formatRelativeTime(lead.created_at)}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-[#57534e]">
                      {lead.email}
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[11px]">
                      <span
                        className={`inline-flex items-center gap-1.5 font-medium ${statusInfo.textClass}`}
                      >
                        <span
                          className={`h-2 w-2 rounded-full ${statusInfo.dotClass}`}
                        />
                        {statusInfo.label}
                      </span>
                      <span className="font-mono text-[#78716c]">
                        {lead.confidence_score !== null
                          ? `conf ${lead.confidence_score.toFixed(2)}`
                          : "degraded"}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right Inspector: Full Context, Editable Draft & Audit Trail */}
          <div className="lg:col-span-8">
            {selectedLead && (
              <div className="rounded-lg border border-[#e7e5e0] bg-[#ffffff] p-6 sm:p-8">
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#e7e5e0] pb-5">
                  <div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`h-2.5 w-2.5 rounded-full ${getStatusPresentation(selectedLead.status).dotClass}`}
                      />
                      <span
                        className={`text-xs font-semibold tracking-wide uppercase ${getStatusPresentation(selectedLead.status).textClass}`}
                      >
                        {getStatusPresentation(selectedLead.status).label}
                      </span>
                      <span className="text-xs text-[#78716c]">
                        · {selectedLead.source}
                      </span>
                    </div>
                    <h3 className="mt-1.5 font-serif text-2xl font-medium text-[#171614]">
                      {selectedLead.name}
                    </h3>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#57534e]">
                      <span>{selectedLead.email}</span>
                      <span>·</span>
                      <a
                        href={selectedLead.company_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-mono text-[#171614] underline decoration-[#d6d3cc] underline-offset-2 hover:decoration-[#171614]"
                      >
                        {selectedLead.company_url}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </div>

                  <div className="text-right font-mono text-xs text-[#57534e]">
                    <div>
                      Conf{" "}
                      <span className="font-semibold text-[#171614]">
                        {selectedLead.confidence_score !== null
                          ? selectedLead.confidence_score.toFixed(2)
                          : "—"}
                      </span>{" "}
                      · ICP{" "}
                      <span className="font-semibold text-[#171614]">
                        {selectedLead.icp_score ?? "—"}
                      </span>
                    </div>
                    <div className="mt-1 font-sans text-[11px] text-[#78716c]">
                      {formatRouteLabel(selectedLead.triage_json?.suggested_route)}
                    </div>
                  </div>
                </div>

                {selectedLead.prompt_injection_detected && (
                  <div className="mt-5 flex items-center gap-2 rounded-md border border-[#991b1b]/20 bg-[#991b1b]/5 px-3.5 py-2.5 text-xs font-medium text-[#991b1b]">
                    <ShieldAlert className="h-4 w-4 shrink-0" />
                    <span>
                      Prompt-injection tripwire flagged this lead before
                      routing.
                    </span>
                  </div>
                )}

                <div className="mt-6 space-y-5">
                  <div>
                    <h4 className="text-xs font-semibold text-[#171614]">
                      Inbound Message
                    </h4>
                    <p className="mt-1.5 max-w-[65ch] whitespace-pre-wrap text-sm leading-relaxed text-[#171614]">
                      {selectedLead.message}
                    </p>
                  </div>

                  {selectedLead.triage_json ? (
                    <div>
                      <h4 className="text-xs font-semibold text-[#171614]">
                        Gemini Assessment
                      </h4>
                      <p className="mt-1.5 max-w-[65ch] text-sm leading-relaxed text-[#57534e]">
                        {selectedLead.triage_json.reasoning}
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-md bg-[#f4f3ef] px-4 py-3 text-xs text-[#57534e]">
                      LLM triage was unavailable when this lead arrived; it was
                      persisted safely for manual handling.
                    </div>
                  )}

                  <div>
                    <h4 className="text-xs font-semibold text-[#171614]">
                      Scraped Company Context
                    </h4>
                    <p className="mt-1.5 line-clamp-4 max-w-[65ch] text-xs leading-relaxed text-[#57534e]">
                      {selectedLead.enriched_summary ||
                        "Enrichment unavailable (site timed out or returned an error)."}
                    </p>
                  </div>

                  {/* Editable Draft Reply + Approve/Reject Controls */}
                  <div>
                    <label
                      htmlFor="draft-reply-editor"
                      className="block text-xs font-semibold text-[#171614]"
                    >
                      Draft Reply
                      {selectedLead.status === "needs_human_review" && (
                        <span className="ml-1.5 font-normal text-[#78716c]">
                          (editable before approving)
                        </span>
                      )}
                    </label>
                    <textarea
                      id="draft-reply-editor"
                      rows={4}
                      value={draftEdit}
                      onChange={(e) => setDraftEdit(e.target.value)}
                      disabled={selectedLead.status !== "needs_human_review"}
                      placeholder="Write or refine the follow-up reply..."
                      className="mt-2 w-full resize-y rounded-md border border-[#e7e5e0] bg-[#fafaf8] px-3.5 py-2.5 text-sm leading-relaxed text-[#171614] outline-none transition-colors focus:border-[#171614] focus:bg-[#ffffff] disabled:cursor-default disabled:bg-[#f4f3ef] disabled:text-[#57534e]"
                    />

                    {selectedLead.status === "needs_human_review" && (
                      <div className="mt-4 flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          disabled={acting !== null}
                          onClick={() => void handleDecision("approved")}
                          className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-[#171614] px-4 py-2 text-xs font-medium text-[#fafaf8] transition-colors hover:bg-[#292524] disabled:opacity-60"
                        >
                          {acting === "approved" ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Check className="h-3.5 w-3.5" />
                          )}
                          <span>Approve &amp; Finalize</span>
                        </button>

                        <button
                          type="button"
                          disabled={acting !== null}
                          onClick={() => void handleDecision("rejected")}
                          className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[#d6d3cc] bg-[#ffffff] px-4 py-2 text-xs font-medium text-[#991b1b] transition-colors hover:border-[#991b1b] hover:bg-[#991b1b]/5 disabled:opacity-60"
                        >
                          {acting === "rejected" ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <X className="h-3.5 w-3.5" />
                          )}
                          <span>Reject Lead</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Audit Trail */}
                  <div className="border-t border-[#e7e5e0] pt-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h4 className="text-xs font-semibold text-[#171614]">
                        Audit Trail
                      </h4>
                      {selectedLead.langfuse_trace_id && (
                        <span className="font-mono text-[11px] text-[#78716c]">
                          Langfuse trace: {selectedLead.langfuse_trace_id}
                        </span>
                      )}
                    </div>

                    {selectedLead.audit_logs.length === 0 ? (
                      <p className="mt-2 text-xs text-[#78716c]">
                        No audit entries recorded.
                      </p>
                    ) : (
                      <ul className="mt-3 space-y-2.5">
                        {selectedLead.audit_logs.map((entry) => {
                          const modelUsed =
                            typeof entry.details_json?.model_used === "string"
                              ? entry.details_json.model_used
                              : null;
                          const reason =
                            typeof entry.details_json?.routing_reason === "string"
                              ? entry.details_json.routing_reason
                              : null;
                          return (
                            <li
                              key={entry.id}
                              className="flex flex-wrap items-baseline justify-between gap-2 text-xs"
                            >
                              <div>
                                <span className="font-mono font-medium text-[#171614]">
                                  {entry.action}
                                </span>
                                <span className="text-[#78716c]">
                                  {" "}
                                  by {entry.actor}
                                </span>
                                {reason && (
                                  <span className="text-[#57534e]">
                                    {" "}
                                    · {reason.replace(/_/g, " ")}
                                  </span>
                                )}
                                {modelUsed && (
                                  <span className="font-mono text-[11px] text-[#78716c]">
                                    {" "}
                                    ({modelUsed})
                                  </span>
                                )}
                              </div>
                              <span className="font-mono text-[11px] text-[#78716c]">
                                {formatRelativeTime(entry.created_at)}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
