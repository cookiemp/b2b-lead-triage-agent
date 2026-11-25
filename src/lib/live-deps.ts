import { loadLiveTriageConfig, loadSupabaseConfig } from "@/lib/config";
import { createSupabaseLeadStore, type LeadStore } from "@/lib/db";
import { enrichCompanyFromUrl } from "@/lib/enrichment";
import { createGeminiTriageClient } from "@/lib/llm";
import { createLangfuseTelemetry } from "@/lib/observability";
import type { TriagePipelineDeps } from "@/lib/pipeline";

let cachedLeadStore: { readonly key: string; readonly store: LeadStore } | null =
  null;
let cachedTriageDeps: {
  readonly key: string;
  readonly deps: TriagePipelineDeps;
  readonly store: LeadStore;
  readonly demoDailyCap: number;
} | null = null;

export function resolveLiveLeadStore(): LeadStore | null {
  const config = loadSupabaseConfig();
  if (config === null) {
    return null;
  }

  const cacheKey = `${config.url}|${config.serviceRoleKey}`;
  if (cachedLeadStore?.key === cacheKey) {
    return cachedLeadStore.store;
  }

  const store = createSupabaseLeadStore(config);
  cachedLeadStore = { key: cacheKey, store };
  return store;
}

export function resolveLiveTriageRuntime(): {
  readonly deps: TriagePipelineDeps;
  readonly store: LeadStore;
  readonly demoDailyCap: number;
} | null {
  const config = loadLiveTriageConfig();
  if (config === null) {
    return null;
  }

  const cacheKey = [
    config.geminiApiKey,
    config.geminiModel,
    config.supabase.url,
    config.supabase.serviceRoleKey,
    config.langfuse?.publicKey ?? "",
    config.langfuse?.baseUrl ?? "",
    String(config.supabase.demoDailyCap),
  ].join("|");

  if (cachedTriageDeps?.key === cacheKey) {
    return {
      deps: cachedTriageDeps.deps,
      store: cachedTriageDeps.store,
      demoDailyCap: cachedTriageDeps.demoDailyCap,
    };
  }

  const store = createSupabaseLeadStore(config.supabase);
  const triageWithLlm = createGeminiTriageClient({
    apiKey: config.geminiApiKey,
    model: config.geminiModel,
  });
  const telemetry = createLangfuseTelemetry(config.langfuse);

  const deps: TriagePipelineDeps = {
    enrich: (companyUrl) => enrichCompanyFromUrl(companyUrl),
    triageWithLlm,
    repo: store,
    telemetry,
  };

  cachedTriageDeps = {
    key: cacheKey,
    deps,
    store,
    demoDailyCap: config.supabase.demoDailyCap,
  };

  return {
    deps,
    store,
    demoDailyCap: config.supabase.demoDailyCap,
  };
}
