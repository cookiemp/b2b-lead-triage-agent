"use client";

import { useCallback, useEffect, useState } from "react";
import { ApprovalQueue } from "@/components/ApprovalQueue";
import { TriageWorkbench } from "@/components/TriageWorkbench";

type ActiveTab = "triage" | "queue";

export function WorkspaceShell() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("triage");
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [focusLeadId, setFocusLeadId] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const fetchPendingCount = useCallback(async () => {
    try {
      const response = await fetch(
        "/api/leads?status=needs_human_review&limit=100",
        { cache: "no-store" },
      );
      if (!response.ok) return;
      const data = (await response.json()) as { leads?: unknown[] };
      setPendingCount(data.leads?.length ?? 0);
    } catch {
      // Ignore transient count refresh errors; queue tab handles explicit errors.
    }
  }, []);

  useEffect(() => {
    void fetchPendingCount();
  }, [fetchPendingCount, refreshToken]);

  function handleDataChanged(): void {
    setRefreshToken((n) => n + 1);
  }

  function handleOpenQueue(leadId?: string): void {
    setFocusLeadId(leadId ?? null);
    setActiveTab("queue");
    setRefreshToken((n) => n + 1);
  }

  return (
    <div className="min-h-screen bg-[#fafaf8]">
      <header className="border-b border-[#e7e5e0] bg-[#ffffff]">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 pt-8 sm:flex-row sm:items-end sm:justify-between">
          <div className="pb-6">
            <h1 className="font-serif text-3xl font-medium tracking-tight text-[#171614]">
              Inbound Lead Triage
            </h1>
            <p className="mt-1.5 max-w-[60ch] text-sm text-[#57534e]">
              Enrich B2B domains, classify intent with structured Gemini output,
              and pause ambiguous or flagged leads for human approval.
            </p>
          </div>

          <nav
            aria-label="Workspace views"
            className="flex items-center gap-6 text-sm"
          >
            <button
              type="button"
              onClick={() => setActiveTab("triage")}
              className={`cursor-pointer border-b-2 pb-4 font-medium transition-colors ${
                activeTab === "triage"
                  ? "border-[#171614] text-[#171614]"
                  : "border-transparent text-[#78716c] hover:text-[#171614]"
              }`}
            >
              Live Triage
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("queue")}
              className={`inline-flex cursor-pointer items-center gap-2 border-b-2 pb-4 font-medium transition-colors ${
                activeTab === "queue"
                  ? "border-[#171614] text-[#171614]"
                  : "border-transparent text-[#78716c] hover:text-[#171614]"
              }`}
            >
              <span>Approval Queue</span>
              {pendingCount !== null && (
                <span className="font-mono text-xs text-[#78716c]">
                  ({pendingCount})
                </span>
              )}
            </button>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        {activeTab === "triage" ? (
          <TriageWorkbench
            onLeadTriaged={handleDataChanged}
            onOpenApprovalQueue={handleOpenQueue}
          />
        ) : (
          <ApprovalQueue
            focusLeadId={focusLeadId}
            refreshToken={refreshToken}
            onQueueMutated={handleDataChanged}
          />
        )}
      </main>
    </div>
  );
}
