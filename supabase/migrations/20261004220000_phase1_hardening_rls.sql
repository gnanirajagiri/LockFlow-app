-- ═══════════════════════════════════════════════════════════════════════════
-- LockFlow — Prompt 35: Phase 1 hardening — RLS enforcement for the
-- library defaults/bundles tables.
--
-- VERIFIED DEFECT (found by the Phase 1 security audit):
-- 20261002130000_library_defaults_bundles.sql created 16 row-level policies
-- on library_relationship_defaults, library_asset_bundles,
-- library_asset_bundle_members and library_suggested_assets, but never ran
-- `alter table ... enable row level security` on any of them, and nothing in
-- the application ever sets the `app.current_workspace_id` setting those
-- policies read. Net effect: the policies were inert, and the four tables
-- had NO database-level workspace isolation.
--
-- Fix, idempotent and additive (no data loss, no replacement of product
-- concepts):
--   1. Enable RLS on all four tables.
--   2. Drop the legacy current_setting-based policies (they could never
--      match once RLS is on) and replace them with the same
--      is_workspace_member(workspace_id) policy shape every other Phase 1
--      table uses — the policy set keeps the original select/insert/update/
--      delete structure.
--
-- Rollback safety: the migration only adds `enable` statements and swaps
-- policy expressions; table data and columns are untouched.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Enable RLS (the missing enforcement switch) ──────────────────────────
alter table public.library_relationship_defaults enable row level security;
alter table public.library_asset_bundles         enable row level security;
alter table public.library_asset_bundle_members  enable row level security;
alter table public.library_suggested_assets      enable row level security;

-- ── 2. Replace the inert policies with the Phase 1 standard shape ───────────
-- These four tables declare workspace_id as TEXT (schema inconsistency —
-- the rest of Phase 1 uses uuid references). The policies below resolve the
-- workspace by text comparison first (never casting user-controlled data,
-- which would throw on legacy rows) and then delegate the membership check
-- to the same is_workspace_member() helper every other Phase 1 table uses.
-- A row whose workspace_id matches no workspace (or a non-uuid legacy value)
-- is simply invisible — fail closed.

-- Relationship defaults: workspace-scoped reads; updates only on drafts.
drop policy if exists "library_relationship_defaults_select_member" on public.library_relationship_defaults;
drop policy if exists "library_relationship_defaults_insert_member" on public.library_relationship_defaults;
drop policy if exists "library_relationship_defaults_update_member" on public.library_relationship_defaults;
drop policy if exists "library_relationship_defaults_delete_member" on public.library_relationship_defaults;

create policy "library_relationship_defaults_select_member"
  on public.library_relationship_defaults
  for select
  using (exists (
    select 1 from public.workspaces w
    where w.id::text = workspace_id and public.is_workspace_member(w.id)
  ));
create policy "library_relationship_defaults_insert_member"
  on public.library_relationship_defaults
  for insert
  with check (exists (
    select 1 from public.workspaces w
    where w.id::text = workspace_id and public.is_workspace_member(w.id)
  ));
create policy "library_relationship_defaults_update_member"
  on public.library_relationship_defaults
  for update
  using (exists (
    select 1 from public.workspaces w
    where w.id::text = workspace_id and public.is_workspace_member(w.id)
  ))
  with check (exists (
    select 1 from public.workspaces w
    where w.id::text = workspace_id and public.is_workspace_member(w.id)
  ));
create policy "library_relationship_defaults_delete_member"
  on public.library_relationship_defaults
  for delete
  using (exists (
    select 1 from public.workspaces w
    where w.id::text = workspace_id and public.is_workspace_member(w.id)
  ));

-- Asset bundles: workspace-scoped, draft-only application.
drop policy if exists "library_asset_bundles_select_member" on public.library_asset_bundles;
drop policy if exists "library_asset_bundles_insert_member" on public.library_asset_bundles;
drop policy if exists "library_asset_bundles_update_member" on public.library_asset_bundles;
drop policy if exists "library_asset_bundles_delete_member" on public.library_asset_bundles;

create policy "library_asset_bundles_select_member"
  on public.library_asset_bundles
  for select
  using (exists (
    select 1 from public.workspaces w
    where w.id::text = workspace_id and public.is_workspace_member(w.id)
  ));
create policy "library_asset_bundles_insert_member"
  on public.library_asset_bundles
  for insert
  with check (exists (
    select 1 from public.workspaces w
    where w.id::text = workspace_id and public.is_workspace_member(w.id)
  ));
create policy "library_asset_bundles_update_member"
  on public.library_asset_bundles
  for update
  using (exists (
    select 1 from public.workspaces w
    where w.id::text = workspace_id and public.is_workspace_member(w.id)
  ))
  with check (exists (
    select 1 from public.workspaces w
    where w.id::text = workspace_id and public.is_workspace_member(w.id)
  ));
create policy "library_asset_bundles_delete_member"
  on public.library_asset_bundles
  for delete
  using (exists (
    select 1 from public.workspaces w
    where w.id::text = workspace_id and public.is_workspace_member(w.id)
  ));

-- Bundle members: scoped by bundle + workspace.
drop policy if exists "library_asset_bundle_members_select_member" on public.library_asset_bundle_members;
drop policy if exists "library_asset_bundle_members_insert_member" on public.library_asset_bundle_members;
drop policy if exists "library_asset_bundle_members_update_member" on public.library_asset_bundle_members;
drop policy if exists "library_asset_bundle_members_delete_member" on public.library_asset_bundle_members;

create policy "library_asset_bundle_members_select_member"
  on public.library_asset_bundle_members
  for select
  using (exists (
    select 1 from public.workspaces w
    where w.id::text = workspace_id and public.is_workspace_member(w.id)
  ));
create policy "library_asset_bundle_members_insert_member"
  on public.library_asset_bundle_members
  for insert
  with check (exists (
    select 1 from public.workspaces w
    where w.id::text = workspace_id and public.is_workspace_member(w.id)
  ));
create policy "library_asset_bundle_members_update_member"
  on public.library_asset_bundle_members
  for update
  using (exists (
    select 1 from public.workspaces w
    where w.id::text = workspace_id and public.is_workspace_member(w.id)
  ))
  with check (exists (
    select 1 from public.workspaces w
    where w.id::text = workspace_id and public.is_workspace_member(w.id)
  ));
create policy "library_asset_bundle_members_delete_member"
  on public.library_asset_bundle_members
  for delete
  using (exists (
    select 1 from public.workspaces w
    where w.id::text = workspace_id and public.is_workspace_member(w.id)
  ));

-- Suggested assets: workspace-scoped, pending only visible.
drop policy if exists "library_suggested_assets_select_member" on public.library_suggested_assets;
drop policy if exists "library_suggested_assets_insert_member" on public.library_suggested_assets;
drop policy if exists "library_suggested_assets_update_member" on public.library_suggested_assets;
drop policy if exists "library_suggested_assets_delete_member" on public.library_suggested_assets;

create policy "library_suggested_assets_select_member"
  on public.library_suggested_assets
  for select
  using (exists (
    select 1 from public.workspaces w
    where w.id::text = workspace_id and public.is_workspace_member(w.id)
  ));
create policy "library_suggested_assets_insert_member"
  on public.library_suggested_assets
  for insert
  with check (exists (
    select 1 from public.workspaces w
    where w.id::text = workspace_id and public.is_workspace_member(w.id)
  ));
create policy "library_suggested_assets_update_member"
  on public.library_suggested_assets
  for update
  using (exists (
    select 1 from public.workspaces w
    where w.id::text = workspace_id and public.is_workspace_member(w.id)
  ))
  with check (exists (
    select 1 from public.workspaces w
    where w.id::text = workspace_id and public.is_workspace_member(w.id)
  ));
create policy "library_suggested_assets_delete_member"
  on public.library_suggested_assets
  for delete
  using (exists (
    select 1 from public.workspaces w
    where w.id::text = workspace_id and public.is_workspace_member(w.id)
  ));
