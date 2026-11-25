import { Langfuse } from "langfuse";
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

/**
 * Langfuse observability adapter.
 * Uses flushAt: 1 and exposes flush() -> langfuse.flushAsync() so Vercel serverless
 * functions (via next/server after()) never lose traces when the lambda freezes.
 * Falls back safely to a no-op tracer when Langfuse credentials are not configured.
 */
export function createLangfuseTelemetry(
  config: LangfuseConfig | null,
): PipelineTelemetry {
  if (config === null) {
    return createNoopTelemetry();
  }

  const client = new Langfuse({
    publicKey: config.publicKey,
    secretKey: config.secretKey,
    baseUrl: config.baseUrl,
    flushAt: 1,
  });

  return {
    startTrace(params): PipelineTraceHandle {
      const trace = client.trace({
        name: params.name,
        input: params.input,
        tags: params.tags ? [...params.tags] : undefined,
      });

      return {
        id: trace.id,

        recordEnrichment(outcome: EnrichmentOutcome, companyUrl: string): void {
          trace.span({
            name: "jina_enrichment",
            input: { company_url: companyUrl },
            output: outcome.ok
              ? {
                  ok: true,
                  summary_chars: outcome.summary.length,
                }
              : {
                  ok: false,
                  reason: outcome.reason,
                  http_status: outcome.httpStatus,
                },
            metadata: {
              duration_ms: outcome.durationMs,
            },
          });
        },

        recordGeneration(
          input: LlmTriageInput,
          output: LlmTriageOutput,
        ): void {
          trace.generation({
            name: "gemini_lead_triage",
            model: output.model,
            input: {
              source: input.lead.source,
              company_url: input.lead.company_url,
              email_domain: input.emailDomain,
              enrichment_ok: input.enrichment.ok,
              prompt_injection_detected: input.promptInjection.detected,
            },
            output: output.result,
            usage: output.usage
              ? {
                  input: output.usage.promptTokens,
                  output: output.usage.completionTokens,
                  total: output.usage.totalTokens,
                }
              : undefined,
            metadata: {
              latency_ms: output.latencyMs,
              attempts: output.attempts,
              model_used: output.model,
              used_fallback: (output.fallbackAttempts?.length ?? 0) > 0,
              fallback_attempts: output.fallbackAttempts ?? [],
            },
          });
        },

        recordRouting(
          decision: RoutingDecision,
          promptInjection: CombinedPromptInjectionScanResult,
        ): void {
          trace.event({
            name: "deterministic_routing",
            output: {
              status: decision.status,
              reason: decision.reason,
              suggested_route: decision.suggestedRoute,
              prompt_injection_detected: promptInjection.detected,
              prompt_injection_source: promptInjection.source,
            },
          });
        },

        recordError(stage: string, error: unknown): void {
          trace.event({
            name: `error_${stage}`,
            level: "ERROR",
            output: {
              stage,
              message: error instanceof Error ? error.message : String(error),
            },
          });
        },

        finish(output: Record<string, unknown>): void {
          trace.update({ output });
        },

        async flush(): Promise<void> {
          await client.flushAsync();
        },
      };
    },
  };
}
