-- ═══════════════════════════════════════════════════════════════════════════
-- LockFlow — Prompt 29: campaign brief → multi-format generation
-- orchestration.
--
-- One campaign brief becomes ONE coordinated content-set run (the parent);
-- child image/video/story jobs are the existing generation_provider_runs
-- rows (prompts 27/28), linked back to the parent. Story grouping stays on
-- the Gallery metadata keys from prompt 28.
--
-- Rules encoded:
--   * Workspace membership gates every row (RLS below).
--   * The parent stores the normalized brief, the inspectable orchestration
--     plan and the shared locked baseline snapshot — identifiers/labels only,
--     never secrets or signed URLs.
--   * Parent status rolls up from child outcomes (partially_completed is a
--     first-class status).
--   * The audit trail is append-only.
-- ═══════════════════════════════════════════════════════════════════════════

create type public.campaign_run_status as enum (
  'draft', 'validating', 'blocked', 'planning', 'queued',
  'running', 'partially_completed', 'completed', 'failed', 'cancelled'
);

-- ── A. Parent orchestration runs ─────────────────────────────────────────────
create table public.campaign_generation_runs (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  campaign_id       uuid references public.campaigns (id) on delete set null,
  initiated_by      uuid not null references auth.users (id) on delete cascade,
  status            campaign_run_status not null default 'draft',
  source_brief_text text not null default '',
  normalized_brief_json    jsonb not null default '{}'::jsonb,
  orchestration_plan_json  jsonb not null default '{}'::jsonb,
  locked_baseline_snapshot_json jsonb,
  total_jobs_count     integer not null default 0 check (total_jobs_count >= 0),
  completed_jobs_count integer not null default 0 check (completed_jobs_count >= 0),
  failed_jobs_count    integer not null default 0 check (failed_jobs_count >= 0),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  completed_at      timestamptz
);

create trigger trg_campaign_generation_runs_updated_at
  before update on public.campaign_generation_runs
  for each row execute function public.set_updated_at();

create index campaign_generation_runs_workspace_idx
  on public.campaign_generation_runs (workspace_id, created_at);
create index campaign_generation_runs_campaign_idx
  on public.campaign_generation_runs (campaign_id);

-- ── B. Child-job links (parent ↔ media run) ──────────────────────────────────
create table public.campaign_generation_run_jobs (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  campaign_generation_run_id uuid not null references public.campaign_generation_runs (id) on delete cascade,
  media_generation_job_id uuid references public.generation_provider_runs (id) on delete set null,
  media_type      text not null check (media_type in ('image', 'video', 'story')),
  planned_role    text,
  output_group_key text,
  created_at      timestamptz not null default now()
);

create index campaign_run_jobs_run_idx
  on public.campaign_generation_run_jobs (campaign_generation_run_id);
create index campaign_run_jobs_media_job_idx
  on public.campaign_generation_run_jobs (media_generation_job_id);

-- ── C. Append-only audit trail ───────────────────────────────────────────────
create table public.campaign_generation_run_audit (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  campaign_run_id uuid not null references public.campaign_generation_runs (id) on delete cascade,
  event           text not null check (event in (
    'campaign_generation_run_requested',
    'campaign_generation_run_validated',
    'campaign_generation_run_blocked',
    'campaign_generation_plan_created',
    'campaign_generation_run_submitted',
    'campaign_generation_child_job_created',
    'campaign_generation_run_completed',
    'campaign_generation_run_partially_completed',
    'campaign_generation_run_failed',
    'campaign_generation_run_retry_requested',
    'campaign_generation_locked_baseline_created'
  )),
  detail          text,
  created_at      timestamptz not null default now()
);

create index campaign_run_audit_run_idx
  on public.campaign_generation_run_audit (campaign_run_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- Row-level security
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.campaign_generation_runs enable row level security;
alter table public.campaign_generation_run_jobs enable row level security;
alter table public.campaign_generation_run_audit enable row level security;

create policy "campaign_runs_select_member" on public.campaign_generation_runs
  for select using (public.is_workspace_member(workspace_id));
create policy "campaign_runs_insert_member" on public.campaign_generation_runs
  for insert with check (public.is_workspace_member(workspace_id) and auth.uid() = initiated_by);
create policy "campaign_runs_update_member" on public.campaign_generation_runs
  for update using (public.is_workspace_member(workspace_id));
create policy "campaign_runs_delete_member" on public.campaign_generation_runs
  for delete using (public.is_workspace_member(workspace_id));

create policy "campaign_run_jobs_select_member" on public.campaign_generation_run_jobs
  for select using (public.is_workspace_member(workspace_id));
create policy "campaign_run_jobs_insert_member" on public.campaign_generation_run_jobs
  for insert with check (public.is_workspace_member(workspace_id));
create policy "campaign_run_jobs_delete_member" on public.campaign_generation_run_jobs
  for delete using (public.is_workspace_member(workspace_id));

-- Audit: append-only — select + insert, never update/delete.
create policy "campaign_run_audit_select_member" on public.campaign_generation_run_audit
  for select using (public.is_workspace_member(workspace_id));
create policy "campaign_run_audit_insert_member" on public.campaign_generation_run_audit
  for insert with check (public.is_workspace_member(workspace_id));
