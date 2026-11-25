# Master Architecture & 5-Phase Implementation Plan
## B2B Inbound Lead Triage & Enrichment Agent

> **Operating Contract:** Execute strictly one phase at a time. Never start Phase N+1 until Phase N's Verification Gate AND all prior phase tests pass and the owner explicitly approves proceeding.
> **Related Docs:** See [ARCHITECTURE_DECISIONS.md](./ARCHITECTURE_DECISIONS.md) for ADRs and explicit contract amendments.

---

## 1. System Architecture & Engineering Decisions

This repository is structured around five core principles:
1. **Boundary Discipline (Thin HTTP Shell, Pure Domain Core):** `src/lib/*` contains zero `next/*` imports. Route handlers (`src/app/api/*`) parse HTTP inputs, run `security.ts`, delegate to `src/lib/*`, schedule Langfuse flushing via Next.js `after()`, and serialize responses.
2. **Single Source of Truth:** `src/lib/schemas.ts` owns all canonical enum literals and Zod schemas. TypeScript types are derived via `z.infer` (no hand-synced parallel unions).
3. **Discriminated Unions:** External calls (`EnrichmentOutcome`, `SecurityCheckResult`, `PromptInjectionScanResult`, `TriagePipelineResponse`) return tagged unions so invalid states cannot compile.
4. **100% Offline CI Suite:** `runTriagePipeline(lead, deps)` injects `enrich`, `triageWithLlm`, `repo`, and `telemetry`. All Vitest tests across Phases 0–4 run offline with zero API keys.
5. **Vercel Serverless Safety:** `export const maxDuration = 30;` on `POST /api/triage`; strict `4500ms` timeout on Jina Reader; explicit timeout on Gemini calls in Phase 2; Langfuse flushed via Next.js `after()` / `flushAsync()` so traces are never dropped on lambda freeze.

### Deterministic Routing Policy (`src/lib/router.ts`)
Evaluated strictly in priority order:

| Priority | Condition | Resulting `status` | `routing_reason` |
| :---: | :--- | :--- | :--- |
| 0 | LLM unavailable / failed after bounded retry | `needs_human_review` | `llm_unavailable` |
| 1 | `promptInjection.detected === true` (input OR scraped content) | `needs_human_review` | `prompt_injection_flagged` |
| 2 | `triage.suggested_route === "spam"` AND `triage.confidence_score >= 0.80` | `auto_rejected` | `high_confidence_spam` |
| 3 | `emailDomain === "disposable"` | `needs_human_review` | `disposable_email_flagged` |
| 4 | `enrichment.ok === false` | `needs_human_review` | `enrichment_unavailable` |
| 5 | `triage.confidence_score < 0.80` | `needs_human_review` | `below_confidence_threshold` |
| 6 | Otherwise (`confidence >= 0.80` AND `enrichment.ok === true`) | `auto_routed` | `high_confidence_verified` |

---

## 2. Phase Roadmap & Cumulative Verification Gates

### Phase 0: Scaffolding, Contracts, SQL Schema & CI/CD Foundation
- Next.js 15 (App Router, TypeScript strict, Tailwind CSS v4), Vitest, Zod v4, ESLint flat config (`eslint.config.mjs`).
- Locked contracts in `src/lib/schemas.ts` (`InboundLeadSchema` with URL hygiene guard + optional `idempotency_nonce`, `TriageResultSchema` with `icp_score` + `draft_reply`, `LeadDecisionSchema`, `LeadRecordSchema`, `AuditLogRecordSchema`).
- `supabase/schema.sql` (`leads` with unique `idempotency_key` + `audit_logs` + indexes + `updated_at` trigger).
- `.env.example` and `.github/workflows/ci.yml` (`typecheck`, `test`, Gitleaks).
- **Gate:** `schemas.test.ts` passes, `npm run typecheck` passes, `npm test` passes, `ci.yml` valid YAML.

### Phase 1 (+ Phase 1.1 Hardening): Core Pipeline Logic, Security Guardrails & Deterministic Routing (Offline)
- `src/lib/security.ts`: `timingSafeEqual` `X-Webhook-Secret` verification, best-effort in-memory **fixed-window** IP rate limiter (`web_demo` + sandbox `PATCH`), broadened prompt-injection tripwire (scans both user input and scraped site text), and personal/disposable email classifier.
- `src/lib/idempotency.ts`: time-windowed (10-minute bucket) SHA-256 of normalized `(email + message + optional nonce)`.
- `src/lib/enrichment.ts`: Jina Reader (`https://r.jina.ai/<url>`) with 4.5s timeout, safe token truncation, graceful fallback outcome (never throws).
- `src/lib/router.ts`: pure deterministic router (`auto_routed` vs `auto_rejected` vs `needs_human_review`).
- `src/lib/pipeline.ts` (fail-safe persistence when LLM fails -> `llm_unavailable`), `src/lib/triage-handler.ts`, and `src/app/api/triage/route.ts` (`maxDuration = 30`).
- **Gate (Cumulative 0 + 1):** All Phase 0 + Phase 1 tests pass (`200`, `400`, `401`, `429`, time-windowed + nonce idempotency, Jina timeout/500 fallback, LLM failure fail-safe persistence, input + scraped-site prompt-injection override, high-confidence spam -> `auto_rejected`, disposable email flagging, `0.79`/`0.80` boundary), `npm run typecheck`, and `npm run lint` pass.

### Phase 2: Live Integrations (Gemini Flash + Supabase + Langfuse), Approval API & Eval Suite
- `src/lib/config.ts`: lazy Zod env validator at boundary.
- `src/lib/llm.ts`: Gemini Flash structured JSON client with explicit timeout, XML-delimited untrusted inputs, Zod validation + 1 bounded retry on schema/parse error.
- `src/lib/db.ts`: Supabase Postgres repository (`leads` + `audit_logs` + Postgres `23505` concurrent duplicate race handling + daily demo quota cap check + `409` state-transition guard).
- `src/lib/observability.ts`: Langfuse tracing (enrichment span, Gemini generation, routing event) + `after()` flush.
- `GET /api/leads` and `PATCH /api/leads/[id]` (rate-limited public sandbox).
- `scripts/smoke-test.ts`, `evals/leads_dataset.json` (20 cases), `scripts/run-evals.ts`.
- **Gate (Cumulative 0 + 1 + 2):** Full offline Vitest suite green with 0 API keys + live smoke test writes Supabase rows and produces a visible Langfuse trace.

### Phase 3: Clean 2-Tab Operational UI, README & Vercel Deployment (Stage A Release)
- `src/lib/presets.ts`: 4 one-click presets (Enterprise, Ambiguous, Spam, Prompt Injection — each generating a fresh `idempotency_nonce` on click so every visitor gets a live run).
- `src/components/TriageWorkbench.tsx` (Tab 1) + `src/components/ApprovalQueue.tsx` (Tab 2 with editable `draft_reply`, Approve/Reject, Audit Log, Langfuse trace links).
- `README.md` (Mermaid architecture, honest security boundaries, reliability & Langfuse metrics, 20-case eval table, local setup).
- **Gate (Stage A Release):** All Phase 0–2 tests pass, `npm run build` + `typecheck` + `lint` pass, CI green on `main`, live Vercel URL verified end-to-end. **STOP for Stage A submission.**

### Phase 4: n8n Orchestration Bolt-On & Outbound Alerts (Stage B Extension)
- `src/lib/notify.ts`: non-blocking Discord/Slack webhook notifier (3s timeout, swallows errors).
- `workflows/n8n-triage-workflow.json`: importable n8n workflow calling Vercel `POST /api/triage` with `X-Webhook-Secret` and `source: "n8n"`, branching cleanly on `auto_routed` vs `needs_human_review` (and ignoring `auto_rejected` spam).
- Update `README.md` with n8n orchestration section (noting n8n Cloud 14-day trial vs Render free tier + UptimeRobot).
- **Gate (Final Release):** All Phase 0–4 tests pass, `npm run build` green, live n8n run verified end-to-end.

---

## 3. Decision & Progress Log

| Date | Phase | Status | Notes / Architectural Decisions |
| :--- | :---: | :---: | :--- |
| 2026-11-25 | Phase 0 | Passed | Locked Zod schemas (incl. URL hygiene guard, `icp_score`, `draft_reply`, `LeadDecisionSchema`), Supabase SQL schema with unique `idempotency_key`, and GitHub Actions CI + Gitleaks. Chose Jina Reader (`r.jina.ai`) over Firecrawl to preserve Firecrawl credits. Gate passed: `tsc --noEmit` (0 errors), Vitest (14/14 passed), `ci.yml` YAML valid. |
| 2026-11-25 | Phase 1 | Passed | Built `idempotency.ts`, `security.ts`, `enrichment.ts`, `router.ts`, `pipeline.ts`, `triage-handler.ts`, and `POST /api/triage` (`maxDuration = 30`). Extracted handler factory out of `route.ts` for Next.js App Router export compliance. Gate passed: `tsc --noEmit` (0 errors), Vitest (41/41 passed). |
| 2026-11-25 | Phase 1.1 | Passed | Hardening pass: added `auto_rejected` status (ADR-002), fail-safe persistence on LLM failure (ADR-003), 10-min time-windowed idempotency + optional `idempotency_nonce` (ADR-004), broadened prompt-injection tripwire across both user input and scraped site content (ADR-005), personal/disposable email classification, ESLint flat config, Git repo init, Zod v4 (`^4.6.7`) upgrade, and `ARCHITECTURE_DECISIONS.md`. Gate passed: `tsc --noEmit` (0 errors), `eslint .` (0 errors), Vitest (51/51 passed). |
