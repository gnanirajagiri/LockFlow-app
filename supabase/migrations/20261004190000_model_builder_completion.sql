-- ═══════════════════════════════════════════════════════════════════════════
-- LockFlow — Prompt 32: Model Builder completion (reference import,
-- coverage, lock-and-save).
--
-- Minimal by design: draft status, active version, lock state and reference
-- associations already live on models / model_versions / character_sheets /
-- model_references (20260926000001, 20261003000000). Builder workflow state
-- (reference roles, coverage, readiness) is derived — never duplicated.
--
-- The only new table is the builder's own append-only audit trail with its
-- dedicated event vocabulary. The prompt-26 Character Sheet audit keeps its
-- own closed set; builder events never masquerade there.
--
-- Rules encoded:
--   * Workspace membership gates every row (RLS via is_workspace_member).
--   * The audit is append-only (select + insert policies only).
-- ═══════════════════════════════════════════════════════════════════════════

create table public.model_builder_audit (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  model_version_id  uuid not null references public.model_versions (id) on delete cascade,
  event             text not null check (event in (
    'model_draft_created',
    'model_reference_added',
    'model_reference_removed',
    'model_readiness_checked',
    'model_lock_blocked',
    'model_version_locked',
    'model_draft_created_from_locked_version',
    'model_character_sheet_linked'
  )),
  detail            text,
  created_at        timestamptz not null default now()
);

create index model_builder_audit_version_idx
  on public.model_builder_audit (model_version_id);
create index model_builder_audit_workspace_idx
  on public.model_builder_audit (workspace_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- Row-level security — workspace-scoped access only
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.model_builder_audit enable row level security;

create policy "model_builder_audit_select_member" on public.model_builder_audit
  for select using (public.is_workspace_member(workspace_id));
create policy "model_builder_audit_insert_member" on public.model_builder_audit
  for insert with check (public.is_workspace_member(workspace_id));
