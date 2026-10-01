-- ═══════════════════════════════════════════════════════════════════════════
-- LockFlow — Secure reference uploads (private, workspace-scoped media)
--
-- Replaces local reference placeholders with private Supabase Storage uploads
-- for Model, Environment and Library Asset references. Product rules encoded:
--   * Reference media is PRIVATE: two private buckets, path-scoped storage
--     policies, short-lived signed URLs, no anon access, no public URLs.
--   * Uploads belong to a specific VERSION (never directly to a model /
--     environment / asset). Gallery outputs are untouched.
--   * Locked/superseded versions are read-only: the existing immutability
--     triggers already reject every UPDATE/DELETE of their references —
--     including upload_status flips — so locked history is preserved.
--   * Rights acknowledgement is mandatory and auditable (rights_confirmed_*).
--   * No visual analysis: an upload stores an image + user metadata only.
--
-- NOTE ON VERIFICATION LIMITS: this project has no server-side image
-- processing runtime, so file signatures and image dimensions are validated
-- client-side before upload (src/features/media/validateUpload.ts) and the
-- database enforces mime/size constraints declaratively. Nothing here claims
-- server-side magic-byte or dimension verification.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── A. Buckets (private) ────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values
  ('lockflow-references', 'lockflow-references', false),
  ('lockflow-previews', 'lockflow-previews', false)
on conflict (id) do nothing;

-- ── B. Extend the three reference tables (consistently, no new tables) ──────
create type public.reference_upload_status as enum ('pending', 'uploaded', 'failed', 'deleted');

-- workspace_id is backfilled from the owning version chain so every reference
-- row is workspace-scoped like the rest of the schema. Legacy placeholder rows
-- (placeholders/*.svg) keep upload_status 'uploaded' so existing UI keeps
-- rendering them until replaced by real uploads.
alter table public.model_references
  add column if not exists workspace_id uuid references public.workspaces (id) on delete cascade,
  add column if not exists storage_bucket text,
  add column if not exists original_filename text,
  add column if not exists display_filename text,
  add column if not exists mime_type text,
  add column if not exists file_size_bytes bigint,
  add column if not exists width integer,
  add column if not exists height integer,
  add column if not exists rights_confirmed_at timestamptz,
  add column if not exists rights_confirmed_by uuid,
  add column if not exists upload_status public.reference_upload_status not null default 'uploaded',
  add column if not exists deleted_at timestamptz;

alter table public.environment_references
  add column if not exists workspace_id uuid references public.workspaces (id) on delete cascade,
  add column if not exists storage_bucket text,
  add column if not exists original_filename text,
  add column if not exists display_filename text,
  add column if not exists mime_type text,
  add column if not exists file_size_bytes bigint,
  add column if not exists width integer,
  add column if not exists height integer,
  add column if not exists rights_confirmed_at timestamptz,
  add column if not exists rights_confirmed_by uuid,
  add column if not exists upload_status public.reference_upload_status not null default 'uploaded',
  add column if not exists deleted_at timestamptz;

alter table public.library_asset_references
  add column if not exists workspace_id uuid references public.workspaces (id) on delete cascade,
  add column if not exists storage_bucket text,
  add column if not exists original_filename text,
  add column if not exists display_filename text,
  add column if not exists mime_type text,
  add column if not exists file_size_bytes bigint,
  add column if not exists width integer,
  add column if not exists height integer,
  add column if not exists rights_confirmed_at timestamptz,
  add column if not exists rights_confirmed_by uuid,
  add column if not exists upload_status public.reference_upload_status not null default 'uploaded',
  add column if not exists deleted_at timestamptz;

-- Backfill workspace_id from each version chain (versions carry no
-- workspace_id; it lives on the asset parent: models / environments /
-- library_assets).
update public.model_references r
set workspace_id = m.workspace_id
from public.model_versions v
join public.models m on m.id = v.model_id
where r.model_version_id = v.id and r.workspace_id is null;

update public.environment_references r
set workspace_id = e.workspace_id
from public.environment_versions v
join public.environments e on e.id = v.environment_id
where r.environment_version_id = v.id and r.workspace_id is null;

update public.library_asset_references r
set workspace_id = a.workspace_id
from public.library_asset_versions v
join public.library_assets a on a.id = v.library_asset_id
where r.library_asset_version_id = v.id and r.workspace_id is null;

-- From here on the column is required.
alter table public.model_references
  alter column workspace_id set not null,
  add constraint model_references_mime_allowed
    check (mime_type is null or mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  add constraint model_references_file_size_positive
    check (file_size_bytes is null or file_size_bytes > 0),
  add constraint model_references_file_size_limit
    check (file_size_bytes is null or file_size_bytes <= 10485760);

alter table public.environment_references
  alter column workspace_id set not null,
  add constraint environment_references_mime_allowed
    check (mime_type is null or mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  add constraint environment_references_file_size_positive
    check (file_size_bytes is null or file_size_bytes > 0),
  add constraint environment_references_file_size_limit
    check (file_size_bytes is null or file_size_bytes <= 10485760);

alter table public.library_asset_references
  alter column workspace_id set not null,
  add constraint library_asset_references_mime_allowed
    check (mime_type is null or mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  add constraint library_asset_references_file_size_positive
    check (file_size_bytes is null or file_size_bytes > 0),
  add constraint library_asset_references_file_size_limit
    check (file_size_bytes is null or file_size_bytes <= 10485760);

create index if not exists model_references_workspace_idx on public.model_references (workspace_id);
create index if not exists environment_references_workspace_idx on public.environment_references (workspace_id);
create index if not exists library_asset_references_workspace_idx on public.library_asset_references (workspace_id);

-- Workspace consistency: a reference's workspace must equal its version's.
create function public.guard_reference_workspace_consistency()
returns trigger
language plpgsql
as $$
declare
  v_version_workspace uuid;
begin
  if tg_table_name = 'model_references' then
    select workspace_id into v_version_workspace from public.model_versions where id = new.model_version_id;
  elsif tg_table_name = 'environment_references' then
    select workspace_id into v_version_workspace from public.environment_versions where id = new.environment_version_id;
  else
    select workspace_id into v_version_workspace from public.library_asset_versions where id = new.library_asset_version_id;
  end if;

  if v_version_workspace is null or v_version_workspace <> new.workspace_id then
    raise exception 'reference workspace must match the owning version workspace'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger trg_model_references_workspace_guard
  before insert or update on public.model_references
  for each row execute function public.guard_reference_workspace_consistency();

create trigger trg_environment_references_workspace_guard
  before insert or update on public.environment_references
  for each row execute function public.guard_reference_workspace_consistency();

create trigger trg_library_references_workspace_guard
  before insert or update on public.library_asset_references
  for each row execute function public.guard_reference_workspace_consistency();

-- ── C. Upload audit events (append-only traceability) ───────────────────────
create table public.upload_audit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  actor_id uuid not null references auth.users (id) on delete cascade,
  target_type text not null check (target_type in ('model_reference', 'environment_reference', 'library_asset_reference')),
  target_reference_id uuid,
  event_type text not null check (event_type in (
    'upload_requested', 'upload_completed', 'upload_failed',
    'metadata_updated', 'soft_deleted', 'signed_url_requested'
  )),
  storage_bucket text,
  storage_path text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index upload_audit_events_workspace_idx on public.upload_audit_events (workspace_id, created_at);
create index upload_audit_events_reference_idx on public.upload_audit_events (target_reference_id);

alter table public.upload_audit_events enable row level security;

create policy "upload_audit_events_select_member" on public.upload_audit_events
  for select using (public.is_workspace_member(workspace_id));

create policy "upload_audit_events_insert_member" on public.upload_audit_events
  for insert with check (
    public.is_workspace_member(workspace_id) and auth.uid() = actor_id
  );

-- No update/delete policies: audit history is append-only by default-deny.

-- ── D. Storage policies — workspace derived from the OBJECT PATH, never a
--      client-supplied id. Path shape: workspaces/{wsId}/... ─────────────────
create policy "refs_select_own_workspace"
on storage.objects for select to authenticated
using (
  bucket_id in ('lockflow-references', 'lockflow-previews')
  and public.is_workspace_member(split_part(name, '/', 2)::uuid)
);

create policy "refs_insert_own_workspace"
on storage.objects for insert to authenticated
with check (
  bucket_id in ('lockflow-references', 'lockflow-previews')
  and public.is_workspace_member(split_part(name, '/', 2)::uuid)
);

create policy "refs_update_own_workspace"
on storage.objects for update to authenticated
using (
  bucket_id in ('lockflow-references', 'lockflow-previews')
  and public.is_workspace_member(split_part(name, '/', 2)::uuid)
);

create policy "refs_delete_own_workspace"
on storage.objects for delete to authenticated
using (
  bucket_id in ('lockflow-references', 'lockflow-previews')
  and public.is_workspace_member(split_part(name, '/', 2)::uuid)
);

-- ── E. Server-side actions (security-definer RPCs; authenticated only) ──────

-- Shared validator: safe filename → 'safe-name.ext' (lowercase, [a-z0-9._-],
-- traversal segments and control chars stripped). Mirrors the client-side
-- sanitizer; the RPC trusts only its own output for path construction.
create function public.safe_reference_filename(raw text)
returns text
language sql
immutable
as $$
  select case
    when raw is null then 'reference'
    else
      coalesce(
        nullif(regexp_replace(
          regexp_replace(
            lower(
              -- basename: strip any leading path segments, then the extension
              split_part(reverse(split_part(reverse(raw), '/', 1)), '.', 1)
            ),
            '[^a-z0-9._-]', '', 'g'
          ),
          '^[._-]+|[._-]+$', ''
        ), ''),
        'reference')
      || case
        when position('.' in raw) > 0 and position('.' in raw) < length(raw) then
          '.' || lower(regexp_replace(split_part(raw, '.', -1), '[^a-z0-9]', '', 'g'))
        else ''
      end
  end;
$$;

-- 1) Upload intent. Validates everything server-side, creates the PENDING
--    reference + audit event, returns the narrow upload target.
create or replace function public.begin_reference_upload(
  p_target_type text,
  p_version_id uuid,
  p_reference_type text,
  p_caption text default '',
  p_original_filename text default 'reference',
  p_mime_type text default null,
  p_file_size bigint default null,
  p_rights_confirmed boolean default false
)
returns table (reference_id uuid, bucket text, upload_path text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace uuid;
  v_status text;
  v_reference_id uuid;
  v_bucket text := 'lockflow-references';
  v_upload_path text;
  v_safe_filename text;
  v_target_type text;
  v_owner_column text;
  v_owner_id uuid;
begin
  if p_target_type not in ('model_reference', 'environment_reference', 'library_asset_reference') then
    raise exception 'unknown reference target type %', p_target_type using errcode = 'check_violation';
  end if;
  v_target_type := p_target_type;

  if not p_rights_confirmed then
    raise exception 'rights acknowledgement is required before an upload can begin'
      using errcode = 'check_violation';
  end if;

  if p_mime_type is null or p_mime_type not in ('image/jpeg', 'image/png', 'image/webp') then
    raise exception 'unsupported file type (allowed: image/jpeg, image/png, image/webp)'
      using errcode = 'check_violation';
  end if;

  if p_file_size is null or p_file_size <= 0 then
    raise exception 'empty files are rejected' using errcode = 'check_violation';
  end if;
  if p_file_size > 10485760 then
    raise exception 'file exceeds the 10 MB limit' using errcode = 'check_violation';
  end if;

  -- Resolve the version row and its workspace per target type.
  if v_target_type = 'model_reference' then
    select status::text, workspace_id into v_status, v_workspace
    from public.model_versions where id = p_version_id;
    v_owner_column := 'model_id';
    select model_id into v_owner_id from public.model_versions where id = p_version_id;
  elsif v_target_type = 'environment_reference' then
    select status::text, workspace_id into v_status, v_workspace
    from public.environment_versions where id = p_version_id;
    v_owner_column := 'environment_id';
    select environment_id into v_owner_id from public.environment_versions where id = p_version_id;
  else
    select status::text, workspace_id into v_status, v_workspace
    from public.library_asset_versions where id = p_version_id;
    v_owner_column := 'library_asset_id';
    select library_asset_id into v_owner_id from public.library_asset_versions where id = p_version_id;
  end if;

  if v_workspace is null then
    raise exception 'target version not found' using errcode = 'P0002';
  end if;

  if not public.is_workspace_member(v_workspace) then
    raise exception 'you do not have access to this workspace' using errcode = '42501';
  end if;

  -- Locked protection: only draft versions may receive uploads. (Locked and
  -- superseded versions additionally reject ALL reference mutations via the
  -- existing immutability triggers.)
  if v_status <> 'draft' then
    raise exception 'references are protected in this locked version' using errcode = 'check_violation';
  end if;

  v_safe_filename := public.safe_reference_filename(p_original_filename);
  v_reference_id := gen_random_uuid();

  if v_target_type = 'model_reference' then
    v_upload_path := 'workspaces/' || v_workspace || '/models/' || v_owner_id
      || '/versions/' || p_version_id || '/references/' || v_reference_id || '/' || v_safe_filename;
    insert into public.model_references (
      id, model_version_id, workspace_id, storage_path, storage_bucket,
      original_filename, display_filename, mime_type, file_size_bytes,
      reference_type, caption, sort_order,
      rights_confirmed_at, rights_confirmed_by, upload_status
    ) values (
      v_reference_id, p_version_id, v_workspace, v_upload_path, v_bucket,
      p_original_filename, p_original_filename, p_mime_type, p_file_size,
      p_reference_type::public.model_reference_type, coalesce(p_caption, ''), 0,
      now(), auth.uid(), 'pending'
    );
  elsif v_target_type = 'environment_reference' then
    v_upload_path := 'workspaces/' || v_workspace || '/environments/' || v_owner_id
      || '/versions/' || p_version_id || '/references/' || v_reference_id || '/' || v_safe_filename;
    insert into public.environment_references (
      id, environment_version_id, workspace_id, storage_path, storage_bucket,
      original_filename, display_filename, mime_type, file_size_bytes,
      reference_type, caption, sort_order,
      rights_confirmed_at, rights_confirmed_by, upload_status
    ) values (
      v_reference_id, p_version_id, v_workspace, v_upload_path, v_bucket,
      p_original_filename, p_original_filename, p_mime_type, p_file_size,
      p_reference_type::public.environment_reference_type, coalesce(p_caption, ''), 0,
      now(), auth.uid(), 'pending'
    );
  else
    v_upload_path := 'workspaces/' || v_workspace || '/library/' || v_owner_id
      || '/versions/' || p_version_id || '/references/' || v_reference_id || '/' || v_safe_filename;
    insert into public.library_asset_references (
      id, library_asset_version_id, workspace_id, storage_path, storage_bucket,
      original_filename, display_filename, mime_type, file_size_bytes,
      reference_type, caption, sort_order,
      rights_confirmed_at, rights_confirmed_by, upload_status
    ) values (
      v_reference_id, p_version_id, v_workspace, v_upload_path, v_bucket,
      p_original_filename, p_original_filename, p_mime_type, p_file_size,
      p_reference_type::public.library_reference_type, coalesce(p_caption, ''), 0,
      now(), auth.uid(), 'pending'
    );
  end if;

  insert into public.upload_audit_events (
    workspace_id, actor_id, target_type, target_reference_id,
    event_type, storage_bucket, storage_path, metadata
  ) values (
    v_workspace, auth.uid(), v_target_type, v_reference_id,
    'upload_requested', v_bucket, v_upload_path,
    jsonb_build_object('mime_type', p_mime_type, 'file_size', p_file_size, 'original_filename', p_original_filename)
  );

  return query select v_reference_id, v_bucket, v_upload_path;
end;
$$;

-- 2) Upload completion. The client uploads directly to the object path and
--    then confirms; the RPC flips pending → uploaded and records dimensions.
create or replace function public.complete_reference_upload(
  p_reference_id uuid,
  p_target_type text,
  p_width integer default null,
  p_height integer default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace uuid;
  v_status text;
  v_path text;
  v_bucket text;
  v_width_ok boolean := p_width is null or (p_width between 256 and 8192);
  v_height_ok boolean := p_height is null or (p_height between 256 and 8192);
begin
  if p_target_type not in ('model_reference', 'environment_reference', 'library_asset_reference') then
    raise exception 'unknown reference target type %', p_target_type using errcode = 'check_violation';
  end if;

  if not v_width_ok or not v_height_ok then
    raise exception 'image dimensions out of range (256–8192 px per side)' using errcode = 'check_violation';
  end if;

  if p_target_type = 'model_reference' then
    select workspace_id, upload_status::text, storage_path, storage_bucket
    into v_workspace, v_status, v_path, v_bucket
    from public.model_references where id = p_reference_id;
    if v_workspace is null then
      raise exception 'reference not found' using errcode = 'P0002';
    end if;
    if not public.is_workspace_member(v_workspace) then
      raise exception 'you do not have access to this workspace' using errcode = '42501';
    end if;
    if v_status <> 'pending' then
      raise exception 'only pending uploads can be completed' using errcode = 'check_violation';
    end if;
    update public.model_references
    set upload_status = 'uploaded', width = p_width, height = p_height
    where id = p_reference_id;
  elsif p_target_type = 'environment_reference' then
    select workspace_id, upload_status::text, storage_path, storage_bucket
    into v_workspace, v_status, v_path, v_bucket
    from public.environment_references where id = p_reference_id;
    if v_workspace is null then
      raise exception 'reference not found' using errcode = 'P0002';
    end if;
    if not public.is_workspace_member(v_workspace) then
      raise exception 'you do not have access to this workspace' using errcode = '42501';
    end if;
    if v_status <> 'pending' then
      raise exception 'only pending uploads can be completed' using errcode = 'check_violation';
    end if;
    update public.environment_references
    set upload_status = 'uploaded', width = p_width, height = p_height
    where id = p_reference_id;
  else
    select workspace_id, upload_status::text, storage_path, storage_bucket
    into v_workspace, v_status, v_path, v_bucket
    from public.library_asset_references where id = p_reference_id;
    if v_workspace is null then
      raise exception 'reference not found' using errcode = 'P0002';
    end if;
    if not public.is_workspace_member(v_workspace) then
      raise exception 'you do not have access to this workspace' using errcode = '42501';
    end if;
    if v_status <> 'pending' then
      raise exception 'only pending uploads can be completed' using errcode = 'check_violation';
    end if;
    update public.library_asset_references
    set upload_status = 'uploaded', width = p_width, height = p_height
    where id = p_reference_id;
  end if;

  insert into public.upload_audit_events (
    workspace_id, actor_id, target_type, target_reference_id,
    event_type, storage_bucket, storage_path, metadata
  ) values (
    v_workspace, auth.uid(), p_target_type, p_reference_id,
    'upload_completed', v_bucket, v_path,
    jsonb_build_object('width', p_width, 'height', p_height)
  );
end;
$$;

-- 3) Failure marking. Keeps failed uploads out of the "available" set with an
--    audit trail; retry starts a fresh intent.
create or replace function public.fail_reference_upload(
  p_reference_id uuid,
  p_target_type text,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace uuid;
  v_status text;
  v_path text;
  v_bucket text;
begin
  if p_target_type not in ('model_reference', 'environment_reference', 'library_asset_reference') then
    raise exception 'unknown reference target type %', p_target_type using errcode = 'check_violation';
  end if;

  if p_target_type = 'model_reference' then
    select workspace_id, upload_status::text, storage_path, storage_bucket
    into v_workspace, v_status, v_path, v_bucket
    from public.model_references where id = p_reference_id;
    if v_workspace is null then
      raise exception 'reference not found' using errcode = 'P0002';
    end if;
    if not public.is_workspace_member(v_workspace) then
      raise exception 'you do not have access to this workspace' using errcode = '42501';
    end if;
    if v_status <> 'pending' then
      raise exception 'only pending uploads can be marked failed' using errcode = 'check_violation';
    end if;
    update public.model_references set upload_status = 'failed' where id = p_reference_id;
  elsif p_target_type = 'environment_reference' then
    select workspace_id, upload_status::text, storage_path, storage_bucket
    into v_workspace, v_status, v_path, v_bucket
    from public.environment_references where id = p_reference_id;
    if v_workspace is null then
      raise exception 'reference not found' using errcode = 'P0002';
    end if;
    if not public.is_workspace_member(v_workspace) then
      raise exception 'you do not have access to this workspace' using errcode = '42501';
    end if;
    if v_status <> 'pending' then
      raise exception 'only pending uploads can be marked failed' using errcode = 'check_violation';
    end if;
    update public.environment_references set upload_status = 'failed' where id = p_reference_id;
  else
    select workspace_id, upload_status::text, storage_path, storage_bucket
    into v_workspace, v_status, v_path, v_bucket
    from public.library_asset_references where id = p_reference_id;
    if v_workspace is null then
      raise exception 'reference not found' using errcode = 'P0002';
    end if;
    if not public.is_workspace_member(v_workspace) then
      raise exception 'you do not have access to this workspace' using errcode = '42501';
    end if;
    if v_status <> 'pending' then
      raise exception 'only pending uploads can be marked failed' using errcode = 'check_violation';
    end if;
    update public.library_asset_references set upload_status = 'failed' where id = p_reference_id;
  end if;

  insert into public.upload_audit_events (
    workspace_id, actor_id, target_type, target_reference_id,
    event_type, storage_bucket, storage_path, metadata
  ) values (
    v_workspace, auth.uid(), p_target_type, p_reference_id,
    'upload_failed', v_bucket, v_path,
    jsonb_build_object('reason', left(coalesce(p_reason, 'unknown'), 300))
  );
end;
$$;

-- 4) Soft delete (draft versions only; locked versions are protected by the
--    existing immutability triggers). Never hard-deletes the record.
create or replace function public.soft_delete_reference(
  p_reference_id uuid,
  p_target_type text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace uuid;
  v_status text;
  v_version_id uuid;
  v_version_status text;
  v_path text;
  v_bucket text;
begin
  if p_target_type not in ('model_reference', 'environment_reference', 'library_asset_reference') then
    raise exception 'unknown reference target type %', p_target_type using errcode = 'check_violation';
  end if;

  if p_target_type = 'model_reference' then
    select r.workspace_id, r.upload_status::text, r.model_version_id, r.storage_path, r.storage_bucket
    into v_workspace, v_status, v_version_id, v_path, v_bucket
    from public.model_references r where r.id = p_reference_id;
    if v_workspace is null then
      raise exception 'reference not found' using errcode = 'P0002';
    end if;
    if not public.is_workspace_member(v_workspace) then
      raise exception 'you do not have access to this workspace' using errcode = '42501';
    end if;
    select status::text into v_version_status from public.model_versions where id = v_version_id;
    if v_version_status <> 'draft' then
      raise exception 'references are protected in this locked version' using errcode = 'check_violation';
    end if;
    update public.model_references
    set upload_status = 'deleted', deleted_at = now()
    where id = p_reference_id;
  elsif p_target_type = 'environment_reference' then
    select r.workspace_id, r.upload_status::text, r.environment_version_id, r.storage_path, r.storage_bucket
    into v_workspace, v_status, v_version_id, v_path, v_bucket
    from public.environment_references r where r.id = p_reference_id;
    if v_workspace is null then
      raise exception 'reference not found' using errcode = 'P0002';
    end if;
    if not public.is_workspace_member(v_workspace) then
      raise exception 'you do not have access to this workspace' using errcode = '42501';
    end if;
    select status::text into v_version_status from public.environment_versions where id = v_version_id;
    if v_version_status <> 'draft' then
      raise exception 'references are protected in this locked version' using errcode = 'check_violation';
    end if;
    update public.environment_references
    set upload_status = 'deleted', deleted_at = now()
    where id = p_reference_id;
  else
    select r.workspace_id, r.upload_status::text, r.library_asset_version_id, r.storage_path, r.storage_bucket
    into v_workspace, v_status, v_version_id, v_path, v_bucket
    from public.library_asset_references r where r.id = p_reference_id;
    if v_workspace is null then
      raise exception 'reference not found' using errcode = 'P0002';
    end if;
    if not public.is_workspace_member(v_workspace) then
      raise exception 'you do not have access to this workspace' using errcode = '42501';
    end if;
    select status::text into v_version_status from public.library_asset_versions where id = v_version_id;
    if v_version_status <> 'draft' then
      raise exception 'references are protected in this locked version' using errcode = 'check_violation';
    end if;
    update public.library_asset_references
    set upload_status = 'deleted', deleted_at = now()
    where id = p_reference_id;
  end if;

  insert into public.upload_audit_events (
    workspace_id, actor_id, target_type, target_reference_id,
    event_type, storage_bucket, storage_path, metadata
  ) values (
    v_workspace, auth.uid(), p_target_type, p_reference_id,
    'soft_deleted', v_bucket, v_path, '{}'::jsonb
  );
end;
$$;

-- 5) Signed-view audit. Called BEFORE requesting a signed URL; the URL itself
--    is never persisted anywhere.
create or replace function public.log_signed_url_access(
  p_reference_id uuid,
  p_target_type text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace uuid;
  v_path text;
  v_bucket text;
begin
  if p_target_type not in ('model_reference', 'environment_reference', 'library_asset_reference') then
    raise exception 'unknown reference target type %', p_target_type using errcode = 'check_violation';
  end if;

  if p_target_type = 'model_reference' then
    select workspace_id, storage_path, storage_bucket into v_workspace, v_path, v_bucket
    from public.model_references where id = p_reference_id;
  elsif p_target_type = 'environment_reference' then
    select workspace_id, storage_path, storage_bucket into v_workspace, v_path, v_bucket
    from public.environment_references where id = p_reference_id;
  else
    select workspace_id, storage_path, storage_bucket into v_workspace, v_path, v_bucket
    from public.library_asset_references where id = p_reference_id;
  end if;

  if v_workspace is null then
    raise exception 'reference not found' using errcode = 'P0002';
  end if;
  if not public.is_workspace_member(v_workspace) then
    raise exception 'you do not have access to this workspace' using errcode = '42501';
  end if;

  insert into public.upload_audit_events (
    workspace_id, actor_id, target_type, target_reference_id,
    event_type, storage_bucket, storage_path, metadata
  ) values (
    v_workspace, auth.uid(), p_target_type, p_reference_id,
    'signed_url_requested', v_bucket, v_path, '{}'::jsonb
  );
end;
$$;

grant execute on function public.begin_reference_upload(text, uuid, text, text, text, text, bigint, boolean) to authenticated;
grant execute on function public.complete_reference_upload(uuid, text, integer, integer) to authenticated;
grant execute on function public.fail_reference_upload(uuid, text, text) to authenticated;
grant execute on function public.soft_delete_reference(uuid, text) to authenticated;
grant execute on function public.log_signed_url_access(uuid, text) to authenticated;

-- ── F. RLS on the extended reference tables ─────────────────────────────────
-- The base-domain migrations already enable RLS and member policies on the
-- three reference tables (select/insert/update/delete gated on
-- is_workspace_member over the owning version chain). One gap: the models
-- migration never created a DELETE policy for model_references, which made
-- draft reference removal a silent no-op in real mode. Adding it here.
create policy "references_delete_member" on public.model_references
  for delete using (
    exists (
      select 1 from public.model_versions v
      join public.models m on m.id = v.model_id
      where v.id = model_version_id and public.is_workspace_member(m.workspace_id)
    )
  );

do $$
declare
  r record;
begin
  for r in
    select c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('model_references', 'environment_references', 'library_asset_references')
      and c.relrowsecurity = false
  loop
    raise exception 'table % is missing row level security', r.table_name;
  end loop;
end
$$;
