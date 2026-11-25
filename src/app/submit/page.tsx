import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PublicIntakeForm } from "@/components/PublicIntakeForm";

export const metadata: Metadata = {
  title: "Contact Sales | Lead Triage",
  description: "Submit an inbound B2B inquiry to our automated triage workflow.",
};

export default function SubmitLeadPage() {
  return (
    <div className="min-h-screen bg-[#fafafa]">
      <header className="border-b border-[#ececef] bg-[#ffffff]">
        <div className="mx-auto flex h-12 max-w-2xl items-center justify-between px-6">
          <span className="text-[13px] font-semibold tracking-[-0.01em] text-[#111113]">
            Lead Triage
          </span>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs text-[#52525b] transition-colors hover:text-[#111113]"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Back to inbox</span>
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-14">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-[-0.02em] text-[#111113]">
            Contact sales
          </h1>
          <p className="mt-2 max-w-[54ch] text-sm leading-relaxed text-[#52525b]">
            Share a few details about your team and what you are looking to
            automate. Submissions feed directly into the live triage inbox.
          </p>
        </div>

        <PublicIntakeForm />
      </main>
    </div>
  );
}
