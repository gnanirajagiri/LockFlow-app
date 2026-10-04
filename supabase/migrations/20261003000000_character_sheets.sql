-- ═══════════════════════════════════════════════════════════════════════════
-- LockFlow — Prompt 26: Character Sheet protected trait rows + audit trail
--
-- Extends the models-domain Character Sheet (identity JSONB groups per model
-- version, 1:1 with model_versions) with the prompt-26 protection layer:
--
--   * character_sheet_traits — one explicit row per trait
--     (trait_group, trait_key, trait_value_json, protection_level,
--     is_editable) so protected identity traits are queryable, inspectable
--     and auditable rather than buried in JSONB.
--   * character_sheet_audit  — append-only audit trail for the structured
--     Character Sheet events: created / updated / locked / activated /
--     draft_created, protected-trait blocks and in-draft updates, reference
--     add/remove.
--
-- Product rules encoded here:
--   * Workspace membership gates every path, resolved through
--     character_sheets → model_versions → models. Trait and audit rows
--     inherit the owning sheet's workspace.
--   * Traits on a LOCKED version's sheet are immutable (trigger) — protected
--     identity changes must go through a new draft version.
--   * The audit trail is append-only: no UPDATE or DELETE policies.
--   * No secrets: trait rows and audit details carry metadata only; signed
--     URLs and storage internals never enter these tables.
-- ═══════════════════════════════════════════════════════════════════════════

create type public.character_sheet_protection_level as enum (
  'editable',
  'derived',
  'supporting',
  'protected',
  'locked'
);

-- ── Explicit trait rows ──────────────────────────────────────────────────────
create table public.character_sheet_traits (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces (id) on delete cascade,
  character_sheet_id uuid not null references public.character_sheets (id) on delete cascade,
  trait_group      text not null check (trait_group in (
    'identity', 'faceFeatures', 'hairIdentity', 'complexion',
    'bodyProportions', 'distinctiveDetails', 'lockRules', 'referenceNotes'
  )),
  trait_key        text not null check (char_length(trait_key) between 1 and 120),
  trait_value_json jsonb not null default '{}'::jsonb,
  protection_level character_sheet_protection_level not null default 'protected',
  is_editable      boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- One row per trait per sheet: the UI never renders duplicates, and a
  -- protected trait has exactly one authoritative value per version.
  unique (character_sheet_id, trait_group, trait_key)
);

create index character_sheet_traits_sheet_idx
  on public.character_sheet_traits (character_sheet_id);
create index character_sheet_traits_workspace_idx
  on public.character_sheet_traits (workspace_id);

create trigger trg_character_sheet_traits_updated_at
  before update on public.character_sheet_traits
  for each row execute function public.set_updated_at();

-- Protected traits on a locked version's sheet are immutable — the same rule
-- the character_sheets lock guard enforces for the JSONB groups.
create function public.guard_character_sheet_traits_locked()
returns trigger
language plpgsql
as $$
declare
  v_sheet_id uuid := coalesce(new.character_sheet_id, old.character_sheet_id);
begin
  if exists (
    select 1
    from public.character_sheets cs
    join public.model_versions v on v.id = cs.model_version_id
    where cs.id = v_sheet_id and v.status = 'locked'
  ) then
    raise exception 'character sheet traits belong to a locked version and are immutable'
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger trg_character_sheet_traits_lock_guard
  before insert or update or delete on public.character_sheet_traits
  for each row execute function public.guard_character_sheet_traits_locked();

-- ── Append-only audit trail ──────────────────────────────────────────────────
create table public.character_sheet_audit (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  character_sheet_id uuid not null references public.character_sheets (id) on delete cascade,
  event             text not null check (event in (
    'character_sheet_created',
    'character_sheet_updated',
    'character_sheet_locked',
    'character_sheet_activated',
    'character_sheet_draft_created',
    'protected_trait_edit_blocked',
    'protected_trait_updated_in_draft',
    'character_sheet_reference_added',
    'character_sheet_reference_removed'
  )),
  actor_id          uuid references auth.users (id) on delete set null,
  detail            text,
  created_at        timestamptz not null default now()
);

create index character_sheet_audit_sheet_idx
  on public.character_sheet_audit (character_sheet_id);
create index character_sheet_audit_workspace_idx
  on public.character_sheet_audit (workspace_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- Row-level security — workspace membership, inherited via the sheet.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.character_sheet_traits enable row level security;
alter table public.character_sheet_audit enable row level security;

-- character_sheet_traits ─────────────────────────────────────────────────────
create policy "character_sheet_traits_select_member" on public.character_sheet_traits
  for select using (
    exists (
      select 1
      from public.character_sheets cs
      join public.model_versions v on v.id = cs.model_version_id
      join public.models m on m.id = v.model_id
      where cs.id = character_sheet_id
        and public.is_workspace_member(m.workspace_id)
    )
  );

create policy "character_sheet_traits_insert_member" on public.character_sheet_traits
  for insert with check (
    public.is_workspace_member(workspace_id)
    and exists (
      select 1
      from public.character_sheets cs
      join public.model_versions v on v.id = cs.model_version_id
      join public.models m on m.id = v.model_id
      where cs.id = character_sheet_id
        and m.workspace_id = workspace_id
    )
  );

create policy "character_sheet_traits_update_member" on public.character_sheet_traits
  for update using (
    exists (
      select 1
      from public.character_sheets cs
      join public.model_versions v on v.id = cs.model_version_id
      join public.models m on m.id = v.model_id
      where cs.id = character_sheet_id
        and public.is_workspace_member(m.workspace_id)
    )
  )
  with check (
    public.is_workspace_member(workspace_id)
    and exists (
      select 1
      from public.character_sheets cs
      join public.model_versions v on v.id = cs.model_version_id
      join public.models m on m.id = v.model_id
      where cs.id = character_sheet_id
        and m.workspace_id = workspace_id
    )
  );

create policy "character_sheet_traits_delete_member" on public.character_sheet_traits
  for delete using (
    exists (
      select 1
      from public.character_sheets cs
      join public.model_versions v on v.id = cs.model_version_id
      join public.models m on m.id = v.model_id
      where cs.id = character_sheet_id
        and public.is_workspace_member(m.workspace_id)
    )
  );

-- character_sheet_audit (append-only: select + insert, never update/delete) ──
create policy "character_sheet_audit_select_member" on public.character_sheet_audit
  for select using (
    exists (
      select 1
      from public.character_sheets cs
      join public.model_versions v on v.id = cs.model_version_id
      join public.models m on m.id = v.model_id
      where cs.id = character_sheet_id
        and public.is_workspace_member(m.workspace_id)
    )
  );

create policy "character_sheet_audit_insert_member" on public.character_sheet_audit
  for insert with check (
    public.is_workspace_member(workspace_id)
    and exists (
      select 1
      from public.character_sheets cs
      join public.model_versions v on v.id = cs.model_version_id
      join public.models m on m.id = v.model_id
      where cs.id = character_sheet_id
        and m.workspace_id = workspace_id
    )
  );
