import type { EnrichmentOutcome } from "@/lib/enrichment";
import { computeIdempotencyKey } from "@/lib/idempotency";
import { decideLeadRoute, type RoutingDecision, type RoutingReason } from "@/lib/router";
import type { InboundLead, LeadRecord, TriageResult } from "@/lib/schemas";
import {
  classifyEmailDomain,
  scanLeadAndEnrichmentForPromptInjection,
  type CombinedPromptInjectionScanResult,
  type EmailDomainClass,
} from "@/lib/security";

export interface LlmTokenUsage {
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly totalTokens?: number;
}

export interface LlmTriageInput {
  readonly lead: InboundLead;
  readonly enrichment: EnrichmentOutcome;
  readonly promptInjection: CombinedPromptInjectionScanResult;
  readonly emailDomain: EmailDomainClass;
}

export interface LlmTriageOutput {
  readonly result: TriageResult;
  readonly model: string;
  readonly latencyMs: number;
  readonly attempts: number;
  readonly usage?: LlmTokenUsage;
}

export type LlmTriageFn = (input: LlmTriageInput) => Promise<LlmTriageOutput>;

export interface CreateLeadInput {
  readonly idempotency_key: string;
  readonly lead: InboundLead;
  readonly enrichment: EnrichmentOutcome;
  readonly prompt_injection: CombinedPromptInjectionScanResult;
  readonly email_domain: EmailDomainClass;
  readonly triage: TriageResult | null;
  readonly routing: RoutingDecision;
  readonly langfuse_trace_id: string | null;
}

export interface LeadRepository {
  findByIdempotencyKey(idempotencyKey: string): Promise<LeadRecord | null>;
  createLeadWithAudit(input: CreateLeadInput): Promise<LeadRecord>;
}

export interface PipelineTraceHandle {
  readonly id: string | null;
  recordEnrichment(outcome: EnrichmentOutcome, companyUrl: string): void;
  recordGeneration(input: LlmTriageInput, output: LlmTriageOutput): void;
  recordRouting(
    decision: RoutingDecision,
    promptInjection: CombinedPromptInjectionScanResult,
  ): void;
  recordError(stage: string, error: unknown): void;
  finish(output: Record<string, unknown>): void;
  flush(): Promise<void>;
}

export interface PipelineTelemetry {
  startTrace(params: {
    readonly name: string;
    readonly input: Record<string, unknown>;
    readonly tags?: readonly string[];
  }): PipelineTraceHandle;
}

export interface TriagePipelineDeps {
  readonly enrich: (companyUrl: string) => Promise<EnrichmentOutcome>;
  readonly triageWithLlm: LlmTriageFn;
  readonly repo: LeadRepository;
  readonly telemetry: PipelineTelemetry;
  readonly now?: () => number;
}

export type TriagePipelineResponse =
  | {
      readonly deduplicated: true;
      readonly degraded: false;
      readonly lead: LeadRecord;
      readonly routing_reason: "deduplicated_existing_lead";
    }
  | {
      readonly deduplicated: false;
      readonly degraded: boolean;
      readonly lead: LeadRecord;
      readonly enrichment: EnrichmentOutcome;
      readonly routing_reason: RoutingReason;
      readonly prompt_injection: CombinedPromptInjectionScanResult;
      readonly email_domain: EmailDomainClass;
    };

export interface TriagePipelineExecution {
  readonly response: TriagePipelineResponse;
  readonly flushTelemetry: () => Promise<void>;
}

export function createNoopTelemetry(): PipelineTelemetry {
  return {
    startTrace(): PipelineTraceHandle {
      return {
        id: null,
        recordEnrichment() {},
        recordGeneration() {},
        recordRouting() {},
        recordError() {},
        finish() {},
        async flush() {},
      };
    },
  };
}

/**
 * Executes the complete B2B inbound lead triage pipeline using injected dependencies.
 * Fail-safe: if enrichment or the LLM fails, the lead is still persisted to `needs_human_review`
 * rather than being dropped with a 502.
 */
export async function runTriagePipeline(
  lead: InboundLead,
  deps: TriagePipelineDeps,
): Promise<TriagePipelineExecution> {
  const now = deps.now ?? Date.now;
  const idempotencyKey = computeIdempotencyKey(lead.email, lead.message, {
    nowMs: now(),
    nonce: lead.idempotency_nonce,
  });

  const trace = deps.telemetry.startTrace({
    name: "lead_triage_pipeline",
    input: {
      source: lead.source,
      company_url: lead.company_url,
      idempotency_key: idempotencyKey,
    },
    tags: [`source:${lead.source}`],
  });

  const flushTelemetry = () => trace.flush();

  try {
    const existingLead = await deps.repo.findByIdempotencyKey(idempotencyKey);
    if (existingLead !== null) {
      trace.finish({
        deduplicated: true,
        lead_id: existingLead.id,
        status: existingLead.status,
      });

      return {
        response: {
          deduplicated: true,
          degraded: false,
          lead: existingLead,
          routing_reason: "deduplicated_existing_lead",
        },
        flushTelemetry,
      };
    }

    const emailDomain = classifyEmailDomain(lead.email);

    const enrichment = await deps.enrich(lead.company_url);
    trace.recordEnrichment(enrichment, lead.company_url);

    // Scan BOTH direct lead input and indirect scraped website text for prompt-injection tripwires.
    const promptInjection = scanLeadAndEnrichmentForPromptInjection({
      leadText: `${lead.name}\n${lead.message}`,
      enrichedText: enrichment.ok ? enrichment.summary : "",
    });

    const llmInput: LlmTriageInput = {
      lead,
      enrichment,
      promptInjection,
      emailDomain,
    };

    let triage: TriageResult | null = null;
    try {
      const llmOutput = await deps.triageWithLlm(llmInput);
      trace.recordGeneration(llmInput, llmOutput);
      triage = llmOutput.result;
    } catch (llmError: unknown) {
      // Fail-safe persistence: record error and degrade to human review instead of losing the lead.
      trace.recordError("llm_triage", llmError);
      triage = null;
    }

    const routing = decideLeadRoute({
      triage,
      enrichment,
      promptInjection,
      emailDomain,
    });
    trace.recordRouting(routing, promptInjection);

    const savedLead = await deps.repo.createLeadWithAudit({
      idempotency_key: idempotencyKey,
      lead,
      enrichment,
      prompt_injection: promptInjection,
      email_domain: emailDomain,
      triage,
      routing,
      langfuse_trace_id: trace.id,
    });

    const degraded = triage === null;

    trace.finish({
      deduplicated: false,
      degraded,
      lead_id: savedLead.id,
      status: savedLead.status,
      routing_reason: routing.reason,
      enrichment_ok: enrichment.ok,
      prompt_injection_detected: promptInjection.detected,
      prompt_injection_source: promptInjection.source,
      email_domain: emailDomain,
    });

    return {
      response: {
        deduplicated: false,
        degraded,
        lead: savedLead,
        enrichment,
        routing_reason: routing.reason,
        prompt_injection: promptInjection,
        email_domain: emailDomain,
      },
      flushTelemetry,
    };
  } catch (error: unknown) {
    trace.recordError("pipeline", error);
    try {
      await trace.flush();
    } catch {
      // Never mask the original pipeline error if telemetry flush fails.
    }
    throw error;
  }
}
