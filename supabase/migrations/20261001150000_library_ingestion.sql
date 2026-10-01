-- ═══════════════════════════════════════════════════════════════════════════
-- LockFlow — Library ingestion, attachment & picker workflows (Prompt 22)
--
-- Purely additive on the Prompt 21 unified Library. LockFlow still has
-- EXACTLY ONE Library: this layer adds HOW assets enter it (upload, import,
-- URL, manual, prompt-assisted) and HOW they are referenced elsewhere
-- (attachments point at canonical Library assets; they never copy them).
--
-- Rules encoded here:
--   * library_asset_files stores SAFE file references (private-bucket
--     bucket+path pairs, allow-listed) — never signed URLs or secrets.
--   * library_asset_attachments is workspace-scoped and polymorphic on
--     purpose (target_type + target_id): concrete wiring into content
--     scenes / job pins / campaigns stays owned by those domains, while
--     the Library records the reusable reference. Same-workspace integrity
--     is enforced service-side via the target-domain validators and RLS.
--   * One primary attachment per role/slot: a partial unique index makes
--     double-primaries impossible at the database level.
--   * An asset may be attached to a target at most once (no duplicates).
--   * Gallery outputs are never ingested here: no gallery_* table is
--     referenced; `generated_derivative` provenance stays a label.
--   * Audit enum gains the Prompt 22 events; the trail stays append-only.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── A. Audit enum — Prompt 22 events (no values used in this migration) ────
alter type public.library_event_type add value if not exists 'library_asset_add_started';
alter type public.library_event_type add value if not exists 'library_asset_parse_suggested';
alter type public.library_event_type add value if not exists 'library_asset_detached';
alter type public.library_event_type add value if not exists 'library_inline_add_started';

-- ── B. library_assets — rights/usage note (metadata model addition) ────────
alter table public.library_assets
  add column if not exists rights_or_usage_note text;

-- ── C. Asset files — safe references to PRIVATE storage objects ────────────
create table if not exists public.library_asset_files (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  library_asset_id uuid not null references public.library_assets (id) on delete cascade,
  -- Allow-listed private buckets only (same pair the reference-upload flow uses).
  storage_bucket text not null check (storage_bucket in ('lockflow-references', 'lockflow-previews')),
  storage_path text not null check (char_length(storage_path) between 1 and 512),
  file_name text not null check (char_length(file_name) between 1 and 200),
  mime_type text not null check (
    mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif', 'application/pdf')
  ),
  file_size_bytes bigint check (file_size_bytes is null or (file_size_bytes > 0 and file_size_bytes <= 26214400)),
  -- URL-import provenance: absolute http(s) URLs only, no credentials.
  source_url text check (
    source_url is null or (source_url ~ '^https?://[^@]+$' and char_length(source_url) <= 1000)
  ),
  file_kind text not null default 'image' check (file_kind in ('image', 'document', 'other')),
  upload_status text not null default 'pending' check (upload_status in ('pending', 'uploaded', 'failed', 'deleted')),
  uploaded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, storage_bucket, storage_path)
);

create index if not exists library_asset_files_asset_idx
  on public.library_asset_files (library_asset_id, created_at desc);
create index if not exists library_asset_files_workspace_idx
  on public.library_asset_files (workspace_id, created_at desc);

-- ── D. Attachments — canonical references into other workflows ─────────────
create type public.library_attachment_target as enum (
  'content_scene', 'content_job', 'campaign', 'model', 'environment'
);

create table if not exists public.library_asset_attachments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  library_asset_id uuid not null references public.library_assets (id) on delete cascade,
  target_type public.library_attachment_target not null,
  target_id uuid not null,
  role_or_slot text not null default 'reference' check (char_length(role_or_slot) between 1 and 60),
  is_primary boolean not null default false,
  attached_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- No duplicate attach of the same asset to the same target/slot.
create unique index if not exists library_asset_attachments_unique
  on public.library_asset_attachments (workspace_id, target_type, target_id, library_asset_id, role_or_slot);

-- ONE primary per role/slot on a target (partial unique index).
create unique index if not exists library_asset_attachments_single_primary
  on public.library_asset_attachments (workspace_id, target_type, target_id, role_or_slot)
  where is_primary;

create index if not exists library_asset_attachments_target_idx
  on public.library_asset_attachments (workspace_id, target_type, target_id);
create index if not exists library_asset_attachments_asset_idx
  on public.library_asset_attachments (library_asset_id, created_at desc);

-- ── E. RLS — same member-scoped pattern as the rest of the Library ─────────
alter table public.library_asset_files enable row level security;
alter table public.library_asset_attachments enable row level security;

create policy library_asset_files_select
  on public.library_asset_files for select to authenticated
  using (public.is_workspace_member(workspace_id, auth.uid()));
create policy library_asset_files_insert
  on public.library_asset_files for insert to authenticated
  with check (public.is_workspace_member(workspace_id, auth.uid()));
create policy library_asset_files_update
  on public.library_asset_files for update to authenticated
  using (public.is_workspace_member(workspace_id, auth.uid()))
  with check (public.is_workspace_member(workspace_id, auth.uid()));
create policy library_asset_files_delete
  on public.library_asset_files for delete to authenticated
  using (public.is_workspace_member(workspace_id, auth.uid()));

create policy library_asset_attachments_select
  on public.library_asset_attachments for select to authenticated
  using (public.is_workspace_member(workspace_id, auth.uid()));
create policy library_asset_attachments_insert
  on public.library_asset_attachments for insert to authenticated
  with check (public.is_workspace_member(workspace_id, auth.uid()));
create policy library_asset_attachments_update
  on public.library_asset_attachments for update to authenticated
  using (public.is_workspace_member(workspace_id, auth.uid()))
  with check (public.is_workspace_member(workspace_id, auth.uid()));
create policy library_asset_attachments_delete
  on public.library_asset_attachments for delete to authenticated
  using (public.is_workspace_member(workspace_id, auth.uid()));

-- NOTE: archived assets are not blocked at the schema level — existing
-- attachments must remain inspectable. The SERVICE refuses NEW attachments
-- to archived assets (the UI may explicitly expose them with a warning).
-- NOTE: no gallery interplay anywhere; the Library/Gallery boundary holds.
