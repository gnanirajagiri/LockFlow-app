-- ═══════════════════════════════════════════════════════════════════════════
-- LockFlow — Models data foundation
-- models, model_versions, character_sheets, model_references,
-- model_asset_shortcuts + RLS + lock immutability + ordered version RPCs.
--
-- Product rules encoded here:
--   * Versions are immutable once locked (DB guard + service-layer guard).
--   * One draft version per model at a time (partial unique index).
--   * Exactly one Character Sheet per model version (1:1 PK = FK).
--   * Model asset shortcuts are pointers only — no second Library, no
--     duplicate assets. library_asset_id deliberately has NO foreign key
--     until the shared Library migration exists (documented placeholder).
--   * No delete policies on the app path: soft archive only.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Role vocabulary ─────────────────────────────────────────────────────────
-- The initial migration shipped owner/editor/viewer. Product conventions now
-- use owner/admin/member. Postgres enums cannot drop values, so editor/viewer
-- remain valid-but-unused legacy members.
alter type public.workspace_role add value if not exists 'admin' after 'owner';
alter type public.workspace_role add value if not exists 'member' after 'admin';

-- Membership rows gain updated_at for consistency with other tables.
alter table public.workspace_members
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists trg_workspace_members_updated_at on public.workspace_members;
create trigger trg_workspace_members_updated_at
  before update on public.workspace_members
  for each row execute function public.set_updated_at();

-- ── Enums ───────────────────────────────────────────────────────────────────
create type public.model_status as enum ('draft', 'ready', 'archived');
create type public.model_version_status as enum ('draft', 'locked', 'superseded');
create type public.model_reference_type as enum ('portrait', 'full_body', 'profile', 'detail', 'other');
create type public.model_asset_category as enum ('wardrobe', 'accessory', 'personal_item', 'product', 'creator_tool', 'other');

-- ── Models ──────────────────────────────────────────────────────────────────
create table public.models (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  status model_status not null default 'draft',
  active_version_id uuid, -- set when a version is locked; no FK to avoid circular dependency
  cover_image_path text,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, slug)
);

create index models_workspace_idx on public.models (workspace_id);

-- ── Model versions ──────────────────────────────────────────────────────────
create table public.model_versions (
  id uuid primary key default gen_random_uuid(),
  model_id uuid not null references public.models (id) on delete cascade,
  version_number integer not null check (version_number >= 1),
  status model_version_status not null default 'draft',
  change_summary text check (char_length(change_summary) <= 500),
  cover_image_path text,
  locked_at timestamptz,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (model_id, version_number)
);

create index model_versions_model_idx on public.model_versions (model_id);

-- One draft version per model at a time.
create unique index model_versions_one_draft_per_model
  on public.model_versions (model_id)
  where status = 'draft';

-- Once locked, never unlocked or superseded in place (append-only lifecycle).
create function public.guard_locked_version_transition()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'locked' and new.status <> 'locked' then
    raise exception 'locked model versions are immutable (status transition % -> %)', old.status, new.status
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger trg_model_versions_lock_guard
  before update on public.model_versions
  for each row execute function public.guard_locked_version_transition();

create trigger trg_model_versions_updated_at
  before update on public.model_versions
  for each row execute function public.set_updated_at();

-- ── Character sheets (1:1 with model_versions) ──────────────────────────────
create table public.character_sheets (
  id uuid unique default gen_random_uuid(),
  model_version_id uuid primary key references public.model_versions (id) on delete cascade,
  identity_summary text not null default '',
  face_features jsonb not null default '{}'::jsonb,
  hair_identity jsonb not null default '{}'::jsonb,
  complexion jsonb not null default '{}'::jsonb,
  body_proportions jsonb not null default '{}'::jsonb,
  distinctive_details jsonb not null default '{}'::jsonb,
  lock_rules jsonb not null default '{}'::jsonb,
  reference_notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Identity traits only: face, hair, complexion, body, distinctive details.
-- Clothing/accessories/props/environments are NOT stored here — they live in
-- the shared Library and attach via model_asset_shortcuts or content jobs.
create trigger trg_character_sheets_updated_at
  before update on public.character_sheets
  for each row execute function public.set_updated_at();

-- A locked version's Character Sheet is immutable.
create function public.guard_character_sheet_locked()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1 from public.model_versions v
    where v.id = new.model_version_id and v.status = 'locked'
  ) then
    raise exception 'character sheet belongs to a locked version and is immutable'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger trg_character_sheets_lock_guard
  before update on public.character_sheets
  for each row execute function public.guard_character_sheet_locked();

-- ── Model references ────────────────────────────────────────────────────────
create table public.model_references (
  id uuid primary key default gen_random_uuid(),
  model_version_id uuid not null references public.model_versions (id) on delete cascade,
  storage_path text not null,
  reference_type model_reference_type not null default 'other',
  caption text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index model_references_version_idx on public.model_references (model_version_id);

create trigger trg_model_references_updated_at
  before update on public.model_references
  for each row execute function public.set_updated_at();

create function public.guard_model_reference_locked()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1 from public.model_versions v
    where v.id = new.model_version_id and v.status = 'locked'
  ) then
    raise exception 'reference belongs to a locked version and is immutable'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger trg_model_references_lock_guard
  before update on public.model_references
  for each row execute function public.guard_model_reference_locked();

-- ── Model asset shortcuts (pointers into the future shared Library) ─────────
create table public.model_asset_shortcuts (
  id uuid primary key default gen_random_uuid(),
  model_id uuid not null references public.models (id) on delete cascade,
  -- PLACEHOLDER: no foreign key yet — the shared Library table does not exist.
  -- A later migration will add: library_asset_id uuid references library_assets(id).
  library_asset_id uuid,
  category model_asset_category not null default 'other',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index model_asset_shortcuts_model_idx on public.model_asset_shortcuts (model_id);

create trigger trg_model_asset_shortcuts_updated_at
  before update on public.model_asset_shortcuts
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Row-level security — workspace membership gates every path.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.models enable row level security;
alter table public.model_versions enable row level security;
alter table public.character_sheets enable row level security;
alter table public.model_references enable row level security;
alter table public.model_asset_shortcuts enable row level security;

-- models ─────────────────────────────────────────────────────────────────────
create policy "models_select_member" on public.models
  for select using (public.is_workspace_member(workspace_id));

create policy "models_insert_member" on public.models
  for insert with check (public.is_workspace_member(workspace_id) and auth.uid() = created_by);

create policy "models_update_member" on public.models
  for update using (public.is_workspace_member(workspace_id));

create policy "models_soft_archive_member" on public.models
  for update using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

-- model_versions ─────────────────────────────────────────────────────────────
create policy "versions_select_member" on public.model_versions
  for select using (
    exists (select 1 from public.models m where m.id = model_id and public.is_workspace_member(m.workspace_id))
  );

create policy "versions_insert_member" on public.model_versions
  for insert with check (
    auth.uid() = created_by
    and exists (select 1 from public.models m where m.id = model_id and public.is_workspace_member(m.workspace_id))
  );

create policy "versions_update_member" on public.model_versions
  for update using (
    exists (select 1 from public.models m where m.id = model_id and public.is_workspace_member(m.workspace_id))
  );

-- character_sheets ───────────────────────────────────────────────────────────
create policy "sheets_select_member" on public.character_sheets
  for select using (
    exists (
      select 1 from public.model_versions v
      join public.models m on m.id = v.model_id
      where v.id = model_version_id and public.is_workspace_member(m.workspace_id)
    )
  );

create policy "sheets_insert_member" on public.character_sheets
  for insert with check (
    exists (
      select 1 from public.model_versions v
      join public.models m on m.id = v.model_id
      where v.id = model_version_id and public.is_workspace_member(m.workspace_id)
    )
  );

create policy "sheets_update_member" on public.character_sheets
  for update using (
    exists (
      select 1 from public.model_versions v
      join public.models m on m.id = v.model_id
      where v.id = model_version_id and public.is_workspace_member(m.workspace_id)
    )
  );

-- model_references ───────────────────────────────────────────────────────────
create policy "references_select_member" on public.model_references
  for select using (
    exists (
      select 1 from public.model_versions v
      join public.models m on m.id = v.model_id
      where v.id = model_version_id and public.is_workspace_member(m.workspace_id)
    )
  );

create policy "references_insert_member" on public.model_references
  for insert with check (
    exists (
      select 1 from public.model_versions v
      join public.models m on m.id = v.model_id
      where v.id = model_version_id and public.is_workspace_member(m.workspace_id)
    )
  );

create policy "references_update_member" on public.model_references
  for update using (
    exists (
      select 1 from public.model_versions v
      join public.models m on m.id = v.model_id
      where v.id = model_version_id and public.is_workspace_member(m.workspace_id)
    )
  );

-- model_asset_shortcuts ──────────────────────────────────────────────────────
create policy "shortcuts_select_member" on public.model_asset_shortcuts
  for select using (
    exists (select 1 from public.models m where m.id = model_id and public.is_workspace_member(m.workspace_id))
  );

create policy "shortcuts_insert_member" on public.model_asset_shortcuts
  for insert with check (
    exists (select 1 from public.models m where m.id = model_id and public.is_workspace_member(m.workspace_id))
  );

create policy "shortcuts_update_member" on public.model_asset_shortcuts
  for update using (
    exists (select 1 from public.models m where m.id = model_id and public.is_workspace_member(m.workspace_id))
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- Transaction-safe RPCs (security definer; membership re-checked inside).
-- ═══════════════════════════════════════════════════════════════════════════

-- Creates the next draft version for a model by copying an existing version's
-- Character Sheet. Sequential version_number; the one-draft index prevents
-- two concurrent drafts; a locked source version is read-only but copyable.
create or replace function public.create_next_model_version(
  p_model_id uuid,
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
  v_source_status model_version_status;
begin
  if not public.is_workspace_member(
    (select m.workspace_id from public.models m where m.id = p_model_id)
  ) then
    raise exception 'not a member of this workspace' using errcode = '42501';
  end if;

  select workspace_id into v_workspace_id from public.models where id = p_model_id;
  if v_workspace_id is null then
    raise exception 'model not found' using errcode = 'P0002';
  end if;

  select status into v_source_status from public.model_versions where id = p_source_version_id;
  if v_source_status is null then
    raise exception 'source version not found' using errcode = 'P0002';
  end if;

  if exists (select 1 from public.model_versions where model_id = p_model_id and status = 'draft') then
    raise exception 'a draft version already exists for this model' using errcode = 'check_violation';
  end if;

  select coalesce(max(version_number), 0) + 1 into v_next_number
  from public.model_versions where model_id = p_model_id;

  insert into public.model_versions (model_id, version_number, status, change_summary, created_by)
  values (p_model_id, v_next_number, 'draft', p_change_summary, auth.uid())
  returning id into v_new_version_id;

  insert into public.character_sheets (model_version_id)
  values (v_new_version_id);

  -- Copy identity fields from the source version's sheet (if present).
  update public.character_sheets new_sheet
  set
    identity_summary = src.identity_summary,
    face_features = src.face_features,
    hair_identity = src.hair_identity,
    complexion = src.complexion,
    body_proportions = src.body_proportions,
    distinctive_details = src.distinctive_details,
    lock_rules = src.lock_rules,
    reference_notes = src.reference_notes
  from public.character_sheets src
  where src.model_version_id = p_source_version_id
    and new_sheet.model_version_id = v_new_version_id;

  return v_new_version_id;
end;
$$;

-- Locks a draft version: sets locked_at, marks it locked, supersedes older
-- locked versions, and points models.active_version_id at it.
create or replace function public.lock_model_version(p_version_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_model_id uuid;
  v_status model_version_status;
begin
  select v.model_id, v.status into v_model_id, v_status
  from public.model_versions v where v.id = p_version_id;

  if v_model_id is null then
    raise exception 'version not found' using errcode = 'P0002';
  end if;
  if not public.is_workspace_member(
    (select m.workspace_id from public.models m where m.id = v_model_id)
  ) then
    raise exception 'not a member of this workspace' using errcode = '42501';
  end if;
  if v_status <> 'draft' then
    raise exception 'only draft versions can be locked (status: %)', v_status using errcode = 'check_violation';
  end if;

  update public.model_versions
  set status = 'superseded', locked_at = locked_at
  where model_id = v_model_id and status = 'locked';

  update public.model_versions
  set status = 'locked', locked_at = now()
  where id = p_version_id;

  update public.models
  set active_version_id = p_version_id
  where id = v_model_id;
end;
$$;

grant execute on function public.create_next_model_version(uuid, uuid, text) to authenticated;
grant execute on function public.lock_model_version(uuid) to authenticated;
