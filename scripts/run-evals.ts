import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { parseGeminiModelChain } from "../src/lib/config";
import { enrichCompanyFromUrl, type EnrichmentOutcome } from "../src/lib/enrichment";
import { createGeminiTriageClient } from "../src/lib/llm";
import {
  createNoopTelemetry,
  runTriagePipeline,
  type CreateLeadInput,
  type LeadRepository,
} from "../src/lib/pipeline";
import { InboundLeadSchema, type LeadRecord } from "../src/lib/schemas";

interface EvalCase {
  readonly id: string;
  readonly group:
    | "clear_icp"
    | "spam"
    | "ambiguous"
    | "broken_or_personal"
    | "prompt_injection";
  readonly expected_status:
    | "auto_routed"
    | "auto_rejected"
    | "needs_human_review";
  readonly expected_route: string | null;
  readonly lead: {
    readonly name: string;
    readonly email: string;
    readonly company_url: string;
    readonly message: string;
  };
  readonly mock_enrichment:
    | { readonly ok: true; readonly summary: string }
    | {
        readonly ok: false;
        readonly reason: "timeout" | "http_error" | "network_error" | "empty_content";
      };
}

// Gemini 2.5 Flash standard paid reference pricing (USD per 1M tokens) for cost estimation
const INPUT_COST_PER_1M_USD = 0.15;
const OUTPUT_COST_PER_1M_USD = 0.6;

function loadLocalEnv(): void {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (existsSync(envPath) && typeof process.loadEnvFile === "function") {
    process.loadEnvFile(envPath);
  }
}

function createEphemeralRepo(): LeadRepository {
  const records: LeadRecord[] = [];
  return {
    async findByIdempotencyKey() {
      return null;
    },
    async createLeadWithAudit(input: CreateLeadInput): Promise<LeadRecord> {
      const nowIso = new Date().toISOString();
      const record: LeadRecord = {
        id: randomUUID(),
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
        created_at: nowIso,
        updated_at: nowIso,
      };
      records.push(record);
      return record;
    },
  };
}

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.ceil((p / 100) * sorted.length) - 1,
  );
  return sorted[index] ?? 0;
}

async function main(): Promise<void> {
  loadLocalEnv();

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    console.error("GEMINI_API_KEY is required in .env.local to run live evals.");
    process.exit(1);
  }

  const useLiveEnrichment = process.argv.includes("--live-enrichment");
  const models = parseGeminiModelChain(
    process.env.GEMINI_MODELS,
    process.env.GEMINI_MODEL,
  );

  const datasetPath = path.resolve(process.cwd(), "evals/leads_dataset.json");
  const dataset = JSON.parse(readFileSync(datasetPath, "utf8")) as EvalCase[];

  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  const baseLlm = createGeminiTriageClient({ apiKey, models });

  const latenciesMs: number[] = [];
  let statusMatches = 0;
  let falseAutoRoutes = 0;
  let nonAutoExpected = 0;
  let badUrlCases = 0;
  let badUrlGraceful = 0;
  let injectionCases = 0;
  let injectionCaught = 0;

  console.log(
    `Running ${dataset.length}-case evaluation suite (models=${models.join(" -> ")}, liveEnrichment=${useLiveEnrichment})...\n`,
  );

  for (const item of dataset) {
    const parsedLead = InboundLeadSchema.parse({
      ...item.lead,
      source: "webhook",
      idempotency_nonce: `eval-${item.id}-${Date.now()}`,
    });

    const enrichFn = async (url: string): Promise<EnrichmentOutcome> => {
      if (useLiveEnrichment && item.group !== "prompt_injection") {
        return enrichCompanyFromUrl(url);
      }
      if (item.mock_enrichment.ok) {
        return {
          ok: true,
          summary: item.mock_enrichment.summary,
          sourceUrl: url,
          durationMs: 120,
        };
      }
      return {
        ok: false,
        reason: item.mock_enrichment.reason,
        fallback: true,
        durationMs: 120,
      };
    };

    const startedAt = Date.now();
    const { response } = await runTriagePipeline(parsedLead, {
      enrich: enrichFn,
      triageWithLlm: async (input) => {
        const out = await baseLlm(input);
        totalPromptTokens += out.usage?.promptTokens ?? 0;
        totalCompletionTokens += out.usage?.completionTokens ?? 0;
        return out;
      },
      repo: createEphemeralRepo(),
      telemetry: createNoopTelemetry(),
    });
    const elapsedMs = Date.now() - startedAt;
    latenciesMs.push(elapsedMs);

    const actualStatus = response.lead.status;
    const statusCorrect = actualStatus === item.expected_status;
    if (statusCorrect) statusMatches += 1;

    if (item.expected_status !== "auto_routed") {
      nonAutoExpected += 1;
      if (actualStatus === "auto_routed") {
        falseAutoRoutes += 1;
      }
    }

    if (item.group === "broken_or_personal") {
      badUrlCases += 1;
      if (actualStatus === "needs_human_review") {
        badUrlGraceful += 1;
      }
    }

    if (item.group === "prompt_injection") {
      injectionCases += 1;
      if (
        actualStatus === "needs_human_review" &&
        response.lead.prompt_injection_detected
      ) {
        injectionCaught += 1;
      }
    }

    const mark = statusCorrect ? "PASS" : "FAIL";
    console.log(
      `[${mark}] ${item.id} (${item.group}) expected=${item.expected_status} actual=${actualStatus} reason=${response.routing_reason} (${elapsedMs}ms)`,
    );
  }

  const totalCostUsd =
    (totalPromptTokens / 1_000_000) * INPUT_COST_PER_1M_USD +
    (totalCompletionTokens / 1_000_000) * OUTPUT_COST_PER_1M_USD;
  const avgCostUsd = totalCostUsd / dataset.length;
  const p95Sec = percentile(latenciesMs, 95) / 1000;
  const accuracyPct = (statusMatches / dataset.length) * 100;
  const falseAutoPct =
    nonAutoExpected > 0 ? (falseAutoRoutes / nonAutoExpected) * 100 : 0;
  const gracefulPct =
    badUrlCases > 0 ? (badUrlGraceful / badUrlCases) * 100 : 100;
  const injectionPct =
    injectionCases > 0 ? (injectionCaught / injectionCases) * 100 : 100;

  console.log("\n### Evaluation Summary Table\n");
  console.log("| Metric | Result |");
  console.log("| :--- | :--- |");
  console.log(
    `| Routing Accuracy (${dataset.length} cases) | ${accuracyPct.toFixed(1)}% (${statusMatches}/${dataset.length}) |`,
  );
  console.log(
    `| False Auto-Route Rate | ${falseAutoPct.toFixed(1)}% (${falseAutoRoutes}/${nonAutoExpected}) |`,
  );
  console.log(
    `| Graceful Failure Rate (Bad URLs / Disposable) | ${gracefulPct.toFixed(1)}% (${badUrlGraceful}/${badUrlCases}) |`,
  );
  console.log(
    `| Prompt Injection Catch Rate | ${injectionPct.toFixed(1)}% (${injectionCaught}/${injectionCases}) |`,
  );
  console.log(`| Estimated Avg Cost / Lead | $${avgCostUsd.toFixed(5)} |`);
  console.log(`| p95 Latency | ${p95Sec.toFixed(2)}s |`);
}

main().catch((error: unknown) => {
  console.error("Eval runner failed:", error);
  process.exit(1);
});
