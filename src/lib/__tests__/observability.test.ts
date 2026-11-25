import { describe, expect, it, vi } from "vitest";
import { createLangfuseTelemetry } from "@/lib/observability";

describe("createLangfuseTelemetry (OTLP/JSON)", () => {
  it("falls back safely to a no-op tracer when config is null", async () => {
    const telemetry = createLangfuseTelemetry(null);
    const trace = telemetry.startTrace({
      name: "lead_triage_pipeline",
      input: { source: "web_demo" },
    });
    expect(trace.id).toBeNull();
    await expect(trace.flush()).resolves.toBeUndefined();
  });

  it("posts a valid OTLP/JSON trace with Basic Auth, enrichment span, Gemini generation, and routing event", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));

    let clock = 1_700_000_000_000;
    const telemetry = createLangfuseTelemetry(
      {
        publicKey: "pk-lf-test",
        secretKey: "sk-lf-test",
        baseUrl: "https://cloud.langfuse.com/",
      },
      { fetchFn, now: () => (clock += 250) },
    );

    const trace = telemetry.startTrace({
      name: "lead_triage_pipeline",
      input: { source: "webhook" },
      tags: ["source:webhook"],
    });

    expect(trace.id).toMatch(/^[a-f0-9]{32}$/);

    trace.recordEnrichment(
      {
        ok: true,
        summary: "AcmeCloud B2B platform",
        sourceUrl: "https://acmecloud.io",
        durationMs: 200,
      },
      "https://acmecloud.io",
    );

    trace.recordGeneration(
      {
        lead: {
          name: "Elena",
          email: "elena@acmecloud.io",
          company_url: "https://acmecloud.io",
          message: "Need enterprise automation",
          source: "webhook",
        },
        enrichment: {
          ok: true,
          summary: "AcmeCloud B2B platform",
          sourceUrl: "https://acmecloud.io",
          durationMs: 200,
        },
        promptInjection: { detected: false, source: "none", matchedPatterns: [] },
        emailDomain: "corporate",
      },
      {
        result: {
          intent: "Enterprise demo",
          urgency: "high",
          company_size_estimate: "200-500",
          icp_score: 92,
          suggested_route: "sales_enterprise",
          confidence_score: 0.91,
          reasoning: "Strong ICP fit.",
          draft_reply: "Hi Elena, let's schedule a call.",
        },
        model: "gemini-3.6-flash",
        latencyMs: 300,
        attempts: 2,
        fallbackAttempts: [{ model: "gemini-3.8-flash", reason: "503" }],
        usage: { promptTokens: 400, completionTokens: 120, totalTokens: 520 },
      },
    );

    trace.recordRouting(
      {
        status: "auto_routed",
        reason: "high_confidence_verified",
        suggestedRoute: "sales_enterprise",
      },
      { detected: false, source: "none", matchedPatterns: [] },
    );

    trace.finish({ status: "auto_routed" });
    await trace.flush();
    // Second flush is idempotent no-op
    await trace.flush();

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe("https://cloud.langfuse.com/api/public/otel/v1/traces");
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(
      `Basic ${Buffer.from("pk-lf-test:sk-lf-test").toString("base64")}`,
    );

    const parsedBody = JSON.parse(String(init?.body)) as {
      resourceSpans: Array<{
        scopeSpans: Array<{
          spans: Array<{
            name: string;
            traceId: string;
            attributes: Array<{ key: string; value: Record<string, unknown> }>;
          }>;
        }>;
      }>;
    };
    const spans = parsedBody.resourceSpans[0]?.scopeSpans[0]?.spans ?? [];
    expect(spans.map((s) => s.name)).toEqual([
      "lead_triage_pipeline",
      "jina_enrichment",
      "gemini_lead_triage",
      "deterministic_routing",
    ]);

    const genSpan = spans.find((s) => s.name === "gemini_lead_triage");
    const genAttrs = new Map(
      (genSpan?.attributes ?? []).map((a) => [a.key, a.value]),
    );
    expect(genAttrs.get("gen_ai.request.model")).toEqual({
      stringValue: "gemini-3.6-flash",
    });
    expect(genAttrs.get("gen_ai.usage.input_tokens")).toEqual({
      intValue: "400",
    });
    expect(genAttrs.get("gen_ai.usage.output_tokens")).toEqual({
      intValue: "120",
    });
    expect(genAttrs.get("langfuse.observation.metadata.used_fallback")).toEqual({
      boolValue: true,
    });
  });

  it("swallows OTLP HTTP/network errors safely so observability never breaks triage", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("Service Unavailable", { status: 503 }));

    const telemetry = createLangfuseTelemetry(
      {
        publicKey: "pk-lf-test",
        secretKey: "sk-lf-test",
        baseUrl: "https://cloud.langfuse.com",
      },
      { fetchFn },
    );

    const trace = telemetry.startTrace({ name: "lead_triage_pipeline", input: {} });
    await expect(trace.flush()).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
