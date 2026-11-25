"use client";

import { useState, type FormEvent } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Globe,
  Loader2,
  Send,
  ShieldAlert,
} from "lucide-react";
import type { TriagePipelineResponse } from "@/lib/pipeline";
import {
  createDemoRunNonce,
  DEMO_LEAD_PRESETS,
  type LeadPreset,
} from "@/lib/presets";
import {
  formatRouteLabel,
  formatRoutingReason,
  getStatusPresentation,
} from "@/components/status-format";

interface TriageWorkbenchProps {
  readonly onLeadTriaged: () => void;
  readonly onOpenApprovalQueue: (leadId?: string) => void;
}

interface FormState {
  name: string;
  email: string;
  company_url: string;
  message: string;
  idempotency_nonce: string;
}

const INITIAL_PRESET = DEMO_LEAD_PRESETS[0]!;

export function TriageWorkbench({
  onLeadTriaged,
  onOpenApprovalQueue,
}: TriageWorkbenchProps) {
  const [activePresetId, setActivePresetId] = useState<string | null>(
    INITIAL_PRESET.id,
  );
  const [form, setForm] = useState<FormState>({
    ...INITIAL_PRESET.values,
    idempotency_nonce: createDemoRunNonce(INITIAL_PRESET.id),
  });
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<TriagePipelineResponse | null>(null);
  const [showRawJson, setShowRawJson] = useState(false);
  const [copiedReply, setCopiedReply] = useState(false);
  const [copiedTrace, setCopiedTrace] = useState(false);

  function applyPreset(preset: LeadPreset): void {
    setActivePresetId(preset.id);
    setForm({
      ...preset.values,
      idempotency_nonce: createDemoRunNonce(preset.id),
    });
    setErrorMessage(null);
  }

  function updateField<K extends keyof Omit<FormState, "idempotency_nonce">>(
    field: K,
    value: string,
  ): void {
    setActivePresetId(null);
    setForm((prev) => ({
      ...prev,
      [field]: value,
      idempotency_nonce: createDemoRunNonce("custom"),
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/triage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          company_url: form.company_url,
          message: form.message,
          source: "web_demo",
          idempotency_nonce: form.idempotency_nonce,
        }),
      });

      const data = (await response.json()) as
        | TriagePipelineResponse
        | { error?: string; message?: string; details?: Array<{ path: string; message: string }> };

      if (!response.ok) {
        const errObj = data as {
          message?: string;
          details?: Array<{ path: string; message: string }>;
        };
        const detailText = errObj.details
          ?.map((d) => `${d.path}: ${d.message}`)
          .join(" · ");
        setErrorMessage(
          detailText || errObj.message || `Request failed (${response.status}).`,
        );
        return;
      }

      setResult(data as TriagePipelineResponse);
      setShowRawJson(false);
      onLeadTriaged();
    } catch {
      setErrorMessage("Network error while contacting /api/triage.");
    } finally {
      setSubmitting(false);
    }
  }

  async function copyText(
    value: string,
    kind: "reply" | "trace",
  ): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      if (kind === "reply") {
        setCopiedReply(true);
        setTimeout(() => setCopiedReply(false), 1800);
      } else {
        setCopiedTrace(true);
        setTimeout(() => setCopiedTrace(false), 1800);
      }
    } catch {
      // Clipboard API unavailable in non-secure contexts; fail silently.
    }
  }

  const activePreset = DEMO_LEAD_PRESETS.find((p) => p.id === activePresetId);

  return (
    <div className="grid grid-cols-1 gap-10 lg:grid-cols-12">
      {/* Left column: Inbound lead form + one-click presets */}
      <section className="lg:col-span-5">
        <div className="mb-6">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold tracking-tight text-[#171614]">
              Test Scenarios
            </h2>
            {activePreset && (
              <span className="text-xs text-[#78716c]">
                {activePreset.expectedOutcome}
              </span>
            )}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {DEMO_LEAD_PRESETS.map((preset) => {
              const isActive = preset.id === activePresetId;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyPreset(preset)}
                  className={`cursor-pointer rounded-md border px-3 py-2 text-left text-xs font-medium transition-colors ${
                    isActive
                      ? "border-[#171614] bg-[#171614] text-[#fafaf8]"
                      : "border-[#e7e5e0] bg-[#ffffff] text-[#171614] hover:border-[#d6d3cc] hover:bg-[#f4f3ef]"
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-lg border border-[#e7e5e0] bg-[#ffffff] p-6"
        >
          <div className="space-y-4">
            <div>
              <label
                htmlFor="lead-name"
                className="block text-xs font-medium text-[#57534e]"
              >
                Full Name
              </label>
              <input
                id="lead-name"
                type="text"
                required
                value={form.name}
                onChange={(e) => updateField("name", e.target.value)}
                placeholder="Elena Rostova"
                className="mt-1.5 w-full rounded-md border border-[#e7e5e0] bg-[#fafaf8] px-3 py-2 text-sm text-[#171614] outline-none transition-colors focus:border-[#171614] focus:bg-[#ffffff]"
              />
            </div>

            <div>
              <label
                htmlFor="lead-email"
                className="block text-xs font-medium text-[#57534e]"
              >
                Work Email
              </label>
              <input
                id="lead-email"
                type="email"
                required
                value={form.email}
                onChange={(e) => updateField("email", e.target.value)}
                placeholder="elena@company.com"
                className="mt-1.5 w-full rounded-md border border-[#e7e5e0] bg-[#fafaf8] px-3 py-2 text-sm text-[#171614] outline-none transition-colors focus:border-[#171614] focus:bg-[#ffffff]"
              />
            </div>

            <div>
              <label
                htmlFor="lead-url"
                className="block text-xs font-medium text-[#57534e]"
              >
                Company Website
              </label>
              <input
                id="lead-url"
                type="url"
                required
                value={form.company_url}
                onChange={(e) => updateField("company_url", e.target.value)}
                placeholder="https://company.com"
                className="mt-1.5 w-full rounded-md border border-[#e7e5e0] bg-[#fafaf8] px-3 py-2 font-mono text-xs text-[#171614] outline-none transition-colors focus:border-[#171614] focus:bg-[#ffffff]"
              />
            </div>

            <div>
              <label
                htmlFor="lead-message"
                className="block text-xs font-medium text-[#57534e]"
              >
                Inbound Inquiry
              </label>
              <textarea
                id="lead-message"
                required
                rows={4}
                value={form.message}
                onChange={(e) => updateField("message", e.target.value)}
                placeholder="Describe the prospect's inquiry..."
                className="mt-1.5 w-full resize-y rounded-md border border-[#e7e5e0] bg-[#fafaf8] px-3 py-2 text-sm leading-relaxed text-[#171614] outline-none transition-colors focus:border-[#171614] focus:bg-[#ffffff]"
              />
            </div>
          </div>

          {errorMessage && (
            <div className="mt-4 flex items-start gap-2 rounded-md border border-[#991b1b]/20 bg-[#991b1b]/5 px-3 py-2.5 text-xs text-[#991b1b]">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="mt-5 flex w-full cursor-pointer items-center justify-center gap-2 rounded-md bg-[#171614] px-4 py-2.5 text-sm font-medium text-[#fafaf8] transition-colors hover:bg-[#292524] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Enriching domain &amp; evaluating with Gemini…</span>
              </>
            ) : (
              <>
                <Send className="h-3.5 w-3.5" />
                <span>Run Triage Pipeline</span>
              </>
            )}
          </button>

          <p className="mt-3 text-center text-[11px] text-[#78716c]">
            Each preset click mints a fresh run nonce. Clicking submit twice
            reuses the same key to demonstrate idempotent deduplication.
          </p>
        </form>
      </section>

      {/* Right column: Live verdict readout */}
      <section className="lg:col-span-7">
        {result === null ? (
          <div className="flex h-full min-h-[420px] flex-col justify-center rounded-lg border border-dashed border-[#d6d3cc] bg-[#ffffff]/60 p-8">
            <h3 className="font-serif text-xl font-medium text-[#171614]">
              Ready to evaluate an inbound lead
            </h3>
            <p className="mt-2 max-w-[60ch] text-sm leading-relaxed text-[#57534e]">
              Select one of the four presets or enter a custom inquiry. The
              pipeline scrapes the company domain via Jina Reader, scans both
              user input and scraped copy for prompt injection, runs structured
              JSON triage on the Gemini Flash fallback chain, and enforces the
              deterministic 0.80 confidence gate.
            </p>
            <ol className="mt-6 space-y-2.5 text-xs text-[#57534e]">
              <li>
                <span className="font-mono text-[#171614]">1.</span> Validate
                schema, URL hygiene &amp; 10-minute idempotency key
              </li>
              <li>
                <span className="font-mono text-[#171614]">2.</span> Enrich
                domain with 5.5s timeout &amp; graceful fallback
              </li>
              <li>
                <span className="font-mono text-[#171614]">3.</span> Classify
                intent, ICP fit &amp; draft reply with Gemini Flash
              </li>
              <li>
                <span className="font-mono text-[#171614]">4.</span> Persist to
                Supabase, log audit trail &amp; flush OTLP trace to Langfuse
              </li>
            </ol>
          </div>
        ) : (
          <VerdictPanel
            result={result}
            showRawJson={showRawJson}
            onToggleRawJson={() => setShowRawJson((v) => !v)}
            copiedReply={copiedReply}
            copiedTrace={copiedTrace}
            onCopyReply={(text) => void copyText(text, "reply")}
            onCopyTrace={(id) => void copyText(id, "trace")}
            onOpenApprovalQueue={onOpenApprovalQueue}
          />
        )}
      </section>
    </div>
  );
}

interface VerdictPanelProps {
  readonly result: TriagePipelineResponse;
  readonly showRawJson: boolean;
  readonly onToggleRawJson: () => void;
  readonly copiedReply: boolean;
  readonly copiedTrace: boolean;
  readonly onCopyReply: (text: string) => void;
  readonly onCopyTrace: (id: string) => void;
  readonly onOpenApprovalQueue: (leadId?: string) => void;
}

function VerdictPanel({
  result,
  showRawJson,
  onToggleRawJson,
  copiedReply,
  copiedTrace,
  onCopyReply,
  onCopyTrace,
  onOpenApprovalQueue,
}: VerdictPanelProps) {
  const { lead } = result;
  const presentation = getStatusPresentation(lead.status);
  const triage = lead.triage_json;

  return (
    <div className="rounded-lg border border-[#e7e5e0] bg-[#ffffff] p-6 sm:p-8">
      {/* Verdict Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#e7e5e0] pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span
              className={`h-2.5 w-2.5 rounded-full ${presentation.dotClass}`}
            />
            <span
              className={`text-xs font-semibold tracking-wide uppercase ${presentation.textClass}`}
            >
              {presentation.label}
            </span>
            {result.deduplicated && (
              <span className="text-xs text-[#78716c]">
                · Deduplicated hit
              </span>
            )}
          </div>
          <h3 className="mt-1.5 font-serif text-2xl font-medium tracking-tight text-[#171614]">
            {triage?.intent ?? "Saved for Manual Triage"}
          </h3>
          <p className="mt-1 text-xs text-[#57534e]">
            {formatRoutingReason(result.routing_reason)}
          </p>
        </div>

        {!result.deduplicated && result.model_used && (
          <div className="text-right">
            <div className="font-mono text-xs text-[#171614]">
              {result.model_used}
            </div>
            <div className="mt-0.5 text-[11px] text-[#78716c]">
              {result.fallback_attempts.length > 0
                ? `Recovered after ${result.fallback_attempts.length} fallback`
                : "Primary model"}
            </div>
          </div>
        )}
      </div>

      {/* Key Metrics Strip */}
      <div className="grid grid-cols-3 divide-x divide-[#e7e5e0] border-b border-[#e7e5e0] py-5">
        <div className="pr-4">
          <div className="text-[11px] font-medium text-[#78716c]">
            Confidence
          </div>
          <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-[#171614]">
            {lead.confidence_score !== null
              ? lead.confidence_score.toFixed(2)
              : "—"}
          </div>
          <div className="mt-0.5 text-[11px] text-[#78716c]">Gate ≥ 0.80</div>
        </div>

        <div className="px-4">
          <div className="text-[11px] font-medium text-[#78716c]">
            ICP Score
          </div>
          <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-[#171614]">
            {lead.icp_score !== null ? `${lead.icp_score}` : "—"}
            <span className="text-xs font-normal text-[#78716c]"> / 100</span>
          </div>
          <div className="mt-0.5 text-[11px] text-[#78716c]">
            {triage?.company_size_estimate ?? "Unknown size"}
          </div>
        </div>

        <div className="pl-4">
          <div className="text-[11px] font-medium text-[#78716c]">
            Suggested Route
          </div>
          <div className="mt-1 text-sm font-semibold text-[#171614]">
            {formatRouteLabel(triage?.suggested_route)}
          </div>
          <div className="mt-1 text-[11px] capitalize text-[#78716c]">
            {triage ? `${triage.urgency} urgency` : "Manual review"}
          </div>
        </div>
      </div>

      {/* Security / Degraded Notice (only shown when triggered) */}
      {(lead.prompt_injection_detected ||
        (!result.deduplicated && result.email_domain === "disposable") ||
        result.degraded) && (
        <div className="mt-5 flex items-start gap-2.5 rounded-md border border-[#991b1b]/20 bg-[#991b1b]/5 px-3.5 py-3 text-xs text-[#991b1b]">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="space-y-0.5">
            {lead.prompt_injection_detected && (
              <p className="font-medium">
                Prompt-injection tripwire triggered
                {!result.deduplicated
                  ? ` (${result.prompt_injection.source.replace("_", " ")})`
                  : ""}
                . Deterministic router overrode LLM confidence to Human Review.
              </p>
            )}
            {!result.deduplicated && result.email_domain === "disposable" && (
              <p>Disposable email domain detected; escalated to review.</p>
            )}
            {result.degraded && (
              <p>
                Upstream LLM unavailable. Lead was persisted safely to the
                Approval Queue instead of failing with HTTP 502.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Reasoning & Enrichment */}
      <div className="mt-6 space-y-5">
        {triage && (
          <div>
            <h4 className="text-xs font-semibold text-[#171614]">
              Triage Reasoning
            </h4>
            <p className="mt-1.5 max-w-[65ch] text-sm leading-relaxed text-[#57534e]">
              {triage.reasoning}
            </p>
          </div>
        )}

        <div>
          <div className="flex items-center gap-1.5 text-xs font-semibold text-[#171614]">
            <Globe className="h-3.5 w-3.5 text-[#78716c]" />
            <span>Domain Enrichment</span>
            <span className="font-normal text-[#78716c]">
              · {lead.enrichment_ok ? "Verified via Jina Reader" : "Unavailable (fallback applied)"}
            </span>
          </div>
          {lead.enriched_summary ? (
            <p className="mt-1.5 line-clamp-3 max-w-[65ch] text-xs leading-relaxed text-[#57534e]">
              {lead.enriched_summary}
            </p>
          ) : (
            <p className="mt-1.5 text-xs text-[#78716c]">
              Target site could not be scraped within the 5.5s budget. Pipeline
              continued without crashing.
            </p>
          )}
        </div>

        {/* Drafted Reply */}
        {lead.draft_reply && (
          <div>
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold text-[#171614]">
                Drafted B2B Reply
              </h4>
              <button
                type="button"
                onClick={() => onCopyReply(lead.draft_reply!)}
                className="inline-flex cursor-pointer items-center gap-1 text-xs text-[#57534e] transition-colors hover:text-[#171614]"
              >
                {copiedReply ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-[#166534]" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    <span>Copy</span>
                  </>
                )}
              </button>
            </div>
            <div className="mt-2 rounded-md bg-[#f4f3ef] px-4 py-3 text-sm leading-relaxed text-[#171614]">
              {lead.draft_reply}
            </div>
          </div>
        )}
      </div>

      {/* Footer Actions: Queue Jump + Trace ID + Raw JSON */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[#e7e5e0] pt-4 text-xs">
        <div className="flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={onToggleRawJson}
            className="inline-flex cursor-pointer items-center gap-1 font-medium text-[#57534e] transition-colors hover:text-[#171614]"
          >
            {showRawJson ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
            <span>{showRawJson ? "Hide raw JSON" : "Inspect raw JSON"}</span>
          </button>

          {lead.langfuse_trace_id && (
            <button
              type="button"
              onClick={() => onCopyTrace(lead.langfuse_trace_id!)}
              className="inline-flex cursor-pointer items-center gap-1.5 font-mono text-[11px] text-[#78716c] transition-colors hover:text-[#171614]"
              title="Copy Langfuse OTLP trace ID"
            >
              <span>Trace {lead.langfuse_trace_id.slice(0, 10)}…</span>
              {copiedTrace ? (
                <Check className="h-3 w-3 text-[#166534]" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
            </button>
          )}
        </div>

        {lead.status === "needs_human_review" && (
          <button
            type="button"
            onClick={() => onOpenApprovalQueue(lead.id)}
            className="inline-flex cursor-pointer items-center gap-1 font-medium text-[#171614] underline decoration-[#d6d3cc] underline-offset-4 transition-colors hover:decoration-[#171614]"
          >
            <span>Review in Approval Queue</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {showRawJson && (
        <pre className="mt-4 max-h-80 overflow-auto rounded-md bg-[#171614] p-4 font-mono text-[11px] leading-relaxed text-[#fafaf8]">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}
