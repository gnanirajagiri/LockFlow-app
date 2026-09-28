-- ═══════════════════════════════════════════════════════════════════════════
-- LockFlow — LOCAL VERIFICATION ONLY. Never run against a hosted Supabase
-- project (the platform already provides everything below).
--
-- Gives a plain Postgres database the small surface of the Supabase platform
-- that LockFlow's migrations assume:
--   * `authenticated` / `anon` roles (Supabase's PostgREST roles)
--   * auth.users (minimal shape) + auth.uid() reading request.jwt.claims
--   * storage.buckets (the initial migration seeds a private bucket)
--   * schema usage + table grants so RLS (not grants) is what blocks rows
-- ═══════════════════════════════════════════════════════════════════════════

-- Roles (Supabase projects always have these; local installs may not).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
end
$$;

grant usage on schema public to authenticated, anon;
grant all on all tables in schema public to authenticated, anon;
alter default privileges in schema public
  grant all on tables to authenticated, anon;

-- auth schema: users table (subset sufficient for the migrations) + uid().
create schema if not exists auth;
grant usage on schema auth to authenticated, anon;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  aud text not null default 'authenticated',
  role text not null default 'authenticated',
  email text,
  encrypted_password text,
  email_confirmed_at timestamptz default now(),
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- auth.uid(): the JWT-claims reader Supabase ships. Mirrors the platform
-- behaviour exactly for `set request.jwt.claims = '{"sub": "..."}' sessions.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claims', true)::json ->> 'sub', '')::uuid
$$;

-- storage schema: just the buckets table the initial migration seeds.
create schema if not exists storage;
grant usage on schema storage to authenticated, anon;

create table if not exists storage.buckets (
  id text primary key,
  name text,
  public boolean default false
);
