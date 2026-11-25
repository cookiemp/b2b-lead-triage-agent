"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
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
  formatRouteLabel,
  getStatusPresentation,
} from "@/components/status-format";

type NavView = "all" | LeadStatus;

interface NavItem {
  readonly id: NavView;
  readonly label: string;
  readonly dotClass?: string;
}

const NAV_ITEMS: readonly NavItem[] = [
  { id: "all", label: "All Leads" },
  { id: "needs_human_review", label: "Needs Review", dotClass: "bg-[#d97706]" },
  { id: "auto_routed", label: "Auto-Routed", dotClass: "bg-[#059669]" },
  { id: "approved", label: "Approved", dotClass: "bg-[#059669]" },
  { id: "auto_rejected", label: "Auto-Rejected", dotClass: "bg-[#dc2626]" },
  { id: "rejected", label: "Rejected", dotClass: "bg-[#71717a]" },
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

  function renderNavIcon(id: NavView) {
    switch (id) {
      case "all":
        return <Inbox className="h-3.5 w-3.5 text-[#71717a]" />;
      case "needs_human_review":
        return <Clock className="h-3.5 w-3.5 text-[#d97706]" />;
      case "auto_routed":
      case "approved":
        return <CheckCircle2 className="h-3.5 w-3.5 text-[#059669]" />;
      case "auto_rejected":
        return <ShieldBan className="h-3.5 w-3.5 text-[#dc2626]" />;
      case "rejected":
        return <XCircle className="h-3.5 w-3.5 text-[#71717a]" />;
    }
  }

  const activeNavLabel =
    NAV_ITEMS.find((item) => item.id === activeView)?.label ?? "All Leads";

  return (
    <div className="flex min-h-screen flex-col bg-[#ffffff] lg:h-screen lg:flex-row lg:overflow-hidden">
      {/* Pane 1: Slim Left Navigation Rail */}
      <aside className="flex shrink-0 flex-col border-b border-[#e8e8ec] bg-[#f8f8f9] lg:w-[224px] lg:border-r lg:border-b-0">
        <div className="flex h-12 items-center justify-between border-b border-[#e8e8ec] px-4">
          <div className="flex items-center gap-2">
            <div className="flex h-5 w-5 items-center justify-center rounded bg-[#111113] font-mono text-[10px] font-semibold text-[#ffffff]">
              LT
            </div>
            <span className="text-sm font-semibold tracking-tight text-[#111113]">
              Lead Triage
            </span>
          </div>
          <span className="font-mono text-[10px] text-[#71717a]">B2B Ops</span>
        </div>

        <div className="p-3">
          <button
            type="button"
            onClick={() => setSimulatorOpen(true)}
            className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-md bg-[#111113] px-3 py-2 text-xs font-medium text-[#ffffff] transition-colors hover:bg-[#27272a]"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Simulate Inbound Lead</span>
          </button>
        </div>

        <nav
          aria-label="Lead queues"
          className="flex flex-row gap-1 overflow-x-auto px-2 pb-3 lg:flex-1 lg:flex-col lg:overflow-x-visible"
        >
          {NAV_ITEMS.map((item) => {
            const isActive = item.id === activeView;
            const count = counts[item.id];
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveView(item.id)}
                className={`flex shrink-0 cursor-pointer items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  isActive
                    ? "bg-[#eaeaf0] text-[#111113]"
                    : "text-[#52525b] hover:bg-[#f0f0f4] hover:text-[#111113]"
                }`}
              >
                <span className="flex items-center gap-2">
                  {renderNavIcon(item.id)}
                  <span>{item.label}</span>
                </span>
                <span className="font-mono text-[11px] tabular-nums text-[#71717a]">
                  {count}
                </span>
              </button>
            );
          })}
        </nav>

        <div className="hidden border-t border-[#e8e8ec] px-4 py-3 text-[11px] text-[#71717a] lg:block">
          <div className="font-medium text-[#52525b]">Pipeline Guardrails</div>
          <div className="mt-1 space-y-0.5 font-mono text-[10px]">
            <div>Gate: conf ≥ 0.80</div>
            <div>LLM: 3.8 → 3.6 → 3.5-lite</div>
            <div>Trace: Langfuse OTLP</div>
          </div>
        </div>
      </aside>

      {/* Pane 2: Center Inbox List */}
      <section className="flex min-h-[300px] shrink-0 flex-col border-b border-[#e8e8ec] bg-[#ffffff] lg:w-[340px] lg:border-r lg:border-b-0 xl:w-[368px]">
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-[#e8e8ec] px-4">
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
            title="Refresh leads from Supabase"
            aria-label="Refresh leads"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        <div className="border-b border-[#e8e8ec] px-3 py-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-[#71717a]" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter name, email, domain…"
              className="w-full rounded-md bg-[#f4f4f6] py-1.5 pr-3 pl-8 text-xs text-[#111113] placeholder:text-[#71717a] outline-none focus:ring-1 focus:ring-[#111113]"
            />
          </div>
        </div>

        {errorMessage && (
          <div className="border-b border-[#dc2626]/20 bg-[#fef2f2] px-4 py-2 text-xs text-[#b91c1c]">
            {errorMessage}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto divide-y divide-[#e8e8ec]">
          {loading && leads.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-xs text-[#71717a]">
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              Loading leads…
            </div>
          ) : filteredLeads.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <p className="text-xs font-medium text-[#111113]">
                No leads in {activeNavLabel}
              </p>
              <p className="mt-1 text-[11px] text-[#71717a]">
                Use &ldquo;Simulate Inbound Lead&rdquo; to run a live test
                preset.
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
                  onClick={() => setSelectedId(lead.id)}
                  className={`block w-full cursor-pointer px-4 py-3 text-left transition-colors ${
                    isSelected
                      ? "bg-[#f4f4f6]"
                      : "bg-[#ffffff] hover:bg-[#f8f8f9]"
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[13px] font-semibold text-[#111113]">
                      {lead.name}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-[#71717a]">
                      {formatRelativeTime(lead.created_at)}
                    </span>
                  </div>

                  <div className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] text-[#71717a]">
                    <span className="truncate font-mono">
                      {extractDomain(lead.company_url)}
                    </span>
                    <span>·</span>
                    <span className="truncate">
                      {formatRouteLabel(lead.triage_json?.suggested_route)}
                    </span>
                  </div>

                  <p className="mt-1.5 line-clamp-1 text-xs text-[#52525b]">
                    {lead.message}
                  </p>

                  <div className="mt-2 flex items-center justify-between text-[11px]">
                    <span
                      className={`inline-flex items-center gap-1.5 font-medium ${statusInfo.textClass}`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${statusInfo.dotClass}`}
                      />
                      {statusInfo.shortLabel}
                    </span>
                    <span className="font-mono text-[10px] tabular-nums text-[#71717a]">
                      {lead.confidence_score !== null
                        ? `${lead.confidence_score.toFixed(2)} conf`
                        : "degraded"}
                      {lead.icp_score !== null ? ` · ICP ${lead.icp_score}` : ""}
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

      {/* Slide-over Simulator Drawer */}
      <SimulateLeadDrawer
        open={simulatorOpen}
        onClose={() => setSimulatorOpen(false)}
        onTriaged={handleLeadTriaged}
      />
    </div>
  );
}
