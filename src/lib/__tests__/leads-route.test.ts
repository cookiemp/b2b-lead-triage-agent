import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { LeadStore, LeadWithAuditLogs, ReviewLeadResult } from "@/lib/db";
import {
  createLeadPatchHandler,
  createLeadsGetHandler,
} from "@/lib/leads-handler";
import type {
  AuditLogRecord,
  LeadDecision,
  LeadRecord,
  LeadStatus,
} from "@/lib/schemas";
import { createInMemoryRateLimiter } from "@/lib/security";

function createFakeLead(status: LeadStatus = "needs_human_review"): LeadRecord {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    idempotency_key: "a".repeat(64),
    name: "Jordan Lee",
    email: "jordan@northstar.example",
    company_url: "https://northstar.example",
    message: "Curious what you guys do—maybe chat next quarter?",
    enriched_summary: "Northstar advisory group.",
    enrichment_ok: true,
    prompt_injection_detected: false,
    triage_json: {
      intent: "Exploratory inquiry",
      urgency: "low",
      company_size_estimate: "10-50",
      icp_score: 55,
      suggested_route: "sales_smb",
      confidence_score: 0.62,
      reasoning: "Vague timeline and unclear budget.",
      draft_reply: "Hi Jordan, happy to share a quick overview.",
    },
    icp_score: 55,
    confidence_score: 0.62,
    draft_reply: "Hi Jordan, happy to share a quick overview.",
    status,
    source: "web_demo",
    langfuse_trace_id: "trace-123",
    created_at: now,
    updated_at: now,
  };
}

function createInMemoryLeadStore(initialLeads: LeadRecord[]): LeadStore & {
  readonly audits: AuditLogRecord[];
} {
  const leads = [...initialLeads];
  const audits: AuditLogRecord[] = [];

  return {
    audits,
    async findByIdempotencyKey(key: string) {
      return leads.find((l) => l.idempotency_key === key) ?? null;
    },
    async createLeadWithAudit() {
      throw new Error("Not used in leads-route tests");
    },
    async countRecentDemoLeads() {
      return leads.filter((l) => l.source === "web_demo").length;
    },
    async listLeadsWithAudit(options): Promise<readonly LeadWithAuditLogs[]> {
      const filtered = options?.status
        ? leads.filter((l) => l.status === options.status)
        : leads;
      return filtered.slice(0, options?.limit ?? 50).map((lead) => ({
        ...lead,
        audit_logs: audits.filter((a) => a.lead_id === lead.id),
      }));
    },
    async reviewLead(
      leadId: string,
      decision: LeadDecision,
    ): Promise<ReviewLeadResult> {
      const idx = leads.findIndex((l) => l.id === leadId);
      const existing = idx >= 0 ? leads[idx] : undefined;
      if (!existing) {
        return { ok: false, code: "NOT_FOUND", message: "Lead not found." };
      }
      if (existing.status !== "needs_human_review") {
        return {
          ok: false,
          code: "INVALID_STATE_TRANSITION",
          message: `Cannot review lead in status ${existing.status}`,
          currentStatus: existing.status,
        };
      }
      const updated: LeadRecord = {
        ...existing,
        status: decision.status,
        draft_reply: decision.edited_draft_reply ?? existing.draft_reply,
        updated_at: new Date().toISOString(),
      };
      leads[idx] = updated;
      const auditLog: AuditLogRecord = {
        id: randomUUID(),
        lead_id: updated.id,
        action: `human_${decision.status}`,
        actor: decision.actor,
        details_json: {
          previous_status: existing.status,
          new_status: updated.status,
          draft_reply_edited: decision.edited_draft_reply !== undefined,
        },
        created_at: new Date().toISOString(),
      };
      audits.push(auditLog);
      return { ok: true, lead: updated, auditLog };
    },
  };
}

describe("GET /api/leads", () => {
  it("lists leads and filters cleanly by status, rejecting invalid status queries with 400", async () => {
    const store = createInMemoryLeadStore([
      createFakeLead("needs_human_review"),
      createFakeLead("auto_routed"),
      createFakeLead("auto_rejected"),
    ]);

    const handler = createLeadsGetHandler({ resolveStore: () => store });

    const allRes = await handler(new Request("http://localhost:3000/api/leads"));
    expect(allRes.status).toBe(200);
    expect((await allRes.json()).leads).toHaveLength(3);

    const queueRes = await handler(
      new Request("http://localhost:3000/api/leads?status=needs_human_review"),
    );
    expect(queueRes.status).toBe(200);
    expect((await queueRes.json()).leads).toHaveLength(1);

    const badStatusRes = await handler(
      new Request("http://localhost:3000/api/leads?status=invalid_state"),
    );
    expect(badStatusRes.status).toBe(400);
  });
});

describe("PATCH /api/leads/[id]", () => {
  it("approves a needs_human_review lead, saves edited_draft_reply, and writes an audit_log", async () => {
    const lead = createFakeLead("needs_human_review");
    const store = createInMemoryLeadStore([lead]);
    const handler = createLeadPatchHandler({
      resolveStore: () => store,
      reviewRateLimiter: createInMemoryRateLimiter({
        maxRequests: 20,
        windowMs: 60_000,
      }),
    });

    const res = await handler(
      new Request(`http://localhost:3000/api/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: "approved",
          edited_draft_reply: "Hi Jordan, let's connect next Tuesday at 2pm.",
          actor: "revops_lead",
        }),
      }),
      { params: Promise.resolve({ id: lead.id }) },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lead.status).toBe("approved");
    expect(body.lead.draft_reply).toBe(
      "Hi Jordan, let's connect next Tuesday at 2pm.",
    );
    expect(body.audit_log.action).toBe("human_approved");
    expect(body.audit_log.actor).toBe("revops_lead");
    expect(store.audits).toHaveLength(1);
  });

  it("rejects invalid UUIDs and invalid decision statuses with 400", async () => {
    const lead = createFakeLead("needs_human_review");
    const store = createInMemoryLeadStore([lead]);
    const handler = createLeadPatchHandler({
      resolveStore: () => store,
      reviewRateLimiter: createInMemoryRateLimiter({
        maxRequests: 20,
        windowMs: 60_000,
      }),
    });

    const badUuidRes = await handler(
      new Request("http://localhost:3000/api/leads/not-a-uuid", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "approved" }),
      }),
      { params: Promise.resolve({ id: "not-a-uuid" }) },
    );
    expect(badUuidRes.status).toBe(400);

    const badStatusRes = await handler(
      new Request(`http://localhost:3000/api/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "auto_routed" }),
      }),
      { params: Promise.resolve({ id: lead.id }) },
    );
    expect(badStatusRes.status).toBe(400);
  });

  it("returns 404 for unknown lead ID and 409 for invalid state transitions", async () => {
    const autoRouted = createFakeLead("auto_routed");
    const alreadyApproved = createFakeLead("approved");
    const store = createInMemoryLeadStore([autoRouted, alreadyApproved]);
    const handler = createLeadPatchHandler({
      resolveStore: () => store,
      reviewRateLimiter: createInMemoryRateLimiter({
        maxRequests: 20,
        windowMs: 60_000,
      }),
    });

    const missingId = randomUUID();
    const notFoundRes = await handler(
      new Request(`http://localhost:3000/api/leads/${missingId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "rejected" }),
      }),
      { params: Promise.resolve({ id: missingId }) },
    );
    expect(notFoundRes.status).toBe(404);

    const conflictAutoRes = await handler(
      new Request(`http://localhost:3000/api/leads/${autoRouted.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "approved" }),
      }),
      { params: Promise.resolve({ id: autoRouted.id }) },
    );
    expect(conflictAutoRes.status).toBe(409);

    const conflictApprovedRes = await handler(
      new Request(`http://localhost:3000/api/leads/${alreadyApproved.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "rejected" }),
      }),
      { params: Promise.resolve({ id: alreadyApproved.id }) },
    );
    expect(conflictApprovedRes.status).toBe(409);
  });

  it("enforces public sandbox rate limiting with 429 and Retry-After", async () => {
    const lead1 = createFakeLead("needs_human_review");
    const lead2 = createFakeLead("needs_human_review");
    const store = createInMemoryLeadStore([lead1, lead2]);
    const handler = createLeadPatchHandler({
      resolveStore: () => store,
      reviewRateLimiter: createInMemoryRateLimiter({
        maxRequests: 1,
        windowMs: 60_000,
      }),
    });

    const first = await handler(
      new Request(`http://localhost:3000/api/leads/${lead1.id}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "198.51.100.42",
        },
        body: JSON.stringify({ status: "approved" }),
      }),
      { params: Promise.resolve({ id: lead1.id }) },
    );
    expect(first.status).toBe(200);

    const limited = await handler(
      new Request(`http://localhost:3000/api/leads/${lead2.id}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "198.51.100.42",
        },
        body: JSON.stringify({ status: "rejected" }),
      }),
      { params: Promise.resolve({ id: lead2.id }) },
    );
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBeTruthy();
  });
});
