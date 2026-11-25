# B2B Inbound Lead Triage & Enrichment Agent

A production-oriented B2B AI Operations workflow built on a **\$0/month stack** (Next.js 15 App Router, TypeScript, Zod v4, Jina Reader, Google Gemini Flash, Supabase PostgreSQL, and Langfuse OpenTelemetry).

It ingests messy inbound B2B inquiries, enriches the prospect's domain, classifies intent and ICP fit with structured JSON guardrails, auto-routes high-confidence leads, auto-rejects high-confidence spam, and pauses ambiguous, degraded, or adversarial leads in a **Human Approval Queue** without ever dropping an inbound lead.

---

## Application Views

- **`/` (Operations Inbox):** 3-pane workspace with monochrome navigation rail and live queue counts (`All leads`, `Needs review`, `Auto-routed`, `Approved`, `Auto-rejected`, `Rejected`), searchable lead list with keyboard navigation (`J` / `K` / `↑` / `↓` with auto-scroll), lead inspector with editable reply composer, inline `Approve` / `Reject` actions, `audit_logs` timeline, raw JSON toggle, Langfuse trace ID copy, and a **New lead** (`N`) slide-over drawer with 4 one-click test examples.
- **`/submit` (Public Client Intake Form):** Standalone "Contact sales" form feeding directly into `POST /api/triage` and the live inbox.

---

## Architecture

```mermaid
flowchart LR
    subgraph Boundary["Next.js App Router (Vercel)"]
        UI["Operations Inbox (/)\nPublic Intake Form (/submit)"]
        WH["Programmatic Webhook / n8n\n(X-Webhook-Secret)"]
        API_T["POST /api/triage\nmaxDuration = 30"]
        API_L["GET /api/leads\nPATCH /api/leads/[id]"]
    end

    subgraph Core["Pure Domain Core (src/lib/*)"]
        SEC["security.ts\nWebhook Auth · Rate Limit\nInjection Scan · Email Class"]
        IDEM["idempotency.ts\n10-Min Window SHA-256"]
        ENRICH["enrichment.ts\nJina Reader (5.5s timeout)"]
        LLM["llm.ts\nGemini Fallback Chain + Cooldown\n6s Timeout · 1 Repair Retry"]
        ROUTE["router.ts\n7-Priority Deterministic Policy"]
    end

    subgraph External["External Services ($0 Stack)"]
        JINA["r.jina.ai"]
        GEM["Gemini Flash Pool\n3.8 -> 3.7 -> 3.6 -> 3.5 -> 2.5"]
        DB["Supabase Postgres\nleads + audit_logs (RLS)"]
        LF["Langfuse Cloud\nOTLP/JSON via after()"]
    end

    UI --> API_T
    WH --> API_T
    UI --> API_L
    API_T --> SEC --> IDEM --> DB
    API_T --> ENRICH --> JINA
    API_T --> LLM --> GEM
    API_T --> ROUTE --> DB
    API_T -. "after() flush" .-> LF
    API_L --> DB
```

---

## 20-Case Live Evaluation Results

Measured with `npm run evals` against `evals/leads_dataset.json` (6 clear ICP leads, 4 spam pitches, 5 ambiguous inquiries, 3 broken-URL/disposable-email cases, and 2 direct/indirect prompt-injection attacks) running live against the Gemini Flash fallback chain:

| Metric | Measured Result |
| :--- | :--- |
| Routing Accuracy (20 cases) | **95.0%** (19/20) |
| False Auto-Route Rate *(Target: 0%)* | **0.0%** (0/14) |
| Prompt Injection Catch Rate (Direct + Scraped-Site) | **100.0%** (2/2) |
| Estimated Avg Cost / Lead | **\$0.00013** |
| p95 Latency *(incl. live 503 fallback recovery)* | **17.51s** |

> **Notes on the 1/20 delta (`deg-03`):** `burner99@mailinator.com` impersonating Stripe was classified as high-confidence spam (`auto_rejected`) rather than `needs_human_review`, preserving a **0.0% false auto-route rate**. During free-tier load spikes (`503 UNAVAILABLE`), the fallback chain automatically recovered on the next healthy model, and if all models hit transient limits, fail-safe persistence saved leads cleanly to `needs_human_review` (`llm_unavailable`) with zero dropped inquiries.

---

## Security-First Decisions

- **Strict Boundary Validation (`src/lib/schemas.ts`):** Every external payload is parsed with Zod v4. `company_url` allows only public `http:`/`https:` URLs and rejects `localhost`, `.local`/`.internal`, single-label hosts, cloud metadata IPs (`169.254.169.254`), and private IPv4/IPv6 ranges as input hygiene before forwarding to Jina Reader.
- **Constant-Time Webhook Auth (`src/lib/security.ts`):** Programmatic calls (`source: "webhook" | "n8n"`) require `X-Webhook-Secret`, verified with `crypto.timingSafeEqual` over SHA-256 digests (fails closed when unset).
- **Defense-in-Depth Against Prompt Injection:**
  1. Early tripwire scans **both** user input (`name + message`) and scraped website copy (`enrichment.summary`) for direct and indirect injection patterns.
  2. `src/lib/llm.ts` wraps all untrusted text in explicit XML delimiters (`<untrusted_lead_input>`, `<untrusted_scraped_website>`) and escapes closing-tag breakouts.
  3. `src/lib/router.ts` enforces routing policy deterministically outside the LLM. Flagged inputs are always forced to `needs_human_review`, regardless of model confidence.
- **Rate Limiting & Quota Protection:**
  - Public `web_demo` calls and `PATCH /api/leads/[id]` sandbox reviews use an in-memory fixed-window IP rate limiter (`429` + `Retry-After`). Because Vercel serverless instances do not share in-memory state across cold starts, this is best-effort per instance, backed by a **Supabase-counted daily demo quota cap** (`DEMO_DAILY_CAP`, default `100/24h`) with a partial index (`idx_leads_web_demo_created_at`) to protect free-tier Gemini limits.
- **Database Isolation & Secret Scanning:** Both `public.leads` and `public.audit_logs` have **Row Level Security (RLS) enabled** with zero public policies (server-side `service_role` access only), `set search_path = ''` on triggers, and **Gitleaks** running on every PR and push to `main` via `.github/workflows/ci.yml`.

---

## Reliability & Observability

- **Deterministic Routing Gate (`src/lib/router.ts`):**
  - `llm_unavailable` -> `needs_human_review` (fail-safe persistence; leads are never dropped with `502`)
  - `prompt_injection_flagged` -> `needs_human_review`
  - `suggested_route === "spam"` & `confidence_score >= 0.80` -> `auto_rejected` (kept separate from `auto_routed` so spam never triggers sales alerts)
  - `disposable` email domain -> `needs_human_review`
  - `enrichment.ok === false` (Jina `5.5s` timeout or HTTP error) -> `needs_human_review`
  - `confidence_score < 0.80` -> `needs_human_review`
  - `confidence_score >= 0.80` & `enrichment.ok === true` -> `auto_routed`
- **Configurable Gemini Fallback Chain + Cooldowns (`GEMINI_MODELS`):** Defaults to `gemini-3.8-flash -> gemini-3.7-flash -> gemini-3.6-flash -> gemini-3.5-flash -> gemini-3.5-flash-lite -> gemini-2.5-flash` with a `6s` per-attempt timeout (fitting inside Vercel's `maxDuration = 30`). Transient `429`/`503`/`404`/timeout errors immediately advance to the next model and place the failing model on an in-memory cooldown (`15m` for quota exhaustion, `60s` for `503` overload) so subsequent requests skip it immediately. Raw RPC error blobs are normalized into compact structured summaries before logging to Langfuse.
- **Time-Windowed Idempotency + Race Safety:** SHA-256 of normalized `(email + message + 10-minute bucket + optional nonce)` prevents duplicate webhook retries and Submit double-clicks (with Postgres `23505` concurrent race recovery), while demo examples generate a fresh nonce per click so live demos stay live.
- **Langfuse OpenTelemetry (`src/lib/observability.ts`):** Dependency-free OTLP/JSON exporter posting directly to `POST /api/public/otel/v1/traces`, flushed via Next.js `after()` so traces never drop on serverless freeze.

---

## Local Setup & Scripts

```bash
# 1. Install dependencies
npm install

# 2. Configure environment variables
cp .env.example .env.local
# Fill in GEMINI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
# LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, LANGFUSE_BASE_URL, WEBHOOK_SECRET

# 3. Apply database schema once in Supabase SQL Editor
#    supabase/schema.sql

# 4. Run offline verification suite (zero API keys required)
npm run typecheck
npm run lint
npm test

# 5. Run live end-to-end smoke test & 20-case evaluation suite
npm run smoke
npm run evals

# 6. Start local dev server
npm run dev
```
