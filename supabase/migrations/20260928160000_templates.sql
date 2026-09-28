-- ═══════════════════════════════════════════════════════════════════════════
-- LockFlow — Templates data foundation
-- content_templates, content_template_scenes, content_template_beats,
-- content_template_input_suggestions, content_template_events
-- + RLS + append-only audit + structural-order guarantees.
--
-- Product rules encoded here:
--   * Templates are reusable planning blueprints, not generated content:
--     they never create provider runs, Gallery outputs or media, and they
--     do not replace Content Studio — applying one creates a NEW draft
--     content project through the existing Content Studio service.
--   * Templates own NOTHING. The suggestions table has NO version columns
--     at all — a database-level guarantee that exact versions can never be
--     stored, resolved or pinned from a template. Concrete asset references
--     must be canonical workspace records; category suggestions need none.
--   * Scene/beat order is explicit and unique per parent (deferrable, so
--     reorder rewrites stay atomic).
--   * content_template_events are an append-only audit timeline.
--   * Phase 1: templates are private to their workspace. No sharing,
--     marketplace or cross-workspace discovery.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Enums ───────────────────────────────────────────────────────────────────
create type public.template_category as enum (
  'product_launch', 'social_series', 'product_demo', 'tutorial', 'testimonial',
  'lifestyle', 'announcement', 'seasonal', 'creator_content', 'custom'
);
create type public.template_status as enum ('draft', 'active', 'archived');
-- Shares the content_output_type enum created by 20260928000000.
create type public.template_suggestion_type as enum (
  'model', 'environment', 'look', 'library_asset_category', 'library_asset'
);
-- Shares the content_input_role enum for suggested roles.

-- ── A. Templates (reusable planning blueprints) ─────────────────────────────
create table public.content_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description text,
  category public.template_category not null,
  status public.template_status not null default 'draft',
  default_output_type public.content_output_type not null default 'photo',
  default_variants integer not null default 1 check (default_variants between 1 and 10),
  -- Structured brief copied into new projects on apply. Plain creative text
  -- only — never job pins, provider fields, media paths or signed URLs.
  brief_template jsonb not null default '{}'::jsonb,
  creative_direction text,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (workspace_id, slug)
);

create index content_templates_workspace_idx on public.content_templates (workspace_id);
create index content_templates_workspace_status_idx on public.content_templates (workspace_id, status);
create index content_templates_workspace_category_idx on public.content_templates (workspace_id, category);
create index content_templates_slug_idx on public.content_templates (workspace_id, slug);

create trigger trg_content_templates_updated_at
  before update on public.content_templates
  for each row execute function public.set_updated_at();

-- Soft archive bookkeeping: archived_at is set iff status is archived.
create function public.guard_content_template_archive()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'archived' and new.archived_at is null and old.status <> 'archived' then
    new.archived_at := now();
  elsif new.status <> 'archived' and new.archived_at is not null then
    new.archived_at := null;
  end if;
  return new;
end;
$$;

create trigger trg_content_templates_archive_guard
  before update on public.content_templates
  for each row execute function public.guard_content_template_archive();

-- ── B. Template scenes ──────────────────────────────────────────────────────
create table public.content_template_scenes (
  id uuid primary key default gen_random_uuid(),
  content_template_id uuid not null references public.content_templates (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  purpose text,
  setting_notes text,
  shot_notes text,
  scene_order integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (content_template_id, scene_order) deferrable initially deferred
);

create index content_template_scenes_template_idx
  on public.content_template_scenes (content_template_id, scene_order);

create trigger trg_content_template_scenes_updated_at
  before update on public.content_template_scenes
  for each row execute function public.set_updated_at();

-- ── C. Template beats (text guidance only; no audio-generation promise) ─────
create table public.content_template_beats (
  id uuid primary key default gen_random_uuid(),
  content_template_scene_id uuid not null references public.content_template_scenes (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  action_description text,
  dialogue_or_overlay text,
  camera_direction text,
  duration_seconds numeric check (duration_seconds is null or duration_seconds >= 0),
  beat_order integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (content_template_scene_id, beat_order) deferrable initially deferred
);

create index content_template_beats_scene_idx
  on public.content_template_beats (content_template_scene_id, beat_order);

create trigger trg_content_template_beats_updated_at
  before update on public.content_template_beats
  for each row execute function public.set_updated_at();

-- ── D. Input suggestions (NON-BINDING; no version columns by design) ────────
create table public.content_template_input_suggestions (
  id uuid primary key default gen_random_uuid(),
  content_template_id uuid not null references public.content_templates (id) on delete cascade,
  suggestion_type public.template_suggestion_type not null,
  suggested_role public.content_input_role not null default 'other',
  -- Canonical workspace record only when suggestion_type is a concrete type;
  -- NEVER an exact version id (no column exists for one).
  suggested_asset_id uuid,
  suggested_asset_type text check (char_length(suggested_asset_type) between 1 and 60),
  compatibility_notes text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index content_template_suggestions_template_idx
  on public.content_template_input_suggestions (content_template_id, sort_order);
create index content_template_suggestions_asset_idx
  on public.content_template_input_suggestions (suggested_asset_id);

create trigger trg_content_template_suggestions_updated_at
  before update on public.content_template_input_suggestions
  for each row execute function public.set_updated_at();

-- Shape guard: category suggestions carry no concrete asset; concrete
-- suggestions must carry one (same rule the service layer enforces).
create function public.guard_template_suggestion_shape()
returns trigger
language plpgsql
as $$
begin
  if new.suggestion_type = 'library_asset_category' then
    if new.suggested_asset_id is not null then
      raise exception 'category suggestions must not reference a concrete asset'
        using errcode = 'check_violation';
    end if;
  elsif new.suggested_asset_id is null then
    raise exception '% suggestions must reference a canonical workspace asset',
      new.suggestion_type
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger trg_template_suggestion_shape_guard
  before insert or update on public.content_template_input_suggestions
  for each row execute function public.guard_template_suggestion_shape();

-- Every concrete suggestion must point at a same-workspace canonical record.
-- (Applies on insert/update; suggested_asset_id has no version semantics.)
create function public.guard_template_suggestion_workspace()
returns trigger
language plpgsql
as $$
declare
  v_template_workspace uuid;
  v_record_workspace uuid;
begin
  if new.suggested_asset_id is null then
    return new;
  end if;

  select workspace_id into v_template_workspace
  from public.content_templates where id = new.content_template_id;
  if v_template_workspace is null then
    raise exception 'template not found' using errcode = 'P0002';
  end if;

  if new.suggestion_type = 'model' then
    select workspace_id into v_record_workspace from public.models where id = new.suggested_asset_id;
    if v_record_workspace is null or v_record_workspace <> v_template_workspace then
      raise exception 'suggested model must belong to the same workspace as the template'
        using errcode = 'check_violation';
    end if;
  elsif new.suggestion_type = 'environment' then
    select workspace_id into v_record_workspace from public.environments where id = new.suggested_asset_id;
    if v_record_workspace is null or v_record_workspace <> v_template_workspace then
      raise exception 'suggested environment must belong to the same workspace as the template'
        using errcode = 'check_violation';
    end if;
  else -- look | library_asset
    select workspace_id into v_record_workspace from public.library_assets where id = new.suggested_asset_id;
    if v_record_workspace is null or v_record_workspace <> v_template_workspace then
      raise exception 'suggested library asset must belong to the same workspace as the template'
        using errcode = 'check_violation';
    end if;
    if new.suggestion_type = 'look' then
      if not exists (
        select 1 from public.library_assets
        where id = new.suggested_asset_id and asset_type = 'look'
      ) then
        raise exception 'look suggestions must reference a look-type library asset'
          using errcode = 'check_violation';
      end if;
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_template_suggestion_workspace_guard
  before insert or update on public.content_template_input_suggestions
  for each row execute function public.guard_template_suggestion_workspace();

-- ── E. Template events (append-only audit timeline) ─────────────────────────
create table public.content_template_events (
  id uuid primary key default gen_random_uuid(),
  content_template_id uuid not null references public.content_templates (id) on delete cascade,
  event_type text not null check (event_type in (
    'created', 'updated', 'duplicated', 'applied', 'archived', 'restored'
  )),
  message text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index content_template_events_template_idx
  on public.content_template_events (content_template_id, created_at);

create function public.guard_content_template_events_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'content template events are an append-only audit timeline'
    using errcode = 'check_violation';
end;
$$;

create trigger trg_content_template_events_no_update
  before update on public.content_template_events
  for each row execute function public.guard_content_template_events_append_only();

create trigger trg_content_template_events_no_delete
  before delete on public.content_template_events
  for each row execute function public.guard_content_template_events_append_only();

-- ═══════════════════════════════════════════════════════════════════════════
-- Row-level security — workspace membership gates every path
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.content_templates enable row level security;
alter table public.content_template_scenes enable row level security;
alter table public.content_template_beats enable row level security;
alter table public.content_template_input_suggestions enable row level security;
alter table public.content_template_events enable row level security;

-- content_templates ──────────────────────────────────────────────────────────
create policy "content_templates_select_member" on public.content_templates
  for select using (public.is_workspace_member(workspace_id));

create policy "content_templates_insert_member" on public.content_templates
  for insert with check (public.is_workspace_member(workspace_id) and auth.uid() = created_by);

create policy "content_templates_update_member" on public.content_templates
  for update using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "content_templates_delete_member" on public.content_templates
  for delete using (public.is_workspace_member(workspace_id));

-- content_template_scenes (workspace via the parent template) ────────────────
create policy "content_template_scenes_select_member" on public.content_template_scenes
  for select using (
    exists (
      select 1 from public.content_templates t
      where t.id = content_template_id and public.is_workspace_member(t.workspace_id)
    )
  );

create policy "content_template_scenes_insert_member" on public.content_template_scenes
  for insert with check (
    exists (
      select 1 from public.content_templates t
      where t.id = content_template_id and public.is_workspace_member(t.workspace_id)
    )
  );

create policy "content_template_scenes_update_member" on public.content_template_scenes
  for update using (
    exists (
      select 1 from public.content_templates t
      where t.id = content_template_id and public.is_workspace_member(t.workspace_id)
    )
  );

create policy "content_template_scenes_delete_member" on public.content_template_scenes
  for delete using (
    exists (
      select 1 from public.content_templates t
      where t.id = content_template_id and public.is_workspace_member(t.workspace_id)
    )
  );

-- content_template_beats (workspace via scene → template) ────────────────────
create policy "content_template_beats_select_member" on public.content_template_beats
  for select using (
    exists (
      select 1 from public.content_template_scenes s
      join public.content_templates t on t.id = s.content_template_id
      where s.id = content_template_scene_id and public.is_workspace_member(t.workspace_id)
    )
  );

create policy "content_template_beats_insert_member" on public.content_template_beats
  for insert with check (
    exists (
      select 1 from public.content_template_scenes s
      join public.content_templates t on t.id = s.content_template_id
      where s.id = content_template_scene_id and public.is_workspace_member(t.workspace_id)
    )
  );

create policy "content_template_beats_update_member" on public.content_template_beats
  for update using (
    exists (
      select 1 from public.content_template_scenes s
      join public.content_templates t on t.id = s.content_template_id
      where s.id = content_template_scene_id and public.is_workspace_member(t.workspace_id)
    )
  );

create policy "content_template_beats_delete_member" on public.content_template_beats
  for delete using (
    exists (
      select 1 from public.content_template_scenes s
      join public.content_templates t on t.id = s.content_template_id
      where s.id = content_template_scene_id and public.is_workspace_member(t.workspace_id)
    )
  );

-- content_template_input_suggestions (workspace via the parent template) ─────
create policy "content_template_suggestions_select_member" on public.content_template_input_suggestions
  for select using (
    exists (
      select 1 from public.content_templates t
      where t.id = content_template_id and public.is_workspace_member(t.workspace_id)
    )
  );

create policy "content_template_suggestions_insert_member" on public.content_template_input_suggestions
  for insert with check (
    exists (
      select 1 from public.content_templates t
      where t.id = content_template_id and public.is_workspace_member(t.workspace_id)
    )
  );

create policy "content_template_suggestions_update_member" on public.content_template_input_suggestions
  for update using (
    exists (
      select 1 from public.content_templates t
      where t.id = content_template_id and public.is_workspace_member(t.workspace_id)
    )
  );

create policy "content_template_suggestions_delete_member" on public.content_template_input_suggestions
  for delete using (
    exists (
      select 1 from public.content_templates t
      where t.id = content_template_id and public.is_workspace_member(t.workspace_id)
    )
  );

-- content_template_events (workspace via the parent template; append-only) ───
create policy "content_template_events_select_member" on public.content_template_events
  for select using (
    exists (
      select 1 from public.content_templates t
      where t.id = content_template_id and public.is_workspace_member(t.workspace_id)
    )
  );

create policy "content_template_events_insert_member" on public.content_template_events
  for insert with check (
    exists (
      select 1 from public.content_templates t
      where t.id = content_template_id and public.is_workspace_member(t.workspace_id)
    )
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- Content Studio provenance — "created from template" (additive, minimal)
--
-- content_projects gains a historic, write-once provenance reference set at
-- creation time by the application service. It is informational only: the
-- template is NEVER modified by applying, and suggestions are shown as
-- read-only hints in the project's Inputs step — never auto-converted into
-- project inputs or version pins. (Template events carry the same ids.)
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.content_projects
  add column if not exists source_template_id uuid
    references public.content_templates (id) on delete set null;

alter table public.content_projects
  add column if not exists source_template_name text;

create index if not exists content_projects_source_template_idx
  on public.content_projects (source_template_id);
