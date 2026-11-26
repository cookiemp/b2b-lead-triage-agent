-- B2B Inbound Lead Triage & Enrichment Agent
-- Supabase PostgreSQL Schema (Phase 0 Locked Contract + Phase 1.1 auto_rejected Amendment)

create extension if not exists pgcrypto;

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  name text not null,
  email text not null,
  company_url text not null,
  message text not null,
  enriched_summary text,
  enrichment_ok boolean not null default false,
  prompt_injection_detected boolean not null default false,
  triage_json jsonb,
  icp_score integer check (icp_score is null or (icp_score >= 0 and icp_score <= 100)),
  confidence_score double precision check (
    confidence_score is null or (confidence_score >= 0.0 and confidence_score <= 1.0)
  ),
  draft_reply text,
  status text not null check (
    status in ('auto_routed', 'auto_rejected', 'needs_human_review', 'approved', 'rejected')
  ),
  source text not null default 'web_demo' check (
    source in ('web_demo', 'webhook', 'n8n')
  ),
  langfuse_trace_id text,
  hubspot_contact_id text,
  hubspot_sync_status text check (
    hubspot_sync_status is null or hubspot_sync_status in ('pending', 'synced', 'failed', 'skipped')
  ),
  hubspot_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  action text not null,
  actor text not null,
  details_json jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_leads_status_created_at
  on public.leads (status, created_at desc);

create index if not exists idx_leads_web_demo_created_at
  on public.leads (created_at desc)
  where source = 'web_demo';

create index if not exists idx_audit_logs_lead_id_created_at
  on public.audit_logs (lead_id, created_at desc);

-- Enable RLS with no anon/authenticated policies: only server-side service_role access is permitted.
alter table public.leads enable row level security;
alter table public.audit_logs enable row level security;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_leads_updated_at on public.leads;
create trigger trg_leads_updated_at
  before update on public.leads
  for each row
  execute function public.set_updated_at();
