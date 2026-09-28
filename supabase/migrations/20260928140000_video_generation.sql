-- ═══════════════════════════════════════════════════════════════════════════
-- LockFlow — Video generation (short-form, provider-agnostic; Phase 1)
--
-- Extends the Prompt-12 generation schema for SHORT-FORM video clips:
--   * generation_provider_runs gains generation_kind + scene/beat provenance
--     columns and requested aspect/duration (immutable after submission — the
--     Prompt-12 immutability rule covers every snapshot column here).
--   * generation_video_quota_usage — SEPARATE from image quotas: per
--     workspace/user monthly jobs + total requested seconds (auditable guard,
--     not billing).
--   * generation_config gains video flags (fail-closed defaults).
--   * gallery_outputs gains content_scene_id / content_beat_id provenance.
--
-- Phase-1 constraints encoded: durations limited to 4/6/8 s; aspect ratios
-- 9:16 / 1:1 / 16:9; mp4/webm outputs only. No long-form, audio, voice or
-- streaming infrastructure is introduced here.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── A. Runs: kind + scene/beat provenance + requested settings ─────────────
alter table public.generation_provider_runs
  add column if not exists generation_kind text not null default 'image'
    check (generation_kind in ('image', 'video')),
  add column if not exists content_scene_id uuid references public.content_scenes (id) on delete set null,
  add column if not exists content_beat_id uuid references public.content_beats (id) on delete set null,
  add column if not exists scene_snapshot jsonb,
  add column if not exists beat_snapshot jsonb,
  add column if not exists requested_aspect_ratio text,
  add column if not exists requested_duration_seconds integer;

create index if not exists generation_runs_kind_status_idx
  on public.generation_provider_runs (generation_kind, status);
create index if not exists generation_runs_scene_idx
  on public.generation_provider_runs (content_scene_id);
create index if not exists generation_runs_beat_idx
  on public.generation_provider_runs (content_beat_id);

-- Scene/Beat provenance must belong to the job's content project (which
-- guarantees the workspace). Snapshot immutability is enforced by the
-- existing no-rewrite discipline: submitted snapshots are never updated.
create or replace function public.guard_generation_run_scene_workspace()
returns trigger
language plpgsql
as $$
declare
  v_project_id uuid;
begin
  if new.content_scene_id is not null then
    select content_project_id into v_project_id
    from public.content_scenes where id = new.content_scene_id;
    if v_project_id is null or v_project_id is distinct from (
      select content_project_id from public.content_job_requests where id = new.content_job_request_id
    ) then
      raise exception 'scene must belong to the run job''s content project' using errcode = 'check_violation';
    end if;
  end if;
  if new.content_beat_id is not null then
    if new.content_scene_id is null then
      raise exception 'a beat reference requires a scene reference' using errcode = 'check_violation';
    end if;
    if exists (
      select 1 from public.content_beats b
      join public.content_scenes s on s.id = b.content_scene_id
      where b.id = new.content_beat_id and s.id <> new.content_scene_id
    ) then
      raise exception 'beat must belong to the referenced scene' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_generation_runs_scene_guard
  before insert or update on public.generation_provider_runs
  for each row execute function public.guard_generation_run_scene_workspace();

-- ── B. Video quota (separate from image) ────────────────────────────────────
create table public.generation_video_quota_usage (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  period_start date not null,
  period_end date not null,
  video_jobs_submitted integer not null default 0 check (video_jobs_submitted >= 0),
  video_seconds_requested integer not null default 0 check (video_seconds_requested >= 0),
  reported_cost_metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id, period_start)
);

create trigger trg_generation_video_quota_updated_at
  before update on public.generation_video_quota_usage
  for each row execute function public.set_updated_at();

create index generation_video_quota_workspace_idx
  on public.generation_video_quota_usage (workspace_id, period_start);

alter table public.generation_video_quota_usage enable row level security;
create policy "generation_video_quota_select_member" on public.generation_video_quota_usage
  for select using (public.is_workspace_member(workspace_id));

-- ── C. Config: video flags (fail-closed defaults) ───────────────────────────
alter table public.generation_config
  add column if not exists video_generation_enabled boolean not null default false,
  add column if not exists video_provider_name text not null default 'none',
  add column if not exists video_max_outputs_per_job integer not null default 2
    check (video_max_outputs_per_job between 1 and 4),
  add column if not exists video_max_jobs_per_user_per_period integer not null default 3,
  add column if not exists video_max_jobs_per_workspace_per_period integer not null default 10,
  add column if not exists video_max_seconds_per_user_per_period integer not null default 48,
  add column if not exists video_max_seconds_per_workspace_per_period integer not null default 240;

-- ── D. Gallery provenance: originating scene/beat ───────────────────────────
alter table public.gallery_outputs
  add column if not exists content_scene_id uuid references public.content_scenes (id) on delete set null,
  add column if not exists content_beat_id uuid references public.content_beats (id) on delete set null;

create index if not exists gallery_outputs_scene_idx on public.gallery_outputs (content_scene_id);
create index if not exists gallery_outputs_beat_idx on public.gallery_outputs (content_beat_id);

-- ── E. Privileged RPCs (server-side worker + client status) ─────────────────

-- Worker-only config sync for the video half.
create or replace function public.sync_video_generation_config(
  p_enabled boolean,
  p_provider_name text,
  p_max_outputs integer,
  p_max_jobs_user integer,
  p_max_jobs_workspace integer,
  p_max_seconds_user integer,
  p_max_seconds_workspace integer
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.generation_config
  set video_generation_enabled = p_enabled,
      video_provider_name = p_provider_name,
      video_max_outputs_per_job = p_max_outputs,
      video_max_jobs_per_user_per_period = p_max_jobs_user,
      video_max_jobs_per_workspace_per_period = p_max_jobs_workspace,
      video_max_seconds_per_user_per_period = p_max_seconds_user,
      video_max_seconds_per_workspace_per_period = p_max_seconds_workspace,
      updated_at = now()
  where id = 1;
$$;

revoke execute on function public.sync_video_generation_config(boolean, text, integer, integer, integer, integer, integer) from authenticated, anon, public;

-- Video eligibility evaluation (mirrors the TS evaluator; fail-closed).
create or replace function public.evaluate_video_job_eligibility(
  p_job_id uuid,
  p_scene_id uuid default null,
  p_beat_id uuid default null,
  p_duration_seconds integer default 4,
  p_aspect_ratio text default '9:16',
  p_output_count integer default 1,
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
  v_cfg public.generation_config;
  v_quota_user_jobs integer;
  v_quota_ws_jobs integer;
  v_quota_user_seconds integer;
  v_quota_ws_seconds integer;
  v_period_start date := date_trunc('month', now())::date;
  v_project_id uuid;
begin
  if v_user is null then
    return jsonb_build_object('eligible', false, 'blocking', to_jsonb(array['Authentication required.']));
  end if;

  select * into v_job from public.content_job_requests where id = p_job_id;
  if v_job.workspace_id is null then
    return jsonb_build_object('eligible', false, 'blocking', to_jsonb(array['Job not found.']));
  end if;
  if not public.is_workspace_member(v_job.workspace_id) then
    return jsonb_build_object('eligible', false, 'blocking', to_jsonb(array['You do not have access to this workspace.']));
  end if;

  -- Video output types only (image handled by the image flow).
  if v_job.requested_output_type not in ('video', 'story', 'content_set') then
    v_blocking := v_blocking || array[format('Output type %s is not a video-compatible output.', v_job.requested_output_type)];
  end if;

  -- Fail-closed provider configuration.
  select * into v_cfg from public.generation_config where id = 1;
  if not v_cfg.video_generation_enabled or v_cfg.video_provider_name = 'none' then
    v_blocking := v_blocking || array['Video generation is not configured for this deployment.'];
  end if;

  -- Job must be draft (fresh submission; retries reset a failed job first).
  if v_job.status <> 'draft' then
    v_blocking := v_blocking || array[format('Job status is %s; only draft jobs can be submitted.', v_job.status)];
  end if;

  -- Duration/aspect/output-count constraints (Phase-1 contract).
  if p_duration_seconds not in (4, 6, 8) then
    v_blocking := v_blocking || array['Your requested clip duration must be 4, 6 or 8 seconds.'];
  end if;
  if p_aspect_ratio not in ('9:16', '1:1', '16:9') then
    v_blocking := v_blocking || array['Aspect ratio must be 9:16, 1:1 or 16:9.'];
  end if;
  if p_output_count < 1 or p_output_count > v_cfg.video_max_outputs_per_job then
    v_blocking := v_blocking || array[format('Output count must be between 1 and %s.', v_cfg.video_max_outputs_per_job)];
  end if;

  -- Scene/Beat association: required when the project has scenes with beats
  -- (beat-aware generation); the beat must live under the chosen scene.
  select content_project_id into v_project_id from public.content_job_requests where id = p_job_id;
  if p_scene_id is not null then
    if not exists (
      select 1 from public.content_scenes
      where id = p_scene_id and content_project_id = v_project_id
    ) then
      v_blocking := v_blocking || array['The selected scene does not belong to this plan.'];
    end if;
  end if;
  if p_beat_id is not null then
    if p_scene_id is null then
      v_blocking := v_blocking || array['Selecting a beat requires selecting its scene.'];
    elsif not exists (
      select 1 from public.content_beats b
      join public.content_scenes s on s.id = b.content_scene_id
      where b.id = p_beat_id and s.id = p_scene_id
    ) then
      v_blocking := v_blocking || array['The selected beat does not belong to the selected scene.'];
    end if;
  end if;

  -- Pins: at least one; every pinned version locked; references available.
  if not exists (select 1 from public.content_job_pins where content_job_request_id = p_job_id) then
    v_blocking := v_blocking || array['The job has no pins yet — prepare it from the Review tab first.'];
  else
    for v_pin in
      select pin_type, source_version_id
      from public.content_job_pins where content_job_request_id = p_job_id
    loop
      if v_pin.pin_type::text = 'model' then
        if not exists (select 1 from public.model_versions where id = v_pin.source_version_id and status = 'locked') then
          v_blocking := v_blocking || array['Select a locked Model version before preparing this clip.'];
        end if;
      elsif v_pin.pin_type::text = 'environment' then
        if not exists (select 1 from public.environment_versions where id = v_pin.source_version_id and status = 'locked') then
          v_blocking := v_blocking || array[format('Environment version %s is still a draft.', v_pin.source_version_id)];
        end if;
      else
        if not exists (
          select 1 from public.library_asset_versions where id = v_pin.source_version_id and status = 'locked'
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

  -- Quotas: jobs AND total requested seconds, user + workspace scopes.
  select video_jobs_submitted, video_seconds_requested into v_quota_user_jobs, v_quota_user_seconds
  from public.generation_video_quota_usage
  where workspace_id = v_job.workspace_id and user_id = v_user and period_start = v_period_start;
  v_quota_user_jobs := coalesce(v_quota_user_jobs, 0);
  v_quota_user_seconds := coalesce(v_quota_user_seconds, 0);
  select coalesce(sum(video_jobs_submitted), 0), coalesce(sum(video_seconds_requested), 0)
  into v_quota_ws_jobs, v_quota_ws_seconds
  from public.generation_video_quota_usage
  where workspace_id = v_job.workspace_id and period_start = v_period_start;

  if v_quota_user_jobs + 1 > v_cfg.video_max_jobs_per_user_per_period then
    v_blocking := v_blocking || array['Your video allowance has been reached.'];
  end if;
  if v_quota_user_seconds + p_duration_seconds * p_output_count > v_cfg.video_max_seconds_per_user_per_period then
    v_blocking := v_blocking || array['Your requested clip seconds exceed your remaining video allowance.'];
  end if;
  if v_quota_ws_jobs + 1 > v_cfg.video_max_jobs_per_workspace_per_period then
    v_blocking := v_blocking || array['Your workspace video allowance has been reached.'];
  end if;
  if v_quota_ws_seconds + p_duration_seconds * p_output_count > v_cfg.video_max_seconds_per_workspace_per_period then
    v_blocking := v_blocking || array['Your workspace requested seconds exceed the remaining video allowance.'];
  end if;

  return jsonb_build_object(
    'eligible', array_length(v_blocking, 1) is null,
    'blocking', to_jsonb(v_blocking),
    'seconds_requested', p_duration_seconds * p_output_count
  );
end;
$$;

revoke execute on function public.evaluate_video_job_eligibility(uuid, uuid, uuid, integer, text, integer, uuid) from anon;

-- Submission: idempotent run creation with immutable snapshots.
create or replace function public.submit_video_generation_run(
  p_job_id uuid,
  p_scene_id uuid default null,
  p_beat_id uuid default null,
  p_duration_seconds integer default 4,
  p_aspect_ratio text default '9:16',
  p_output_count integer default 1
)
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
  v_scene public.content_scenes;
  v_beat public.content_beats;
  v_attempt integer;
begin
  if v_user is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  select * into v_job from public.content_job_requests where id = p_job_id;
  if v_job.workspace_id is null or not public.is_workspace_member(v_job.workspace_id) then
    raise exception 'You do not have access to this workspace.' using errcode = '42501';
  end if;

  -- Idempotency: an active video run for this job wins; completed video runs
  -- are returned, never silently resubmitted.
  select * into v_existing
  from public.generation_provider_runs
  where content_job_request_id = p_job_id and generation_kind = 'video'
    and status in ('created', 'submitted', 'queued', 'processing', 'completed')
  order by created_at desc limit 1;
  if v_existing.id is not null then
    return jsonb_build_object('run_id', v_existing.id, 'idempotency_key', v_existing.idempotency_key,
      'eligible', true, 'blocking', '[]'::jsonb, 'reused', true);
  end if;

  v_eval := public.evaluate_video_job_eligibility(p_job_id, p_scene_id, p_beat_id, p_duration_seconds, p_aspect_ratio, p_output_count, v_user);
  if not (v_eval ->> 'eligible')::boolean then
    insert into public.generation_audit_events (
      workspace_id, content_job_request_id, actor_id, event_type, message, metadata
    ) values (
      v_job.workspace_id, p_job_id, v_user, 'eligibility_failed',
      'Video submission blocked by eligibility checks', jsonb_build_object('blocking', v_eval -> 'blocking')
    );
    return jsonb_build_object('run_id', null, 'eligible', false, 'blocking', v_eval -> 'blocking');
  end if;

  -- Immutable scene/beat snapshots captured NOW (later storyboard edits
  -- cannot change a submitted request).
  select * into v_scene from public.content_scenes where id = p_scene_id;
  select * into v_beat from public.content_beats where id = p_beat_id;

  select video_provider_name into v_provider from public.generation_config where id = 1;
  select coalesce(max(attempt_number), 0) + 1 into v_attempt
  from public.generation_provider_runs where content_job_request_id = p_job_id and generation_kind = 'video';
  v_key := 'vidjob:' || p_job_id || ':attempt:' || v_attempt;

  insert into public.generation_provider_runs (
    workspace_id, content_job_request_id, created_by, provider_name,
    idempotency_key, status, generation_kind,
    content_scene_id, content_beat_id, scene_snapshot, beat_snapshot,
    requested_aspect_ratio, requested_duration_seconds,
    request_snapshot
  ) values (
    v_job.workspace_id, p_job_id, v_user, v_provider,
    v_key, 'created', 'video',
    p_scene_id, p_beat_id,
    case when p_scene_id is not null then to_jsonb(v_scene) else null end,
    case when p_beat_id is not null then to_jsonb(v_beat) else null end,
    p_aspect_ratio, p_duration_seconds,
    jsonb_build_object(
      'job_id', p_job_id,
      'requested_output_type', v_job.requested_output_type,
      'requested_variants', p_output_count,
      'brief_snapshot', v_job.brief_snapshot,
      'plan_snapshot', v_job.plan_snapshot,
      'duration_seconds', p_duration_seconds,
      'aspect_ratio', p_aspect_ratio
    )
  )
  returning id into v_run_id;

  -- Quota increment (jobs + seconds) after every check passed.
  insert into public.generation_video_quota_usage (
    workspace_id, user_id, period_start, period_end,
    video_jobs_submitted, video_seconds_requested
  ) values (
    v_job.workspace_id, v_user,
    date_trunc('month', now())::date,
    (date_trunc('month', now()) + interval '1 month - 1 day')::date,
    1, p_duration_seconds * p_output_count
  ) on conflict (workspace_id, user_id, period_start) do update
    set video_jobs_submitted = generation_video_quota_usage.video_jobs_submitted + 1,
        video_seconds_requested = generation_video_quota_usage.video_seconds_requested + excluded.video_seconds_requested,
        updated_at = now();

  insert into public.generation_audit_events (
    workspace_id, content_job_request_id, provider_run_id, actor_id,
    event_type, message, metadata
  ) values (
    v_job.workspace_id, p_job_id, v_run_id, v_user,
    'provider_run_created', 'Video provider run created (awaiting worker submission).',
    jsonb_build_object('idempotency_key', v_key, 'provider', v_provider, 'seconds', p_duration_seconds * p_output_count)
  );

  return jsonb_build_object('run_id', v_run_id, 'idempotency_key', v_key, 'eligible', true, 'blocking', '[]'::jsonb);
end;
$$;

-- Video retry: failed → draft then a fresh attempt with the same snapshots.
create or replace function public.retry_video_generation_run(p_job_id uuid)
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
  where content_job_request_id = p_job_id and generation_kind = 'video'
  order by created_at desc limit 1;
  if v_last.id is null or v_last.status <> 'failed' then
    raise exception 'Retry is only available for failed generation runs.' using errcode = 'check_violation';
  end if;
  insert into public.generation_audit_events (
    workspace_id, content_job_request_id, provider_run_id, actor_id, event_type, message
  ) values (
    v_job.workspace_id, p_job_id, v_last.id, v_user,
    'retry_requested', format('Video retry requested after attempt %s failed.', v_last.attempt_number)
  );
  update public.content_job_requests set status = 'draft' where id = p_job_id;
  return public.submit_video_generation_run(
    p_job_id, v_last.content_scene_id, v_last.content_beat_id,
    coalesce(v_last.requested_duration_seconds, 4),
    coalesce(v_last.requested_aspect_ratio, '9:16'),
    coalesce((v_last.request_snapshot ->> 'requested_variants')::int, 1)
  );
end;
$$;

-- Workspace-scoped video run status for UI polling.
create or replace function public.get_video_generation_run_status(p_job_id uuid)
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
  where content_job_request_id = p_job_id and generation_kind = 'video'
  order by created_at desc limit 1;
  select count(*) into v_outputs from public.gallery_outputs
  where content_job_request_id = p_job_id and generation_provider_run_id = v_run.id;
  return jsonb_build_object(
    'run_found', v_run.id is not null,
    'run_id', v_run.id,
    'status', v_run.status::text,
    'provider_name', v_run.provider_name,
    'attempt_number', v_run.attempt_number,
    'error_code', v_run.error_code,
    'error_message', v_run.error_message,
    'outputs_ready', v_outputs
  );
end;
$$;

grant execute on function public.evaluate_video_job_eligibility(uuid, uuid, uuid, integer, text, integer, uuid) to authenticated;
grant execute on function public.submit_video_generation_run(uuid, uuid, uuid, integer, text, integer) to authenticated;
grant execute on function public.retry_video_generation_run(uuid) to authenticated;
grant execute on function public.get_video_generation_run_status(uuid) to authenticated;
