-- ═══════════════════════════════════════════════════════════════════════════
-- LockFlow — Prompt 34: Content Studio scenes, Beats, storyboard editing and
-- locked generation handoff.
--
-- Minimal by design: content_projects / content_scenes / content_beats and
-- their ordering already exist (20260928000000). This migration adds what has
-- no home yet:
--   * content_beats.beat_type + motion_config — the beat taxonomy and the
--     camera/motion staging metadata (action, camera, dialogue, product,
--     transition; dolly/trolley movement etc.). Staging data only — never
--     model identity traits.
--   * content_scene_asset_bindings — version-pinned model/environment/Library
--     inputs per scene (sourceRecord + version, never loose records).
--   * content_scene_generation_handoffs — the locked scene/storyboard
--     snapshot captured at handoff time (immutable JSON payload + link to
--     the draft content job the generation services submit under).
--   * content_studio_audit — the studio's own append-only trail (9 events).
--
-- Rules encoded:
--   * Workspace membership gates every row (RLS via is_workspace_member).
--   * Scenes/Beats stay workspace-scoped through project ownership; bindings
--     and handoffs are scoped through their scene.
--   * Audit is select+insert only (append-only).
--   * Snapshots store safe labels/ids only — never storage paths, provider
--     payloads or secrets (enforced by the service layer; JSONB columns are
--     intentionally untyped so schema changes never strand history).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── A. Beat taxonomy + camera/motion staging metadata ───────────────────────
alter table public.content_beats
  add column if not exists beat_type text not null default 'action'
    check (beat_type in ('action', 'camera', 'dialogue', 'product', 'transition')),
  add column if not exists motion_config jsonb;

-- ── B. Version-pinned scene bindings ────────────────────────────────────────
create table public.content_scene_asset_bindings (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  content_scene_id  uuid not null references public.content_scenes (id) on delete cascade,
  binding_kind      text not null check (binding_kind in (
                      'model_version', 'environment_version', 'library_asset')),
  ref_id            uuid not null,
  label             text not null default '',
  role              text,
  created_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  unique (content_scene_id, binding_kind, ref_id)
);

create index content_scene_asset_bindings_scene_idx
  on public.content_scene_asset_bindings (content_scene_id);
create index content_scene_asset_bindings_workspace_idx
  on public.content_scene_asset_bindings (workspace_id);

-- ── C. Locked generation handoff snapshots ──────────────────────────────────
create table public.content_scene_generation_handoffs (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces (id) on delete cascade,
  content_scene_id    uuid not null references public.content_scenes (id) on delete cascade,
  content_project_id  uuid not null references public.content_projects (id) on delete cascade,
  generation_type     text not null check (generation_type in ('image', 'video', 'story', 'content_set')),
  snapshot            jsonb not null,
  content_job_request_id uuid references public.content_job_requests (id) on delete set null,
  status              text not null default 'snapshot_created'
                        check (status in ('snapshot_created', 'submitted', 'failed')),
  created_by          uuid references auth.users (id) on delete set null,
  created_at          timestamptz not null default now()
);

create index content_scene_generation_handoffs_scene_idx
  on public.content_scene_generation_handoffs (content_scene_id);
create index content_scene_generation_handoffs_workspace_idx
  on public.content_scene_generation_handoffs (workspace_id);

-- ── D. Append-only audit trail ──────────────────────────────────────────────
create table public.content_studio_audit (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces (id) on delete cascade,
  content_project_id  uuid references public.content_projects (id) on delete set null,
  content_scene_id    uuid references public.content_scenes (id) on delete set null,
  event               text not null check (event in (
    'content_project_created',
    'scene_created',
    'scene_reordered',
    'beat_created',
    'beat_reordered',
    'storyboard_updated',
    'scene_generation_snapshot_created',
    'scene_generation_validation_blocked',
    'scene_generation_submitted'
  )),
  detail              text,
  created_at          timestamptz not null default now()
);

create index content_studio_audit_project_idx
  on public.content_studio_audit (content_project_id);
create index content_studio_audit_scene_idx
  on public.content_studio_audit (content_scene_id);
create index content_studio_audit_workspace_idx
  on public.content_studio_audit (workspace_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- Row-level security — workspace-scoped access only
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.content_scene_asset_bindings enable row level security;
alter table public.content_scene_generation_handoffs enable row level security;
alter table public.content_studio_audit enable row level security;

create policy "content_scene_bindings_select_member" on public.content_scene_asset_bindings
  for select using (public.is_workspace_member(workspace_id));
create policy "content_scene_bindings_insert_member" on public.content_scene_asset_bindings
  for insert with check (public.is_workspace_member(workspace_id));
create policy "content_scene_bindings_delete_member" on public.content_scene_asset_bindings
  for delete using (public.is_workspace_member(workspace_id));

create policy "content_scene_handoffs_select_member" on public.content_scene_generation_handoffs
  for select using (public.is_workspace_member(workspace_id));
create policy "content_scene_handoffs_insert_member" on public.content_scene_generation_handoffs
  for insert with check (public.is_workspace_member(workspace_id));
create policy "content_scene_handoffs_update_member" on public.content_scene_generation_handoffs
  for update using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

-- Audit: append-only — select + insert, never update/delete.
create policy "content_studio_audit_select_member" on public.content_studio_audit
  for select using (public.is_workspace_member(workspace_id));
create policy "content_studio_audit_insert_member" on public.content_studio_audit
  for insert with check (public.is_workspace_member(workspace_id));
