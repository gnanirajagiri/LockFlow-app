-- ═══════════════════════════════════════════════════════════════════════════
-- LockFlow — Account avatar profiles (cloud-synced, cross-device)
--
-- Gives each signed-in account a cloud-backed avatar so the topbar photo and
-- the AI-generated portrait follow the user across devices. Product rules:
--   * One avatar row per account (user_id), upserted via a narrow RPC.
--   * Image bytes live in a PRIVATE storage bucket; the row stores only the
--     storage path. Readers fetch short-lived signed URLs — never public URLs.
--   * Strict byte budget: images are downscaled client-side to 256×256 JPEG
--     (~30–80 KB); the DB still enforces ≤ 512 KB and image/* mime only.
--   * Upload wins over generated (same layering as the localStorage store).
--   * Every change is audited in avatar_profile_events (append-only by
--     default-deny: no update/delete policies).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── A. Private bucket ───────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('lockflow-avatars', 'lockflow-avatars', false)
on conflict (id) do nothing;

-- ── B. Table ────────────────────────────────────────────────────────────────
create table public.avatar_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  origin text not null check (origin in ('upload', 'generated')),
  storage_bucket text not null default 'lockflow-avatars',
  storage_path text not null,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  file_size_bytes bigint not null check (file_size_bytes > 0 and file_size_bytes <= 524288),
  updated_at timestamptz not null default now()
);

comment on table public.avatar_profiles is
  'Cloud-synced account avatars; bytes in the private lockflow-avatars bucket.';

alter table public.avatar_profiles enable row level security;

-- Owner-only: a user sees and manages exactly their own avatar row.
create policy "avatar_profiles_select_own" on public.avatar_profiles
  for select using (auth.uid() = user_id);

create policy "avatar_profiles_insert_own" on public.avatar_profiles
  for insert with check (auth.uid() = user_id);

create policy "avatar_profiles_update_own" on public.avatar_profiles
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "avatar_profiles_delete_own" on public.avatar_profiles
  for delete using (auth.uid() = user_id);

-- ── C. Storage policies — path-scoped, owner derived from the OBJECT PATH ───
-- Path shape: avatars/{userId}/{origin}-{n}.jpg — never a client-chosen id.

create policy "avatars_select_own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'lockflow-avatars'
    and (storage.foldername(name))[1] = 'avatars'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

create policy "avatars_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'lockflow-avatars'
    and (storage.foldername(name))[1] = 'avatars'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

create policy "avatars_update_own" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'lockflow-avatars'
    and (storage.foldername(name))[1] = 'avatars'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

create policy "avatars_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'lockflow-avatars'
    and (storage.foldername(name))[1] = 'avatars'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- ── D. Append-only audit trail ──────────────────────────────────────────────
create table public.avatar_profile_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  event_type text not null check (event_type in ('avatar_set', 'avatar_replaced', 'avatar_cleared')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index avatar_profile_events_user_idx on public.avatar_profile_events (user_id, created_at);

alter table public.avatar_profile_events enable row level security;

create policy "avatar_profile_events_select_own" on public.avatar_profile_events
  for select using (auth.uid() = user_id);

create policy "avatar_profile_events_insert_own" on public.avatar_profile_events
  for insert with check (auth.uid() = user_id);

-- No update/delete policies: history is append-only by default-deny.

-- ── E. Upsert RPC — the only write path the client uses ─────────────────────
-- Validates origin/mime/size server-side, replaces any previous object for
-- the user, and appends an audit event.
create or replace function public.set_my_avatar_profile(
  p_origin text,
  p_storage_path text,
  p_mime_type text,
  p_file_size bigint
)
returns public.avatar_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.avatar_profiles;
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'sign in to manage your avatar' using errcode = '42501';
  end if;

  if p_origin not in ('upload', 'generated') then
    raise exception 'unknown avatar origin %', p_origin using errcode = 'check_violation';
  end if;
  if p_mime_type not in ('image/jpeg', 'image/png', 'image/webp') then
    raise exception 'unsupported avatar file type (allowed: image/jpeg, image/png, image/webp)'
      using errcode = 'check_violation';
  end if;
  if p_file_size is null or p_file_size <= 0 or p_file_size > 524288 then
    raise exception 'avatar must be a non-empty image up to 512 KB' using errcode = 'check_violation';
  end if;

  -- The client may only write into its own folder in the avatars bucket.
  if p_storage_path !~ ('^avatars/' || v_user::text || '/[a-z0-9._-]+$') then
    raise exception 'avatar storage path must be avatars/<your-account>/…' using errcode = '42501';
  end if;

  select * into v_existing from public.avatar_profiles where user_id = v_user;

  insert into public.avatar_profiles (user_id, origin, storage_path, mime_type, file_size_bytes, updated_at)
  values (v_user, p_origin, p_storage_path, p_mime_type, p_file_size, now())
  on conflict (user_id) do update
    set origin = excluded.origin,
        storage_path = excluded.storage_path,
        mime_type = excluded.mime_type,
        file_size_bytes = excluded.file_size_bytes,
        updated_at = now();

  -- Best-effort cleanup of the replaced object (same folder, different name).
  if v_existing is not null and v_existing.storage_path <> p_storage_path then
    delete from storage.objects
    where bucket_id = 'lockflow-avatars'
      and name = v_existing.storage_path;
  end if;

  insert into public.avatar_profile_events (user_id, event_type, metadata)
  values (
    v_user,
    case when v_existing is null then 'avatar_set' else 'avatar_replaced' end,
    jsonb_build_object('origin', p_origin, 'mime_type', p_mime_type, 'file_size', p_file_size)
  );

  return select * from public.avatar_profiles where user_id = v_user;
end;
$$;

create or replace function public.clear_my_avatar_profile()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.avatar_profiles;
begin
  if auth.uid() is null then
    raise exception 'sign in to manage your avatar' using errcode = '42501';
  end if;

  select * into v_existing from public.avatar_profiles where user_id = auth.uid();
  if v_existing is null then
    return; -- nothing to clear; idempotent
  end if;

  delete from storage.objects
  where bucket_id = 'lockflow-avatars' and name = v_existing.storage_path;

  delete from public.avatar_profiles where user_id = auth.uid();

  insert into public.avatar_profile_events (user_id, event_type, metadata)
  values (auth.uid(), 'avatar_cleared', jsonb_build_object('origin', v_existing.origin));
end;
$$;

grant execute on function public.set_my_avatar_profile(text, text, text, bigint) to authenticated;
grant execute on function public.clear_my_avatar_profile() to authenticated;

-- ── F. Hard guards ──────────────────────────────────────────────────────────
do $$
declare
  r record;
begin
  for r in
    select c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('avatar_profiles', 'avatar_profile_events')
      and c.relrowsecurity = false
  loop
    raise exception 'table % is missing row level security', r.table_name;
  end loop;
end
$$;
