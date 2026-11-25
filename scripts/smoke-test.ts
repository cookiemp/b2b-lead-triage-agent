import { existsSync } from "node:fs";
import path from "node:path";
import { loadLiveTriageConfig } from "../src/lib/config";
import { createSupabaseLeadStore } from "../src/lib/db";
import { enrichCompanyFromUrl } from "../src/lib/enrichment";
import { createGeminiTriageClient } from "../src/lib/llm";
import { createLangfuseTelemetry } from "../src/lib/observability";
import { runTriagePipeline } from "../src/lib/pipeline";
import { InboundLeadSchema } from "../src/lib/schemas";

function loadLocalEnv(): void {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (existsSync(envPath) && typeof process.loadEnvFile === "function") {
    process.loadEnvFile(envPath);
  }
}

async function main(): Promise<void> {
  loadLocalEnv();

  const config = loadLiveTriageConfig(process.env);
  if (config === null) {
    console.error(
      "Missing required env vars in .env.local: GEMINI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY",
    );
    process.exit(1);
  }

  const store = createSupabaseLeadStore(config.supabase);
  const telemetry = createLangfuseTelemetry(config.langfuse);
  const baseLlm = createGeminiTriageClient({
    apiKey: config.geminiApiKey,
    models: config.geminiModels,
  });

  let modelUsed: string | null = null;
  let fallbackAttempts: readonly { model: string; reason: string }[] = [];

  const lead = InboundLeadSchema.parse({
    name: "Smoke Test Operator",
    email: "ops.smoke@stripe.com",
    company_url: "https://stripe.com",
    message:
      "We run a 200-person GTM team and want to automate B2B inbound lead enrichment and HubSpot routing.",
    source: "webhook",
    idempotency_nonce: `smoke-${Date.now()}`,
  });

  console.log(
    `Running live end-to-end smoke test (chain: ${config.geminiModels.join(" -> ")})...`,
  );
  const startedAt = Date.now();
  const { response, flushTelemetry } = await runTriagePipeline(lead, {
    enrich: (url) => enrichCompanyFromUrl(url),
    triageWithLlm: async (input) => {
      const out = await baseLlm(input);
      modelUsed = out.model;
      fallbackAttempts = out.fallbackAttempts ?? [];
      return out;
    },
    repo: store,
    telemetry,
  });
  await flushTelemetry();
  const elapsedMs = Date.now() - startedAt;

  console.log(
    JSON.stringify(
      {
        elapsed_ms: elapsedMs,
        model_used: modelUsed,
        fallback_attempts: fallbackAttempts,
        deduplicated: response.deduplicated,
        degraded: response.degraded,
        lead_id: response.lead.id,
        status: response.lead.status,
        routing_reason: response.routing_reason,
        enrichment_ok: response.lead.enrichment_ok,
        confidence_score: response.lead.confidence_score,
        icp_score: response.lead.icp_score,
        langfuse_trace_id: response.lead.langfuse_trace_id,
      },
      null,
      2,
    ),
  );

  if (response.degraded) {
    console.error("Smoke test completed in degraded mode (LLM unavailable).");
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error("Smoke test failed:", error);
  process.exit(1);
});
