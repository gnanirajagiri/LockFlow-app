-- ═══════════════════════════════════════════════════════════════════════════
-- LockFlow — Publishing Review & Submission Orchestration (Prompt 19)
-- publish_runs, publishing_review_events
-- + RLS + append-only audit + immutable request/validation snapshots.
--
-- Product rules encoded here:
--   * One publish run per attempt per campaign item: request and validation
--     snapshots freeze at creation and are never rewritten; retries create
--     NEW rows with fresh idempotency keys (a failed run stays failed).
--   * idempotency_key is unique per campaign item — duplicate confirms of
--     the same intent dedupe instead of double-posting.
--   * Only safe, non-sensitive error fields exist (code + safe message).
--     No provider internals, tokens or raw provider errors are stored.
--   * Audit trail is append-only (trigger-enforced) with audit-safe
--     metadata; workspace-scoped RLS; events readable by members.
--   * No calendar auto-publish: no trigger, function or worker here ever
--     creates or submits a run from a planned campaign date.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Enums ───────────────────────────────────────────────────────────────────
create type public.publish_run_status as enum (
  'pending', 'validated', 'submitted', 'accepted', 'published', 'failed', 'cancelled'
);

create type public.publishing_review_event_type as enum (
  'review_checked', 'review_blocked', 'review_confirmed',
  'run_created', 'run_submitted', 'run_accepted', 'run_published',
  'run_failed', 'retry_requested', 'run_cancelled'
);

-- ── A. Publish runs — one row per submission attempt ────────────────────────
create table public.publish_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  campaign_item_id uuid not null references public.campaign_items (id) on delete cascade,
  -- Target draft in the Prompt 18 publishing domain (set at submission).
  publishing_draft_id uuid references public.publishing_drafts (id) on delete set null,
  requested_by uuid not null references auth.users (id) on delete cascade,
  status public.publish_run_status not null default 'pending',
  placement public.publishing_placement not null,
  -- Immutable request snapshot: what this run was created from.
  request_snapshot jsonb not null default '{}'::jsonb,
  -- Immutable validation snapshot: the structured eligibility decision.
  validation_snapshot jsonb,
  idempotency_key text not null,
  attempt_number integer not null check (attempt_number >= 1),
  -- Safe fields only — never provider internals or raw provider errors.
  error_code text,
  error_message_safe text,
  provider_publish_id text,
  published_url text,
  published_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_item_id, idempotency_key),
  unique (campaign_item_id, attempt_number)
);

create index publish_runs_workspace_status_idx
  on public.publish_runs (workspace_id, status, updated_at desc);
create index publish_runs_campaign_status_idx
  on public.publish_runs (campaign_id, status);
create index publish_runs_item_attempt_idx
  on public.publish_runs (campaign_item_id, attempt_number desc);
create index publish_runs_idempotency_idx
  on public.publish_runs (idempotency_key);
create index publish_runs_draft_idx
  on public.publish_runs (publishing_draft_id);

-- Snapshot immutability: request/validation snapshots can never change.
create or replace function public.publish_runs_snapshot_guard()
returns trigger as $$
begin
  if new.request_snapshot is distinct from old.request_snapshot
     or new.validation_snapshot is distinct from old.validation_snapshot then
    raise exception 'publish_runs snapshots are immutable.';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger publish_runs_snapshot_guard
  before update on public.publish_runs
  for each row execute function public.publish_runs_snapshot_guard();

-- ── B. Publishing review audit — append-only trail ──────────────────────────
create table public.publishing_review_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  campaign_item_id uuid not null references public.campaign_items (id) on delete cascade,
  publish_run_id uuid references public.publish_runs (id) on delete set null,
  actor_id uuid references auth.users (id) on delete set null,
  event_type public.publishing_review_event_type not null,
  message text not null check (char_length(message) between 1 and 400),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index publishing_review_events_timeline_idx
  on public.publishing_review_events (campaign_item_id, created_at desc);
create index publishing_review_events_run_idx
  on public.publishing_review_events (publish_run_id, created_at desc);
create index publishing_review_events_workspace_idx
  on public.publishing_review_events (workspace_id, created_at desc);

-- Metadata stays small and audit-safe.
create or replace function public.publishing_review_event_metadata_guard()
returns trigger as $$
begin
  if octet_length(new.metadata::text) > 512 then
    raise exception 'publishing_review_events.metadata exceeds 512 bytes — keep metadata audit-safe.';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger publishing_review_events_metadata_guard
  before insert or update on public.publishing_review_events
  for each row execute function public.publishing_review_event_metadata_guard();

-- Append-only enforcement: no UPDATE or DELETE may rewrite history.
create or replace function public.publishing_review_events_append_only()
returns trigger as $$
begin
  raise exception 'publishing_review_events are append-only.';
end;
$$ language plpgsql;

create trigger publishing_review_events_no_update
  before update on public.publishing_review_events
  for each row execute function public.publishing_review_events_append_only();
create trigger publishing_review_events_no_delete
  before delete on public.publishing_review_events
  for each row execute function public.publishing_review_events_append_only();

-- ── updated_at bookkeeping ──────────────────────────────────────────────────
create or replace function public.publish_runs_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger publish_runs_updated_at
  before update on public.publish_runs
  for each row execute function public.publish_runs_set_updated_at();

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.publish_runs enable row level security;
alter table public.publishing_review_events enable row level security;

-- Publish runs: full member access, workspace-scoped.
create policy publish_runs_read
  on public.publish_runs for select
  to authenticated using (public.is_workspace_member(workspace_id, auth.uid()));
create policy publish_runs_insert
  on public.publish_runs for insert
  to authenticated with check (public.is_workspace_member(workspace_id, auth.uid()));
create policy publish_runs_update
  on public.publish_runs for update
  to authenticated using (public.is_workspace_member(workspace_id, auth.uid()))
  with check (public.is_workspace_member(workspace_id, auth.uid()));

-- Review audit: members read their workspace's trail; writes stay
-- service-side in production (insert happens via the orchestration service).
create policy publishing_review_events_read
  on public.publishing_review_events for select
  to authenticated using (public.is_workspace_member(workspace_id, auth.uid()));

-- Deliberately NO delete policy on publish_runs (history is preserved) and
-- NO insert/update policy on publishing_review_events (service-side writes).
