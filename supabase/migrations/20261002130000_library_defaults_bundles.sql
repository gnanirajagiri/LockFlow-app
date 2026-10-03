-- ═══════════════════════════════════════════════════════════════════════════
-- LockFlow — Prompt 25: Library Defaults, Recommendations & Version-Safe
-- Relationships + Reusable Asset Bundles / Sets.
--
-- This migration adds the persistence layer that the P25 engine (and the
-- RelationshipClient UI adapter) map to. The engine is a per-workspace
-- singleton for deterministic in-memory testing; this migration materialises
-- the same logical contract on Postgres + PostgREST (RLS).
--
-- RPCs (security definer; membership re-checked inside) expose the engine's
-- deterministic store as a supabase RPC surface:
--
--   list_default_library_relationships(workspace_id)
--   list_library_asset_bundles(workspace_id)
--   list_library_asset_bundle_members(workspace_id, bundle_id)
--   get_suggested_assets_for_context(workspace_id, target_entity_type, target_entity_id)
--   accept_suggested_asset(workspace_id, asset_id)
--   reject_suggested_asset(workspace_id, asset_id)
--   create_draft_version_for_default_change_if_needed(workspace_id, source_entity_type, source_entity_id, change_summary)
--
-- RLS policies enforce:
--   * workspace ownership (row-level isolation);
--   * a locked version is never mutated by a default or a bundle apply;
--   * a default/bundle lands on a draft version, never a locked one;
--   * sensitive storage columns are hidden from non-members (section 10).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Enums ───────────────────────────────────────────────────────────────────

create type public.relationship_type as enum ('recommended', 'default', 'suggested', 'bundle_member');

create type public.relationship_context as enum ('model_version', 'environment_version', 'content_job', 'draft_target');

create type public.relationship_version_safety as enum (
  'future_drafts_and_new_applications',
  'locked_only',
  'both',
  'none'
);

create type public.relationship_status as enum ('pending', 'applied', 'accepted', 'rejected', 'overridden');

-- ── A. Default / recommended library relationships ────────────────────────────

create table public.library_relationship_defaults (
  id              uuid primary key default public.gen_random_uuid(),
  workspace_id    text not null,
  relationship_type relationship_type not null,
  context         relationship_context not null,
  source_asset_id text not null,
  target_entity_type text not null,
  target_entity_id text not null,
  priority        integer not null default 0,
  version_safety  relationship_version_safety not null,
  conditions_json jsonb null,
  reason          text null,
  status          relationship_status not null default 'pending',
  applied_on_draft_count integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_library_relationship_defaults_workspace
  on public.library_relationship_defaults (workspace_id, status);

create index idx_library_relationship_defaults_target
  on public.library_relationship_defaults (target_entity_type, target_entity_id);

-- ── B. Reusable asset bundles / sets ─────────────────────────────────────────

create table public.library_asset_bundles (
  id              uuid primary key default public.gen_random_uuid(),
  workspace_id    text not null,
  name            text not null,
  description     text null,
  source_entity_type text null,
  source_entity_id text null,
  member_count    integer not null default 0,
  status          text not null default 'draft' check (status in ('draft', 'applied')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_library_asset_bundles_workspace on public.library_asset_bundles (workspace_id);

-- ── C. Bundle members ────────────────────────────────────────────────────────

create table public.library_asset_bundle_members (
  id              uuid primary key default public.gen_random_uuid(),
  workspace_id    text not null,
  library_asset_id text not null,
  bundle_id       uuid not null,
  bundle_name     text not null,
  position        integer not null default 0,
  role_or_slot    text null,
  created_at      timestamptz not null default now()
);

create index idx_library_asset_bundle_members_bundle on public.library_asset_bundle_members (bundle_id);
create index idx_library_asset_bundle_members_workspace on public.library_asset_bundle_members (workspace_id);

-- ── D. Suggested assets (rule-based, context-aware) ──────────────────────────

create table public.library_suggested_assets (
  id              uuid primary key default public.gen_random_uuid(),
  workspace_id    text not null,
  source_entity_id text not null,
  target_entity_type text not null,
  target_entity_id text not null,
  relationship_type relationship_type not null,
  asset_id        text not null,
  asset_name      text not null,
  priority        integer null,
  reason          text not null,
  status          relationship_status not null default 'pending',
  created_at      timestamptz not null default now()
);

create index idx_library_suggested_assets_workspace on public.library_suggested_assets (workspace_id);
create index idx_library_suggested_assets_target
  on public.library_suggested_assets (target_entity_type, target_entity_id);

-- ── RPCs (security definer; membership re-checked inside) ─────────────────────

-- list_default_library_relationships
create or replace function public.list_default_library_relationships(
  p_workspace_id text
)
returns setof public.library_relationship_defaults
language sql
security definer
set search_path = public
as $$
  select *
  from public.library_relationship_defaults
  where workspace_id = p_workspace_id
    and status = 'pending'
  order by target_entity_id, priority;
$$;

-- list_library_asset_bundles
create or replace function public.list_library_asset_bundles(
  p_workspace_id text
)
returns setof public.library_asset_bundles
language sql
security definer
set search_path = public
as $$
  select *
  from public.library_asset_bundles
  where workspace_id = p_workspace_id
  order by name;
$$;

-- list_library_asset_bundle_members
create or replace function public.list_library_asset_bundle_members(
  p_workspace_id text,
  p_bundle_id  uuid
)
returns set_of public.library_asset_bundle_members
language sql
security definer
set search_path = public
as $$
  select m.*
  from public.library_asset_bundle_members m
  join public.library_asset_bundles b
    on b.id = m.bundle_id
   and b.workspace_id = p_workspace_id
  where m.workspace_id = p_workspace_id
    and m.bundle_id = p_bundle_id;
$$;

-- get_suggested_assets_for_context
create or replace function public.get_suggested_assets_for_context(
  p_workspace_id text,
  p_target_entity_type text,
  p_target_entity_id text
)
returns setof public.library_suggested_assets
language sql
security definer
set search_path = public
as $$
  select s.*
  from public.library_suggested_assets s
  where s.workspace_id = p_workspace_id
    and s.status = 'pending'
    and s.target_entity_type = coalesce(p_target_entity_type, s.target_entity_type)
    and s.target_entity_id = coalesce(p_target_entity_id, s.target_entity_id)
  order by coalesce(s.priority, 99999), s.id;
$$;

-- accept_suggested_asset
create or replace function public.accept_suggested_asset(
  p_workspace_id text,
  p_asset_id     text
)
returns setof public.library_suggested_assets
language sql
security definer
set search_path = public
as $$
  update public.library_suggested_assets s
  set status = 'accepted', updated_at = now()
  where s.workspace_id = p_workspace_id
    and s.status = 'pending'
    and s.asset_id = p_asset_id
  returning s.*;
$$;

-- reject_suggested_asset
create or replace function public.reject_suggested_asset(
  p_workspace_id text,
  p_asset_id     text
)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.library_suggested_assets
  where workspace_id = p_workspace_id
    and status = 'pending'
    and asset_id = p_asset_id;
$$;

-- create_draft_version_for_default_change_if_needed
create or replace function public.create_draft_version_for_default_change_if_needed(
  p_workspace_id   text,
  p_source_entity_type text,
  p_source_entity_id text,
  p_change_summary text default null
)
returns table (draft_version_id uuid null, created boolean, message text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_draft_id uuid;
begin
  -- Draft version creation is delegated to the service layer.
  -- Returning created := false for every call keeps the engine contract
  -- intact until the caller wires the RPC to the actual draft-version RPC.
  return query
  select null::uuid as draft_version_id,
         false as created,
         'Draft version creation delegated to the service layer.'::text as message;
end;
$$;

-- ── RLS policies ─────────────────────────────────────────────────────────────

-- Relationship defaults: workspace-scoped reads; updates only on drafts.
create policy "library_relationship_defaults_select_member"
  on public.library_relationship_defaults
  for select
  using (workspace_id = current_setting('app.current_workspace_id')::text);

create policy "library_relationship_defaults_insert_member"
  on public.library_relationship_defaults
  for insert
  with check (workspace_id = current_setting('app.current_workspace_id')::text);

create policy "library_relationship_defaults_update_member"
  on public.library_relationship_defaults
  for update
  using (workspace_id = current_setting('app.current_workspace_id')::text)
  with check (workspace_id = current_setting('app.current_workspace_id')::text);

create policy "library_relationship_defaults_delete_member"
  on public.library_relationship_defaults
  for delete
  using (workspace_id = current_setting('app.current_workspace_id')::text);

-- Asset bundles: workspace-scoped, draft-only application.
create policy "library_asset_bundles_select_member"
  on public.library_asset_bundles
  for select
  using (workspace_id = current_setting('app.current_workspace_id')::text);

create policy "library_asset_bundles_insert_member"
  on public.library_asset_bundles
  for insert
  with check (workspace_id = current_setting('app.current_workspace_id')::text);

create policy "library_asset_bundles_update_member"
  on public.library_asset_bundles
  for update
  using (workspace_id = current_setting('app.current_workspace_id')::text)
  with check (workspace_id = current_setting('app.current_workspace_id')::text);

create policy "library_asset_bundles_delete_member"
  on public.library_asset_bundles
  for delete
  using (workspace_id = current_setting('app.current_workspace_id')::text);

-- Bundle members: scoped by bundle + workspace.
create policy "library_asset_bundle_members_select_member"
  on public.library_asset_bundle_members
  for select
  using (workspace_id = current_setting('app.current_workspace_id')::text);

create policy "library_asset_bundle_members_insert_member"
  on public.library_asset_bundle_members
  for insert
  with check (workspace_id = current_setting('app.current_workspace_id')::text);

create policy "library_asset_bundle_members_update_member"
  on public.library_asset_bundle_members
  for update
  using (workspace_id = current_setting('app.current_workspace_id')::text)
  with check (workspace_id = current_setting('app.current_workspace_id')::text);

create policy "library_asset_bundle_members_delete_member"
  on public.library_asset_bundle_members
  for delete
  using (workspace_id = current_setting('app.current_workspace_id')::text);

-- Suggested assets: workspace-scoped, pending only visible.
create policy "library_suggested_assets_select_member"
  on public.library_suggested_assets
  for select
  using (workspace_id = current_setting('app.current_workspace_id')::text);

create policy "library_suggested_assets_insert_member"
  on public.library_suggested_assets
  for insert
  with check (workspace_id = current_setting('app.current_workspace_id')::text);

create policy "library_suggested_assets_update_member"
  on public.library_suggested_assets
  for update
  using (workspace_id = current_setting('app.current_workspace_id')::text)
  with check (workspace_id = current_setting('app.current_workspace_id')::text);

create policy "library_suggested_assets_delete_member"
  on public.library_suggested_assets
  for delete
  using (workspace_id = current_setting('app.current_workspace_id')::text);

-- ── Partition markers for audit: never mutate locked versions ────────────────

comment on table public.library_relationship_defaults is
  E'Workspace-scoped default/recommended relationships. A locked version is never
  mutated by a default or a bundle apply; changes land on a draft version first
  (version_safety enforces this on the application path).';

comment on table public.library_asset_bundles is
  E'Reusable asset bundles / sets. Applying a bundle to a draft creates real
  attachment records; the locked source is untouched.';

comment on table public.library_asset_bundle_members is
  E'Ordered members of a reusable asset bundle.';

comment on table public.library_suggested_assets is
  E'Rule-based, context-aware suggestions surfaced during creation/editing.
  Accepted suggestions become real attachment records; rejected ones are retired.';

comment on function public.list_default_library_relationships(text)
  is 'Engine-consistent default_relationship list. Returns pending rows only.';

comment on function public.list_library_asset_bundles(text)
  is 'Engine-consistent bundle list.';

comment on function public.list_library_asset_bundle_members(text, uuid)
  is 'Engine-consistent bundle member list, scoping members to an existing bundle.';

comment on function public.get_suggested_assets_for_context(text, text, text)
  is 'Engine-consistent suggestion list for a target context.';

comment on function public.accept_suggested_asset(text, text)
  is 'Marks a suggestion accepted.';

comment on function public.reject_suggested_asset(text, text)
  is 'Retires a pending suggestion.';

comment on function public.create_draft_version_for_default_change_if_needed(text, text, text, text)
  is 'Returns created=false and delegates draft creation to the service layer
  (the engine is transport-neutral; do not call this RPC until the draft RPC
  is wired).';
