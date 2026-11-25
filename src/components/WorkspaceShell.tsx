"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Inbox,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  ShieldBan,
  XCircle,
} from "lucide-react";
import type { LeadWithAuditLogs } from "@/lib/db";
import type { TriagePipelineResponse } from "@/lib/pipeline";
import type { LeadStatus } from "@/lib/schemas";
import { LeadInspector } from "@/components/LeadInspector";
import { SimulateLeadDrawer } from "@/components/SimulateLeadDrawer";
import {
  extractDomain,
  formatRelativeTime,
  getStatusPresentation,
} from "@/components/status-format";

type NavView = "all" | LeadStatus;

const NAV_ITEMS: ReadonlyArray<{ readonly id: NavView; readonly label: string }> =
  [
    { id: "all", label: "All leads" },
    { id: "needs_human_review", label: "Needs review" },
    { id: "auto_routed", label: "Auto-routed" },
    { id: "approved", label: "Approved" },
    { id: "auto_rejected", label: "Auto-rejected" },
    { id: "rejected", label: "Rejected" },
  ];

export function WorkspaceShell() {
  const [leads, setLeads] = useState<readonly LeadWithAuditLogs[]>([]);
  const [activeView, setActiveView] = useState<NavView>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [simulatorOpen, setSimulatorOpen] = useState(false);
  const [lastRunMeta, setLastRunMeta] = useState<TriagePipelineResponse | null>(
    null,
  );
  const listContainerRef = useRef<HTMLDivElement | null>(null);

  const loadLeads = useCallback(async (focusId?: string) => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const response = await fetch("/api/leads?limit=100", {
        cache: "no-store",
      });
      const data = (await response.json()) as {
        leads?: LeadWithAuditLogs[];
        message?: string;
      };
      if (!response.ok) {
        setErrorMessage(
          data.message || `Failed to load leads (${response.status}).`,
        );
        return;
      }

      const rows = data.leads ?? [];
      setLeads(rows);
      setSelectedId((prev) => {
        if (focusId && rows.some((r) => r.id === focusId)) return focusId;
        if (prev && rows.some((r) => r.id === prev)) return prev;
        return rows[0]?.id ?? null;
      });
    } catch {
      setErrorMessage("Network error while loading leads.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLeads();
  }, [loadLeads]);

  const counts = useMemo(() => {
    const map: Record<NavView, number> = {
      all: leads.length,
      needs_human_review: 0,
      auto_routed: 0,
      approved: 0,
      auto_rejected: 0,
      rejected: 0,
    };
    for (const lead of leads) {
      map[lead.status] += 1;
    }
    return map;
  }, [leads]);

  const filteredLeads = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return leads.filter((lead) => {
      if (activeView !== "all" && lead.status !== activeView) {
        return false;
      }
      if (!q) return true;
      return (
        lead.name.toLowerCase().includes(q) ||
        lead.email.toLowerCase().includes(q) ||
        lead.company_url.toLowerCase().includes(q) ||
        lead.message.toLowerCase().includes(q)
      );
    });
  }, [leads, activeView, searchQuery]);

  const selectedLead =
    filteredLeads.find((l) => l.id === selectedId) ?? filteredLeads[0] ?? null;

  // Keyboard navigation: J / K to step through leads, N to open new lead drawer
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (simulatorOpen) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }

      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        setSimulatorOpen(true);
        return;
      }

      if (filteredLeads.length === 0) return;
      const currentIdx = filteredLeads.findIndex(
        (l) => l.id === selectedLead?.id,
      );

      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        const nextIdx = Math.min(filteredLeads.length - 1, currentIdx + 1);
        setSelectedId(filteredLeads[nextIdx]?.id ?? null);
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        const prevIdx = Math.max(0, currentIdx - 1);
        setSelectedId(filteredLeads[prevIdx]?.id ?? null);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [filteredLeads, selectedLead?.id, simulatorOpen]);

  // Keep keyboard-selected lead row scrolled into view
  useEffect(() => {
    if (!selectedLead?.id || !listContainerRef.current) return;
    const activeRow = listContainerRef.current.querySelector<HTMLElement>(
      `[data-lead-id="${CSS.escape(selectedLead.id)}"]`,
    );
    activeRow?.scrollIntoView({ block: "nearest" });
  }, [selectedLead?.id]);

  async function handleLeadTriaged(
    result: TriagePipelineResponse,
  ): Promise<void> {
    setLastRunMeta(result);
    setActiveView("all");
    await loadLeads(result.lead.id);
    setSelectedId(result.lead.id);
  }

  async function handleLeadUpdated(leadId: string): Promise<void> {
    await loadLeads(leadId);
  }

  function renderNavIcon(id: NavView, isActive: boolean) {
    const color = isActive ? "text-[#111113]" : "text-[#71717a]";
    switch (id) {
      case "all":
        return <Inbox className={`h-3.5 w-3.5 ${color}`} />;
      case "needs_human_review":
        return <Clock className={`h-3.5 w-3.5 ${color}`} />;
      case "auto_routed":
      case "approved":
        return <CheckCircle2 className={`h-3.5 w-3.5 ${color}`} />;
      case "auto_rejected":
        return <ShieldBan className={`h-3.5 w-3.5 ${color}`} />;
      case "rejected":
        return <XCircle className={`h-3.5 w-3.5 ${color}`} />;
    }
  }

  const activeNavLabel =
    NAV_ITEMS.find((item) => item.id === activeView)?.label ?? "All leads";

  return (
    <div className="flex min-h-screen flex-col bg-[#ffffff] lg:h-screen lg:flex-row lg:overflow-hidden">
      {/* Pane 1: Monochrome Navigation Rail */}
      <aside className="flex shrink-0 flex-col border-b border-[#ececef] bg-[#fafafa] lg:w-[216px] lg:border-r lg:border-b-0">
        <div className="flex h-12 items-center justify-between border-b border-[#ececef] px-4">
          <span className="text-[13px] font-semibold tracking-[-0.01em] text-[#111113]">
            Lead Triage
          </span>
        </div>

        <div className="p-3">
          <button
            type="button"
            onClick={() => setSimulatorOpen(true)}
            className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-md bg-[#111113] px-3 py-1.5 text-xs font-medium text-[#ffffff] transition-colors hover:bg-[#27272a]"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>New lead</span>
          </button>
        </div>

        <nav
          aria-label="Lead queues"
          className="flex flex-row gap-0.5 overflow-x-auto px-2 pb-3 lg:flex-1 lg:flex-col lg:overflow-x-visible"
        >
          {NAV_ITEMS.map((item) => {
            const isActive = item.id === activeView;
            const count = counts[item.id];
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveView(item.id)}
                className={`flex shrink-0 cursor-pointer items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-xs transition-colors ${
                  isActive
                    ? "bg-[#ececf0] font-medium text-[#111113]"
                    : "text-[#52525b] hover:bg-[#f1f1f4] hover:text-[#111113]"
                }`}
              >
                <span className="flex items-center gap-2">
                  {renderNavIcon(item.id, isActive)}
                  <span>{item.label}</span>
                </span>
                <span className="font-mono text-[11px] tabular-nums text-[#71717a]">
                  {count}
                </span>
              </button>
            );
          })}
        </nav>

        <div className="hidden border-t border-[#ececef] px-3 py-3 text-[11px] text-[#71717a] lg:block">
          <Link
            href="/submit"
            className="mb-2.5 flex items-center justify-between rounded-md px-2 py-1.5 text-xs font-medium text-[#52525b] transition-colors hover:bg-[#f1f1f4] hover:text-[#111113]"
          >
            <span>Public intake form</span>
            <ArrowUpRight className="h-3.5 w-3.5 text-[#71717a]" />
          </Link>
          <div className="space-y-1 px-2">
            <div className="flex items-center justify-between">
              <span>Navigate</span>
              <span className="font-mono text-[10px]">J / K</span>
            </div>
            <div className="flex items-center justify-between">
              <span>New lead</span>
              <span className="font-mono text-[10px]">N</span>
            </div>
          </div>
        </div>
      </aside>

      {/* Pane 2: Center Inbox List */}
      <section className="flex min-h-[300px] shrink-0 flex-col border-b border-[#ececef] bg-[#ffffff] lg:w-[336px] lg:border-r lg:border-b-0 xl:w-[360px]">
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-[#ececef] px-4">
          <div className="flex items-center gap-2">
            <h1 className="text-xs font-semibold text-[#111113]">
              {activeNavLabel}
            </h1>
            <span className="font-mono text-[11px] text-[#71717a]">
              {filteredLeads.length}
            </span>
          </div>
          <button
            type="button"
            onClick={() => void loadLeads()}
            disabled={loading}
            className="cursor-pointer rounded p-1.5 text-[#71717a] transition-colors hover:bg-[#f4f4f6] hover:text-[#111113] disabled:opacity-50"
            title="Refresh"
            aria-label="Refresh leads"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        <div className="border-b border-[#ececef] px-3 py-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-[#a1a1aa]" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search leads..."
              className="w-full rounded-md bg-[#f4f4f6] py-1.5 pr-3 pl-8 text-xs text-[#111113] placeholder:text-[#a1a1aa] outline-none focus:ring-1 focus:ring-[#a1a1aa]"
            />
          </div>
        </div>

        {errorMessage && (
          <div className="border-b border-[#dc2626]/20 bg-[#fef2f2] px-4 py-2 text-xs text-[#b91c1c]">
            {errorMessage}
          </div>
        )}

        <div
          ref={listContainerRef}
          className="min-h-0 flex-1 divide-y divide-[#f1f1f4] overflow-y-auto"
        >
          {loading && leads.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-xs text-[#71717a]">
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              Loading leads...
            </div>
          ) : filteredLeads.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <p className="text-xs font-medium text-[#111113]">
                No leads in {activeNavLabel.toLowerCase()}
              </p>
              <p className="mt-1 text-[11px] text-[#71717a]">
                Press N or click New lead to submit a test inquiry.
              </p>
            </div>
          ) : (
            filteredLeads.map((lead) => {
              const isSelected = lead.id === selectedLead?.id;
              const statusInfo = getStatusPresentation(lead.status);
              return (
                <button
                  key={lead.id}
                  type="button"
                  data-lead-id={lead.id}
                  onClick={() => setSelectedId(lead.id)}
                  className={`relative block w-full cursor-pointer px-4 py-3 text-left transition-colors ${
                    isSelected
                      ? "bg-[#f5f5f7]"
                      : "bg-[#ffffff] hover:bg-[#fafafa]"
                  }`}
                >
                  {isSelected && (
                    <span className="absolute top-0 bottom-0 left-0 w-[2px] bg-[#111113]" />
                  )}

                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[13px] font-medium text-[#111113]">
                      {lead.name}
                    </span>
                    <span className="shrink-0 text-[11px] text-[#a1a1aa]">
                      {formatRelativeTime(lead.created_at)}
                    </span>
                  </div>

                  <p className="mt-1 line-clamp-1 text-xs text-[#52525b]">
                    {lead.message}
                  </p>

                  <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-[#71717a]">
                    <span className="inline-flex min-w-0 items-center gap-1.5 truncate">
                      <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusInfo.dotClass}`}
                      />
                      <span className="truncate">{statusInfo.shortLabel}</span>
                      <span className="text-[#d4d4d8]">·</span>
                      <span className="truncate">
                        {extractDomain(lead.company_url)}
                      </span>
                    </span>
                    <span className="shrink-0 font-mono text-[10px] tabular-nums text-[#71717a]">
                      {lead.confidence_score !== null
                        ? lead.confidence_score.toFixed(2)
                        : "—"}
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </section>

      {/* Pane 3: Right Lead Inspector */}
      <LeadInspector
        lead={selectedLead}
        lastRunMeta={lastRunMeta}
        onLeadUpdated={handleLeadUpdated}
        onOpenSimulator={() => setSimulatorOpen(true)}
      />

      {/* Slide-over New Lead Drawer */}
      <SimulateLeadDrawer
        open={simulatorOpen}
        onClose={() => setSimulatorOpen(false)}
        onTriaged={handleLeadTriaged}
      />
    </div>
  );
}
