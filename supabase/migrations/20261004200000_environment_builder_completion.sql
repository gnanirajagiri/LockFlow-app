-- ═══════════════════════════════════════════════════════════════════════════
-- LockFlow — Prompt 33: Environment Builder completion (reference import,
-- props/camera views, lock-and-save).
--
-- Minimal by design: draft status, active version, lock state, the defining
-- spec anchors and reference associations already live on environments /
-- environment_versions / environment_specs / environment_references.
-- Reference ROLE is derived (caption tag) — never duplicated in a column.
--
-- The new tables cover what has no home yet:
--   * environment_camera_views — reusable, environment-specific camera/view
--     records (angle, optional dolly/trolley movement metadata). Staging
--     metadata only — never model identity traits, never global.
--   * environment_version_asset_links — version-scoped Library asset
--     pointers (props/furniture/lighting), explicit + reversible.
--   * environment_builder_audit — the builder's own append-only trail with
--     its dedicated event vocabulary (environment audit stays untouched).
--
-- Rules encoded:
--   * Workspace membership gates every row (RLS via is_workspace_member).
--   * Camera-view rows and the audit are append-safe (select+insert policies
--     on the audit; camera views may be removed on drafts by service guards).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── A. Environment camera / view records ────────────────────────────────────
create table public.environment_camera_views (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  environment_version_id uuid not null references public.environment_versions (id) on delete cascade,
  name              text not null check (char_length(name) between 1 and 80),
  angle             text,
  movement          text check (movement in ('static', 'dolly_in', 'dolly_out', 'trolley_left', 'trolley_right')),
  configuration_json jsonb,
  created_by        uuid not null references auth.users (id) on delete cascade,
  created_at        timestamptz not null default now()
);

create index environment_camera_views_version_idx
  on public.environment_camera_views (environment_version_id);

-- ── B. Version-scoped Library asset links (explicit + reversible) ───────────
create table public.environment_version_asset_links (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  environment_version_id uuid not null references public.environment_versions (id) on delete cascade,
  library_asset_id  uuid not null references public.library_assets (id) on delete cascade,
  category          text not null check (category in (
                      'furniture', 'prop', 'product', 'lighting', 'decor', 'other')),
  added_by          uuid not null references auth.users (id) on delete cascade,
  created_at        timestamptz not null default now(),
  unique (environment_version_id, library_asset_id, category)
);

create index environment_version_asset_links_version_idx
  on public.environment_version_asset_links (environment_version_id);

-- ── C. Append-only audit trail ───────────────────────────────────────────────
create table public.environment_builder_audit (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  environment_version_id uuid not null references public.environment_versions (id) on delete cascade,
  event             text not null check (event in (
    'environment_draft_created',
    'environment_reference_added',
    'environment_asset_attached',
    'environment_camera_view_saved',
    'environment_readiness_checked',
    'environment_lock_blocked',
    'environment_version_locked',
    'environment_draft_created_from_locked_version'
  )),
  detail            text,
  created_at        timestamptz not null default now()
);

create index environment_builder_audit_version_idx
  on public.environment_builder_audit (environment_version_id);
create index environment_builder_audit_workspace_idx
  on public.environment_builder_audit (workspace_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- Row-level security — workspace-scoped access only
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.environment_camera_views enable row level security;
alter table public.environment_version_asset_links enable row level security;
alter table public.environment_builder_audit enable row level security;

create policy "environment_camera_views_select_member" on public.environment_camera_views
  for select using (public.is_workspace_member(workspace_id));
create policy "environment_camera_views_insert_member" on public.environment_camera_views
  for insert with check (public.is_workspace_member(workspace_id) and auth.uid() = created_by);
create policy "environment_camera_views_delete_member" on public.environment_camera_views
  for delete using (public.is_workspace_member(workspace_id));

create policy "environment_version_asset_links_select_member" on public.environment_version_asset_links
  for select using (public.is_workspace_member(workspace_id));
create policy "environment_version_asset_links_insert_member" on public.environment_version_asset_links
  for insert with check (public.is_workspace_member(workspace_id) and auth.uid() = added_by);
create policy "environment_version_asset_links_delete_member" on public.environment_version_asset_links
  for delete using (public.is_workspace_member(workspace_id));

-- Audit: append-only — select + insert, never update/delete.
create policy "environment_builder_audit_select_member" on public.environment_builder_audit
  for select using (public.is_workspace_member(workspace_id));
create policy "environment_builder_audit_insert_member" on public.environment_builder_audit
  for insert with check (public.is_workspace_member(workspace_id));
