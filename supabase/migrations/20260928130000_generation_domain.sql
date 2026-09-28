-- ═══════════════════════════════════════════════════════════════════════════
-- LockFlow — Generation domain (provider-agnostic IMAGE generation)
--
-- Adds the server-side backbone for image generation:
--   * generation_provider_runs  — one row per provider attempt (audit +
--     idempotency + snapshots). Never overwritten; failures append attempts.
--   * generation_quota_usage    — auditable per workspace/user period guard.
--   * generation_config         — server-synced non-secret configuration the
--     SQL eligibility checks read (fail-closed unless the worker synced
--     IMAGE_GENERATION_ENABLED=true + a configured provider name).
--   * gallery_outputs.generation_provider_run_id — provenance from output back
--     to the exact provider attempt (job pins stay immutable).
--   * lockflow-gallery-media    — NEW private bucket for generated images.
--
-- Privileged logic lives in security-definer RPCs, callable only by
-- `authenticated` users through narrow entry points; the worker uses the
-- service role (bypasses RLS) server-side. Rules encoded here:
--   * Submission requires a draft image-compatible job with ALL pins locked,
--     rights-confirmed references, non-archived sources, available quota and
--     an enabled+configured provider — everything re-verified server-side.
--   * Idempotency: one active run per job; duplicate submissions return the
--     existing run without a second billable attempt. Retries append a new
--     attempt (new idempotency key) and never resubmit completed runs.
--   * Request snapshots exclude credentials and permanent signed URLs.
--   * Client access is read-only and workspace-scoped; status/mutations flow
--     through RPCs and the server-side worker only.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── A. Status enum + runs table ─────────────────────────────────────────────
create type public.generation_run_status as enum (
  'created', 'submitted', 'queued', 'processing', 'completed', 'failed', 'cancelled'
);

create table public.generation_provider_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  content_job_request_id uuid not null references public.content_job_requests (id) on delete cascade,
  created_by uuid not null references auth.users (id) on delete cascade,
  provider_name text not null,
  provider_request_id text,
  idempotency_key text not null unique,
  status public.generation_run_status not null default 'created',
  request_snapshot jsonb not null default '{}'::jsonb,
  response_snapshot jsonb,
  provider_cost_metadata jsonb,
  error_code text,
  error_message text,
  attempt_number integer not null default 1 check (attempt_number >= 1),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_generation_provider_runs_updated_at
  before update on public.generation_provider_runs
  for each row execute function public.set_updated_at();

create index generation_runs_job_idx
  on public.generation_provider_runs (content_job_request_id, status);
create index generation_runs_provider_request_idx
  on public.generation_provider_runs (provider_request_id);
create index generation_runs_workspace_idx
  on public.generation_provider_runs (workspace_id, status, created_at);

-- ── B. Quota usage (auditable guard, not billing) ───────────────────────────
create table public.generation_quota_usage (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  period_start date not null,
  period_end date not null,
  image_jobs_submitted integer not null default 0 check (image_jobs_submitted >= 0),
  image_outputs_requested integer not null default 0 check (image_outputs_requested >= 0),
  estimated_or_reported_cost_metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id, period_start)
);

create trigger trg_generation_quota_usage_updated_at
  before update on public.generation_quota_usage
  for each row execute function public.set_updated_at();

create index generation_quota_workspace_idx
  on public.generation_quota_usage (workspace_id, period_start);

-- ── C. Generation configuration (non-secret; worker-synced from env) ───────
create table public.generation_config (
  id integer primary key default 1 check (id = 1),
  image_generation_enabled boolean not null default false,
  provider_name text not null default 'none',
  image_max_outputs_per_job integer not null default 4 check (image_max_outputs_per_job between 1 and 10),
  image_max_jobs_per_user_per_period integer not null default 5,
  image_max_jobs_per_workspace_per_period integer not null default 20,
  updated_at timestamptz not null default now()
);

insert into public.generation_config (id) values (1) on conflict (id) do nothing;

create trigger trg_generation_config_updated_at
  before update on public.generation_config
  for each row execute function public.set_updated_at();

-- ── D. Gallery provenance link + private media bucket ──────────────────────
alter table public.gallery_outputs
  add column if not exists generation_provider_run_id uuid
    references public.generation_provider_runs (id) on delete set null;

create index if not exists gallery_outputs_provider_run_idx
  on public.gallery_outputs (generation_provider_run_id);

insert into storage.buckets (id, name, public)
values ('lockflow-gallery-media', 'lockflow-gallery-media', false)
on conflict (id) do nothing;

-- Generated media is written by the server-side worker (service role) and
-- read by members through short-lived signed URLs only; path-derived policy.
create policy "genmedia_select_own_workspace"
on storage.objects for select to authenticated
using (
  bucket_id = 'lockflow-gallery-media'
  and public.is_workspace_member(split_part(name, '/', 2)::uuid)
);

-- ── E. RLS on the new tables ────────────────────────────────────────────────
alter table public.generation_provider_runs enable row level security;
alter table public.generation_quota_usage enable row level security;
alter table public.generation_config enable row level security;

-- Runs: workspace members may READ run status only. Insert/update happens
-- through the security-definer RPCs and the service-role worker.
create policy "generation_runs_select_member" on public.generation_provider_runs
  for select using (public.is_workspace_member(workspace_id));

-- Quota: members read their own workspace's usage; writes are server-only.
create policy "generation_quota_select_member" on public.generation_quota_usage
  for select using (public.is_workspace_member(workspace_id));

-- Config: members may read the non-secret flags (UI readiness display).
create policy "generation_config_select_member" on public.generation_config
  for select using (public.is_workspace_member(auth.uid()));

-- ── F. Audit events for generation ──────────────────────────────────────────
create table public.generation_audit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  content_job_request_id uuid references public.content_job_requests (id) on delete cascade,
  provider_run_id uuid references public.generation_provider_runs (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  event_type text not null check (event_type in (
    'submission_requested', 'eligibility_failed', 'quota_denied',
    'provider_run_created', 'provider_request_accepted', 'status_update_received',
    'result_ingested', 'provider_error', 'retry_requested', 'output_created'
  )),
  message text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index generation_audit_workspace_idx
  on public.generation_audit_events (workspace_id, created_at);
create index generation_audit_run_idx
  on public.generation_audit_events (provider_run_id);

alter table public.generation_audit_events enable row level security;

create policy "generation_audit_select_member" on public.generation_audit_events
  for select using (public.is_workspace_member(workspace_id));

-- Inserts flow through the RPCs/worker (service role); no client insert.

-- ── G. Privileged RPCs ──────────────────────────────────────────────────────

-- Worker-only (service role): push env-derived limits into generation_config.
create or replace function public.sync_generation_config(
  p_enabled boolean,
  p_provider_name text,
  p_max_outputs integer,
  p_max_jobs_user integer,
  p_max_jobs_workspace integer
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.generation_config
  set image_generation_enabled = p_enabled,
      provider_name = p_provider_name,
      image_max_outputs_per_job = p_max_outputs,
      image_max_jobs_per_user_per_period = p_max_jobs_user,
      image_max_jobs_per_workspace_per_period = p_max_jobs_workspace,
      updated_at = now()
  where id = 1;
$$;

revoke execute on function public.sync_generation_config(boolean, text, integer, integer, integer) from authenticated, anon, public;

-- Eligibility evaluation shared by submit and the UI readiness checklist.
-- Returns a jsonb object: { eligible boolean, blocking text[], reason text }.
create or replace function public.evaluate_image_job_eligibility(
  p_job_id uuid,
  p_user_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := coalesce(p_user_id, auth.uid());
  v_job public.content_job_requests;
  v_blocking text[] := '{}';
  v_pin record;
  v_ref record;
  v_cfg public.generation_config;
  v_outputs_requested integer;
  v_quota_user integer;
  v_quota_workspace integer;
  v_period_start date := date_trunc('month', now())::date;
  v_period_end date := (date_trunc('month', now()) + interval '1 month - 1 day')::date;
begin
  if v_user is null then
    return jsonb_build_object('eligible', false, 'blocking', array['Authentication required.']);
  end if;

  select * into v_job from public.content_job_requests where id = p_job_id;
  if v_job.workspace_id is null then
    return jsonb_build_object('eligible', false, 'blocking', array['Job not found.']);
  end if;
  if not public.is_workspace_member(v_job.workspace_id) then
    return jsonb_build_object('eligible', false, 'blocking', array['You do not have access to this workspace.']);
  end if;

  -- Provider enabled + configured (fail closed).
  select * into v_cfg from public.generation_config where id = 1;
  if not v_cfg.image_generation_enabled or v_cfg.provider_name = 'none' then
    v_blocking := v_blocking || array['Image generation is not enabled for this deployment (provider not configured).'];
  end if;

  -- Job state: must be draft (a fresh submission) — retries go through
  -- retry_image_generation_run, which resets a failed job to draft first.
  if v_job.status <> 'draft' then
    v_blocking := v_blocking || array[format('Job status is %s; only draft jobs can be submitted.', v_job.status)];
  end if;

  -- Image-compatible output request.
  if v_job.requested_output_type not in ('photo', 'content_set') then
    v_blocking := v_blocking || array[format('Output type %s is not image-compatible in this milestone.', v_job.requested_output_type)];
  end if;

  -- Pins: at least one, every pinned version locked, model present for people.
  if not exists (select 1 from public.content_job_pins where content_job_request_id = p_job_id) then
    v_blocking := v_blocking || array['The job has no pins yet — prepare it from the Review tab first.'];
  else
    for v_pin in
      select pin_type, source_version_id, source_record_id
      from public.content_job_pins where content_job_request_id = p_job_id
    loop
      if v_pin.pin_type::text = 'model' then
        if not exists (select 1 from public.model_versions where id = v_pin.source_version_id and status = 'locked') then
          v_blocking := v_blocking || array['The pinned model version is not locked.'];
        elsif exists (
          select 1 from public.model_references r
          where r.model_version_id = v_pin.source_version_id
            and r.upload_status in ('pending', 'failed', 'deleted')
        ) then
          v_blocking := v_blocking || array['A pinned model reference upload is pending, failed or removed.'];
        end if;
      elsif v_pin.pin_type::text = 'environment' then
        if not exists (select 1 from public.environment_versions where id = v_pin.source_version_id and status = 'locked') then
          v_blocking := v_blocking || array['The pinned environment version is not locked.'];
        end if;
      else -- library_asset | look
        if not exists (
          select 1 from public.library_asset_versions v
          where v.id = v_pin.source_version_id and v.status = 'locked'
        ) then
          v_blocking := v_blocking || array['A pinned library/look version is not locked.'];
        elsif exists (
          select 1
          from public.library_asset_versions v
          join public.library_assets a on a.id = v.library_asset_id
          where v.id = v_pin.source_version_id
            and (v.rights_status <> 'confirmed' or a.status = 'archived')
        ) then
          v_blocking := v_blocking || array['A pinned library asset has unknown/restricted rights or is archived.'];
        end if;
      end if;
    end loop;
  end if;

  -- Quota (only meaningful when otherwise eligible; evaluated regardless so
  -- the UI checklist can show it).
  v_outputs_requested := v_job.requested_variants;
  select coalesce(sum(image_jobs_submitted), 0), coalesce(sum(image_outputs_requested), 0)
  into v_quota_user, v_quota_workspace
  from public.generation_quota_usage
  where workspace_id = v_job.workspace_id
    and period_start = v_period_start
    and (user_id = v_user or true);
  -- Per-user row:
  select image_jobs_submitted into v_quota_user
  from public.generation_quota_usage
  where workspace_id = v_job.workspace_id and user_id = v_user and period_start = v_period_start;
  v_quota_user := coalesce(v_quota_user, 0);

  if v_cfg.image_max_jobs_per_user_per_period is not null
     and v_quota_user + 1 > v_cfg.image_max_jobs_per_user_per_period then
    v_blocking := v_blocking || array['User generation allowance for this period is exhausted.'];
  end if;
  if v_cfg.image_max_jobs_per_workspace_per_period is not null
     and v_quota_workspace + 1 > v_cfg.image_max_jobs_per_workspace_per_period then
    v_blocking := v_blocking || array['Workspace generation allowance for this period is exhausted.'];
  end if;
  if v_outputs_requested > v_cfg.image_max_outputs_per_job then
    v_blocking := v_blocking || array[format('Requested %s outputs exceeds the per-job limit of %s.', v_outputs_requested, v_cfg.image_max_outputs_per_job)];
  end if;

  return jsonb_build_object(
    'eligible', array_length(v_blocking, 1) is null,
    'blocking', to_jsonb(v_blocking),
    'outputs_requested', v_outputs_requested
  );
end;
$$;

revoke execute on function public.evaluate_image_job_eligibility(uuid, uuid) from anon;

-- Submission: creates the provider run (idempotent) after full eligibility.
-- Returns jsonb: { run_id, idempotency_key, eligible, blocking }.
create or replace function public.submit_image_generation_run(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_job public.content_job_requests;
  v_eval jsonb;
  v_existing public.generation_provider_runs;
  v_run_id uuid;
  v_key text;
  v_provider text;
begin
  if v_user is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select * into v_job from public.content_job_requests where id = p_job_id;
  if v_job.workspace_id is null or not public.is_workspace_member(v_job.workspace_id) then
    raise exception 'You do not have access to this workspace.' using errcode = '42501';
  end if;

  -- Idempotency: an active run for this job wins over a new attempt.
  select * into v_existing
  from public.generation_provider_runs
  where content_job_request_id = p_job_id
    and status in ('created', 'submitted', 'queued', 'processing')
  order by created_at desc
  limit 1;
  if v_existing.id is not null then
    return jsonb_build_object(
      'run_id', v_existing.id,
      'idempotency_key', v_existing.idempotency_key,
      'eligible', true,
      'blocking', '[]'::jsonb,
      'reused', true
    );
  end if;

  v_eval := public.evaluate_image_job_eligibility(p_job_id, v_user);
  if not (v_eval ->> 'eligible')::boolean then
    insert into public.generation_audit_events (
      workspace_id, content_job_request_id, actor_id, event_type, message, metadata
    ) values (
      v_job.workspace_id, p_job_id, v_user, 'eligibility_failed',
      'Submission blocked by eligibility checks', jsonb_build_object('blocking', v_eval -> 'blocking')
    );
    return jsonb_build_object('run_id', null, 'eligible', false, 'blocking', v_eval -> 'blocking');
  end if;

  select provider_name into v_provider from public.generation_config where id = 1;
  v_key := 'imgjob:' || p_job_id || ':attempt:' || (
    coalesce((
      select max(attempt_number) from public.generation_provider_runs
      where content_job_request_id = p_job_id
    ), 0) + 1
  );

  insert into public.generation_provider_runs (
    workspace_id, content_job_request_id, created_by, provider_name,
    idempotency_key, status, request_snapshot
  ) values (
    v_job.workspace_id, p_job_id, v_user, v_provider,
    v_key, 'created',
    jsonb_build_object(
      'job_id', p_job_id,
      'requested_output_type', v_job.requested_output_type,
      'requested_variants', v_job.requested_variants,
      'brief_snapshot', v_job.brief_snapshot,
      'plan_snapshot', v_job.plan_snapshot
    )
  )
  returning id into v_run_id;

  insert into public.generation_quota_usage (
    workspace_id, user_id, period_start, period_end,
    image_jobs_submitted, image_outputs_requested
  ) values (
    v_job.workspace_id, v_user,
    date_trunc('month', now())::date,
    (date_trunc('month', now()) + interval '1 month - 1 day')::date,
    1, v_job.requested_variants
  )
  on conflict (workspace_id, user_id, period_start) do update
    set image_jobs_submitted = generation_quota_usage.image_jobs_submitted + 1,
        image_outputs_requested = generation_quota_usage.image_outputs_requested + excluded.image_outputs_requested,
        updated_at = now();

  insert into public.generation_audit_events (
    workspace_id, content_job_request_id, provider_run_id, actor_id,
    event_type, message, metadata
  ) values (
    v_job.workspace_id, p_job_id, v_run_id, v_user,
    'provider_run_created', 'Provider run created (awaiting worker submission).',
    jsonb_build_object('idempotency_key', v_key, 'provider', v_provider)
  );

  return jsonb_build_object('run_id', v_run_id, 'idempotency_key', v_key, 'eligible', true, 'blocking', '[]'::jsonb);
end;
$$;

-- Retry: a failed job returns to draft (guarded transition failed->draft),
-- then a fresh submission appends a new attempt reusing the same pins.
create or replace function public.retry_image_generation_run(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_job public.content_job_requests;
  v_last public.generation_provider_runs;
begin
  if v_user is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  select * into v_job from public.content_job_requests where id = p_job_id;
  if v_job.workspace_id is null or not public.is_workspace_member(v_job.workspace_id) then
    raise exception 'You do not have access to this workspace.' using errcode = '42501';
  end if;

  select * into v_last
  from public.generation_provider_runs
  where content_job_request_id = p_job_id
  order by created_at desc limit 1;

  if v_last.id is null or v_last.status <> 'failed' then
    raise exception 'Retry is only available for failed generation runs.' using errcode = 'check_violation';
  end if;

  insert into public.generation_audit_events (
    workspace_id, content_job_request_id, provider_run_id, actor_id,
    event_type, message
  ) values (
    v_job.workspace_id, p_job_id, v_last.id, v_user,
    'retry_requested', format('Retry requested after attempt %s failed.', v_last.attempt_number)
  );

  -- Reset the failed job to draft so submit's state check passes (the DB
  -- state machine allows failed->draft). Snapshots stay immutable.
  update public.content_job_requests set status = 'draft' where id = p_job_id;

  return public.submit_image_generation_run(p_job_id);
end;
$$;

-- Workspace-scoped run status for UI polling (read-only).
create or replace function public.get_generation_run_status(p_job_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_workspace uuid;
  v_run public.generation_provider_runs;
  v_outputs integer;
begin
  select workspace_id into v_workspace from public.content_job_requests where id = p_job_id;
  if v_workspace is null or not public.is_workspace_member(v_workspace) then
    raise exception 'You do not have access to this workspace.' using errcode = '42501';
  end if;

  select * into v_run
  from public.generation_provider_runs
  where content_job_request_id = p_job_id
  order by created_at desc limit 1;

  select count(*) into v_outputs
  from public.gallery_outputs
  where content_job_request_id = p_job_id
    and generation_provider_run_id = v_run.id;

  return jsonb_build_object(
    'run_found', v_run.id is not null,
    'run_id', v_run.id,
    'status', v_run.status::text,
    'provider_name', v_run.provider_name,
    'attempt_number', v_run.attempt_number,
    'error_code', v_run.error_code,
    'error_message', v_run.error_message,
    'outputs_ready', v_outputs,
    'started_at', v_run.started_at,
    'completed_at', v_run.completed_at
  );
end;
$$;

grant execute on function public.evaluate_image_job_eligibility(uuid, uuid) to authenticated;
grant execute on function public.submit_image_generation_run(uuid) to authenticated;
grant execute on function public.retry_image_generation_run(uuid) to authenticated;
grant execute on function public.get_generation_run_status(uuid) to authenticated;
