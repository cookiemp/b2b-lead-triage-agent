"use client";

import { useEffect, useState, type FormEvent } from "react";
import { AlertTriangle, Loader2, X } from "lucide-react";
import type { TriagePipelineResponse } from "@/lib/pipeline";
import {
  createDemoRunNonce,
  DEMO_LEAD_PRESETS,
  type LeadPreset,
} from "@/lib/presets";

interface SimulateLeadDrawerProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onTriaged: (result: TriagePipelineResponse) => Promise<void>;
}

interface FormState {
  name: string;
  email: string;
  company_url: string;
  message: string;
  idempotency_nonce: string;
}

const INITIAL_PRESET = DEMO_LEAD_PRESETS[0]!;

export function SimulateLeadDrawer({
  open,
  onClose,
  onTriaged,
}: SimulateLeadDrawerProps) {
  const [activePresetId, setActivePresetId] = useState<string | null>(
    INITIAL_PRESET.id,
  );
  const [form, setForm] = useState<FormState>({
    ...INITIAL_PRESET.values,
    idempotency_nonce: createDemoRunNonce(INITIAL_PRESET.id),
  });
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !submitting) {
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, submitting, onClose]);

  if (!open) return null;

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
        | {
            message?: string;
            details?: Array<{ path: string; message: string }>;
          };

      if (!response.ok) {
        const err = data as {
          message?: string;
          details?: Array<{ path: string; message: string }>;
        };
        const detail = err.details
          ?.map((d) => `${d.path}: ${d.message}`)
          .join(" · ");
        setErrorMessage(detail || err.message || `Failed (${response.status}).`);
        return;
      }

      await onTriaged(data as TriagePipelineResponse);
      onClose();
    } catch {
      setErrorMessage("Network error contacting /api/triage.");
    } finally {
      setSubmitting(false);
    }
  }

  const activePreset = DEMO_LEAD_PRESETS.find((p) => p.id === activePresetId);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-[#111113]/20"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="New inbound lead"
        className="flex h-full w-full max-w-[440px] flex-col border-l border-[#e4e4e7] bg-[#ffffff] shadow-2xl"
      >
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-[#ececef] px-5">
          <h2 className="text-sm font-semibold text-[#111113]">
            New inbound lead
          </h2>
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            className="cursor-pointer rounded p-1 text-[#71717a] hover:bg-[#f4f4f6] hover:text-[#111113]"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form
          onSubmit={handleSubmit}
          className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-5"
        >
          {/* Examples */}
          <div>
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-medium text-[#71717a]">
                Examples
              </span>
              {activePreset && (
                <span className="text-[11px] text-[#71717a]">
                  {activePreset.expectedOutcome}
                </span>
              )}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              {DEMO_LEAD_PRESETS.map((preset) => {
                const isActive = preset.id === activePresetId;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applyPreset(preset)}
                    className={`cursor-pointer rounded-md border px-2.5 py-1.5 text-left text-xs font-medium transition-colors ${
                      isActive
                        ? "border-[#111113] bg-[#111113] text-[#ffffff]"
                        : "border-[#e4e4e7] bg-[#ffffff] text-[#18181b] hover:bg-[#f4f4f6]"
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Fields */}
          <div className="mt-5 space-y-4">
            <div>
              <label
                htmlFor="sim-name"
                className="block text-xs font-medium text-[#52525b]"
              >
                Name
              </label>
              <input
                id="sim-name"
                type="text"
                required
                value={form.name}
                onChange={(e) => updateField("name", e.target.value)}
                className="mt-1.5 w-full rounded-md border border-[#e4e4e7] bg-[#ffffff] px-3 py-2 text-sm text-[#111113] outline-none transition-colors focus:border-[#111113]"
              />
            </div>

            <div>
              <label
                htmlFor="sim-email"
                className="block text-xs font-medium text-[#52525b]"
              >
                Email
              </label>
              <input
                id="sim-email"
                type="email"
                required
                value={form.email}
                onChange={(e) => updateField("email", e.target.value)}
                className="mt-1.5 w-full rounded-md border border-[#e4e4e7] bg-[#ffffff] px-3 py-2 text-sm text-[#111113] outline-none transition-colors focus:border-[#111113]"
              />
            </div>

            <div>
              <label
                htmlFor="sim-url"
                className="block text-xs font-medium text-[#52525b]"
              >
                Company URL
              </label>
              <input
                id="sim-url"
                type="url"
                required
                value={form.company_url}
                onChange={(e) => updateField("company_url", e.target.value)}
                className="mt-1.5 w-full rounded-md border border-[#e4e4e7] bg-[#ffffff] px-3 py-2 font-mono text-xs text-[#111113] outline-none transition-colors focus:border-[#111113]"
              />
            </div>

            <div>
              <label
                htmlFor="sim-msg"
                className="block text-xs font-medium text-[#52525b]"
              >
                Message
              </label>
              <textarea
                id="sim-msg"
                rows={5}
                required
                value={form.message}
                onChange={(e) => updateField("message", e.target.value)}
                className="mt-1.5 w-full resize-y rounded-md border border-[#e4e4e7] bg-[#ffffff] px-3 py-2 text-sm leading-relaxed text-[#111113] outline-none transition-colors focus:border-[#111113]"
              />
            </div>
          </div>

          {errorMessage && (
            <div className="mt-4 flex items-start gap-2 rounded-md border border-[#dc2626]/20 bg-[#fef2f2] px-3 py-2 text-xs text-[#b91c1c]">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          <div className="mt-auto flex items-center justify-end gap-2 border-t border-[#ececef] pt-4">
            <button
              type="button"
              disabled={submitting}
              onClick={onClose}
              className="cursor-pointer rounded-md border border-[#e4e4e7] bg-[#ffffff] px-3.5 py-2 text-xs font-medium text-[#52525b] hover:text-[#111113] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-[#111113] px-4 py-2 text-xs font-medium text-[#ffffff] transition-colors hover:bg-[#27272a] disabled:opacity-60"
            >
              {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <span>{submitting ? "Running triage..." : "Submit lead"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
