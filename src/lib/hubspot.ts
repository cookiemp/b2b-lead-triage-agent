import { z } from "zod";
import { loadLangfuseConfig, type LangfuseConfig } from "@/lib/config";
import type { LeadStore } from "@/lib/db";
import { emitHubSpotSyncSpan } from "@/lib/observability";
import type { LeadRecord } from "@/lib/schemas";

export const DEFAULT_HUBSPOT_TIMEOUT_MS = 5000;
export const HUBSPOT_API_BASE_URL = "https://api.hubapi.com";
export const HUBSPOT_NOTE_TO_CONTACT_ASSOCIATION_TYPE_ID = 202;
const MAX_ENRICHMENT_SUMMARY_CHARS = 1500;

export interface HubSpotCustomPropertySpec {
  readonly name: string;
  readonly label: string;
  readonly type: "number" | "string";
  readonly fieldType: "number" | "text" | "textarea";
  readonly groupName: "contactinformation";
  readonly description: string;
}

export const HUBSPOT_CUSTOM_PROPERTIES: readonly HubSpotCustomPropertySpec[] = [
  {
    name: "icp_score",
    label: "ICP Score",
    type: "number",
    fieldType: "number",
    groupName: "contactinformation",
    description: "AI-assigned Ideal Customer Profile fit score (0-100).",
  },
  {
    name: "triage_route",
    label: "Triage Route",
    type: "string",
    fieldType: "text",
    groupName: "contactinformation",
    description:
      "Suggested B2B routing destination (sales_enterprise, sales_smb, support, spam).",
  },
  {
    name: "ai_enrichment_summary",
    label: "AI Enrichment Summary",
    type: "string",
    fieldType: "textarea",
    groupName: "contactinformation",
    description:
      "Domain enrichment summary captured during automated inbound lead triage.",
  },
] as const;

const BatchUpsertResponseSchema = z.object({
  results: z
    .array(
      z.object({
        id: z.string().min(1),
      }),
    )
    .min(1),
});

const CreateNoteResponseSchema = z.object({
  id: z.string().min(1),
});

export type HubSpotSyncOutcome =
  | {
      readonly status: "synced";
      readonly contactId: string;
      readonly noteId: string;
      readonly syncedAt: string;
      readonly latencyMs: number;
    }
  | {
      readonly status: "skipped";
      readonly reason: "token_missing" | "ineligible_status" | "already_synced";
      readonly latencyMs: number;
    }
  | {
      readonly status: "failed";
      readonly reason:
        | "timeout"
        | "http_error"
        | "invalid_response"
        | "network_error";
      readonly httpStatus?: number;
      readonly contactId?: string;
      readonly message: string;
      readonly latencyMs: number;
    };

export interface HubSpotSyncOptions {
  readonly accessToken?: string | null;
  readonly fetchFn?: typeof fetch;
  readonly timeoutMs?: number;
  readonly now?: () => number;
  readonly baseUrl?: string;
}

function splitFullName(fullName: string): {
  readonly firstname: string;
  readonly lastname: string;
} {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return { firstname: "", lastname: "" };
  }
  if (parts.length === 1) {
    return { firstname: parts[0]!, lastname: "" };
  }
  return {
    firstname: parts[0]!,
    lastname: parts.slice(1).join(" "),
  };
}

function deriveCompanyName(companyUrl: string): string {
  try {
    const host = new URL(companyUrl).hostname.replace(/^www\./i, "");
    const firstLabel = host.split(".")[0] ?? host;
    if (!firstLabel) {
      return host;
    }
    return firstLabel.charAt(0).toUpperCase() + firstLabel.slice(1);
  } catch {
    return "";
  }
}

function truncateText(value: string, maxChars: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxChars - 3).trimEnd()}...`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildHubSpotNoteBody(lead: LeadRecord): string {
  const route = lead.triage_json?.suggested_route ?? "unassigned";
  const icp = lead.icp_score !== null ? `${lead.icp_score}/100` : "n/a";
  const confidence =
    lead.confidence_score !== null ? lead.confidence_score.toFixed(2) : "n/a";
  const summary = lead.enriched_summary
    ? truncateText(lead.enriched_summary, MAX_ENRICHMENT_SUMMARY_CHARS)
    : "No domain enrichment summary available.";
  const draft = lead.draft_reply?.trim() || "No drafted reply.";

  return [
    `<p><strong>B2B Lead Triage Summary</strong></p>`,
    `<p><strong>Status:</strong> ${escapeHtml(lead.status)} | <strong>Route:</strong> ${escapeHtml(route)} | <strong>ICP Score:</strong> ${escapeHtml(icp)} | <strong>Confidence:</strong> ${escapeHtml(confidence)}</p>`,
    `<p><strong>AI Enrichment Summary:</strong><br/>${escapeHtml(summary).replace(/\r?\n/g, "<br/>")}</p>`,
    `<p><strong>Drafted Reply:</strong><br/>${escapeHtml(draft).replace(/\r?\n/g, "<br/>")}</p>`,
  ].join("");
}

async function fetchWithTimeout(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchFn(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

/**
 * Idempotently upserts an auto-routed or human-approved lead to HubSpot CRM v3
 * by email and attaches an HTML Note with the AI enrichment summary and drafted reply.
 * Gracefully skips when HUBSPOT_ACCESS_TOKEN is unset; never throws on 429/5xx/timeouts.
 */
export async function syncLeadToHubSpot(
  lead: LeadRecord,
  options: HubSpotSyncOptions = {},
): Promise<HubSpotSyncOutcome> {
  const now = options.now ?? Date.now;
  const startedAt = now();

  const token = (
    options.accessToken !== undefined
      ? options.accessToken
      : process.env.HUBSPOT_ACCESS_TOKEN
  )?.trim();

  if (!token) {
    console.warn(
      JSON.stringify({
        event: "hubspot_sync_skipped",
        reason: "token_missing",
        lead_id: lead.id,
      }),
    );
    return {
      status: "skipped",
      reason: "token_missing",
      latencyMs: Math.max(0, now() - startedAt),
    };
  }

  if (lead.status !== "auto_routed" && lead.status !== "approved") {
    return {
      status: "skipped",
      reason: "ineligible_status",
      latencyMs: Math.max(0, now() - startedAt),
    };
  }

  if (lead.hubspot_sync_status === "synced") {
    return {
      status: "skipped",
      reason: "already_synced",
      latencyMs: Math.max(0, now() - startedAt),
    };
  }

  const fetchFn = options.fetchFn ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_HUBSPOT_TIMEOUT_MS;
  const baseUrl = (options.baseUrl ?? HUBSPOT_API_BASE_URL).replace(/\/$/, "");
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const { firstname, lastname } = splitFullName(lead.name);
  const company = deriveCompanyName(lead.company_url);
  const properties: Record<string, string | number> = {
    email: lead.email,
    firstname,
    lastname,
    company,
    website: lead.company_url,
    triage_route: lead.triage_json?.suggested_route ?? "unassigned",
    ai_enrichment_summary: lead.enriched_summary
      ? truncateText(lead.enriched_summary, MAX_ENRICHMENT_SUMMARY_CHARS)
      : "",
  };
  if (lead.icp_score !== null) {
    properties.icp_score = lead.icp_score;
  }

  let contactId: string;
  try {
    const upsertRes = await fetchWithTimeout(
      fetchFn,
      `${baseUrl}/crm/v3/objects/contacts/batch/upsert`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          inputs: [
            {
              idProperty: "email",
              id: lead.email,
              properties,
            },
          ],
        }),
      },
      timeoutMs,
    );

    if (!upsertRes.ok) {
      return {
        status: "failed",
        reason: "http_error",
        httpStatus: upsertRes.status,
        message: `HubSpot contact upsert returned HTTP ${upsertRes.status}`,
        latencyMs: Math.max(0, now() - startedAt),
      };
    }

    const parsedUpsert = BatchUpsertResponseSchema.safeParse(
      await upsertRes.json(),
    );
    if (!parsedUpsert.success) {
      return {
        status: "failed",
        reason: "invalid_response",
        message: "HubSpot contact upsert returned unexpected payload shape",
        latencyMs: Math.max(0, now() - startedAt),
      };
    }

    contactId = parsedUpsert.data.results[0]!.id;
  } catch (error: unknown) {
    return {
      status: "failed",
      reason: isAbortError(error) ? "timeout" : "network_error",
      message: isAbortError(error)
        ? `HubSpot contact upsert timed out after ${timeoutMs}ms`
        : error instanceof Error
          ? error.message
          : "HubSpot contact upsert network error",
      latencyMs: Math.max(0, now() - startedAt),
    };
  }

  try {
    const syncedAt = new Date(now()).toISOString();
    const noteRes = await fetchWithTimeout(
      fetchFn,
      `${baseUrl}/crm/v3/objects/notes`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          properties: {
            hs_timestamp: syncedAt,
            hs_note_body: buildHubSpotNoteBody(lead),
          },
          associations: [
            {
              to: { id: contactId },
              types: [
                {
                  associationCategory: "HUBSPOT_DEFINED",
                  associationTypeId: HUBSPOT_NOTE_TO_CONTACT_ASSOCIATION_TYPE_ID,
                },
              ],
            },
          ],
        }),
      },
      timeoutMs,
    );

    if (!noteRes.ok) {
      return {
        status: "failed",
        reason: "http_error",
        httpStatus: noteRes.status,
        contactId,
        message: `HubSpot note creation returned HTTP ${noteRes.status}`,
        latencyMs: Math.max(0, now() - startedAt),
      };
    }

    const parsedNote = CreateNoteResponseSchema.safeParse(await noteRes.json());
    if (!parsedNote.success) {
      return {
        status: "failed",
        reason: "invalid_response",
        contactId,
        message: "HubSpot note creation returned unexpected payload shape",
        latencyMs: Math.max(0, now() - startedAt),
      };
    }

    return {
      status: "synced",
      contactId,
      noteId: parsedNote.data.id,
      syncedAt,
      latencyMs: Math.max(0, now() - startedAt),
    };
  } catch (error: unknown) {
    return {
      status: "failed",
      reason: isAbortError(error) ? "timeout" : "network_error",
      contactId,
      message: isAbortError(error)
        ? `HubSpot note creation timed out after ${timeoutMs}ms`
        : error instanceof Error
          ? error.message
          : "HubSpot note creation network error",
      latencyMs: Math.max(0, now() - startedAt),
    };
  }
}

/**
 * Orchestrates HubSpot sync + Supabase persistence + Langfuse OTLP span for
 * eligible leads (`auto_routed` or `approved`). Never throws so the caller's
 * main triage or approval response is never disrupted.
 */
export async function syncAndRecordLeadToHubSpot(params: {
  readonly lead: LeadRecord;
  readonly trigger: "auto_routed" | "human_approved";
  readonly store: LeadStore | null;
  readonly langfuseConfig?: LangfuseConfig | null;
  readonly options?: HubSpotSyncOptions;
}): Promise<{
  readonly outcome: HubSpotSyncOutcome;
  readonly updatedLead: LeadRecord;
}> {
  const outcome = await syncLeadToHubSpot(params.lead, params.options);
  let updatedLead = params.lead;

  if (
    params.store?.recordHubSpotSync &&
    !(outcome.status === "skipped" && outcome.reason === "already_synced") &&
    !(outcome.status === "skipped" && outcome.reason === "ineligible_status")
  ) {
    try {
      const persisted = await params.store.recordHubSpotSync(params.lead.id, {
        status: outcome.status,
        contactId:
          outcome.status === "synced"
            ? outcome.contactId
            : outcome.status === "failed"
              ? (outcome.contactId ?? null)
              : null,
        noteId: outcome.status === "synced" ? outcome.noteId : null,
        syncedAt: outcome.status === "synced" ? outcome.syncedAt : null,
        reason:
          outcome.status === "failed"
            ? outcome.message
            : outcome.status === "skipped"
              ? outcome.reason
              : undefined,
        httpStatus:
          outcome.status === "failed" ? outcome.httpStatus : undefined,
      });
      if (persisted) {
        updatedLead = persisted;
      }
    } catch (error: unknown) {
      console.error(
        "Failed to persist HubSpot sync status:",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  const langfuseConfig =
    params.langfuseConfig !== undefined
      ? params.langfuseConfig
      : loadLangfuseConfig();
  if (
    langfuseConfig &&
    !(outcome.status === "skipped" && outcome.reason === "ineligible_status")
  ) {
    await emitHubSpotSyncSpan(langfuseConfig, {
      leadId: params.lead.id,
      trigger: params.trigger,
      status: outcome.status,
      latencyMs: outcome.latencyMs,
      contactId:
        outcome.status === "synced"
          ? outcome.contactId
          : outcome.status === "failed"
            ? (outcome.contactId ?? null)
            : null,
      noteId: outcome.status === "synced" ? outcome.noteId : null,
      reason:
        outcome.status === "failed"
          ? outcome.message
          : outcome.status === "skipped"
            ? outcome.reason
            : undefined,
      httpStatus: outcome.status === "failed" ? outcome.httpStatus : undefined,
      parentTraceId:
        params.trigger === "auto_routed" ? params.lead.langfuse_trace_id : null,
    });
  }

  return { outcome, updatedLead };
}
