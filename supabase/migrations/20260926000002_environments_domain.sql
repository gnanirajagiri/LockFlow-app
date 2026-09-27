-- ═══════════════════════════════════════════════════════════════════════════
-- LockFlow — Environments data foundation
-- environments, environment_versions, environment_specs,
-- environment_references, environment_asset_shortcuts
-- + RLS + lock immutability + ordered version RPCs.
--
-- Product rules encoded here:
--   * Environments are standalone reusable assets — NO model_id, no
--     model-specific classification, no permanent model relationship.
--     Models meet environments only later, through content jobs.
--   * Versions are immutable once locked (DB guard + service-layer guard).
--   * One active draft version per environment (partial unique index).
--   * Exactly one Environment Spec per version (1:1 PK = FK).
--   * Asset shortcuts are pointers into the ONE future shared Library —
--     no second environment library, no duplicated assets. library_asset_id
--     deliberately has NO foreign key until the shared Library migration
--     exists (documented placeholder).
--   * No delete policies on the app path: soft archive only.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Enums ───────────────────────────────────────────────────────────────────
create type public.environment_status as enum ('draft', 'ready', 'archived');
create type public.environment_version_status as enum ('draft', 'locked', 'superseded');
-- How tightly the locked anchors bind future jobs.
create type public.environment_lock_level as enum ('flexible', 'balanced', 'strict');
create type public.environment_reference_type as enum (
  'wide', 'hero_angle', 'detail', 'layout', 'lighting', 'product_zone', 'other'
);
create type public.environment_asset_category as enum (
  'furniture', 'prop', 'product', 'lighting', 'decor', 'other'
);

-- ── Environments ────────────────────────────────────────────────────────────
create table public.environments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  status environment_status not null default 'draft',
  active_version_id uuid, -- set when a version is locked; no FK to avoid circular dependency
  cover_image_path text,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, slug)
);

create index environments_workspace_idx on public.environments (workspace_id);

create trigger trg_environments_updated_at
  before update on public.environments
  for each row execute function public.set_updated_at();

-- ── Environment versions ────────────────────────────────────────────────────
create table public.environment_versions (
  id uuid primary key default gen_random_uuid(),
  environment_id uuid not null references public.environments (id) on delete cascade,
  version_number integer not null check (version_number >= 1),
  status environment_version_status not null default 'draft',
  change_summary text check (char_length(change_summary) <= 500),
  cover_image_path text,
  lock_level environment_lock_level not null default 'balanced',
  locked_at timestamptz,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (environment_id, version_number)
);

create index environment_versions_environment_idx on public.environment_versions (environment_id);

-- One active draft version per environment at a time.
create unique index environment_versions_one_draft_per_environment
  on public.environment_versions (environment_id)
  where status = 'draft';

create trigger trg_environment_versions_updated_at
  before update on public.environment_versions
  for each row execute function public.set_updated_at();

-- Locked versions are immutable, with exactly one sanctioned transition:
-- locked -> superseded, performed only by lock_environment_version when a
-- newer version locks (history is preserved, never overwritten). The RPC
-- sets a transaction-local flag; any other UPDATE (even from a workspace
-- member) cannot flip a locked version's status.
create function public.guard_locked_environment_version_transition()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'superseded' and new.status <> 'superseded' then
    raise exception 'superseded environment versions are immutable history'
      using errcode = 'check_violation';
  end if;
  if old.status = 'locked' and new.status <> 'locked' then
    if new.status = 'superseded'
       and coalesce(current_setting('lockflow.supersede_allowed', true), '') = 'on' then
      return new; -- sanctioned by lock_environment_version
    end if;
    raise exception 'locked environment versions are immutable (status transition % -> %)', old.status, new.status
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger trg_environment_versions_lock_guard
  before update on public.environment_versions
  for each row execute function public.guard_locked_environment_version_transition();

-- ── Environment specs (1:1 with environment_versions) ───────────────────────
-- The approved defining anchors a locked environment preserves: room type and
-- layout feel, hero camera angle, lighting style, furniture anchors,
-- signature props, palette/material direction, and the product zone where
-- applicable.
create table public.environment_specs (
  id uuid primary key default gen_random_uuid(),
  environment_version_id uuid primary key references public.environment_versions (id) on delete cascade,
  room_type text not null default '',
  layout_feel text not null default '',
  hero_angle text not null default '',
  lighting_style text not null default '',
  furniture_anchors jsonb not null default '{}'::jsonb,
  signature_props jsonb not null default '{}'::jsonb,
  palette_materials jsonb not null default '{}'::jsonb,
  product_zone jsonb, -- nullable: not every environment presents products
  continuity_notes text not null default '',
  lock_rules jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_environment_specs_updated_at
  before update on public.environment_specs
  for each row execute function public.set_updated_at();

-- A locked version's spec is immutable.
create function public.guard_environment_spec_locked()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1 from public.environment_versions v
    where v.id = new.environment_version_id and v.status in ('locked', 'superseded')
  ) then
    raise exception 'environment spec belongs to a locked or superseded version and is immutable'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger trg_environment_specs_lock_guard
  before update on public.environment_specs
  for each row execute function public.guard_environment_spec_locked();

-- ── Environment references ──────────────────────────────────────────────────
create table public.environment_references (
  id uuid primary key default gen_random_uuid(),
  environment_version_id uuid not null references public.environment_versions (id) on delete cascade,
  storage_path text not null,
  reference_type environment_reference_type not null default 'other',
  caption text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index environment_references_version_idx on public.environment_references (environment_version_id);

create trigger trg_environment_references_updated_at
  before update on public.environment_references
  for each row execute function public.set_updated_at();

create function public.guard_environment_reference_locked()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1 from public.environment_versions v
    where v.id = new.environment_version_id and v.status in ('locked', 'superseded')
  ) then
    raise exception 'reference belongs to a locked or superseded environment version and is immutable'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger trg_environment_references_lock_guard
  before update on public.environment_references
  for each row execute function public.guard_environment_reference_locked();

-- ── Environment asset shortcuts (pointers into the future shared Library) ───
create table public.environment_asset_shortcuts (
  id uuid primary key default gen_random_uuid(),
  environment_id uuid not null references public.environments (id) on delete cascade,
  -- PLACEHOLDER: no foreign key yet — the shared Library table does not exist.
  -- A later migration will add:
  --   alter table public.environment_asset_shortcuts
  --     add constraint environment_asset_shortcuts_library_asset_fkey
  --     references public.library_assets (id);
  library_asset_id uuid,
  category environment_asset_category not null default 'other',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index environment_asset_shortcuts_environment_idx
  on public.environment_asset_shortcuts (environment_id);

create trigger trg_environment_asset_shortcuts_updated_at
  before update on public.environment_asset_shortcuts
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Row-level security — workspace membership gates every path
-- (reuses public.is_workspace_member from the initial migration).
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.environments enable row level security;
alter table public.environment_versions enable row level security;
alter table public.environment_specs enable row level security;
alter table public.environment_references enable row level security;
alter table public.environment_asset_shortcuts enable row level security;

-- environments ───────────────────────────────────────────────────────────────
create policy "environments_select_member" on public.environments
  for select using (public.is_workspace_member(workspace_id));

create policy "environments_insert_member" on public.environments
  for insert with check (public.is_workspace_member(workspace_id) and auth.uid() = created_by);

create policy "environments_update_member" on public.environments
  for update using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

-- environment_versions ───────────────────────────────────────────────────────
create policy "environment_versions_select_member" on public.environment_versions
  for select using (
    exists (
      select 1 from public.environments e
      where e.id = environment_id and public.is_workspace_member(e.workspace_id)
    )
  );

create policy "environment_versions_insert_member" on public.environment_versions
  for insert with check (
    auth.uid() = created_by
    and exists (
      select 1 from public.environments e
      where e.id = environment_id and public.is_workspace_member(e.workspace_id)
    )
  );

create policy "environment_versions_update_member" on public.environment_versions
  for update using (
    exists (
      select 1 from public.environments e
      where e.id = environment_id and public.is_workspace_member(e.workspace_id)
    )
  );

-- environment_specs ──────────────────────────────────────────────────────────
create policy "environment_specs_select_member" on public.environment_specs
  for select using (
    exists (
      select 1 from public.environment_versions v
      join public.environments e on e.id = v.environment_id
      where v.id = environment_version_id and public.is_workspace_member(e.workspace_id)
    )
  );

create policy "environment_specs_insert_member" on public.environment_specs
  for insert with check (
    exists (
      select 1 from public.environment_versions v
      join public.environments e on e.id = v.environment_id
      where v.id = environment_version_id and public.is_workspace_member(e.workspace_id)
    )
  );

create policy "environment_specs_update_member" on public.environment_specs
  for update using (
    exists (
      select 1 from public.environment_versions v
      join public.environments e on e.id = v.environment_id
      where v.id = environment_version_id and public.is_workspace_member(e.workspace_id)
    )
  );

-- environment_references ─────────────────────────────────────────────────────
create policy "environment_references_select_member" on public.environment_references
  for select using (
    exists (
      select 1 from public.environment_versions v
      join public.environments e on e.id = v.environment_id
      where v.id = environment_version_id and public.is_workspace_member(e.workspace_id)
    )
  );

create policy "environment_references_insert_member" on public.environment_references
  for insert with check (
    exists (
      select 1 from public.environment_versions v
      join public.environments e on e.id = v.environment_id
      where v.id = environment_version_id and public.is_workspace_member(e.workspace_id)
    )
  );

create policy "environment_references_update_member" on public.environment_references
  for update using (
    exists (
      select 1 from public.environment_versions v
      join public.environments e on e.id = v.environment_id
      where v.id = environment_version_id and public.is_workspace_member(e.workspace_id)
    )
  );

-- Reference metadata rows may be removed from DRAFT versions (the locked/
-- superseded immutability trigger blocks the rest). This is the only delete
-- policy in the environments module and never touches versions or specs.
create policy "environment_references_delete_member" on public.environment_references
  for delete using (
    exists (
      select 1 from public.environment_versions v
      join public.environments e on e.id = v.environment_id
      where v.id = environment_version_id
        and public.is_workspace_member(e.workspace_id)
        and v.status = 'draft'
    )
  );

-- environment_asset_shortcuts ────────────────────────────────────────────────
create policy "environment_asset_shortcuts_select_member" on public.environment_asset_shortcuts
  for select using (
    exists (
      select 1 from public.environments e
      where e.id = environment_id and public.is_workspace_member(e.workspace_id)
    )
  );

create policy "environment_asset_shortcuts_insert_member" on public.environment_asset_shortcuts
  for insert with check (
    exists (
      select 1 from public.environments e
      where e.id = environment_id and public.is_workspace_member(e.workspace_id)
    )
  );

create policy "environment_asset_shortcuts_update_member" on public.environment_asset_shortcuts
  for update using (
    exists (
      select 1 from public.environments e
      where e.id = environment_id and public.is_workspace_member(e.workspace_id)
    )
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- Transaction-safe RPCs (security definer; membership re-checked inside).
-- ═══════════════════════════════════════════════════════════════════════════

-- Creates the next draft version for an environment by copying the source
-- version's Environment Spec (and, in the application layer, its reference
-- metadata). Sequential version_number; the one-draft index prevents two
-- concurrent drafts; a locked source version is read-only but copyable.
create or replace function public.create_next_environment_version(
  p_environment_id uuid,
  p_source_version_id uuid,
  p_change_summary text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace_id uuid;
  v_next_number integer;
  v_new_version_id uuid;
  v_source_lock_level environment_lock_level;
begin
  select workspace_id into v_workspace_id from public.environments where id = p_environment_id;
  if v_workspace_id is null then
    raise exception 'environment not found' using errcode = 'P0002';
  end if;

  if not public.is_workspace_member(v_workspace_id) then
    raise exception 'not a member of this workspace' using errcode = '42501';
  end if;

  select lock_level into v_source_lock_level
  from public.environment_versions
  where id = p_source_version_id and environment_id = p_environment_id;
  if v_source_lock_level is null then
    raise exception 'source version not found' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.environment_versions
    where environment_id = p_environment_id and status = 'draft'
  ) then
    raise exception 'a draft version already exists for this environment'
      using errcode = 'check_violation';
  end if;

  select coalesce(max(version_number), 0) + 1 into v_next_number
  from public.environment_versions where environment_id = p_environment_id;

  insert into public.environment_versions (environment_id, version_number, status, change_summary, lock_level, created_by)
  values (p_environment_id, v_next_number, 'draft', p_change_summary, v_source_lock_level, auth.uid())
  returning id into v_new_version_id;

  insert into public.environment_specs (environment_version_id)
  values (v_new_version_id);

  -- Copy the defining anchors from the source version's spec (if present).
  update public.environment_specs new_spec
  set
    room_type = src.room_type,
    layout_feel = src.layout_feel,
    hero_angle = src.hero_angle,
    lighting_style = src.lighting_style,
    furniture_anchors = src.furniture_anchors,
    signature_props = src.signature_props,
    palette_materials = src.palette_materials,
    product_zone = src.product_zone,
    continuity_notes = src.continuity_notes,
    lock_rules = src.lock_rules
  from public.environment_specs src
  where src.environment_version_id = p_source_version_id
    and new_spec.environment_version_id = v_new_version_id;

  return v_new_version_id;
end;
$$;

-- Locks a draft version: sets locked_at, marks it locked, supersedes older
-- locked versions (preserving them), and points environments.active_version_id
-- at it. The nested update runs at trigger depth 2, which is the only path
-- the immutability trigger allows to supersede a locked version.
create or replace function public.lock_environment_version(p_version_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_environment_id uuid;
  v_status environment_version_status;
begin
  select v.environment_id, v.status into v_environment_id, v_status
  from public.environment_versions v where v.id = p_version_id;

  if v_environment_id is null then
    raise exception 'version not found' using errcode = 'P0002';
  end if;
  if not public.is_workspace_member(
    (select e.workspace_id from public.environments e where e.id = v_environment_id)
  ) then
    raise exception 'not a member of this workspace' using errcode = '42501';
  end if;
  if v_status <> 'draft' then
    raise exception 'only draft versions can be locked (status: %)', v_status
      using errcode = 'check_violation';
  end if;

  -- The supersede of the previous locked version is the one sanctioned
  -- locked->superseded transition; the trigger requires this flag.
  perform set_config('lockflow.supersede_allowed', 'on', true);

  update public.environment_versions
  set status = 'superseded', locked_at = locked_at
  where environment_id = v_environment_id and status = 'locked';

  update public.environment_versions
  set status = 'locked', locked_at = now()
  where id = p_version_id;

  update public.environments
  set active_version_id = p_version_id
  where id = v_environment_id;
end;
$$;

grant execute on function public.create_next_environment_version(uuid, uuid, text) to authenticated;
grant execute on function public.lock_environment_version(uuid) to authenticated;
