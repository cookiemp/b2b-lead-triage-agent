import { createHash, timingSafeEqual } from "node:crypto";
import type { LeadSource } from "@/lib/schemas";

export type RateLimitResult =
  | {
      readonly allowed: true;
      readonly remaining: number;
      readonly resetAtMs: number;
    }
  | {
      readonly allowed: false;
      readonly remaining: 0;
      readonly retryAfterSec: number;
      readonly resetAtMs: number;
    };

export interface RateLimiter {
  check(key: string): RateLimitResult;
  reset(): void;
}

export type SecurityCheckResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly status: 401 | 429;
      readonly code: "INVALID_WEBHOOK_SECRET" | "RATE_LIMITED";
      readonly message: string;
      readonly retryAfterSec?: number;
    };

export type PromptInjectionScanResult =
  | { readonly detected: false; readonly matchedPatterns: readonly [] }
  | {
      readonly detected: true;
      readonly matchedPatterns: readonly [string, ...string[]];
    };

export type CombinedPromptInjectionScanResult =
  | {
      readonly detected: false;
      readonly source: "none";
      readonly matchedPatterns: readonly [];
    }
  | {
      readonly detected: true;
      readonly source: "lead_input" | "enriched_content" | "both";
      readonly matchedPatterns: readonly [string, ...string[]];
    };

export type EmailDomainClass = "corporate" | "personal" | "disposable";

const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "ymail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
]);

const DISPOSABLE_EMAIL_DOMAINS = new Set([
  "mailinator.com",
  "guerrillamail.com",
  "tempmail.com",
  "temp-mail.org",
  "10minutemail.com",
  "yopmail.com",
  "sharklasers.com",
  "trashmail.com",
  "throwawaymail.com",
  "getnada.com",
]);

/**
 * Early tripwire rules for obvious direct and indirect prompt-injection patterns.
 * This is NOT the sole defense: Phase 2 wraps untrusted content in structural prompt delimiters,
 * and src/lib/router.ts enforces deterministic routing policy outside the LLM.
 */
const PROMPT_INJECTION_RULES: ReadonlyArray<{
  readonly id: string;
  readonly pattern: RegExp;
}> = [
  {
    id: "ignore_or_forget_instructions",
    pattern:
      /\b(?:ignore|disregard|forget)\s+(?:(?:all|any)\s+)?(?:of\s+)?(?:(?:the|your|my)\s+)?(?:(?:previous|prior|above|earlier|system|safety)\s+)*(?:instructions|prompts|rules|directions)\b/i,
  },
  {
    id: "override_system_prompt",
    pattern:
      /\boverride\s+(?:(?:the|all|any)\s+)?(?:system|safety|routing|triage)\s+(?:prompt|instructions|rules|policy)\b/i,
  },
  {
    id: "forced_vip_or_auto_route",
    pattern:
      /\b(?:mark|classify|route|treat|set)\s+(?:me|this(?:\s+lead|\s+inquiry)?)\s+as\s+(?:urgent(?:\s+vip)?|high\s+priority|vip|auto[_ -]?routed|auto[_ -]?approved|sales_enterprise)\b/i,
  },
  {
    id: "forced_confidence_score",
    pattern:
      /\bset\s+(?:(?:my|the)\s+)?(?:confidence[_ ]?score|icp[_ ]?score)\s+(?:to|=)\s*\d/i,
  },
  {
    id: "role_jailbreak",
    pattern:
      /\b(?:you\s+are\s+now|enter|switch\s+to)\s+(?:in\s+)?(?:developer|admin|god|unrestricted|jailbreak)\s+mode\b/i,
  },
  {
    id: "prompt_exfiltration",
    pattern:
      /\b(?:reveal|print|output|leak|show|dump)\s+(?:your|the)\s+(?:system\s+prompt|hidden\s+instructions|api\s+key|secrets?)\b/i,
  },
  {
    id: "fake_system_delimiter",
    pattern: /(?:^|\s)(?:<system>|\[system\]|###\s*system\s+instructions)/i,
  },
];

function sha256Digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/**
 * Constant-time secret verification. Fails closed if either value is missing or empty.
 * Hashing both inputs to a fixed 32-byte digest avoids leaking length differences.
 */
export function verifyWebhookSecret(
  providedSecret: string | null | undefined,
  expectedSecret: string | undefined,
): boolean {
  if (!providedSecret || !expectedSecret) {
    return false;
  }
  const providedDigest = sha256Digest(providedSecret);
  const expectedDigest = sha256Digest(expectedSecret);
  return timingSafeEqual(providedDigest, expectedDigest);
}

/**
 * Best-effort in-memory fixed-window rate limiter keyed by IP/route.
 * Note: On serverless platforms like Vercel, state is scoped per warm instance.
 */
export function createInMemoryRateLimiter(options: {
  readonly maxRequests: number;
  readonly windowMs: number;
  readonly now?: () => number;
  readonly maxTrackedKeys?: number;
}): RateLimiter {
  const { maxRequests, windowMs, now = Date.now, maxTrackedKeys = 1000 } = options;
  const buckets = new Map<string, { count: number; resetAtMs: number }>();

  function pruneExpired(currentTimeMs: number): void {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAtMs <= currentTimeMs) {
        buckets.delete(key);
      }
    }
  }

  return {
    check(key: string): RateLimitResult {
      const currentTimeMs = now();
      if (buckets.size >= maxTrackedKeys) {
        pruneExpired(currentTimeMs);
      }

      const existing = buckets.get(key);
      if (!existing || existing.resetAtMs <= currentTimeMs) {
        const resetAtMs = currentTimeMs + windowMs;
        buckets.set(key, { count: 1, resetAtMs });
        return {
          allowed: true,
          remaining: Math.max(0, maxRequests - 1),
          resetAtMs,
        };
      }

      if (existing.count >= maxRequests) {
        const retryAfterSec = Math.max(
          1,
          Math.ceil((existing.resetAtMs - currentTimeMs) / 1000),
        );
        return {
          allowed: false,
          remaining: 0,
          retryAfterSec,
          resetAtMs: existing.resetAtMs,
        };
      }

      existing.count += 1;
      return {
        allowed: true,
        remaining: Math.max(0, maxRequests - existing.count),
        resetAtMs: existing.resetAtMs,
      };
    },

    reset(): void {
      buckets.clear();
    },
  };
}

export function extractClientIp(headers: Headers): string {
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) {
    const firstHop = forwardedFor.split(",")[0]?.trim();
    if (firstHop) {
      return firstHop;
    }
  }

  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) {
    return realIp;
  }

  return "unknown";
}

export function classifyEmailDomain(email: string): EmailDomainClass {
  const atIndex = email.lastIndexOf("@");
  if (atIndex === -1) {
    return "corporate";
  }
  const domain = email.slice(atIndex + 1).trim().toLowerCase();
  if (DISPOSABLE_EMAIL_DOMAINS.has(domain)) {
    return "disposable";
  }
  if (PERSONAL_EMAIL_DOMAINS.has(domain)) {
    return "personal";
  }
  return "corporate";
}

export function scanForPromptInjection(text: string): PromptInjectionScanResult {
  const matched: string[] = [];
  for (const rule of PROMPT_INJECTION_RULES) {
    if (rule.pattern.test(text)) {
      matched.push(rule.id);
    }
  }

  const [first, ...rest] = matched;
  if (first === undefined) {
    return { detected: false, matchedPatterns: [] };
  }

  return {
    detected: true,
    matchedPatterns: [first, ...rest],
  };
}

/**
 * Scans both direct lead input (name/message) and indirect scraped website text
 * for prompt-injection tripwires.
 */
export function scanLeadAndEnrichmentForPromptInjection(params: {
  readonly leadText: string;
  readonly enrichedText: string;
}): CombinedPromptInjectionScanResult {
  const leadScan = scanForPromptInjection(params.leadText);
  const enrichedScan =
    params.enrichedText.length > 0
      ? scanForPromptInjection(params.enrichedText)
      : ({ detected: false, matchedPatterns: [] } as const);

  if (!leadScan.detected && !enrichedScan.detected) {
    return {
      detected: false,
      source: "none",
      matchedPatterns: [],
    };
  }

  const uniquePatterns = Array.from(
    new Set([...leadScan.matchedPatterns, ...enrichedScan.matchedPatterns]),
  );
  const [first, ...rest] = uniquePatterns;
  if (first === undefined) {
    return {
      detected: false,
      source: "none",
      matchedPatterns: [],
    };
  }

  const source =
    leadScan.detected && enrichedScan.detected
      ? "both"
      : leadScan.detected
        ? "lead_input"
        : "enriched_content";

  return {
    detected: true,
    source,
    matchedPatterns: [first, ...rest],
  };
}

export function authorizeTriageRequest(params: {
  readonly source: LeadSource;
  readonly headers: Headers;
  readonly expectedWebhookSecret: string | undefined;
  readonly demoRateLimiter: RateLimiter;
}): SecurityCheckResult {
  const { source, headers, expectedWebhookSecret, demoRateLimiter } = params;

  if (source === "webhook" || source === "n8n") {
    const provided = headers.get("x-webhook-secret");
    if (!verifyWebhookSecret(provided, expectedWebhookSecret)) {
      return {
        ok: false,
        status: 401,
        code: "INVALID_WEBHOOK_SECRET",
        message: "Missing or invalid X-Webhook-Secret header.",
      };
    }
    return { ok: true };
  }

  const clientIp = extractClientIp(headers);
  const limit = demoRateLimiter.check(`triage:web_demo:${clientIp}`);
  if (!limit.allowed) {
    return {
      ok: false,
      status: 429,
      code: "RATE_LIMITED",
      message: "Too many demo requests. Please wait before retrying.",
      retryAfterSec: limit.retryAfterSec,
    };
  }

  return { ok: true };
}
