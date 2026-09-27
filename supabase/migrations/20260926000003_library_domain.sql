-- ═══════════════════════════════════════════════════════════════════════════
-- LockFlow — Unified Library data foundation
-- library_assets, library_asset_versions, library_asset_references,
-- library_asset_tags, library_asset_tag_links, look_details,
-- look_asset_items + RLS + lock immutability + shortcut foreign keys.
--
-- Product rules encoded here:
--   * EXACTLY ONE Library. No "Global Library", "My Library", or per-builder
--     libraries. Every reusable input (product, prop, wardrobe, accessory,
--     creator tool, brand asset, reference, scene, saved Look) lives here
--     once, with one canonical record.
--   * Generated outputs (images, videos, drafts, exports) are NEVER Library
--     records — they belong to Gallery (future).
--   * Assets are workspace-reusable and never model- or environment-owned.
--     Shortcut tables keep pointing at canonical Library records; this
--     migration finally gives those pointers real foreign keys.
--   * Asset versions follow the shared draft → locked → superseded lifecycle.
--     Locked versions are immutable; changes create a new draft.
--   * Looks are special Library assets: a Look is tied to ONE model but never
--     changes the model's protected Character Sheet; its items reference
--     canonical Library assets instead of duplicating them.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Enums ───────────────────────────────────────────────────────────────────
create type public.library_asset_status as enum ('draft', 'ready', 'archived');
create type public.library_asset_type as enum (
  'product', 'prop', 'wardrobe', 'accessory', 'personal_item',
  'creator_tool', 'brand_asset', 'reference', 'scene', 'look', 'other'
);
create type public.asset_version_status as enum ('draft', 'locked', 'superseded');
create type public.asset_rights_status as enum ('unknown', 'confirmed', 'restricted');
create type public.library_reference_type as enum (
  'front', 'back', 'detail', 'in_context', 'label', 'material', 'other'
);
create type public.look_item_role as enum (
  'wardrobe', 'accessory', 'personal_item', 'product', 'creator_tool', 'other'
);

-- ── A. Library assets ───────────────────────────────────────────────────────
create table public.library_assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  asset_type library_asset_type not null default 'other',
  status library_asset_status not null default 'draft',
  active_version_id uuid, -- set when a version is locked; no FK (circular dep)
  cover_image_path text,
  description text,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, slug)
);

create index library_assets_workspace_idx on public.library_assets (workspace_id);
create index library_assets_type_idx on public.library_assets (workspace_id, asset_type);

create trigger trg_library_assets_updated_at
  before update on public.library_assets
  for each row execute function public.set_updated_at();

-- ── B. Library asset versions ───────────────────────────────────────────────
create table public.library_asset_versions (
  id uuid primary key default gen_random_uuid(),
  library_asset_id uuid not null references public.library_assets (id) on delete cascade,
  version_number integer not null check (version_number >= 1),
  status asset_version_status not null default 'draft',
  change_summary text check (char_length(change_summary) <= 500),
  cover_image_path text,
  -- The approved configuration: structured JSON (colours, materials, sizes,
  -- presentation choices…). Versioned and copied on new-draft, never merged.
  structured_details jsonb not null default '{}'::jsonb,
  rights_status asset_rights_status not null default 'unknown',
  locked_at timestamptz,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (library_asset_id, version_number)
);

create index library_asset_versions_asset_idx on public.library_asset_versions (library_asset_id);

-- One active draft version per asset at a time.
create unique index library_asset_versions_one_draft_per_asset
  on public.library_asset_versions (library_asset_id)
  where status = 'draft';

create trigger trg_library_asset_versions_updated_at
  before update on public.library_asset_versions
  for each row execute function public.set_updated_at();

-- Locked versions are immutable, with exactly one sanctioned transition:
-- locked -> superseded, performed only by lock_library_asset_version (flagged
-- via the transaction-local GUC, same pattern as environments).
create function public.guard_locked_library_version_transition()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'superseded' and new.status <> 'superseded' then
    raise exception 'superseded library asset versions are immutable history'
      using errcode = 'check_violation';
  end if;
  if old.status = 'locked' and new.status <> 'locked' then
    if new.status = 'superseded'
       and coalesce(current_setting('lockflow.supersede_allowed', true), '') = 'on' then
      return new; -- sanctioned by lock_library_asset_version
    end if;
    raise exception 'locked library asset versions are immutable (status transition % -> %)', old.status, new.status
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger trg_library_asset_versions_lock_guard
  before update on public.library_asset_versions
  for each row execute function public.guard_locked_library_version_transition();

-- ── C. Library asset references ─────────────────────────────────────────────
create table public.library_asset_references (
  id uuid primary key default gen_random_uuid(),
  library_asset_version_id uuid not null references public.library_asset_versions (id) on delete cascade,
  storage_path text not null,
  reference_type library_reference_type not null default 'other',
  caption text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index library_asset_references_version_idx
  on public.library_asset_references (library_asset_version_id);

create trigger trg_library_asset_references_updated_at
  before update on public.library_asset_references
  for each row execute function public.set_updated_at();

create function public.guard_library_reference_locked()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1 from public.library_asset_versions v
    where v.id = new.library_asset_version_id and v.status in ('locked', 'superseded')
  ) then
    raise exception 'reference belongs to a locked or superseded asset version and is immutable'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger trg_library_asset_references_lock_guard
  before update on public.library_asset_references
  for each row execute function public.guard_library_reference_locked();

-- ── D. Library asset tags (workspace-local vocabulary) ──────────────────────
create table public.library_asset_tags (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  normalized_name text not null check (normalized_name ~ '^[a-z0-9]+(-?[a-z0-9]+)*$'),
  created_at timestamptz not null default now(),
  unique (workspace_id, normalized_name)
);

create index library_asset_tags_workspace_idx on public.library_asset_tags (workspace_id);

-- ── E. Tag links (composite PK pair) ────────────────────────────────────────
create table public.library_asset_tag_links (
  library_asset_id uuid not null references public.library_assets (id) on delete cascade,
  tag_id uuid not null references public.library_asset_tags (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (library_asset_id, tag_id)
);

create index library_asset_tag_links_tag_idx on public.library_asset_tag_links (tag_id);

-- ── F. Look details (1:1 with versions of assets whose type is 'look') ──────
create table public.look_details (
  id uuid primary key default gen_random_uuid(),
  library_asset_version_id uuid primary key references public.library_asset_versions (id) on delete cascade,
  -- The ONE sanctioned model relationship in the Library: a Look belongs to a
  -- model's presentation, but never alters the model's Character Sheet.
  model_id uuid not null references public.models (id) on delete cascade,
  presentation_notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index look_details_model_idx on public.look_details (model_id);

create trigger trg_look_details_updated_at
  before update on public.look_details
  for each row execute function public.set_updated_at();

-- look_details rows are only valid on versions of look-type assets.
create function public.guard_look_details_asset_type()
returns trigger
language plpgsql
as $$
declare
  v_asset_type library_asset_type;
begin
  if tg_op = 'INSERT' then
    select a.asset_type into v_asset_type
    from public.library_asset_versions v
    join public.library_assets a on a.id = v.library_asset_id
    where v.id = new.library_asset_version_id;
    if v_asset_type is null then
      raise exception 'look_details target version not found' using errcode = 'P0002';
    end if;
    if v_asset_type <> 'look' then
      raise exception 'look_details is only valid for assets with asset_type = look (got %)'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_look_details_type_guard
  before insert on public.look_details
  for each row execute function public.guard_look_details_asset_type();

-- ── G. Look asset items (pointers to canonical Library assets) ──────────────
create table public.look_asset_items (
  id uuid primary key default gen_random_uuid(),
  look_details_id uuid not null references public.look_details (id) on delete cascade,
  -- Canonical Library asset — NEVER a copy. The Look references; it does not
  -- duplicate item data.
  library_asset_id uuid not null references public.library_assets (id) on delete cascade,
  -- Set only when an exact approved version is intentionally selected;
  -- otherwise the Look follows the asset's active version.
  library_asset_version_id uuid references public.library_asset_versions (id) on delete set null,
  role look_item_role not null default 'other',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (look_details_id, library_asset_id)
);

create index look_asset_items_details_idx on public.look_asset_items (look_details_id);

create trigger trg_look_asset_items_updated_at
  before update on public.look_asset_items
  for each row execute function public.set_updated_at();

-- An item's pinned version (if any) must belong to the item's asset, and the
-- pinned asset must live in the same workspace as the Look's asset.
create function public.guard_look_item_consistency()
returns trigger
language plpgsql
as $$
declare
  v_pinned_asset_id uuid;
  v_look_workspace uuid;
  v_item_workspace uuid;
begin
  if new.library_asset_version_id is not null then
    select library_asset_id into v_pinned_asset_id
    from public.library_asset_versions where id = new.library_asset_version_id;
    if v_pinned_asset_id is null then
      raise exception 'pinned asset version not found' using errcode = 'P0002';
    end if;
    if v_pinned_asset_id <> new.library_asset_id then
      raise exception 'pinned version belongs to a different asset'
        using errcode = 'check_violation';
    end if;
  end if;

  select la.workspace_id into v_look_workspace
  from public.look_details ld
  join public.library_asset_versions v on v.id = ld.library_asset_version_id
  join public.library_assets la on la.id = v.library_asset_id
  where ld.id = new.look_details_id;

  select workspace_id into v_item_workspace
  from public.library_assets where id = new.library_asset_id;

  if v_look_workspace is null or v_item_workspace is null or v_look_workspace <> v_item_workspace then
    raise exception 'look items must come from the same workspace as the Look'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger trg_look_asset_items_consistency
  before insert or update on public.look_asset_items
  for each row execute function public.guard_look_item_consistency();

-- ── H. Shortcut foreign keys (the placeholder becomes real) ─────────────────
-- Both shortcut tables were created with a deliberately FK-less nullable
-- library_asset_id placeholder. The unified Library now exists, so the
-- pointers become real references. Nullable: shortcut rows may still point at
-- "future" assets until the Library UI creates them, and legacy rows survive.
alter table public.model_asset_shortcuts
  add constraint model_asset_shortcuts_library_asset_fkey
  foreign key (library_asset_id) references public.library_assets (id)
  on delete set null;

alter table public.environment_asset_shortcuts
  add constraint environment_asset_shortcuts_library_asset_fkey
  foreign key (library_asset_id) references public.library_assets (id)
  on delete set null;

-- Shortcut assets must live in the same workspace as their owner record
-- (workspace consistency across the relationship).
create function public.guard_shortcut_workspace_consistency()
returns trigger
language plpgsql
as $$
declare
  v_owner_workspace uuid;
  v_asset_workspace uuid;
begin
  if new.library_asset_id is null then
    return new; -- nullable placeholder rows remain legal
  end if;

  if tg_table_name = 'model_asset_shortcuts' then
    select workspace_id into v_owner_workspace from public.models where id = new.model_id;
  else
    select workspace_id into v_owner_workspace from public.environments where id = new.environment_id;
  end if;

  select workspace_id into v_asset_workspace from public.library_assets where id = new.library_asset_id;

  if v_owner_workspace is null or v_asset_workspace is null or v_owner_workspace <> v_asset_workspace then
    raise exception 'shortcut asset must belong to the same workspace as its owner'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger trg_model_shortcuts_workspace_guard
  before insert or update on public.model_asset_shortcuts
  for each row execute function public.guard_shortcut_workspace_consistency();

create trigger trg_environment_shortcuts_workspace_guard
  before insert or update on public.environment_asset_shortcuts
  for each row execute function public.guard_shortcut_workspace_consistency();

-- ═══════════════════════════════════════════════════════════════════════════
-- Row-level security — workspace membership gates every path
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.library_assets enable row level security;
alter table public.library_asset_versions enable row level security;
alter table public.library_asset_references enable row level security;
alter table public.library_asset_tags enable row level security;
alter table public.library_asset_tag_links enable row level security;
alter table public.look_details enable row level security;
alter table public.look_asset_items enable row level security;

-- library_assets ─────────────────────────────────────────────────────────────
create policy "library_assets_select_member" on public.library_assets
  for select using (public.is_workspace_member(workspace_id));

create policy "library_assets_insert_member" on public.library_assets
  for insert with check (public.is_workspace_member(workspace_id) and auth.uid() = created_by);

create policy "library_assets_update_member" on public.library_assets
  for update using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

-- library_asset_versions ─────────────────────────────────────────────────────
create policy "library_versions_select_member" on public.library_asset_versions
  for select using (
    exists (
      select 1 from public.library_assets a
      where a.id = library_asset_id and public.is_workspace_member(a.workspace_id)
    )
  );

create policy "library_versions_insert_member" on public.library_asset_versions
  for insert with check (
    auth.uid() = created_by
    and exists (
      select 1 from public.library_assets a
      where a.id = library_asset_id and public.is_workspace_member(a.workspace_id)
    )
  );

create policy "library_versions_update_member" on public.library_asset_versions
  for update using (
    exists (
      select 1 from public.library_assets a
      where a.id = library_asset_id and public.is_workspace_member(a.workspace_id)
    )
  );

-- library_asset_references ───────────────────────────────────────────────────
create policy "library_references_select_member" on public.library_asset_references
  for select using (
    exists (
      select 1 from public.library_asset_versions v
      join public.library_assets a on a.id = v.library_asset_id
      where v.id = library_asset_version_id and public.is_workspace_member(a.workspace_id)
    )
  );

create policy "library_references_insert_member" on public.library_asset_references
  for insert with check (
    exists (
      select 1 from public.library_asset_versions v
      join public.library_assets a on a.id = v.library_asset_id
      where v.id = library_asset_version_id and public.is_workspace_member(a.workspace_id)
    )
  );

create policy "library_references_update_member" on public.library_asset_references
  for update using (
    exists (
      select 1 from public.library_asset_versions v
      join public.library_assets a on a.id = v.library_asset_id
      where v.id = library_asset_version_id and public.is_workspace_member(a.workspace_id)
    )
  );

-- Draft-only cleanup of reference rows (mirrors the environments rule).
create policy "library_references_delete_member" on public.library_asset_references
  for delete using (
    exists (
      select 1 from public.library_asset_versions v
      join public.library_assets a on a.id = v.library_asset_id
      where v.id = library_asset_version_id
        and public.is_workspace_member(a.workspace_id)
        and v.status = 'draft'
    )
  );

-- library_asset_tags (workspace-scoped vocabulary) ───────────────────────────
create policy "library_tags_select_member" on public.library_asset_tags
  for select using (public.is_workspace_member(workspace_id));

create policy "library_tags_insert_member" on public.library_asset_tags
  for insert with check (public.is_workspace_member(workspace_id));

create policy "library_tags_update_member" on public.library_asset_tags
  for update using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

-- library_asset_tag_links (workspace consistency on both sides) ──────────────
create policy "library_tag_links_select_member" on public.library_asset_tag_links
  for select using (
    exists (
      select 1 from public.library_assets a
      join public.library_asset_tags t on t.id = tag_id
      where a.id = library_asset_id
        and a.workspace_id = t.workspace_id
        and public.is_workspace_member(a.workspace_id)
    )
  );

create policy "library_tag_links_insert_member" on public.library_asset_tag_links
  for insert with check (
    exists (
      select 1 from public.library_assets a
      join public.library_asset_tags t on t.id = tag_id
      where a.id = library_asset_id
        and a.workspace_id = t.workspace_id
        and public.is_workspace_member(a.workspace_id)
    )
  );

create policy "library_tag_links_delete_member" on public.library_asset_tag_links
  for delete using (
    exists (
      select 1 from public.library_assets a
      join public.library_asset_tags t on t.id = tag_id
      where a.id = library_asset_id
        and a.workspace_id = t.workspace_id
        and public.is_workspace_member(a.workspace_id)
    )
  );

-- look_details (workspace of the Look asset AND the linked model) ────────────
create policy "look_details_select_member" on public.look_details
  for select using (
    exists (
      select 1 from public.library_asset_versions v
      join public.library_assets a on a.id = v.library_asset_id
      where v.id = library_asset_version_id and public.is_workspace_member(a.workspace_id)
    )
  );

create policy "look_details_insert_member" on public.look_details
  for insert with check (
    exists (
      select 1 from public.library_asset_versions v
      join public.library_assets a on a.id = v.library_asset_id
      where v.id = library_asset_version_id and public.is_workspace_member(a.workspace_id)
    )
  );

create policy "look_details_update_member" on public.look_details
  for update using (
    exists (
      select 1 from public.library_asset_versions v
      join public.library_assets a on a.id = v.library_asset_id
      where v.id = library_asset_version_id and public.is_workspace_member(a.workspace_id)
    )
  );

-- look_asset_items (workspace via the Look's asset; canonical items only) ────
create policy "look_items_select_member" on public.look_asset_items
  for select using (
    exists (
      select 1 from public.look_details ld
      join public.library_asset_versions v on v.id = ld.library_asset_version_id
      join public.library_assets a on a.id = v.library_asset_id
      where ld.id = look_details_id and public.is_workspace_member(a.workspace_id)
    )
  );

create policy "look_items_insert_member" on public.look_asset_items
  for insert with check (
    exists (
      select 1 from public.look_details ld
      join public.library_asset_versions v on v.id = ld.library_asset_version_id
      join public.library_assets a on a.id = v.library_asset_id
      where ld.id = look_details_id and public.is_workspace_member(a.workspace_id)
    )
  );

create policy "look_items_update_member" on public.look_asset_items
  for update using (
    exists (
      select 1 from public.look_details ld
      join public.library_asset_versions v on v.id = ld.library_asset_version_id
      join public.library_assets a on a.id = v.library_asset_id
      where ld.id = look_details_id and public.is_workspace_member(a.workspace_id)
    )
  );

create policy "look_items_delete_member" on public.look_asset_items
  for delete using (
    exists (
      select 1 from public.look_details ld
      join public.library_asset_versions v on v.id = ld.library_asset_version_id
      join public.library_assets a on a.id = v.library_asset_id
      where ld.id = look_details_id and public.is_workspace_member(a.workspace_id)
    )
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- Transaction-safe RPCs (security definer; membership re-checked inside).
-- ═══════════════════════════════════════════════════════════════════════════

-- Creates the next draft version for a library asset by copying the source
-- version's structured details. Sequential version_number; the one-draft
-- index prevents two concurrent drafts; locked sources are read-only but
-- copyable. Reference metadata is copied by the application layer.
create or replace function public.create_next_library_asset_version(
  p_asset_id uuid,
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
begin
  select workspace_id into v_workspace_id from public.library_assets where id = p_asset_id;
  if v_workspace_id is null then
    raise exception 'library asset not found' using errcode = 'P0002';
  end if;

  if not public.is_workspace_member(v_workspace_id) then
    raise exception 'not a member of this workspace' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.library_asset_versions
    where id = p_source_version_id and library_asset_id = p_asset_id
  ) then
    raise exception 'source version not found' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.library_asset_versions
    where library_asset_id = p_asset_id and status = 'draft'
  ) then
    raise exception 'a draft version already exists for this asset'
      using errcode = 'check_violation';
  end if;

  select coalesce(max(version_number), 0) + 1 into v_next_number
  from public.library_asset_versions where library_asset_id = p_asset_id;

  insert into public.library_asset_versions (library_asset_id, version_number, status, change_summary, created_by)
  values (p_asset_id, v_next_number, 'draft', p_change_summary, auth.uid())
  returning id into v_new_version_id;

  -- Copy the approved configuration from the source version (if present).
  update public.library_asset_versions new_version
  set
    structured_details = src.structured_details,
    rights_status = src.rights_status,
    cover_image_path = src.cover_image_path
  from public.library_asset_versions src
  where src.id = p_source_version_id
    and new_version.id = v_new_version_id;

  return v_new_version_id;
end;
$$;

-- Locks a draft version: sets locked_at, marks it locked, supersedes older
-- locked versions (preserving them), and points library_assets.active_version_id
-- at it. The supersede runs under the sanctioned GUC flag.
create or replace function public.lock_library_asset_version(p_version_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asset_id uuid;
  v_status asset_version_status;
begin
  select v.library_asset_id, v.status into v_asset_id, v_status
  from public.library_asset_versions v where v.id = p_version_id;

  if v_asset_id is null then
    raise exception 'version not found' using errcode = 'P0002';
  end if;
  if not public.is_workspace_member(
    (select a.workspace_id from public.library_assets a where a.id = v_asset_id)
  ) then
    raise exception 'not a member of this workspace' using errcode = '42501';
  end if;
  if v_status <> 'draft' then
    raise exception 'only draft versions can be locked (status: %)', v_status
      using errcode = 'check_violation';
  end if;

  perform set_config('lockflow.supersede_allowed', 'on', true);

  update public.library_asset_versions
  set status = 'superseded', locked_at = locked_at
  where library_asset_id = v_asset_id and status = 'locked';

  update public.library_asset_versions
  set status = 'locked', locked_at = now()
  where id = p_version_id;

  update public.library_assets
  set active_version_id = p_version_id
  where id = v_asset_id;
end;
$$;

grant execute on function public.create_next_library_asset_version(uuid, uuid, text) to authenticated;
grant execute on function public.lock_library_asset_version(uuid) to authenticated;
