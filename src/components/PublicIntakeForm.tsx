"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2 } from "lucide-react";
import type { TriagePipelineResponse } from "@/lib/pipeline";
import { createDemoRunNonce } from "@/lib/presets";

interface FormState {
  name: string;
  email: string;
  company_url: string;
  message: string;
  idempotency_nonce: string;
}

function createEmptyForm(): FormState {
  return {
    name: "",
    email: "",
    company_url: "",
    message: "",
    idempotency_nonce: createDemoRunNonce("intake"),
  };
}

export function PublicIntakeForm() {
  const [form, setForm] = useState<FormState>(createEmptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<TriagePipelineResponse | null>(
    null,
  );

  function updateField<K extends keyof Omit<FormState, "idempotency_nonce">>(
    field: K,
    value: string,
  ): void {
    setForm((prev) => ({
      ...prev,
      [field]: value,
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
        setErrorMessage(
          detail || err.message || `Submission failed (${response.status}).`,
        );
        return;
      }

      setSubmitted(data as TriagePipelineResponse);
    } catch {
      setErrorMessage("Could not reach the server. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleReset(): void {
    setSubmitted(null);
    setErrorMessage(null);
    setForm(createEmptyForm());
  }

  if (submitted !== null) {
    return (
      <div className="rounded-lg border border-[#e4e4e7] bg-[#ffffff] p-8">
        <div className="flex h-9 w-9 items-center justify-center rounded-full border border-[#16a34a]/20 bg-[#f0fdf4] text-[#15803d]">
          <CheckCircle2 className="h-4 w-4" />
        </div>

        <h2 className="mt-4 text-lg font-semibold tracking-[-0.015em] text-[#111113]">
          Inquiry received
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-[#52525b]">
          Thanks, {submitted.lead.name}. Your message has been logged and routed
          through our inbound triage workflow.
        </p>

        <div className="mt-6 rounded-md border border-[#ececef] bg-[#fafafa] px-4 py-3 text-xs text-[#52525b]">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[#71717a]">Reference ID</span>
            <span className="font-mono text-[11px] text-[#111113]">
              {submitted.lead.id.slice(0, 8)}
            </span>
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <span className="text-[#71717a]">Status</span>
            <span className="font-medium text-[#111113]">
              {submitted.lead.status.replace(/_/g, " ")}
            </span>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-md bg-[#111113] px-4 py-2 text-xs font-medium text-[#ffffff] transition-colors hover:bg-[#27272a]"
          >
            <span>Open in Triage Inbox</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
          <button
            type="button"
            onClick={handleReset}
            className="cursor-pointer rounded-md border border-[#e4e4e7] bg-[#ffffff] px-3.5 py-2 text-xs font-medium text-[#52525b] transition-colors hover:text-[#111113]"
          >
            Submit another inquiry
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-[#e4e4e7] bg-[#ffffff] p-6 sm:p-8"
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="intake-name"
              className="block text-xs font-medium text-[#52525b]"
            >
              Full name
            </label>
            <input
              id="intake-name"
              type="text"
              required
              autoComplete="name"
              value={form.name}
              onChange={(e) => updateField("name", e.target.value)}
              placeholder="Alex Rivera"
              className="mt-1.5 w-full rounded-md border border-[#e4e4e7] bg-[#ffffff] px-3 py-2 text-sm text-[#111113] placeholder:text-[#a1a1aa] outline-none transition-colors focus:border-[#111113]"
            />
          </div>

          <div>
            <label
              htmlFor="intake-email"
              className="block text-xs font-medium text-[#52525b]"
            >
              Work email
            </label>
            <input
              id="intake-email"
              type="email"
              required
              autoComplete="email"
              value={form.email}
              onChange={(e) => updateField("email", e.target.value)}
              placeholder="alex@company.com"
              className="mt-1.5 w-full rounded-md border border-[#e4e4e7] bg-[#ffffff] px-3 py-2 text-sm text-[#111113] placeholder:text-[#a1a1aa] outline-none transition-colors focus:border-[#111113]"
            />
          </div>
        </div>

        <div>
          <label
            htmlFor="intake-url"
            className="block text-xs font-medium text-[#52525b]"
          >
            Company website
          </label>
          <input
            id="intake-url"
            type="url"
            required
            value={form.company_url}
            onChange={(e) => updateField("company_url", e.target.value)}
            placeholder="https://company.com"
            className="mt-1.5 w-full rounded-md border border-[#e4e4e7] bg-[#ffffff] px-3 py-2 font-mono text-xs text-[#111113] placeholder:text-[#a1a1aa] outline-none transition-colors focus:border-[#111113]"
          />
        </div>

        <div>
          <label
            htmlFor="intake-message"
            className="block text-xs font-medium text-[#52525b]"
          >
            How can we help?
          </label>
          <textarea
            id="intake-message"
            rows={5}
            required
            value={form.message}
            onChange={(e) => updateField("message", e.target.value)}
            placeholder="Tell us about your team size, current workflow, and timeline..."
            className="mt-1.5 w-full resize-y rounded-md border border-[#e4e4e7] bg-[#ffffff] px-3 py-2 text-sm leading-relaxed text-[#111113] placeholder:text-[#a1a1aa] outline-none transition-colors focus:border-[#111113]"
          />
        </div>
      </div>

      {errorMessage && (
        <div className="mt-4 flex items-start gap-2 rounded-md border border-[#dc2626]/20 bg-[#fef2f2] px-3 py-2.5 text-xs text-[#b91c1c]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      <div className="mt-6 flex items-center justify-between gap-4">
        <span className="text-[11px] text-[#71717a]">
          Replies are typically routed within seconds.
        </span>
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-[#111113] px-4 py-2 text-xs font-medium text-[#ffffff] transition-colors hover:bg-[#27272a] disabled:opacity-60"
        >
          {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          <span>{submitting ? "Sending..." : "Send inquiry"}</span>
        </button>
      </div>
    </form>
  );
}
