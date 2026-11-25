import { after, NextResponse } from "next/server";
import { runTriagePipeline, type TriagePipelineDeps } from "@/lib/pipeline";
import { InboundLeadSchema } from "@/lib/schemas";
import {
  authorizeTriageRequest,
  createInMemoryRateLimiter,
  type RateLimiter,
} from "@/lib/security";

const defaultDemoRateLimiter = createInMemoryRateLimiter({
  maxRequests: 10,
  windowMs: 60_000,
});

function defaultScheduleFlush(task: () => Promise<void>): void {
  try {
    after(async () => {
      await task();
    });
  } catch {
    // Outside a Next.js request scope (e.g. direct unit test invocation).
    void task();
  }
}

export interface TriageRouteHandlerConfig {
  readonly resolveDeps: () => TriagePipelineDeps | null;
  readonly getWebhookSecret?: () => string | undefined;
  readonly demoRateLimiter?: RateLimiter;
  readonly scheduleFlush?: (task: () => Promise<void>) => void;
}

export function createTriagePostHandler(config: TriageRouteHandlerConfig) {
  const {
    resolveDeps,
    getWebhookSecret = () => process.env.WEBHOOK_SECRET,
    demoRateLimiter = defaultDemoRateLimiter,
    scheduleFlush = defaultScheduleFlush,
  } = config;

  return async function handleTriagePost(request: Request): Promise<NextResponse> {
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

    const parsed = InboundLeadSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "VALIDATION_ERROR",
          message: "Invalid inbound lead payload.",
          details: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 400 },
      );
    }

    const auth = authorizeTriageRequest({
      source: parsed.data.source,
      headers: request.headers,
      expectedWebhookSecret: getWebhookSecret(),
      demoRateLimiter,
    });

    if (!auth.ok) {
      const responseHeaders = new Headers();
      if (auth.retryAfterSec !== undefined) {
        responseHeaders.set("Retry-After", String(auth.retryAfterSec));
      }
      return NextResponse.json(
        {
          error: auth.code,
          message: auth.message,
        },
        { status: auth.status, headers: responseHeaders },
      );
    }

    const deps = resolveDeps();
    if (deps === null) {
      return NextResponse.json(
        {
          error: "LIVE_INTEGRATIONS_NOT_CONFIGURED",
          message:
            "Live Gemini/Supabase integrations are not configured in this environment.",
        },
        { status: 503 },
      );
    }

    try {
      const { response, flushTelemetry } = await runTriagePipeline(
        parsed.data,
        deps,
      );
      scheduleFlush(flushTelemetry);
      return NextResponse.json(response, { status: 200 });
    } catch {
      return NextResponse.json(
        {
          error: "TRIAGE_PIPELINE_FAILED",
          message: "Unable to complete lead triage right now.",
        },
        { status: 502 },
      );
    }
  };
}
