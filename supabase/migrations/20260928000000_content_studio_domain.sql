-- ═══════════════════════════════════════════════════════════════════════════
-- LockFlow — Content Studio data foundation
-- content_projects, content_project_inputs, content_scenes, content_beats,
-- content_job_requests, content_job_pins, content_job_events
-- + RLS + structural-edit guards + pin immutability + job-state triggers.
--
-- Product rules encoded here:
--   * Content Studio assembles approved reusable inputs into content plans
--     and future generation jobs. It owns NOTHING: models, environments,
--     Library assets and Looks stay canonical and independently reusable,
--     and inputs only ever point at their canonical records.
--   * Version pinning is mandatory for execution-ready jobs. Draft-phase
--     experimentation may reference draft versions, but every pin must
--     reference a LOCKED version. Newer versions are never substituted.
--   * Scene and Beat order is explicit and unique per parent; edits are only
--     allowed while the parent project is draft.
--   * content_job_pins are immutable once a job leaves draft;
--     content_job_events are an append-only audit timeline.
--   * No generation happens in this phase: queued/processing/review are
--     unreachable without a provider integration (service-layer boundary;
--     the trigger here additionally refuses them while provider_name is null).
--   * Generated outputs belong in Gallery — never in these tables.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Enums ───────────────────────────────────────────────────────────────────
create type public.content_project_status as enum ('draft', 'ready', 'archived');
create type public.content_input_type as enum ('model', 'environment', 'library_asset', 'look');
create type public.content_input_role as enum (
  'primary_model', 'environment', 'look', 'product', 'prop', 'wardrobe',
  'accessory', 'creator_tool', 'brand_asset', 'reference', 'other'
);
create type public.content_output_type as enum ('photo', 'video', 'story', 'content_set');
create type public.content_job_status as enum (
  'draft', 'queued', 'processing', 'review', 'completed', 'failed', 'cancelled'
);

-- ── A. Content projects (plans / working briefs) ────────────────────────────
create table public.content_projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  status content_project_status not null default 'draft',
  campaign_brief text,
  objective text,
  audience text,
  brand_voice text,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, slug)
);

create index content_projects_workspace_idx on public.content_projects (workspace_id);

create trigger trg_content_projects_updated_at
  before update on public.content_projects
  for each row execute function public.set_updated_at();

-- ── B. Project inputs (planned selections while drafting) ───────────────────
create table public.content_project_inputs (
  id uuid primary key default gen_random_uuid(),
  content_project_id uuid not null references public.content_projects (id) on delete cascade,
  input_type content_input_type not null,
  model_id uuid references public.models (id) on delete cascade,
  model_version_id uuid references public.model_versions (id) on delete cascade,
  environment_id uuid references public.environments (id) on delete cascade,
  environment_version_id uuid references public.environment_versions (id) on delete cascade,
  library_asset_id uuid references public.library_assets (id) on delete cascade,
  library_asset_version_id uuid references public.library_asset_versions (id) on delete cascade,
  role content_input_role not null default 'other',
  sort_order integer not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index content_project_inputs_project_idx
  on public.content_project_inputs (content_project_id, sort_order);

create trigger trg_content_project_inputs_updated_at
  before update on public.content_project_inputs
  for each row execute function public.set_updated_at();

-- Exactly one valid target per record, according to input_type, and every
-- referenced record must live in the same workspace as the project
-- (no permanent model ↔ environment relationship is created by this design).
create function public.guard_content_input_shape()
returns trigger
language plpgsql
as $$
declare
  v_project_workspace uuid;
  v_record_workspace uuid;
begin
  select workspace_id into v_project_workspace
  from public.content_projects where id = new.content_project_id;
  if v_project_workspace is null then
    raise exception 'content project not found' using errcode = 'P0002';
  end if;

  if new.input_type = 'model' then
    if new.model_id is null or new.model_version_id is null
       or new.environment_id is not null or new.environment_version_id is not null
       or new.library_asset_id is not null or new.library_asset_version_id is not null then
      raise exception 'model inputs require model_id + model_version_id and no other targets'
        using errcode = 'check_violation';
    end if;
    select workspace_id into v_record_workspace from public.models where id = new.model_id;
    if v_record_workspace is null or v_record_workspace <> v_project_workspace then
      raise exception 'model must belong to the same workspace as the content project'
        using errcode = 'check_violation';
    end if;
    if not exists (
      select 1 from public.model_versions v
      where v.id = new.model_version_id and v.model_id = new.model_id
    ) then
      raise exception 'model version does not belong to the selected model'
        using errcode = 'check_violation';
    end if;

  elsif new.input_type = 'environment' then
    if new.environment_id is null or new.environment_version_id is null
       or new.model_id is not null or new.model_version_id is not null
       or new.library_asset_id is not null or new.library_asset_version_id is not null then
      raise exception 'environment inputs require environment_id + environment_version_id and no other targets'
        using errcode = 'check_violation';
    end if;
    select workspace_id into v_record_workspace from public.environments where id = new.environment_id;
    if v_record_workspace is null or v_record_workspace <> v_project_workspace then
      raise exception 'environment must belong to the same workspace as the content project'
        using errcode = 'check_violation';
    end if;
    if not exists (
      select 1 from public.environment_versions v
      where v.id = new.environment_version_id and v.environment_id = new.environment_id
    ) then
      raise exception 'environment version does not belong to the selected environment'
        using errcode = 'check_violation';
    end if;

  else -- library_asset | look
    if new.library_asset_id is null or new.library_asset_version_id is null
       or new.model_id is not null or new.model_version_id is not null
       or new.environment_id is not null or new.environment_version_id is not null then
      raise exception 'library/look inputs require library_asset_id + library_asset_version_id and no other targets'
        using errcode = 'check_violation';
    end if;
    select workspace_id into v_record_workspace from public.library_assets where id = new.library_asset_id;
    if v_record_workspace is null or v_record_workspace <> v_project_workspace then
      raise exception 'library asset must belong to the same workspace as the content project'
        using errcode = 'check_violation';
    end if;
    if not exists (
      select 1 from public.library_asset_versions v
      where v.id = new.library_asset_version_id and v.library_asset_id = new.library_asset_id
    ) then
      raise exception 'library asset version does not belong to the selected asset'
        using errcode = 'check_violation';
    end if;
    if new.input_type = 'look' then
      if not exists (
        select 1 from public.library_assets
        where id = new.library_asset_id and asset_type = 'look'
      ) then
        raise exception 'look inputs must select a look-type library asset'
          using errcode = 'check_violation';
      end if;
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_content_input_shape_guard
  before insert or update on public.content_project_inputs
  for each row execute function public.guard_content_input_shape();

-- ── C. Scenes ───────────────────────────────────────────────────────────────
create table public.content_scenes (
  id uuid primary key default gen_random_uuid(),
  content_project_id uuid not null references public.content_projects (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  purpose text,
  scene_order integer not null,
  setting_notes text,
  shot_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (content_project_id, scene_order) deferrable initially deferred
);

create index content_scenes_project_idx on public.content_scenes (content_project_id, scene_order);

create trigger trg_content_scenes_updated_at
  before update on public.content_scenes
  for each row execute function public.set_updated_at();

-- ── D. Beats (editable only while the parent project is draft) ──────────────
create table public.content_beats (
  id uuid primary key default gen_random_uuid(),
  content_scene_id uuid not null references public.content_scenes (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  beat_order integer not null,
  action_description text,
  dialogue_or_overlay text,
  camera_direction text,
  duration_seconds numeric check (duration_seconds is null or duration_seconds >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (content_scene_id, beat_order) deferrable initially deferred
);

create index content_beats_scene_idx on public.content_beats (content_scene_id, beat_order);

create trigger trg_content_beats_updated_at
  before update on public.content_beats
  for each row execute function public.set_updated_at();

-- Structural edit guard: inputs, scenes and beats can only change while the
-- parent project is draft. (Scene order rewrites are excluded — the unique
-- constraint is deferred and reorder operates on scene_order directly.)
create function public.guard_content_project_draft_edits()
returns trigger
language plpgsql
as $$
declare
  v_project_id uuid;
  v_status content_project_status;
begin
  if tg_table_name = 'content_project_inputs' then
    v_project_id := new.content_project_id;
  elsif tg_table_name = 'content_scenes' then
    v_project_id := new.content_project_id;
    -- Allow pure reorder updates (only scene_order changed).
    if tg_op = 'UPDATE' and new.title = old.title and new.purpose is not distinct from old.purpose
       and new.setting_notes is not distinct from old.setting_notes
       and new.shot_notes is not distinct from old.shot_notes
       and new.scene_order is distinct from old.scene_order then
      return new;
    end if;
  else -- content_beats
    select s.content_project_id into v_project_id
    from public.content_scenes s where s.id = new.content_scene_id;
    -- Allow pure reorder updates (only beat_order changed).
    if tg_op = 'UPDATE' and new.title = old.title
       and new.action_description is not distinct from old.action_description
       and new.dialogue_or_overlay is not distinct from old.dialogue_or_overlay
       and new.camera_direction is not distinct from old.camera_direction
       and new.duration_seconds is not distinct from old.duration_seconds
       and new.beat_order is distinct from old.beat_order then
      return new;
    end if;
  end if;

  select status into v_status from public.content_projects where id = v_project_id;
  if v_status is null then
    raise exception 'content project not found' using errcode = 'P0002';
  end if;
  if v_status <> 'draft' then
    raise exception 'content project is % and cannot be structurally edited', v_status
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger trg_content_project_inputs_draft_guard
  before insert or update or delete on public.content_project_inputs
  for each row execute function public.guard_content_project_draft_edits();

create trigger trg_content_scenes_draft_guard
  before insert or update or delete on public.content_scenes
  for each row execute function public.guard_content_project_draft_edits();

create trigger trg_content_beats_draft_guard
  before insert or update or delete on public.content_beats
  for each row execute function public.guard_content_project_draft_edits();

-- ── E. Job requests (future generation requests; drafts only in this phase) ─
create table public.content_job_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  content_project_id uuid references public.content_projects (id) on delete set null,
  name text not null check (char_length(name) between 1 and 120),
  requested_output_type content_output_type not null default 'photo',
  status content_job_status not null default 'draft',
  -- Historic snapshots captured at creation time; never rewritten by later
  -- project edits, and plan_snapshot becomes immutable at submission (future).
  brief_snapshot jsonb not null default '{}'::jsonb,
  plan_snapshot jsonb not null default '{}'::jsonb,
  requested_variants integer not null default 1 check (requested_variants between 1 and 10),
  provider_name text,
  provider_request_id text,
  error_code text,
  error_message text,
  submitted_at timestamptz,
  completed_at timestamptz,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index content_job_requests_workspace_idx on public.content_job_requests (workspace_id);
create index content_job_requests_project_idx on public.content_job_requests (content_project_id);

create trigger trg_content_job_requests_updated_at
  before update on public.content_job_requests
  for each row execute function public.set_updated_at();

-- Job status state machine + provider boundary. queued/processing/review imply
-- a real provider integration; they are refused while provider_name is null.
create function public.guard_content_job_status_transition()
returns trigger
language plpgsql
as $$
declare
  v_allowed text[] := array[
    'draft->queued', 'draft->cancelled',
    'queued->processing', 'queued->cancelled',
    'processing->review', 'processing->failed', 'processing->cancelled',
    'review->completed', 'review->failed',
    'failed->draft'
  ];
  v_transition text;
begin
  v_transition := old.status::text || '->' || new.status::text;
  if new.status <> old.status and not (v_transition = any (v_allowed)) then
    raise exception 'a content job cannot move from % to %', old.status, new.status
      using errcode = 'check_violation';
  end if;

  if new.status in ('queued', 'processing', 'review') and new.provider_name is null then
    raise exception 'job status % requires a provider integration (provider_name is null)'
      using errcode = 'check_violation';
  end if;

  -- Historic snapshots become immutable once the job is submitted.
  if new.status in ('queued', 'processing', 'review', 'completed', 'failed', 'cancelled')
     and (new.plan_snapshot is distinct from old.plan_snapshot
          or new.brief_snapshot is distinct from old.brief_snapshot) then
    raise exception 'job snapshots are immutable after submission' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger trg_content_job_requests_status_guard
  before update on public.content_job_requests
  for each row execute function public.guard_content_job_status_transition();

-- ── F. Job pins (immutable input snapshot) ──────────────────────────────────
create table public.content_job_pins (
  id uuid primary key default gen_random_uuid(),
  content_job_request_id uuid not null references public.content_job_requests (id) on delete cascade,
  pin_type content_input_type not null, -- model|environment|library_asset|look (+ _version semantics via naming below)
  source_record_id uuid not null,
  source_version_id uuid not null,
  -- Minimal immutable reproducibility context (names, version numbers,
  -- locked_at…). Deliberately NOT a duplicate of the source record.
  resolved_details jsonb not null default '{}'::jsonb,
  role content_input_role not null default 'other',
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index content_job_pins_request_idx
  on public.content_job_pins (content_job_request_id, sort_order);

-- Every pin must reference a LOCKED version for the job to be execution-ready.
create function public.guard_content_job_pin_locked()
returns trigger
language plpgsql
as $$
declare
  v_status text;
begin
  if new.pin_type::text like 'model%' then
    select status::text into v_status from public.model_versions where id = new.source_version_id;
  elsif new.pin_type::text like 'environment%' then
    select status::text into v_status from public.environment_versions where id = new.source_version_id;
  else
    select status::text into v_status from public.library_asset_versions where id = new.source_version_id;
  end if;

  if v_status is null then
    raise exception 'pinned version not found' using errcode = 'P0002';
  end if;
  if v_status <> 'locked' then
    raise exception 'pins must reference locked versions (got %)', v_status
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger trg_content_job_pins_locked_guard
  before insert or update on public.content_job_pins
  for each row execute function public.guard_content_job_pin_locked();

-- Pins cannot change (insert/update/delete) once the job leaves draft.
create function public.guard_content_job_pins_immutable()
returns trigger
language plpgsql
as $$
declare
  v_job_status content_job_status;
begin
  select status into v_job_status
  from public.content_job_requests where id = new.content_job_request_id;
  if v_job_status is null then
    raise exception 'content job request not found' using errcode = 'P0002';
  end if;
  if v_job_status <> 'draft' then
    raise exception 'job pins are immutable while the job is %', v_job_status
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger trg_content_job_pins_immutable_guard
  before insert or update or delete on public.content_job_pins
  for each row execute function public.guard_content_job_pins_immutable();

-- ── G. Job events (append-only audit timeline) ──────────────────────────────
create table public.content_job_events (
  id uuid primary key default gen_random_uuid(),
  content_job_request_id uuid not null references public.content_job_requests (id) on delete cascade,
  event_type text not null,
  message text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index content_job_events_request_idx
  on public.content_job_events (content_job_request_id, created_at);

-- Events are append-only: updates and deletes are refused entirely.
create function public.guard_content_job_events_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'content job events are an append-only audit timeline'
    using errcode = 'check_violation';
end;
$$;

create trigger trg_content_job_events_no_update
  before update on public.content_job_events
  for each row execute function public.guard_content_job_events_append_only();

create trigger trg_content_job_events_no_delete
  before delete on public.content_job_events
  for each row execute function public.guard_content_job_events_append_only();

-- ═══════════════════════════════════════════════════════════════════════════
-- Row-level security — workspace membership gates every path
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.content_projects enable row level security;
alter table public.content_project_inputs enable row level security;
alter table public.content_scenes enable row level security;
alter table public.content_beats enable row level security;
alter table public.content_job_requests enable row level security;
alter table public.content_job_pins enable row level security;
alter table public.content_job_events enable row level security;

-- content_projects ───────────────────────────────────────────────────────────
create policy "content_projects_select_member" on public.content_projects
  for select using (public.is_workspace_member(workspace_id));

create policy "content_projects_insert_member" on public.content_projects
  for insert with check (public.is_workspace_member(workspace_id) and auth.uid() = created_by);

create policy "content_projects_update_member" on public.content_projects
  for update using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

-- content_project_inputs (workspace via the parent project) ──────────────────
create policy "content_project_inputs_select_member" on public.content_project_inputs
  for select using (
    exists (
      select 1 from public.content_projects p
      where p.id = content_project_id and public.is_workspace_member(p.workspace_id)
    )
  );

create policy "content_project_inputs_insert_member" on public.content_project_inputs
  for insert with check (
    exists (
      select 1 from public.content_projects p
      where p.id = content_project_id and public.is_workspace_member(p.workspace_id)
    )
  );

create policy "content_project_inputs_update_member" on public.content_project_inputs
  for update using (
    exists (
      select 1 from public.content_projects p
      where p.id = content_project_id and public.is_workspace_member(p.workspace_id)
    )
  );

create policy "content_project_inputs_delete_member" on public.content_project_inputs
  for delete using (
    exists (
      select 1 from public.content_projects p
      where p.id = content_project_id and public.is_workspace_member(p.workspace_id)
    )
  );

-- content_scenes ─────────────────────────────────────────────────────────────
create policy "content_scenes_select_member" on public.content_scenes
  for select using (
    exists (
      select 1 from public.content_projects p
      where p.id = content_project_id and public.is_workspace_member(p.workspace_id)
    )
  );

create policy "content_scenes_insert_member" on public.content_scenes
  for insert with check (
    exists (
      select 1 from public.content_projects p
      where p.id = content_project_id and public.is_workspace_member(p.workspace_id)
    )
  );

create policy "content_scenes_update_member" on public.content_scenes
  for update using (
    exists (
      select 1 from public.content_projects p
      where p.id = content_project_id and public.is_workspace_member(p.workspace_id)
    )
  );

create policy "content_scenes_delete_member" on public.content_scenes
  for delete using (
    exists (
      select 1 from public.content_projects p
      where p.id = content_project_id and public.is_workspace_member(p.workspace_id)
    )
  );

-- content_beats (workspace via scene → project) ──────────────────────────────
create policy "content_beats_select_member" on public.content_beats
  for select using (
    exists (
      select 1 from public.content_scenes s
      join public.content_projects p on p.id = s.content_project_id
      where s.id = content_scene_id and public.is_workspace_member(p.workspace_id)
    )
  );

create policy "content_beats_insert_member" on public.content_beats
  for insert with check (
    exists (
      select 1 from public.content_scenes s
      join public.content_projects p on p.id = s.content_project_id
      where s.id = content_scene_id and public.is_workspace_member(p.workspace_id)
    )
  );

create policy "content_beats_update_member" on public.content_beats
  for update using (
    exists (
      select 1 from public.content_scenes s
      join public.content_projects p on p.id = s.content_project_id
      where s.id = content_scene_id and public.is_workspace_member(p.workspace_id)
    )
  );

create policy "content_beats_delete_member" on public.content_beats
  for delete using (
    exists (
      select 1 from public.content_scenes s
      join public.content_projects p on p.id = s.content_project_id
      where s.id = content_scene_id and public.is_workspace_member(p.workspace_id)
    )
  );

-- content_job_requests ───────────────────────────────────────────────────────
create policy "content_job_requests_select_member" on public.content_job_requests
  for select using (public.is_workspace_member(workspace_id));

create policy "content_job_requests_insert_member" on public.content_job_requests
  for insert with check (public.is_workspace_member(workspace_id) and auth.uid() = created_by);

create policy "content_job_requests_update_member" on public.content_job_requests
  for update using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

-- content_job_pins (workspace via the parent job) ────────────────────────────
create policy "content_job_pins_select_member" on public.content_job_pins
  for select using (
    exists (
      select 1 from public.content_job_requests j
      where j.id = content_job_request_id and public.is_workspace_member(j.workspace_id)
    )
  );

create policy "content_job_pins_insert_member" on public.content_job_pins
  for insert with check (
    exists (
      select 1 from public.content_job_requests j
      where j.id = content_job_request_id and public.is_workspace_member(j.workspace_id)
    )
  );

create policy "content_job_pins_delete_member" on public.content_job_pins
  for delete using (
    exists (
      select 1 from public.content_job_requests j
      where j.id = content_job_request_id and public.is_workspace_member(j.workspace_id)
    )
  );

-- content_job_events (workspace via the parent job; append-only by trigger) ──
create policy "content_job_events_select_member" on public.content_job_events
  for select using (
    exists (
      select 1 from public.content_job_requests j
      where j.id = content_job_request_id and public.is_workspace_member(j.workspace_id)
    )
  );

create policy "content_job_events_insert_member" on public.content_job_events
  for insert with check (
    exists (
      select 1 from public.content_job_requests j
      where j.id = content_job_request_id and public.is_workspace_member(j.workspace_id)
    )
  );
