-- ═══════════════════════════════════════════════════════════════════════════
-- LockFlow — Library asset file uploads via signed URLs (Prompt 22b)
--
-- Completes the ingestion story: the pending library_asset_files rows from
-- 20261001150000 can now be filled with REAL bytes through the same secure
-- pattern as reference uploads (single signed upload path, server-side
-- intent + completion RPCs, no client-chosen storage paths).
--
-- Path rule (MUST match storage RLS in 20260928120000):
--   workspaces/{workspaceId}/library-assets/{assetId}/{fileId}/{safeName}
--   — segment 2 is the workspace uuid the policies parse for membership.
--
-- RPCs (security definer, authenticated):
--   begin_library_file_upload    → validates membership/asset/mime/size,
--                                  creates (or reuses for retry) the PENDING
--                                  row, returns bucket + upload path.
--   complete_library_file_upload → pending|failed → uploaded + audit.
--   fail_library_file_upload     → pending → failed (reason) + audit.
-- ═══════════════════════════════════════════════════════════════════════════

-- Reuse the reference flow's filename sanitizer (same rules, same trust).
-- (public.safe_reference_filename already exists from 20260928120000.)

create or replace function public.begin_library_file_upload(
  p_workspace_id uuid,
  p_library_asset_id uuid,
  p_original_filename text,
  p_mime_type text,
  p_file_size bigint,
  p_retry_file_id uuid default null
)
returns table (file_id uuid, bucket text, upload_path text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asset public.library_assets;
  v_mime text;
  v_size bigint := p_file_size;
  v_name text;
  v_file_id uuid;
  v_path text;
begin
  -- Membership is authoritative here (the client cannot assert it).
  if not public.is_workspace_member(p_workspace_id, auth.uid()) then
    raise exception 'You are not a member of this workspace.';
  end if;

  select * into v_asset from public.library_assets
  where id = p_library_asset_id and workspace_id = p_workspace_id;
  if not found then
    raise exception 'The library asset does not exist in this workspace.';
  end if;

  -- Allow-list (mirrors the library_asset_files CHECK + client sniffing).
  v_mime := lower(coalesce(p_mime_type, ''));
  if v_mime not in ('image/jpeg','image/png','image/webp','image/avif','image/gif','application/pdf') then
    raise exception 'That file type is not supported — use JPEG, PNG, WebP, AVIF, GIF or PDF.';
  end if;
  if v_size is null or v_size <= 0 or v_size > 26214400 then
    raise exception 'File size must be between 1 byte and 25 MiB.';
  end if;

  v_name := public.safe_reference_filename(coalesce(p_original_filename, 'asset-file'));
  if v_name = 'reference' or v_name = 'asset-file' then
    v_name := 'asset-file';
  end if;

  if p_retry_file_id is not null then
    -- Retry: reuse the SAME row and canonical path; only pending/failed rows.
    select f.id, f.storage_path into v_file_id, v_path
    from public.library_asset_files f
    where f.id = p_retry_file_id
      and f.workspace_id = p_workspace_id
      and f.library_asset_id = p_library_asset_id
      and f.upload_status in ('pending', 'failed');
    if not found then
      raise exception 'That file reference cannot be retried.';
    end if;
    update public.library_asset_files
    set upload_status = 'pending', updated_at = now()
    where id = v_file_id;
  else
    insert into public.library_asset_files (
      workspace_id, library_asset_id, storage_bucket, storage_path,
      file_name, mime_type, file_size_bytes, file_kind, upload_status, uploaded_by
    ) values (
      p_workspace_id, p_library_asset_id, 'lockflow-references',
      'workspaces/' || p_workspace_id::text || '/library-assets/' || p_library_asset_id::text
        || '/' || gen_random_uuid()::text || '/' || v_name,
      v_name, v_mime, v_size,
      case when v_mime = 'application/pdf' then 'document' else 'image' end,
      'pending', auth.uid()
    ) returning id into v_file_id;

    select storage_path into v_path from public.library_asset_files where id = v_file_id;
  end if;

  return query select v_file_id, 'lockflow-references'::text, v_path;
end;
$$;

create or replace function public.complete_library_file_upload(p_file_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.library_asset_files;
begin
  select * into v_row from public.library_asset_files where id = p_file_id;
  if not found then
    raise exception 'File reference not found.';
  end if;
  if not public.is_workspace_member(v_row.workspace_id, auth.uid()) then
    raise exception 'You are not a member of this workspace.';
  end if;
  if v_row.upload_status not in ('pending', 'failed') then
    raise exception 'This upload was already completed.';
  end if;

  update public.library_asset_files
  set upload_status = 'uploaded', updated_at = now()
  where id = p_file_id;

  insert into public.library_asset_events (
    workspace_id, library_asset_id, actor_id, event_type, message, metadata
  ) values (
    v_row.workspace_id, v_row.library_asset_id, auth.uid(), 'library_asset_updated',
    left('File “' || v_row.file_name || '” uploaded.', 400),
    jsonb_build_object('fileId', p_file_id::text, 'status', 'uploaded')
  );
end;
$$;

create or replace function public.fail_library_file_upload(p_file_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.library_asset_files;
begin
  select * into v_row from public.library_asset_files where id = p_file_id;
  if not found then
    raise exception 'File reference not found.';
  end if;
  if not public.is_workspace_member(v_row.workspace_id, auth.uid()) then
    raise exception 'You are not a member of this workspace.';
  end if;
  if v_row.upload_status = 'uploaded' then
    return; -- never regress a completed upload
  end if;

  update public.library_asset_files
  set upload_status = 'failed', updated_at = now()
  where id = p_file_id;

  insert into public.library_asset_events (
    workspace_id, library_asset_id, actor_id, event_type, message, metadata
  ) values (
    v_row.workspace_id, v_row.library_asset_id, auth.uid(), 'library_asset_updated',
    left('File “' || v_row.file_name || '” upload failed.', 400),
    jsonb_build_object('fileId', p_file_id::text, 'status', 'failed',
                       'reason', left(coalesce(p_reason, 'transfer failed'), 120))
  );
end;
$$;

-- ── RLS hardening: uploaded objects stay path-scoped (already covered by the
-- reference-upload storage policies via segment 2); nothing to change here.

-- NOTE: library_asset_files rows carry NO signed URLs — the RPCs return the
-- bucket + path only, and the signed URL/token live in the client session.
