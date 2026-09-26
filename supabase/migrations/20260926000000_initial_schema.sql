-- ═══════════════════════════════════════════════════════════════════════════
-- LockFlow initial schema
-- Workspaces + user profiles with row-level security.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Enums ────────────────────────────────────────────────────────────────────
create type public.workspace_role as enum ('owner', 'editor', 'viewer');

create type public.workspace_plan as enum ('free', 'studio', 'agency');

-- ── Workspaces ───────────────────────────────────────────────────────────────
-- Top-level tenancy boundary. All future content tables reference this.
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  plan workspace_plan not null default 'free',
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── User profiles ────────────────────────────────────────────────────────────
-- One row per auth user. Kept separate from auth.users so app metadata lives
-- in the public schema and can carry foreign keys and RLS of its own.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 80),
  avatar_path text, -- storage bucket path; bucket wiring arrives with data features
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Workspace membership ─────────────────────────────────────────────────────
create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role workspace_role not null default 'viewer',
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index workspace_members_user_idx on public.workspace_members (user_id);
create index workspace_members_workspace_idx on public.workspace_members (workspace_id);

-- ── updated_at triggers ──────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_workspaces_updated_at
  before update on public.workspaces
  for each row execute function public.set_updated_at();

create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ── New-user bootstrap ───────────────────────────────────────────────────────
-- Creates a profile row for every new auth user.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email, 'member'), '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Helper: workspace membership check ───────────────────────────────────────
create or replace function public.is_workspace_member(ws_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws_id and m.user_id = auth.uid()
  );
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Row-level security
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.workspaces enable row level security;
alter table public.profiles enable row level security;
alter table public.workspace_members enable row level security;

-- Profiles: a user reads/updates only their own profile.
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);
-- Inserts are handled by the handle_new_user trigger (security definer).

-- Workspaces: members can read; creators can insert; updates stay owner-only.
create policy "workspaces_select_member" on public.workspaces
  for select using (public.is_workspace_member(id));
create policy "workspaces_insert_creator" on public.workspaces
  for insert with check (auth.uid() = created_by);
create policy "workspaces_update_owner" on public.workspaces
  for update using (
    exists (
      select 1 from public.workspace_members m
      where m.workspace_id = id
        and m.user_id = auth.uid()
        and m.role = 'owner'
    )
  );

-- Membership rows: members can read the roster; creators can seed the first
-- owner row; owners manage roles; users may remove their own membership.
create policy "members_select_member" on public.workspace_members
  for select using (user_id = auth.uid() or public.is_workspace_member(workspace_id));
create policy "members_insert_creator" on public.workspace_members
  for insert with check (
    exists (
      select 1 from public.workspaces w
      where w.id = workspace_id
        and w.created_by = auth.uid()
    )
  );
create policy "members_update_owner" on public.workspace_members
  for update using (
    exists (
      select 1 from public.workspace_members me
      where me.workspace_id = workspace_members.workspace_id
        and me.user_id = auth.uid()
        and me.role = 'owner'
    )
  );
create policy "members_delete_self" on public.workspace_members
  for delete using (
    user_id = auth.uid()
    or exists (
      select 1 from public.workspace_members me
      where me.workspace_id = workspace_members.workspace_id
        and me.user_id = auth.uid()
        and me.role = 'owner'
    )
  );

-- ── Storage bootstrap ────────────────────────────────────────────────────────
-- Private bucket for user content; access will be mediated by storage policies
-- in the migration that introduces asset uploads.
insert into storage.buckets (id, name, public)
values ('workspace-assets', 'workspace-assets', false)
on conflict (id) do nothing;
