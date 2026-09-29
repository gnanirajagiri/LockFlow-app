-- ═══════════════════════════════════════════════════════════════════════════
-- LockFlow — Campaign Publishing Preparation and Controlled Publishing
-- publishing_drafts, publishing_draft_media, publishing_draft_events,
-- publishing_provider_runs, publishing_webhook_events
-- + RLS + append-only audit + server-only run/webhook isolation.
--
-- Product rules encoded here:
--   * Publishing begins with approved Gallery content only: drafts reference
--     same-workspace Campaign Items and approved, available Gallery outputs;
--     eligibility is re-validated by the service at preparation AND
--     immediately before provider submission.
--   * Gallery remains the media source. media_snapshot freezes immutable
--     metadata + provenance references (never signed URLs); nothing here
--     alters Gallery media, reviews, pins or provenance.
--   * One draft = one explicit placement/submission intent. Published
--     status only after provider confirmation. Planned campaign dates are
--     internal and never trigger publishing (no scheduler exists).
--   * Runs are append-only per retry; webhooks are stored only after
--     signature verification, sanitized, deduped by external event id.
--   * provider_metadata_protected / run response metadata / webhook payload
--     metadata are server-only: runs and webhooks tables have NO client
--     RLS policies (deny-all); drafts omit protected fields client-side.
--   * No ads-manager concepts: no budgets, bids, targeting, spend, invoices
--     or analytics columns exist by design.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Enums ───────────────────────────────────────────────────────────────────
create type public.publishing_draft_status as enum (
  'draft', 'validating', 'ready', 'submitting', 'processing', 'published',
  'failed', 'cancelled', 'blocked', 'needs_reauth', 'archived'
);

create type public.publishing_placement as enum (
  'feed_post', 'reel', 'story', 'short_video', 'video_post', 'image_post',
  'ad_creative', 'other'
);

create type public.publishing_event_type as enum (
  'created', 'updated', 'validation_started', 'validation_passed',
  'validation_failed', 'marked_ready', 'submit_requested', 'provider_accepted',
  'provider_processing', 'provider_published', 'provider_failed',
  'retry_requested', 'cancelled', 'blocked', 'reauth_required', 'archived',
  'restored'
);

create type public.publishing_run_status as enum (
  'queued', 'submitting', 'accepted', 'processing', 'completed', 'failed'
);

create type public.publishing_upload_status as enum (
  'not_started', 'uploading', 'uploaded', 'failed'
);

-- ── A. Publishing drafts ────────────────────────────────────────────────────
create table public.publishing_drafts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  campaign_item_id uuid not null references public.campaign_items (id) on delete cascade,
  gallery_output_id uuid not null references public.gallery_outputs (id),
  workspace_social_connection_id uuid not null
    references public.workspace_social_connections (id) on delete restrict,
  provider_key text not null,
  -- Safe display snapshot only — never tokens/secrets.
  external_account_snapshot jsonb not null default '{}'::jsonb,
  status public.publishing_draft_status not null default 'draft',
  placement public.publishing_placement not null default 'feed_post',
  -- Immutable source metadata + provenance references once submitted.
  media_snapshot jsonb not null default '{}'::jsonb,
  -- Publishing-layer copy; editable only while the guard allows.
  copy_snapshot jsonb not null default '{}'::jsonb,
  validation_result jsonb,
  idempotency_key text not null unique,
  provider_publish_id text,
  -- Server-only provider diagnostics (client read models omit this column).
  provider_metadata_protected jsonb,
  published_url text,
  published_at timestamptz,
  failure_code text,
  failure_message_safe text,
  acknowledgement_at timestamptz,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create index publishing_drafts_workspace_status_idx
  on public.publishing_drafts (workspace_id, status, updated_at desc);
create index publishing_drafts_campaign_status_idx
  on public.publishing_drafts (campaign_id, status);
create index publishing_drafts_item_idx on public.publishing_drafts (campaign_item_id);
create index publishing_drafts_connection_status_idx
  on public.publishing_drafts (workspace_social_connection_id, status);
create index publishing_drafts_provider_publish_idx
  on public.publishing_drafts (provider_key, provider_publish_id);

-- ── B. Draft media (primary output per draft; structure allows future sets) ─
create table public.publishing_draft_media (
  id uuid primary key default gen_random_uuid(),
  publishing_draft_id uuid not null references public.publishing_drafts (id) on delete cascade,
  gallery_output_id uuid not null references public.gallery_outputs (id),
  role text not null default 'primary' check (role = 'primary'),
  media_type text not null check (media_type in ('image', 'video')),
  -- Server-only provider handle after media preparation.
  provider_media_handle_protected text,
  upload_status public.publishing_upload_status not null default 'not_started',
  provider_metadata_protected jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index publishing_draft_media_draft_idx
  on public.publishing_draft_media (publishing_draft_id);
create index publishing_draft_media_output_idx
  on public.publishing_draft_media (gallery_output_id);

-- ── C. Draft events — append-only audit timeline ────────────────────────────
create table public.publishing_draft_events (
  id uuid primary key default gen_random_uuid(),
  publishing_draft_id uuid not null references public.publishing_drafts (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  event_type public.publishing_event_type not null,
  message text not null check (char_length(message) between 1 and 400),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index publishing_draft_events_timeline_idx
  on public.publishing_draft_events (publishing_draft_id, created_at desc);

-- Metadata stays small and audit-safe.
create or replace function public.publishing_event_metadata_guard()
returns trigger as $$
begin
  if octet_length(new.metadata::text) > 512 then
    raise exception 'publishing_draft_events.metadata exceeds 512 bytes — keep metadata audit-safe.';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger publishing_draft_events_metadata_guard
  before insert or update on public.publishing_draft_events
  for each row execute function public.publishing_event_metadata_guard();

-- Append-only enforcement: no UPDATE or DELETE may rewrite history.
create or replace function public.publishing_events_append_only()
returns trigger as $$
begin
  raise exception 'publishing_draft_events are append-only.';
end;
$$ language plpgsql;

create trigger publishing_draft_events_no_update
  before update on public.publishing_draft_events
  for each row execute function public.publishing_events_append_only();
create trigger publishing_draft_events_no_delete
  before delete on public.publishing_draft_events
  for each row execute function public.publishing_events_append_only();

-- ── D. Provider runs — append-only per retry; SERVER-ONLY (deny-all RLS) ────
create table public.publishing_provider_runs (
  id uuid primary key default gen_random_uuid(),
  publishing_draft_id uuid not null references public.publishing_drafts (id) on delete cascade,
  provider_key text not null,
  attempt_number integer not null check (attempt_number >= 1),
  idempotency_key text not null,
  provider_request_id text,
  status public.publishing_run_status not null default 'queued',
  -- References immutable draft snapshots, never live records.
  request_snapshot jsonb not null default '{}'::jsonb,
  -- Server-only provider diagnostics.
  response_metadata_protected jsonb,
  error_code text,
  error_message_safe text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (publishing_draft_id, attempt_number),
  -- No duplicate active run per draft/idempotency scope.
  unique (publishing_draft_id, idempotency_key)
);

create index publishing_provider_runs_draft_attempt_idx
  on public.publishing_provider_runs (publishing_draft_id, attempt_number desc);
create index publishing_provider_runs_idempotency_idx
  on public.publishing_provider_runs (idempotency_key);

-- ── E. Webhook events — verified, sanitized, deduped; SERVER-ONLY ───────────
create table public.publishing_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider_key text not null,
  external_event_id text,
  signature_verified boolean not null default false,
  event_type text,
  publishing_draft_id uuid references public.publishing_drafts (id) on delete set null,
  provider_run_id uuid references public.publishing_provider_runs (id) on delete set null,
  payload_metadata_protected jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_error_safe text,
  -- Duplicate provider event handling is idempotent where the provider
  -- supplies an external event id.
  unique (provider_key, external_event_id)
);

create index publishing_webhook_events_provider_idx
  on public.publishing_webhook_events (provider_key, received_at desc);
create index publishing_webhook_events_draft_idx
  on public.publishing_webhook_events (publishing_draft_id);

-- ── updated_at bookkeeping ──────────────────────────────────────────────────
create or replace function public.publishing_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger publishing_drafts_updated_at
  before update on public.publishing_drafts
  for each row execute function public.publishing_set_updated_at();
create trigger publishing_draft_media_updated_at
  before update on public.publishing_draft_media
  for each row execute function public.publishing_set_updated_at();
create trigger publishing_provider_runs_updated_at
  before update on public.publishing_provider_runs
  for each row execute function public.publishing_set_updated_at();

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.publishing_drafts enable row level security;
alter table public.publishing_draft_media enable row level security;
alter table public.publishing_draft_events enable row level security;
alter table public.publishing_provider_runs enable row level security;
alter table public.publishing_webhook_events enable row level security;

-- Drafts: full member access, workspace-scoped. Client read models omit
-- provider_metadata_protected (enforced in the service layer's safe view).
create policy publishing_drafts_read
  on public.publishing_drafts for select
  to authenticated using (public.is_workspace_member(workspace_id, auth.uid()));
create policy publishing_drafts_write
  on public.publishing_drafts for insert
  to authenticated with check (public.is_workspace_member(workspace_id, auth.uid()));
create policy publishing_drafts_update
  on public.publishing_drafts for update
  to authenticated using (public.is_workspace_member(workspace_id, auth.uid()))
  with check (public.is_workspace_member(workspace_id, auth.uid()));
create policy publishing_drafts_delete
  on public.publishing_drafts for delete
  to authenticated using (public.is_workspace_member(workspace_id, auth.uid()));

-- Draft media: member access via join to the parent draft's workspace.
create policy publishing_draft_media_read
  on public.publishing_draft_media for select
  to authenticated using (
    exists (
      select 1 from public.publishing_drafts d
      where d.id = publishing_draft_id
        and public.is_workspace_member(d.workspace_id, auth.uid())
    )
  );
create policy publishing_draft_media_write
  on public.publishing_draft_media for insert
  to authenticated with check (
    exists (
      select 1 from public.publishing_drafts d
      where d.id = publishing_draft_id
        and public.is_workspace_member(d.workspace_id, auth.uid())
    )
  );
create policy publishing_draft_media_update
  on public.publishing_draft_media for update
  to authenticated using (
    exists (
      select 1 from public.publishing_drafts d
      where d.id = publishing_draft_id
        and public.is_workspace_member(d.workspace_id, auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.publishing_drafts d
      where d.id = publishing_draft_id
        and public.is_workspace_member(d.workspace_id, auth.uid())
    )
  );

-- Draft events: read-only for members; writes via service role only.
create policy publishing_draft_events_read
  on public.publishing_draft_events for select
  to authenticated using (
    exists (
      select 1 from public.publishing_drafts d
      where d.id = publishing_draft_id
        and public.is_workspace_member(d.workspace_id, auth.uid())
    )
  );

-- Provider runs and webhook events: NO policies — denied to every client
-- role. Server services (service role bypasses RLS) own these tables.
-- (No create policy statements on purpose.)
