import { createClient } from "@supabase/supabase-js";
import type { SupabaseConfig } from "@/lib/config";
import type { CreateLeadInput, LeadRepository } from "@/lib/pipeline";
import {
  AuditLogRecordSchema,
  LeadRecordSchema,
  type AuditLogRecord,
  type LeadDecision,
  type LeadRecord,
  type LeadStatus,
} from "@/lib/schemas";

export interface LeadWithAuditLogs extends LeadRecord {
  readonly audit_logs: readonly AuditLogRecord[];
}

export type ReviewLeadResult =
  | {
      readonly ok: true;
      readonly lead: LeadRecord;
      readonly auditLog: AuditLogRecord;
    }
  | {
      readonly ok: false;
      readonly code: "NOT_FOUND" | "INVALID_STATE_TRANSITION";
      readonly message: string;
      readonly currentStatus?: LeadStatus;
    };

export interface LeadStore extends LeadRepository {
  countRecentDemoLeads(sinceIso: string): Promise<number>;
  listLeadsWithAudit(options?: {
    readonly status?: LeadStatus;
    readonly limit?: number;
  }): Promise<readonly LeadWithAuditLogs[]>;
  reviewLead(leadId: string, decision: LeadDecision): Promise<ReviewLeadResult>;
}

function parseLeadRecord(row: unknown): LeadRecord {
  return LeadRecordSchema.parse(row);
}

function parseAuditLogRecord(row: unknown): AuditLogRecord {
  return AuditLogRecordSchema.parse(row);
}

/**
 * Supabase PostgreSQL implementation of LeadStore.
 * Uses the server-side service role key, handles concurrent idempotency_key races (23505),
 * and enforces atomic needs_human_review -> approved/rejected state transitions.
 */
export function createSupabaseLeadStore(config: SupabaseConfig): LeadStore {
  const supabase = createClient(config.url, config.serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  async function findByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<LeadRecord | null> {
    const { data, error } = await supabase
      .from("leads")
      .select("*")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

    if (error) {
      throw new Error(`Supabase findByIdempotencyKey failed: ${error.message}`);
    }

    return data ? parseLeadRecord(data) : null;
  }

  async function createLeadWithAudit(
    input: CreateLeadInput,
  ): Promise<LeadRecord> {
    const insertPayload = {
      idempotency_key: input.idempotency_key,
      name: input.lead.name,
      email: input.lead.email,
      company_url: input.lead.company_url,
      message: input.lead.message,
      enriched_summary: input.enrichment.ok ? input.enrichment.summary : null,
      enrichment_ok: input.enrichment.ok,
      prompt_injection_detected: input.prompt_injection.detected,
      triage_json: input.triage,
      icp_score: input.triage?.icp_score ?? null,
      confidence_score: input.triage?.confidence_score ?? null,
      draft_reply: input.triage?.draft_reply ?? null,
      status: input.routing.status,
      source: input.lead.source,
      langfuse_trace_id: input.langfuse_trace_id,
    };

    const { data, error } = await supabase
      .from("leads")
      .insert(insertPayload)
      .select("*")
      .single();

    if (error) {
      // Handle concurrent duplicate race condition cleanly via Postgres unique violation code.
      if (error.code === "23505") {
        const existing = await findByIdempotencyKey(input.idempotency_key);
        if (existing !== null) {
          return existing;
        }
      }
      throw new Error(`Supabase insert lead failed: ${error.message}`);
    }

    const savedLead = parseLeadRecord(data);

    const { error: auditError } = await supabase.from("audit_logs").insert({
      lead_id: savedLead.id,
      action: `triage_${input.routing.status}`,
      actor: "triage_agent",
      details_json: {
        routing_reason: input.routing.reason,
        suggested_route: input.routing.suggestedRoute,
        enrichment_ok: input.enrichment.ok,
        enrichment_reason: input.enrichment.ok ? "ok" : input.enrichment.reason,
        email_domain: input.email_domain,
        prompt_injection_detected: input.prompt_injection.detected,
        prompt_injection_source: input.prompt_injection.source,
        matched_patterns: [...input.prompt_injection.matchedPatterns],
        model_used: input.model_used ?? null,
        fallback_attempts: input.fallback_attempts ?? [],
        langfuse_trace_id: input.langfuse_trace_id,
      },
    });

    if (auditError) {
      throw new Error(`Supabase insert audit_log failed: ${auditError.message}`);
    }

    return savedLead;
  }

  async function countRecentDemoLeads(sinceIso: string): Promise<number> {
    const { count, error } = await supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("source", "web_demo")
      .gte("created_at", sinceIso);

    if (error) {
      throw new Error(`Supabase countRecentDemoLeads failed: ${error.message}`);
    }

    return count ?? 0;
  }

  async function listLeadsWithAudit(options?: {
    readonly status?: LeadStatus;
    readonly limit?: number;
  }): Promise<readonly LeadWithAuditLogs[]> {
    const limit = Math.min(100, Math.max(1, options?.limit ?? 50));

    let query = supabase
      .from("leads")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (options?.status) {
      query = query.eq("status", options.status);
    }

    const { data: leadRows, error: leadsError } = await query;
    if (leadsError) {
      throw new Error(`Supabase listLeads failed: ${leadsError.message}`);
    }

    const leads = (leadRows ?? []).map(parseLeadRecord);
    if (leads.length === 0) {
      return [];
    }

    const leadIds = leads.map((lead) => lead.id);
    const { data: auditRows, error: auditError } = await supabase
      .from("audit_logs")
      .select("*")
      .in("lead_id", leadIds)
      .order("created_at", { ascending: false });

    if (auditError) {
      throw new Error(`Supabase listAuditLogs failed: ${auditError.message}`);
    }

    const auditsByLead = new Map<string, AuditLogRecord[]>();
    for (const row of auditRows ?? []) {
      const parsed = parseAuditLogRecord(row);
      const list = auditsByLead.get(parsed.lead_id) ?? [];
      list.push(parsed);
      auditsByLead.set(parsed.lead_id, list);
    }

    return leads.map((lead) => ({
      ...lead,
      audit_logs: auditsByLead.get(lead.id) ?? [],
    }));
  }

  async function reviewLead(
    leadId: string,
    decision: LeadDecision,
  ): Promise<ReviewLeadResult> {
    const { data: existingRow, error: fetchError } = await supabase
      .from("leads")
      .select("*")
      .eq("id", leadId)
      .maybeSingle();

    if (fetchError) {
      throw new Error(`Supabase fetch lead failed: ${fetchError.message}`);
    }

    if (!existingRow) {
      return {
        ok: false,
        code: "NOT_FOUND",
        message: "Lead not found.",
      };
    }

    const existing = parseLeadRecord(existingRow);
    if (existing.status !== "needs_human_review") {
      return {
        ok: false,
        code: "INVALID_STATE_TRANSITION",
        message: `Lead cannot be reviewed from status '${existing.status}'. Only 'needs_human_review' leads can be approved or rejected.`,
        currentStatus: existing.status,
      };
    }

    const updatePayload: { status: LeadStatus; draft_reply?: string } = {
      status: decision.status,
    };
    if (decision.edited_draft_reply !== undefined) {
      updatePayload.draft_reply = decision.edited_draft_reply;
    }

    // Optimistic state guard in SQL prevents concurrent double-review races.
    const { data: updatedRow, error: updateError } = await supabase
      .from("leads")
      .update(updatePayload)
      .eq("id", leadId)
      .eq("status", "needs_human_review")
      .select("*")
      .maybeSingle();

    if (updateError) {
      throw new Error(`Supabase update lead failed: ${updateError.message}`);
    }

    if (!updatedRow) {
      return {
        ok: false,
        code: "INVALID_STATE_TRANSITION",
        message: "Lead was already reviewed concurrently.",
      };
    }

    const updatedLead = parseLeadRecord(updatedRow);

    const { data: auditRow, error: auditError } = await supabase
      .from("audit_logs")
      .insert({
        lead_id: updatedLead.id,
        action: `human_${decision.status}`,
        actor: decision.actor,
        details_json: {
          previous_status: existing.status,
          new_status: updatedLead.status,
          draft_reply_edited: decision.edited_draft_reply !== undefined,
        },
      })
      .select("*")
      .single();

    if (auditError) {
      throw new Error(`Supabase insert review audit failed: ${auditError.message}`);
    }

    return {
      ok: true,
      lead: updatedLead,
      auditLog: parseAuditLogRecord(auditRow),
    };
  }

  return {
    findByIdempotencyKey,
    createLeadWithAudit,
    countRecentDemoLeads,
    listLeadsWithAudit,
    reviewLead,
  };
}
