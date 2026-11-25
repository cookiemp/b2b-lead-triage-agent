import { z } from "zod";

export const LEAD_SOURCES = ["web_demo", "webhook", "n8n"] as const;
export const LEAD_STATUSES = [
  "auto_routed",
  "auto_rejected",
  "needs_human_review",
  "approved",
  "rejected",
] as const;
export const SUGGESTED_ROUTES = [
  "sales_enterprise",
  "sales_smb",
  "support",
  "spam",
] as const;
export const URGENCIES = ["low", "medium", "high"] as const;
export const REVIEW_DECISIONS = ["approved", "rejected"] as const;

export const LeadSourceSchema = z.enum(LEAD_SOURCES);
export const LeadStatusSchema = z.enum(LEAD_STATUSES);
export const SuggestedRouteSchema = z.enum(SUGGESTED_ROUTES);
export const UrgencySchema = z.enum(URGENCIES);
export const ReviewDecisionSchema = z.enum(REVIEW_DECISIONS);

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata",
]);

const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa"];

function parseIpv4(host: string): readonly [number, number, number, number] | null {
  const parts = host.split(".");
  if (parts.length !== 4) {
    return null;
  }

  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return null;
    }
    const num = Number(part);
    if (!Number.isInteger(num) || num < 0 || num > 255) {
      return null;
    }
    octets.push(num);
  }

  const [a, b, c, d] = octets;
  if (a === undefined || b === undefined || c === undefined || d === undefined) {
    return null;
  }
  return [a, b, c, d] as const;
}

function isRestrictedIpv4(octets: readonly [number, number, number, number]): boolean {
  const [a, b] = octets;
  if (a === 0) return true; // 0.0.0.0/8 unspecified
  if (a === 10) return true; // 10.0.0.0/8 RFC1918
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local & cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 RFC1918
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a >= 224) return true; // Multicast & reserved
  return false;
}

function isRestrictedIpv6(rawHost: string): boolean {
  const host = rawHost.toLowerCase();
  if (host === "::" || host === "::1" || host === "0:0:0:0:0:0:0:1") {
    return true;
  }
  // Unique local addresses (fc00::/7)
  if (host.startsWith("fc") || host.startsWith("fd")) {
    return true;
  }
  // Link-local addresses (fe80::/10)
  if (/^fe[89ab]/i.test(host)) {
    return true;
  }
  // IPv4-mapped IPv6 addresses (::ffff:...)
  if (host.startsWith("::ffff:")) {
    return true;
  }
  return false;
}

/**
 * Validates that a company URL is a public http(s) URL and rejects SSRF targets
 * such as localhost, single-label internal hosts, private/loopback/metadata IPs,
 * and URLs with embedded credentials.
 */
export function isSafePublicHttpUrl(rawValue: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawValue);
  } catch {
    return false;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }

  if (parsed.username !== "" || parsed.password !== "") {
    return false;
  }

  const normalizedHost = parsed.hostname.replace(/\.$/, "").toLowerCase();
  if (normalizedHost === "") {
    return false;
  }

  // IPv6 hostnames are bracketed by WHATWG URL parser
  if (normalizedHost.startsWith("[") && normalizedHost.endsWith("]")) {
    const ipv6 = normalizedHost.slice(1, -1);
    return !isRestrictedIpv6(ipv6);
  }

  if (BLOCKED_HOSTNAMES.has(normalizedHost)) {
    return false;
  }

  for (const suffix of BLOCKED_HOST_SUFFIXES) {
    if (normalizedHost.endsWith(suffix)) {
      return false;
    }
  }

  const ipv4 = parseIpv4(normalizedHost);
  if (ipv4 !== null) {
    return !isRestrictedIpv4(ipv4);
  }

  // Public company domains must have at least one dot (blocks single-label internal hosts)
  if (!normalizedHost.includes(".")) {
    return false;
  }

  return true;
}

export const SafePublicUrlSchema = z
  .string()
  .trim()
  .min(1, "company_url is required")
  .max(2048, "company_url is too long")
  .refine(isSafePublicHttpUrl, {
    message:
      "company_url must be a valid public http(s) URL and cannot target localhost or private network addresses",
  });

export const InboundLeadSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "name is required")
    .max(120, "name must be 120 characters or fewer"),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("email must be a valid email address")
    .max(254, "email is too long"),
  company_url: SafePublicUrlSchema,
  message: z
    .string()
    .trim()
    .min(1, "message is required")
    .max(4000, "message must be 4000 characters or fewer"),
  source: LeadSourceSchema.default("web_demo"),
  idempotency_nonce: z
    .string()
    .trim()
    .min(1, "idempotency_nonce cannot be empty when provided")
    .max(64, "idempotency_nonce must be 64 characters or fewer")
    .optional(),
});

export const TriageResultSchema = z.object({
  intent: z.string().trim().min(1, "intent is required").max(200),
  urgency: UrgencySchema,
  company_size_estimate: z
    .string()
    .trim()
    .min(1, "company_size_estimate is required")
    .max(120),
  icp_score: z
    .number()
    .int("icp_score must be an integer")
    .min(0, "icp_score must be >= 0")
    .max(100, "icp_score must be <= 100"),
  suggested_route: SuggestedRouteSchema,
  confidence_score: z
    .number()
    .min(0, "confidence_score must be >= 0")
    .max(1, "confidence_score must be <= 1"),
  reasoning: z.string().trim().min(1, "reasoning is required").max(1500),
  draft_reply: z.string().trim().min(1, "draft_reply is required").max(4000),
});

export const LeadDecisionSchema = z.object({
  status: ReviewDecisionSchema,
  edited_draft_reply: z
    .string()
    .trim()
    .min(1, "edited_draft_reply cannot be empty when provided")
    .max(4000, "edited_draft_reply must be 4000 characters or fewer")
    .optional(),
  actor: z
    .string()
    .trim()
    .min(1, "actor cannot be empty")
    .max(120, "actor must be 120 characters or fewer")
    .default("human_operator"),
});

export const LeadRecordSchema = z.object({
  id: z.string().uuid(),
  idempotency_key: z.string().min(1),
  name: z.string(),
  email: z.string().email(),
  company_url: z.string(),
  message: z.string(),
  enriched_summary: z.string().nullable(),
  enrichment_ok: z.boolean(),
  prompt_injection_detected: z.boolean(),
  triage_json: TriageResultSchema.nullable(),
  icp_score: z.number().int().min(0).max(100).nullable(),
  confidence_score: z.number().min(0).max(1).nullable(),
  draft_reply: z.string().nullable(),
  status: LeadStatusSchema,
  source: LeadSourceSchema,
  langfuse_trace_id: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const AuditLogRecordSchema = z.object({
  id: z.string().uuid(),
  lead_id: z.string().uuid(),
  action: z.string().min(1),
  actor: z.string().min(1),
  details_json: z.record(z.string(), z.unknown()).nullable(),
  created_at: z.string(),
});

export type LeadSource = z.infer<typeof LeadSourceSchema>;
export type LeadStatus = z.infer<typeof LeadStatusSchema>;
export type SuggestedRoute = z.infer<typeof SuggestedRouteSchema>;
export type Urgency = z.infer<typeof UrgencySchema>;
export type ReviewDecision = z.infer<typeof ReviewDecisionSchema>;
export type InboundLead = z.infer<typeof InboundLeadSchema>;
export type InboundLeadInput = z.input<typeof InboundLeadSchema>;
export type TriageResult = z.infer<typeof TriageResultSchema>;
export type LeadDecision = z.infer<typeof LeadDecisionSchema>;
export type LeadRecord = z.infer<typeof LeadRecordSchema>;
export type AuditLogRecord = z.infer<typeof AuditLogRecordSchema>;
