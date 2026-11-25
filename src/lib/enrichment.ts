export type EnrichmentFailureReason =
  | "timeout"
  | "http_error"
  | "network_error"
  | "empty_content";

export type EnrichmentOutcome =
  | {
      readonly ok: true;
      readonly summary: string;
      readonly sourceUrl: string;
      readonly durationMs: number;
    }
  | {
      readonly ok: false;
      readonly reason: EnrichmentFailureReason;
      readonly fallback: true;
      readonly durationMs: number;
      readonly httpStatus?: number;
    };

export interface EnrichmentOptions {
  readonly fetchFn?: typeof fetch;
  readonly timeoutMs?: number;
  readonly maxChars?: number;
  readonly jinaBaseUrl?: string;
  readonly now?: () => number;
}

const DEFAULT_TIMEOUT_MS = 5500;
const DEFAULT_MAX_CHARS = 4000;
const DEFAULT_JINA_BASE_URL = "https://r.jina.ai/";

function normalizeExtractedText(raw: string, maxChars: number): string {
  const cleaned = raw
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (cleaned.length <= maxChars) {
    return cleaned;
  }

  return `${cleaned.slice(0, maxChars).trimEnd()}... [truncated]`;
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.name === "AbortError" || error.name === "TimeoutError";
}

/**
 * Fetches readable company context via Jina Reader with a strict timeout and length cap.
 * Never throws; any timeout, HTTP error, or network error degrades cleanly to a fallback outcome.
 */
export async function enrichCompanyFromUrl(
  companyUrl: string,
  options: EnrichmentOptions = {},
): Promise<EnrichmentOutcome> {
  const {
    fetchFn = fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxChars = DEFAULT_MAX_CHARS,
    jinaBaseUrl = DEFAULT_JINA_BASE_URL,
    now = Date.now,
  } = options;

  const startedAt = now();
  const base = jinaBaseUrl.endsWith("/") ? jinaBaseUrl : `${jinaBaseUrl}/`;
  const targetUrl = `${base}${companyUrl}`;

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetchFn(targetUrl, {
      method: "GET",
      headers: {
        Accept: "text/plain",
        "X-Return-Format": "markdown",
      },
      signal: controller.signal,
    });

    const durationMs = Math.max(0, now() - startedAt);

    if (!response.ok) {
      return {
        ok: false,
        reason: "http_error",
        fallback: true,
        durationMs,
        httpStatus: response.status,
      };
    }

    const rawText = await response.text();
    const summary = normalizeExtractedText(rawText, maxChars);

    if (summary.length === 0) {
      return {
        ok: false,
        reason: "empty_content",
        fallback: true,
        durationMs,
      };
    }

    return {
      ok: true,
      summary,
      sourceUrl: companyUrl,
      durationMs,
    };
  } catch (error: unknown) {
    const durationMs = Math.max(0, now() - startedAt);
    return {
      ok: false,
      reason: isAbortError(error) ? "timeout" : "network_error",
      fallback: true,
      durationMs,
    };
  } finally {
    clearTimeout(timer);
  }
}
