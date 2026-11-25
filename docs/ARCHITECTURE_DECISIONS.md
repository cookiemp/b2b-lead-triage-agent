# Architecture Decision Records (ADRs)

Concise record of the key production, security, and tradeoff decisions in this repository.

---

## ADR-001: Code-First Next.js API (Stage A) + n8n Orchestration Bolt-On (Stage B)
- **Context:** Putting enrichment, validation, confidence gating, and DB writes directly inside visual n8n nodes makes automated regression testing, TypeScript type checking, and CI secret scanning fragile.
- **Decision:** Keep all deterministic domain logic inside `src/lib/*` (zero framework imports) behind `POST /api/triage`, tested offline via Vitest and GitHub Actions. Bolt on n8n in Stage B purely as the orchestration/alerting layer calling the live API with `X-Webhook-Secret`.
- **Consequence:** Clean separation of deterministic business logic vs. workflow orchestration; Stage A ships standalone and CI-tested without Render cold-start maintenance.

---

## ADR-002: Separate `auto_rejected` Status for High-Confidence Spam (Phase 1.1 Contract Amendment)
- **Context:** Originally, both high-confidence sales leads and high-confidence spam resolved to `auto_routed`. Downstream workflows (such as Phase 4's n8n branch on `status`) would mistakenly fire sales alerts for spam.
- **Decision:** Amend `LEAD_STATUSES` and `supabase/schema.sql` to add `auto_rejected`. High-confidence spam (`suggested_route === "spam"` and `confidence_score >= 0.80`) resolves to `auto_rejected` even if enrichment failed, keeping spam out of both the human review queue and sales alerts.
- **Consequence:** Downstream consumers can branch cleanly on `auto_routed` (sales alert), `needs_human_review` (human queue alert), and `auto_rejected` (silent archive).

---

## ADR-003: Fail-Safe Lead Persistence on LLM Failure (`llm_unavailable`)
- **Context:** Free-tier LLM APIs (Gemini Flash via Google AI Studio) periodically rate-limit or error out. Throwing a `502` without saving the lead silently drops an inbound sales inquiry.
- **Decision:** Catch LLM failures inside `runTriagePipeline`, record the error on telemetry, and persist the lead to Supabase with `triage_json: null`, `status: "needs_human_review"`, and `routing_reason: "llm_unavailable"`. Only database persistence failure returns `502`.
- **Consequence:** Zero dropped leads during upstream LLM outages; operators see the raw lead + enriched company summary in the Human Approval Queue.

---

## ADR-004: Time-Windowed Idempotency + Optional Demo Nonce
- **Context:** Hashing `email + message` permanently with a `UNIQUE` DB constraint blocks webhook retries effectively, but breaks a public live demo—the second visitor clicking a preset would receive a cached row without running Gemini or generating a Langfuse trace.
- **Decision:** Bucket idempotency keys into a 10-minute window (`Math.floor(nowMs / 600_000)`) and accept an optional `idempotency_nonce` on `InboundLeadSchema`. Webhook/n8n callers omit the nonce (getting 10-minute retry dedup + Postgres `UNIQUE` race protection); UI preset clicks generate a fresh nonce per click (live run every time) while double-clicking Submit reuses the same nonce (clean dedup).
- **Consequence:** Preserves DB-level race safety and retry idempotency without making the public portfolio demo go stale.

---

## ADR-005: Defense-in-Depth Against Prompt Injection (Both Input & Scraped Content)
- **Context:** A regex pre-filter alone is easy to paraphrase around, and indirect prompt injection can also arrive via scraped website copy from Jina Reader.
- **Decision:** Treat the regex scanner honestly as an early tripwire, scan **both** user input (`name + message`) and scraped website content (`enrichment.summary`), wrap all untrusted content in explicit structural delimiters in the Phase 2 Gemini prompt, and keep routing policy 100% deterministic in `src/lib/router.ts` so the LLM can never bypass `needs_human_review` once flagged.
- **Consequence:** Multi-layer protection against both direct form attacks and indirect website prompt injections.

---

## ADR-006: Honest Security & Dependency Boundaries
- **In-Memory Fixed-Window Rate Limiter:** `createInMemoryRateLimiter` protects individual warm Vercel instances and is unit-tested offline, but is explicitly documented as best-effort per instance (not globally distributed). Phase 2 adds an optional Supabase-backed daily demo quota cap to protect free-tier Gemini limits.
- **URL Hygiene (`isSafePublicHttpUrl`):** Because Jina Reader (`r.jina.ai`) performs the outbound HTTP fetch rather than our Next.js server, URL validation primarily provides input hygiene and prevents forwarding internal/private addresses to Jina rather than acting as a DNS-resolving server-side SSRF firewall.
- **Dependencies:** Upgraded Zod to `^4.6.7` to clear the Zod memory-exhaustion advisory. Remaining on Next.js 15 (`15.5.x`) for stability; the nested `postcss` advisory applies only to build-time CSS compilation of our own static stylesheets, not untrusted runtime input.

---

## ADR-007: Configurable Gemini Flash Model Fallback Chain
- **Context:** Free-tier and high-demand flagship models periodically return `503 UNAVAILABLE` or `429` spikes. Pinning a single model turns transient provider load spikes into degraded runs.
- **Decision:** Configure an ordered fallback chain (`GEMINI_MODELS`, defaulting to `gemini-3.8-flash -> gemini-3.6-flash -> gemini-3.5-flash-lite`) with an `8s` per-attempt timeout (staying inside Vercel's `maxDuration = 30`). Transient/availability failures immediately advance to the next model; JSON/Zod validation failures get 1 bounded repair retry on the responding model before falling back. Exact `model_used` and `fallback_attempts` are logged to Langfuse.
- **Proven Live:** On the very first live smoke test (`10ab10e7-9518-4b17-a265-7120b1615952`), `gemini-3.8-flash` returned HTTP `503 UNAVAILABLE` and the chain automatically recovered via `gemini-3.6-flash` without dropping the lead.

---

## ADR-008: Dependency-Free Langfuse OTLP/JSON Exporter (Post-Nov 16, 2026 v3 Shutdown)
- **Context:** Live verification of Phase 2 via `GET /api/public/v2/observations` revealed that `langfuse@3.39.2` silently failed with `HTTP 410 GONE` because Langfuse Cloud shut down the legacy v3 `/api/public/ingestion` endpoint on November 16, 2026.
- **Decision:** Replace the `langfuse` v3 SDK in `src/lib/observability.ts` with a dependency-free OpenTelemetry OTLP/JSON exporter targeting `POST ${baseUrl}/api/public/otel/v1/traces` with `gen_ai.*` and `langfuse.*` attributes, a `5s` abort timeout, and deterministic single-POST flushing via Next.js `after()`.
- **Consequence:** Traces, spans, Gemini generation model/token usage, and fallback metadata land reliably in Langfuse Cloud v4 with zero heavy OTel SDK bundle overhead.
