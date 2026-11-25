import { z } from "zod";

export const DEFAULT_GEMINI_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-2.5-flash",
] as const;

export const DEFAULT_GEMINI_MODEL = DEFAULT_GEMINI_MODELS[0];
export const DEFAULT_LANGFUSE_BASE_URL = "https://cloud.langfuse.com";
export const DEFAULT_DEMO_DAILY_CAP = 100;

const OptionalNonEmptyString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().min(1).optional(),
);

const PositiveIntWithDefault = (fallback: number) =>
  z.preprocess(
    (value) => {
      if (value === undefined || value === null || value === "") {
        return fallback;
      }
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : value;
    },
    z.number().int().positive(),
  );

const SupabaseEnvSchema = z.object({
  SUPABASE_URL: z.string().trim().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().trim().min(1),
  DEMO_DAILY_CAP: PositiveIntWithDefault(DEFAULT_DEMO_DAILY_CAP),
});

const LangfuseEnvSchema = z.object({
  LANGFUSE_PUBLIC_KEY: z.string().trim().min(1),
  LANGFUSE_SECRET_KEY: z.string().trim().min(1),
  LANGFUSE_BASE_URL: z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === ""
        ? DEFAULT_LANGFUSE_BASE_URL
        : value ?? DEFAULT_LANGFUSE_BASE_URL,
    z.string().trim().url(),
  ),
});

const LiveTriageEnvSchema = SupabaseEnvSchema.extend({
  GEMINI_API_KEY: z.string().trim().min(1),
  GEMINI_MODELS: OptionalNonEmptyString,
  GEMINI_MODEL: OptionalNonEmptyString,
});

export interface SupabaseConfig {
  readonly url: string;
  readonly serviceRoleKey: string;
  readonly demoDailyCap: number;
}

export interface LangfuseConfig {
  readonly publicKey: string;
  readonly secretKey: string;
  readonly baseUrl: string;
}

export interface LiveTriageConfig {
  readonly geminiApiKey: string;
  readonly geminiModels: readonly [string, ...string[]];
  readonly supabase: SupabaseConfig;
  readonly langfuse: LangfuseConfig | null;
}

/**
 * Parses a comma-separated GEMINI_MODELS list (falling back to single GEMINI_MODEL
 * or DEFAULT_GEMINI_MODELS), trimming whitespace and deduplicating while preserving order.
 */
export function parseGeminiModelChain(
  rawModels: string | undefined,
  legacySingleModel?: string,
): readonly [string, ...string[]] {
  const source = rawModels ?? legacySingleModel;
  if (source) {
    const parsed = Array.from(
      new Set(
        source
          .split(",")
          .map((item) => item.trim())
          .filter((item) => item.length > 0),
      ),
    );
    const [first, ...rest] = parsed;
    if (first !== undefined) {
      return [first, ...rest];
    }
  }
  return [...DEFAULT_GEMINI_MODELS];
}

export function loadSupabaseConfig(
  env: NodeJS.ProcessEnv = process.env,
): SupabaseConfig | null {
  const parsed = SupabaseEnvSchema.safeParse(env);
  if (!parsed.success) {
    return null;
  }
  return {
    url: parsed.data.SUPABASE_URL,
    serviceRoleKey: parsed.data.SUPABASE_SERVICE_ROLE_KEY,
    demoDailyCap: parsed.data.DEMO_DAILY_CAP,
  };
}

export function loadLangfuseConfig(
  env: NodeJS.ProcessEnv = process.env,
): LangfuseConfig | null {
  const parsed = LangfuseEnvSchema.safeParse(env);
  if (!parsed.success) {
    return null;
  }
  return {
    publicKey: parsed.data.LANGFUSE_PUBLIC_KEY,
    secretKey: parsed.data.LANGFUSE_SECRET_KEY,
    baseUrl: parsed.data.LANGFUSE_BASE_URL,
  };
}

export function loadLiveTriageConfig(
  env: NodeJS.ProcessEnv = process.env,
): LiveTriageConfig | null {
  const parsed = LiveTriageEnvSchema.safeParse(env);
  if (!parsed.success) {
    return null;
  }

  return {
    geminiApiKey: parsed.data.GEMINI_API_KEY,
    geminiModels: parseGeminiModelChain(
      parsed.data.GEMINI_MODELS,
      parsed.data.GEMINI_MODEL,
    ),
    supabase: {
      url: parsed.data.SUPABASE_URL,
      serviceRoleKey: parsed.data.SUPABASE_SERVICE_ROLE_KEY,
      demoDailyCap: parsed.data.DEMO_DAILY_CAP,
    },
    langfuse: loadLangfuseConfig(env),
  };
}
