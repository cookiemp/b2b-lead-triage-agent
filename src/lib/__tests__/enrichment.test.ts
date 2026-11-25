import { describe, expect, it, vi } from "vitest";
import { enrichCompanyFromUrl } from "@/lib/enrichment";

describe("enrichCompanyFromUrl", () => {
  it("fetches via Jina Reader and truncates long responses safely", async () => {
    const longBody = `Acme Cloud Platform\n\n\n\n${"Enterprise B2B SaaS. ".repeat(50)}`;
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(longBody, { status: 200 }),
    );

    const outcome = await enrichCompanyFromUrl("https://acmecloud.io", {
      fetchFn: mockFetch,
      maxChars: 120,
      timeoutMs: 2000,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0]?.[0]).toBe(
      "https://r.jina.ai/https://acmecloud.io",
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.summary.endsWith("... [truncated]")).toBe(true);
    expect(outcome.summary.length).toBeLessThanOrEqual(120 + "... [truncated]".length);
  });

  it("degrades gracefully on timeout without throwing", async () => {
    const mockFetch = vi.fn<typeof fetch>().mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const abortErr = new Error("Aborted");
            abortErr.name = "AbortError";
            reject(abortErr);
          });
        }),
    );

    const outcome = await enrichCompanyFromUrl("https://slow-company.example", {
      fetchFn: mockFetch,
      timeoutMs: 25,
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe("timeout");
    expect(outcome.fallback).toBe(true);
  });

  it("degrades gracefully on HTTP 500 without throwing", async () => {
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("Upstream error", { status: 500 }),
    );

    const outcome = await enrichCompanyFromUrl("https://broken.example", {
      fetchFn: mockFetch,
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe("http_error");
    expect(outcome.httpStatus).toBe(500);
    expect(outcome.fallback).toBe(true);
  });

  it("degrades gracefully on network failure or empty body without throwing", async () => {
    const networkFetch = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("ECONNRESET"));

    const netOutcome = await enrichCompanyFromUrl("https://offline.example", {
      fetchFn: networkFetch,
    });
    expect(netOutcome.ok).toBe(false);
    if (!netOutcome.ok) {
      expect(netOutcome.reason).toBe("network_error");
      expect(netOutcome.fallback).toBe(true);
    }

    const emptyFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("   \n\t  ", { status: 200 }));

    const emptyOutcome = await enrichCompanyFromUrl("https://blank.example", {
      fetchFn: emptyFetch,
    });
    expect(emptyOutcome.ok).toBe(false);
    if (!emptyOutcome.ok) {
      expect(emptyOutcome.reason).toBe("empty_content");
      expect(emptyOutcome.fallback).toBe(true);
    }
  });
});
