import { NextResponse } from "next/server";
import { z } from "zod";
import type { LeadStore } from "@/lib/db";
import { LeadDecisionSchema, LeadStatusSchema } from "@/lib/schemas";
import {
  createInMemoryRateLimiter,
  extractClientIp,
  type RateLimiter,
} from "@/lib/security";

const UuidSchema = z.string().uuid("Lead id must be a valid UUID");

const defaultReviewRateLimiter = createInMemoryRateLimiter({
  maxRequests: 30,
  windowMs: 60_000,
});

export function createLeadsGetHandler(config: {
  readonly resolveStore: () => LeadStore | null;
}) {
  return async function handleLeadsGet(request: Request): Promise<NextResponse> {
    const url = new URL(request.url);
    const rawStatus = url.searchParams.get("status");
    const rawLimit = url.searchParams.get("limit");

    let statusFilter: z.infer<typeof LeadStatusSchema> | undefined;
    if (rawStatus !== null && rawStatus.trim() !== "") {
      const parsedStatus = LeadStatusSchema.safeParse(rawStatus);
      if (!parsedStatus.success) {
        return NextResponse.json(
          {
            error: "INVALID_QUERY",
            message: "Invalid status filter value.",
          },
          { status: 400 },
        );
      }
      statusFilter = parsedStatus.data;
    }

    let limit = 50;
    if (rawLimit !== null && rawLimit.trim() !== "") {
      const parsedLimit = Number(rawLimit);
      if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
        return NextResponse.json(
          {
            error: "INVALID_QUERY",
            message: "limit must be an integer between 1 and 100.",
          },
          { status: 400 },
        );
      }
      limit = parsedLimit;
    }

    const store = config.resolveStore();
    if (store === null) {
      return NextResponse.json(
        {
          error: "DATABASE_NOT_CONFIGURED",
          message: "Supabase credentials are not configured in this environment.",
        },
        { status: 503 },
      );
    }

    try {
      const leads = await store.listLeadsWithAudit({
        status: statusFilter,
        limit,
      });
      return NextResponse.json({ leads }, { status: 200 });
    } catch {
      return NextResponse.json(
        {
          error: "DATABASE_ERROR",
          message: "Unable to load leads right now.",
        },
        { status: 502 },
      );
    }
  };
}

export function createLeadPatchHandler(config: {
  readonly resolveStore: () => LeadStore | null;
  readonly reviewRateLimiter?: RateLimiter;
}) {
  const { resolveStore, reviewRateLimiter = defaultReviewRateLimiter } = config;

  return async function handleLeadPatch(
    request: Request,
    context: { readonly params: Promise<{ readonly id: string }> },
  ): Promise<NextResponse> {
    const clientIp = extractClientIp(request.headers);
    const rateLimit = reviewRateLimiter.check(`leads:patch:${clientIp}`);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          error: "RATE_LIMITED",
          message: "Too many review requests. Please wait before retrying.",
        },
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfterSec) },
        },
      );
    }

    const { id } = await context.params;
    const parsedId = UuidSchema.safeParse(id);
    if (!parsedId.success) {
      return NextResponse.json(
        {
          error: "INVALID_LEAD_ID",
          message: "Lead ID must be a valid UUID.",
        },
        { status: 400 },
      );
    }

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json(
        {
          error: "INVALID_JSON",
          message: "Request body must be valid JSON.",
        },
        { status: 400 },
      );
    }

    const parsedBody = LeadDecisionSchema.safeParse(rawBody);
    if (!parsedBody.success) {
      return NextResponse.json(
        {
          error: "VALIDATION_ERROR",
          message: "Invalid review decision payload.",
          details: parsedBody.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 400 },
      );
    }

    const store = resolveStore();
    if (store === null) {
      return NextResponse.json(
        {
          error: "DATABASE_NOT_CONFIGURED",
          message: "Supabase credentials are not configured in this environment.",
        },
        { status: 503 },
      );
    }

    try {
      const result = await store.reviewLead(parsedId.data, parsedBody.data);
      if (!result.ok) {
        const status = result.code === "NOT_FOUND" ? 404 : 409;
        return NextResponse.json(
          {
            error: result.code,
            message: result.message,
            current_status: result.currentStatus,
          },
          { status },
        );
      }

      return NextResponse.json(
        {
          lead: result.lead,
          audit_log: result.auditLog,
        },
        { status: 200 },
      );
    } catch {
      return NextResponse.json(
        {
          error: "DATABASE_ERROR",
          message: "Unable to update lead review status right now.",
        },
        { status: 502 },
      );
    }
  };
}
