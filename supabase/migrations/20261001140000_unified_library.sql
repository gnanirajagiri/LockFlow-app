-- ═══════════════════════════════════════════════════════════════════════════
-- LockFlow — Unified Library foundation (Prompt 21)
--
-- Extends the EXISTING library_assets system additively. LockFlow has exactly
-- ONE Library: reusable workspace assets organized by WHERE they are used
-- (on a model, on an item, in an environment, or shared). Generated outputs
-- stay in Gallery — nothing here touches gallery_* tables.
--
-- Rules encoded here:
--   * usage_scope + the linked_* columns form the taxonomy axis; a CHECK
--     keeps scope and links consistent (a scoped usage requires its link,
--     and no asset mixes entity links unless scope is 'shared').
--   * Links are real foreign keys into the workspace's own models, content
--     scenes (reusable items) and environments — cross-workspace links are
--     impossible because the parents are workspace-scoped.
--   * primary_file_id / thumbnail_file_id are SAFE file references
--     (storage object ids), never signed URLs or secrets.
--   * Archived assets stay inspectable (archived_at/archived_by) and are
--     excluded from default picker flows by the SERVICE, not by hiding.
--   * library_asset_events is an append-only, workspace-scoped audit trail.
--   * RLS: same member-scoped pattern as the existing Library tables; the
--     events table is readable by members, writable only service-side.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── A. Taxonomy enums ───────────────────────────────────────────────────────
create type public.library_usage_scope as enum ('model', 'item', 'environment', 'shared');
create type public.library_source_kind as enum ('manual', 'reference_upload', 'generated_derivative', 'import');
create type public.library_event_type as enum (
  'library_asset_created', 'library_asset_updated', 'library_asset_archived',
  'library_asset_restored', 'library_asset_viewed', 'library_picker_opened',
  'library_asset_attached'
);

-- ── B. library_assets — additive taxonomy columns ───────────────────────────
alter table public.library_assets
  add column if not exists usage_scope public.library_usage_scope,
  add column if not exists source_kind public.library_source_kind default 'manual',
  add column if not exists linked_model_id uuid references public.models (id) on delete set null,
  add column if not exists linked_item_id uuid references public.content_scenes (id) on delete set null,
  add column if not exists linked_environment_id uuid references public.environments (id) on delete set null,
  add column if not exists linked_brand_id uuid,
  add column if not exists primary_file_id text,
  add column if not exists thumbnail_file_id text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid;

-- Scope/link consistency (recreate defensively for idempotent re-runs).
alter table public.library_assets
  drop constraint if exists library_assets_scope_links_guard;
alter table public.library_assets
  add constraint library_assets_scope_links_guard check (
    -- scoped usage requires its link, and nothing else
    (
      usage_scope in ('model', 'item', 'environment')
      and (
        (usage_scope = 'model' and linked_model_id is not null)
        or (usage_scope = 'item' and linked_item_id is not null)
        or (usage_scope = 'environment' and linked_environment_id is not null)
      )
      and (usage_scope = 'model' or linked_model_id is null)
      and (usage_scope = 'item' or linked_item_id is null)
      and (usage_scope = 'environment' or linked_environment_id is null)
    )
    -- shared may carry at most one primary-context link
    or (
      usage_scope = 'shared'
      and (
        (linked_model_id is not null)::int
        + (linked_item_id is not null)::int
        + (linked_environment_id is not null)::int
      ) <= 1
    )
    -- legacy rows may be entirely unset
    or usage_scope is null
  );

-- Filters and pickers lean on these indexes.
create index if not exists library_assets_scope_idx
  on public.library_assets (workspace_id, usage_scope);
create index if not exists library_assets_status_idx
  on public.library_assets (workspace_id, status, updated_at desc);
create index if not exists library_assets_archived_idx
  on public.library_assets (workspace_id, archived_at);
create index if not exists library_assets_model_idx
  on public.library_assets (linked_model_id) where linked_model_id is not null;
create index if not exists library_assets_item_idx
  on public.library_assets (linked_item_id) where linked_item_id is not null;
create index if not exists library_assets_environment_idx
  on public.library_assets (linked_environment_id) where linked_environment_id is not null;
create index if not exists library_assets_name_trgm_idx
  on public.library_assets (lower(name));

-- ── C. Audit trail (append-only, workspace-scoped) ──────────────────────────
create table if not exists public.library_asset_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  library_asset_id uuid references public.library_assets (id) on delete set null,
  actor_id uuid references auth.users (id) on delete set null,
  event_type public.library_event_type not null,
  message text not null check (char_length(message) between 1 and 400),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists library_asset_events_asset_idx
  on public.library_asset_events (library_asset_id, created_at desc);
create index if not exists library_asset_events_workspace_idx
  on public.library_asset_events (workspace_id, created_at desc);

create or replace function public.library_events_append_only()
returns trigger as $$
begin
  raise exception 'library_asset_events are append-only.';
end;
$$ language plpgsql;

drop trigger if exists library_asset_events_no_update on public.library_asset_events;
create trigger library_asset_events_no_update
  before update on public.library_asset_events
  for each row execute function public.library_events_append_only();
drop trigger if exists library_asset_events_no_delete on public.library_asset_events;
create trigger library_asset_events_no_delete
  before delete on public.library_asset_events
  for each row execute function public.library_events_append_only();

create or replace function public.library_event_metadata_guard()
returns trigger as $$
begin
  if octet_length(new.metadata::text) > 512 then
    raise exception 'library_asset_events.metadata exceeds 512 bytes — keep metadata audit-safe.';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists library_asset_events_metadata_guard on public.library_asset_events;
create trigger library_asset_events_metadata_guard
  before insert or update on public.library_asset_events
  for each row execute function public.library_event_metadata_guard();

-- ── D. RLS ──────────────────────────────────────────────────────────────────
-- (library_assets already has RLS + member policies from the foundation
-- migration; the new columns inherit those policies automatically.)

alter table public.library_asset_events enable row level security;

create policy library_asset_events_read
  on public.library_asset_events for select
  to authenticated using (public.is_workspace_member(workspace_id, auth.uid()));

-- No insert/update/delete policies on purpose: audit writes are service-side
-- (service role bypasses RLS), keeping the trail tamper-evident.

-- ── E. Picker/attach helper: active + ready defaults, workspace-scoped ──────
create or replace function public.library_picker_asset_ids(
  p_workspace_id uuid,
  p_usage_scope public.library_usage_scope default null,
  p_include_drafts boolean default false
)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $fn$
  select a.id
  from public.library_assets a
  where a.workspace_id = p_workspace_id
    and a.archived_at is null
    and a.status = case when p_include_drafts then a.status else 'ready'::library_asset_status end
    and (p_usage_scope is null or a.usage_scope = p_usage_scope)
  order by a.updated_at desc;
$fn$;

-- NOTE: no gallery interplay here. Gallery = generated outputs; Library =
-- reusable assets. The boundary is enforced by schema separation.
