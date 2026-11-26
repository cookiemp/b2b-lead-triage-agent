-- Add HubSpot CRM v3 sync tracking columns to public.leads
alter table public.leads
  add column if not exists hubspot_contact_id text,
  add column if not exists hubspot_sync_status text check (
    hubspot_sync_status is null or hubspot_sync_status in ('pending', 'synced', 'failed', 'skipped')
  ),
  add column if not exists hubspot_synced_at timestamptz;
