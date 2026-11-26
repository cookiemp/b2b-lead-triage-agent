import { randomBytes } from "node:crypto";
import type { LangfuseConfig } from "@/lib/config";
import type { EnrichmentOutcome } from "@/lib/enrichment";
import {
  createNoopTelemetry,
  type LlmTriageInput,
  type LlmTriageOutput,
  type PipelineTelemetry,
  type PipelineTraceHandle,
} from "@/lib/pipeline";
import type { RoutingDecision } from "@/lib/router";
import type { CombinedPromptInjectionScanResult } from "@/lib/security";

const OTLP_FLUSH_TIMEOUT_MS = 5000;

type OtlpAnyValue =
  | { readonly stringValue: string }
  | { readonly intValue: string }
  | { readonly boolValue: boolean }
  | { readonly arrayValue: { readonly values: readonly OtlpAnyValue[] } };

interface OtlpKeyValue {
  readonly key: string;
  readonly value: OtlpAnyValue;
}

interface OtlpSpan {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly kind: number;
  readonly startTimeUnixNano: string;
  readonly endTimeUnixNano: string;
  readonly attributes: OtlpKeyValue[];
  readonly status?: { readonly code: number; readonly message?: string };
}

export interface LangfuseTelemetryOptions {
  readonly fetchFn?: typeof fetch;
  readonly timeoutMs?: number;
  readonly now?: () => number;
}

function generateHexId(byteLength: number): string {
  return randomBytes(byteLength).toString("hex");
}

function msToUnixNano(ms: number): string {
  return (BigInt(Math.max(0, Math.trunc(ms))) * 1_000_000n).toString();
}

function strAttr(key: string, value: string): OtlpKeyValue {
  return { key, value: { stringValue: value } };
}

function intAttr(key: string, value: number): OtlpKeyValue {
  return { key, value: { intValue: String(Math.trunc(value)) } };
}

function boolAttr(key: string, value: boolean): OtlpKeyValue {
  return { key, value: { boolValue: value } };
}

function strArrayAttr(key: string, values: readonly string[]): OtlpKeyValue {
  return {
    key,
    value: {
      arrayValue: {
        values: values.map((v) => ({ stringValue: v })),
      },
    },
  };
}

/**
 * Langfuse OpenTelemetry (OTLP/JSON) observability adapter.
 * Targets `POST /api/public/otel/v1/traces` (required on Langfuse Cloud after the
 * November 16, 2026 shutdown of the legacy v3 `/api/public/ingestion` API).
 * Zero external SDK dependencies; flushes deterministically in one HTTP call via Next.js `after()`.
 */
export function createLangfuseTelemetry(
  config: LangfuseConfig | null,
  options: LangfuseTelemetryOptions = {},
): PipelineTelemetry {
  if (config === null) {
    return createNoopTelemetry();
  }

  const fetchFn = options.fetchFn ?? fetch;
  const timeoutMs = options.timeoutMs ?? OTLP_FLUSH_TIMEOUT_MS;
  const now = options.now ?? Date.now;

  const endpoint = `${config.baseUrl.replace(/\/$/, "")}/api/public/otel/v1/traces`;
  const authHeader = `Basic ${Buffer.from(
    `${config.publicKey}:${config.secretKey}`,
    "utf8",
  ).toString("base64")}`;

  return {
    startTrace(params): PipelineTraceHandle {
      const traceId = generateHexId(16);
      const rootSpanId = generateHexId(8);
      const traceStartMs = now();
      const childSpans: OtlpSpan[] = [];
      let traceOutput: Record<string, unknown> | null = null;
      let hasError = false;
      let flushed = false;

      const rootAttributes: OtlpKeyValue[] = [
        strAttr("langfuse.trace.name", params.name),
        strAttr("langfuse.trace.input", JSON.stringify(params.input)),
      ];
      if (params.tags && params.tags.length > 0) {
        rootAttributes.push(strArrayAttr("langfuse.trace.tags", params.tags));
      }

      return {
        id: traceId,

        recordEnrichment(outcome: EnrichmentOutcome, companyUrl: string): void {
          const endMs = now();
          const startMs = Math.max(traceStartMs, endMs - outcome.durationMs);
          const outputPayload = outcome.ok
            ? { ok: true, summary_chars: outcome.summary.length }
            : {
                ok: false,
                reason: outcome.reason,
                http_status: outcome.httpStatus,
              };

          childSpans.push({
            traceId,
            spanId: generateHexId(8),
            parentSpanId: rootSpanId,
            name: "jina_enrichment",
            kind: 3, // CLIENT
            startTimeUnixNano: msToUnixNano(startMs),
            endTimeUnixNano: msToUnixNano(endMs),
            attributes: [
              strAttr("langfuse.observation.type", "span"),
              strAttr(
                "langfuse.observation.input",
                JSON.stringify({ company_url: companyUrl }),
              ),
              strAttr(
                "langfuse.observation.output",
                JSON.stringify(outputPayload),
              ),
              intAttr("langfuse.observation.metadata.duration_ms", outcome.durationMs),
            ],
            status: outcome.ok ? { code: 1 } : { code: 2, message: outcome.reason },
          });
        },

        recordGeneration(
          input: LlmTriageInput,
          output: LlmTriageOutput,
        ): void {
          const endMs = now();
          const startMs = Math.max(traceStartMs, endMs - output.latencyMs);
          const attrs: OtlpKeyValue[] = [
            strAttr("langfuse.observation.type", "generation"),
            strAttr("langfuse.observation.model.name", output.model),
            strAttr("gen_ai.system", "google_genai"),
            strAttr("gen_ai.request.model", output.model),
            strAttr("gen_ai.response.model", output.model),
            strAttr(
              "langfuse.observation.input",
              JSON.stringify({
                source: input.lead.source,
                company_url: input.lead.company_url,
                email_domain: input.emailDomain,
                enrichment_ok: input.enrichment.ok,
                prompt_injection_detected: input.promptInjection.detected,
              }),
            ),
            strAttr("langfuse.observation.output", JSON.stringify(output.result)),
            intAttr("langfuse.observation.metadata.latency_ms", output.latencyMs),
            intAttr("langfuse.observation.metadata.attempts", output.attempts),
            strAttr("langfuse.observation.metadata.model_used", output.model),
            boolAttr(
              "langfuse.observation.metadata.used_fallback",
              (output.fallbackAttempts?.length ?? 0) > 0,
            ),
            strAttr(
              "langfuse.observation.metadata.fallback_attempts",
              JSON.stringify(output.fallbackAttempts ?? []),
            ),
          ];

          if (output.usage?.promptTokens !== undefined) {
            attrs.push(
              intAttr("gen_ai.usage.input_tokens", output.usage.promptTokens),
            );
          }
          if (output.usage?.completionTokens !== undefined) {
            attrs.push(
              intAttr(
                "gen_ai.usage.output_tokens",
                output.usage.completionTokens,
              ),
            );
          }

          childSpans.push({
            traceId,
            spanId: generateHexId(8),
            parentSpanId: rootSpanId,
            name: "gemini_lead_triage",
            kind: 3, // CLIENT
            startTimeUnixNano: msToUnixNano(startMs),
            endTimeUnixNano: msToUnixNano(endMs),
            attributes: attrs,
            status: { code: 1 },
          });
        },

        recordRouting(
          decision: RoutingDecision,
          promptInjection: CombinedPromptInjectionScanResult,
        ): void {
          const ts = now();
          childSpans.push({
            traceId,
            spanId: generateHexId(8),
            parentSpanId: rootSpanId,
            name: "deterministic_routing",
            kind: 1,
            startTimeUnixNano: msToUnixNano(ts),
            endTimeUnixNano: msToUnixNano(ts),
            attributes: [
              strAttr("langfuse.observation.type", "event"),
              strAttr(
                "langfuse.observation.output",
                JSON.stringify({
                  status: decision.status,
                  reason: decision.reason,
                  suggested_route: decision.suggestedRoute,
                  prompt_injection_detected: promptInjection.detected,
                  prompt_injection_source: promptInjection.source,
                }),
              ),
            ],
            status: { code: 1 },
          });
        },

        recordError(stage: string, error: unknown): void {
          hasError = true;
          const ts = now();
          const message =
            error instanceof Error ? error.message : String(error);
          const extra: Record<string, unknown> = { stage, message };
          if (
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            typeof error.code === "string"
          ) {
            extra.error_code = error.code;
          }
          if (
            typeof error === "object" &&
            error !== null &&
            "fallbackAttempts" in error &&
            Array.isArray(error.fallbackAttempts)
          ) {
            extra.fallback_attempts = error.fallbackAttempts;
          }
          childSpans.push({
            traceId,
            spanId: generateHexId(8),
            parentSpanId: rootSpanId,
            name: `error_${stage}`,
            kind: 1,
            startTimeUnixNano: msToUnixNano(ts),
            endTimeUnixNano: msToUnixNano(ts),
            attributes: [
              strAttr("langfuse.observation.type", "event"),
              strAttr("langfuse.observation.level", "ERROR"),
              strAttr("langfuse.observation.output", JSON.stringify(extra)),
            ],
            status: { code: 2, message },
          });
        },

        finish(output: Record<string, unknown>): void {
          traceOutput = output;
        },

        async flush(): Promise<void> {
          if (flushed) {
            return;
          }
          flushed = true;

          const traceEndMs = Math.max(traceStartMs, now());
          const finalRootAttrs = [...rootAttributes];
          if (traceOutput !== null) {
            finalRootAttrs.push(
              strAttr("langfuse.trace.output", JSON.stringify(traceOutput)),
            );
          }

          const rootSpan: OtlpSpan = {
            traceId,
            spanId: rootSpanId,
            name: params.name,
            kind: 1, // INTERNAL
            startTimeUnixNano: msToUnixNano(traceStartMs),
            endTimeUnixNano: msToUnixNano(traceEndMs),
            attributes: finalRootAttrs,
            status: hasError ? { code: 2, message: "pipeline_degraded_or_error" } : { code: 1 },
          };

          const payload = {
            resourceSpans: [
              {
                resource: {
                  attributes: [
                    strAttr("service.name", "b2b-lead-triage-agent"),
                  ],
                },
                scopeSpans: [
                  {
                    scope: {
                      name: "b2b-lead-triage-agent.observability",
                      version: "1.0.0",
                    },
                    spans: [rootSpan, ...childSpans],
                  },
                ],
              },
            ],
          };

          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeoutMs);
          try {
            const response = await fetchFn(endpoint, {
              method: "POST",
              headers: {
                Authorization: authHeader,
                "Content-Type": "application/json",
              },
              body: JSON.stringify(payload),
              signal: controller.signal,
            });
            if (!response.ok) {
              // Observability must never crash lead triage; surface status only to stderr.
              console.error(
                `Langfuse OTLP flush failed with HTTP ${response.status}`,
              );
            }
          } catch (error: unknown) {
            console.error(
              "Langfuse OTLP flush error:",
              error instanceof Error ? error.message : String(error),
            );
          } finally {
            clearTimeout(timer);
          }
        },
      };
    },
  };
}

export interface HubSpotSpanEvent {
  readonly leadId: string;
  readonly trigger: "auto_routed" | "human_approved";
  readonly status: "synced" | "failed" | "skipped";
  readonly latencyMs: number;
  readonly contactId?: string | null;
  readonly noteId?: string | null;
  readonly reason?: string;
  readonly httpStatus?: number;
  readonly parentTraceId?: string | null;
}

/**
 * Emits a lightweight OTLP span for HubSpot CRM sync (attached to the existing
 * lead triage trace when `parentTraceId` is a valid 32-hex OTel trace ID, or as
 * a standalone trace for HITL approvals). Never logs secrets or access tokens.
 */
export async function emitHubSpotSyncSpan(
  config: LangfuseConfig | null,
  event: HubSpotSpanEvent,
  options: LangfuseTelemetryOptions = {},
): Promise<void> {
  if (config === null) {
    return;
  }

  const fetchFn = options.fetchFn ?? fetch;
  const timeoutMs = options.timeoutMs ?? OTLP_FLUSH_TIMEOUT_MS;
  const now = options.now ?? Date.now;

  const endMs = now();
  const startMs = Math.max(0, endMs - event.latencyMs);
  const traceId =
    event.parentTraceId && /^[0-9a-f]{32}$/i.test(event.parentTraceId)
      ? event.parentTraceId
      : generateHexId(16);
  const spanId = generateHexId(8);

  const outputPayload: Record<string, unknown> = {
    status: event.status,
    latency_ms: event.latencyMs,
    contact_id: event.contactId ?? null,
    note_id: event.noteId ?? null,
    ...(event.reason ? { reason: event.reason } : {}),
    ...(event.httpStatus !== undefined ? { http_status: event.httpStatus } : {}),
  };

  const attributes: OtlpKeyValue[] = [
    strAttr("langfuse.trace.name", "hubspot_crm_sync"),
    strArrayAttr("langfuse.trace.tags", [
      `trigger:${event.trigger}`,
      `hubspot:${event.status}`,
    ]),
    strAttr("langfuse.observation.type", "span"),
    strAttr(
      "langfuse.observation.input",
      JSON.stringify({ lead_id: event.leadId, trigger: event.trigger }),
    ),
    strAttr("langfuse.observation.output", JSON.stringify(outputPayload)),
    intAttr("langfuse.observation.metadata.latency_ms", event.latencyMs),
    strAttr("langfuse.observation.metadata.status", event.status),
  ];

  if (event.contactId) {
    attributes.push(
      strAttr("langfuse.observation.metadata.contact_id", event.contactId),
    );
  }

  const payload = {
    resourceSpans: [
      {
        resource: {
          attributes: [strAttr("service.name", "b2b-lead-triage-agent")],
        },
        scopeSpans: [
          {
            scope: {
              name: "b2b-lead-triage-agent.observability",
              version: "1.0.0",
            },
            spans: [
              {
                traceId,
                spanId,
                name: "hubspot_crm_sync",
                kind: 3, // CLIENT
                startTimeUnixNano: msToUnixNano(startMs),
                endTimeUnixNano: msToUnixNano(endMs),
                attributes,
                status:
                  event.status === "failed"
                    ? { code: 2, message: event.reason ?? "hubspot_sync_failed" }
                    : { code: 1 },
              },
            ],
          },
        ],
      },
    ],
  };

  const endpoint = `${config.baseUrl.replace(/\/$/, "")}/api/public/otel/v1/traces`;
  const authHeader = `Basic ${Buffer.from(
    `${config.publicKey}:${config.secretKey}`,
    "utf8",
  ).toString("base64")}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(endpoint, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) {
      console.error(
        `Langfuse HubSpot span flush failed with HTTP ${response.status}`,
      );
    }
  } catch (error: unknown) {
    console.error(
      "Langfuse HubSpot span flush error:",
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    clearTimeout(timer);
  }
}
