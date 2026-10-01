-- ═══════════════════════════════════════════════════════════════════════════
-- LockFlow — Social Account Connections foundation (connection management only)
-- social_connection_providers, workspace_social_connections,
-- workspace_social_connection_tokens, social_connection_oauth_states,
-- social_connection_events
-- + RLS + append-only audit + token-table server-only isolation.
--
-- Product rules encoded here:
--   * Connections are workspace-scoped integrations — they belong to a
--     workspace, never to a Gallery output or campaign item, and are never
--     shared across workspaces.
--   * Connection MANAGEMENT only: connect, verify, refresh status, rename,
--     disconnect. No publishing, no containers/drafts, no scheduling, no
--     analytics — those arrive in a later task.
--   * Raw tokens NEVER live in workspace_social_connections or any
--     client-readable table. workspace_social_connection_tokens holds
--     AES-GCM ciphertext (iv || ciphertext || auth tag) written only by the
--     server-side service; it has NO client policies at all (deny-all to
--     anon/authenticated; server role bypasses RLS).
--   * OAuth state tokens are stored hashed (SHA-256); plain state and PKCE
--     verifiers never touch the database. States expire and are single-use.
--   * social_connection_events are an append-only audit timeline with
--     audit-safe metadata only — no tokens, codes, secrets or signed URLs.
--   * One active connection per (workspace, provider, external account).
--   * No provider client secrets exist anywhere in this schema — secrets
--     live only in server-only environment configuration.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Enums ───────────────────────────────────────────────────────────────────
create type public.social_provider_status as enum ('available', 'disabled', 'dev_only');

create type public.social_connection_status as enum (
  'pending', 'connected', 'needs_reauth', 'revoked', 'failed', 'disconnected'
);

create type public.social_connection_event_type as enum (
  'connect_started', 'callback_received', 'connected', 'verification_passed',
  'verification_failed', 'reauth_required', 'refreshed', 'disconnected',
  'revoke_requested', 'revoke_succeeded', 'revoke_failed', 'provider_disabled'
);

-- ── A. Provider registry (metadata only — never secrets) ────────────────────
create table public.social_connection_providers (
  id uuid unique default gen_random_uuid(),
  key text primary key,
  display_name text not null check (char_length(display_name) between 1 and 60),
  status public.social_provider_status not null default 'disabled',
  supports_refresh boolean not null default false,
  supports_disconnect_revoke boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Registry seed. Production providers ship 'disabled' until credentials and
-- platform app review are in place; the dev fake is clearly 'dev_only'.
insert into public.social_connection_providers
  (key, display_name, status, supports_refresh, supports_disconnect_revoke)
values
  ('meta', 'Meta (Instagram Business / Facebook Page)', 'disabled', true, true),
  ('tiktok', 'TikTok', 'disabled', true, true),
  ('youtube', 'YouTube', 'disabled', true, true),
  ('linkedin', 'LinkedIn', 'disabled', true, true),
  ('x', 'X', 'disabled', false, true),
  ('pinterest', 'Pinterest', 'disabled', true, true),
  ('dev_fake', 'Development fake provider', 'dev_only', true, true);

-- ── B. Workspace connections (safe metadata only — never raw tokens) ────────
create table public.workspace_social_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  provider_key text not null references public.social_connection_providers (key),
  local_name text not null check (char_length(local_name) between 1 and 80),
  -- Hashed external account identity: stable dedupe without exposing ids.
  external_account_id_hash text not null,
  external_account_label text,
  external_account_type text,
  status public.social_connection_status not null default 'pending',
  granted_scopes jsonb,
  -- Safe display metadata only: never tokens, codes, signed payloads or
  -- provider-internal error shapes.
  connection_metadata jsonb,
  last_verified_at timestamptz,
  last_error_code text,
  last_error_message_safe text,
  connected_by uuid not null references auth.users (id) on delete cascade,
  connected_at timestamptz,
  disconnected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One active connection per workspace/provider/external account.
  unique (workspace_id, provider_key, external_account_id_hash)
);

create index workspace_social_connections_workspace_idx
  on public.workspace_social_connections (workspace_id);
create index workspace_social_connections_lookup_idx
  on public.workspace_social_connections (workspace_id, provider_key, status);
create index workspace_social_connections_active_idx
  on public.workspace_social_connections (workspace_id, status)
  where status in ('connected', 'needs_reauth', 'pending');

-- ── C. Token vault — server-only. NO RLS policies: denied to every client
-- ── role; the backend service connection bypasses RLS by design.
create table public.workspace_social_connection_tokens (
  id uuid primary key default gen_random_uuid(),
  workspace_social_connection_id uuid not null
    references public.workspace_social_connections (id) on delete cascade,
  -- AES-GCM ciphertext envelope: base64(iv) || ':' || base64(ciphertext+tag).
  access_token_encrypted text not null check (access_token_encrypted ~ '^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$'),
  refresh_token_encrypted text,
  expires_at timestamptz,
  token_metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One current token record per active connection.
  unique (workspace_social_connection_id)
);

create index workspace_social_connection_tokens_connection_idx
  on public.workspace_social_connection_tokens (workspace_social_connection_id);

-- ── D. OAuth states — ephemeral handshake records, hashed state only ────────
create table public.social_connection_oauth_states (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  provider_key text not null references public.social_connection_providers (key),
  -- SHA-256 hex of the state token; the plain token is never stored.
  state_token_hash text not null check (state_token_hash ~ '^[0-9a-f]{64}$'),
  -- Encrypted PKCE verifier (server holds the key); nullable for providers
  -- that do not support PKCE (e.g. Meta).
  pkce_verifier_encrypted text,
  requested_scopes jsonb,
  redirect_uri text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index social_connection_oauth_states_expiry_idx
  on public.social_connection_oauth_states (expires_at);
create index social_connection_oauth_states_hash_idx
  on public.social_connection_oauth_states (state_token_hash);
create index social_connection_oauth_states_lookup_idx
  on public.social_connection_oauth_states (workspace_id, provider_key, expires_at);

-- ── E. Events — append-only audit timeline (no secrets in metadata) ─────────
create table public.social_connection_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  workspace_social_connection_id uuid
    references public.workspace_social_connections (id) on delete set null,
  actor_id uuid references auth.users (id) on delete set null,
  provider_key text not null,
  event_type public.social_connection_event_type not null,
  message text not null check (char_length(message) between 1 and 400),
  -- Audit-safe metadata only; size-capped below.
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index social_connection_events_timeline_idx
  on public.social_connection_events (workspace_id, created_at desc);
create index social_connection_events_connection_idx
  on public.social_connection_events (workspace_social_connection_id, created_at desc);
create index social_connection_events_provider_idx
  on public.social_connection_events (workspace_id, provider_key);

-- Metadata stays small and audit-safe.
create or replace function public.social_event_metadata_size_guard()
returns trigger as $$
begin
  if octet_length(new.metadata::text) > 512 then
    raise exception 'social_connection_events.metadata exceeds 512 bytes — keep metadata audit-safe.';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger social_connection_events_metadata_guard
  before insert or update on public.social_connection_events
  for each row execute function public.social_event_metadata_size_guard();

-- ── updated_at bookkeeping ──────────────────────────────────────────────────
create or replace function public.social_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger social_connection_providers_updated_at
  before update on public.social_connection_providers
  for each row execute function public.social_set_updated_at();
create trigger workspace_social_connections_updated_at
  before update on public.workspace_social_connections
  for each row execute function public.social_set_updated_at();
create trigger workspace_social_connection_tokens_updated_at
  before update on public.workspace_social_connection_tokens
  for each row execute function public.social_set_updated_at();

-- ── F. RLS — workspace membership via the existing is_workspace_member ──────
alter table public.social_connection_providers enable row level security;
alter table public.workspace_social_connections enable row level security;
alter table public.workspace_social_connection_tokens enable row level security;
alter table public.social_connection_oauth_states enable row level security;
alter table public.social_connection_events enable row level security;

-- Providers: readable by all authenticated users (registry metadata only).
create policy social_connection_providers_read
  on public.social_connection_providers for select
  to authenticated using (true);

-- Connections: full member access, workspace-scoped.
create policy workspace_social_connections_read
  on public.workspace_social_connections for select
  to authenticated using (public.is_workspace_member(workspace_id, auth.uid()));
create policy workspace_social_connections_write
  on public.workspace_social_connections for insert
  to authenticated with check (public.is_workspace_member(workspace_id, auth.uid()));
create policy workspace_social_connections_update
  on public.workspace_social_connections for update
  to authenticated using (public.is_workspace_member(workspace_id, auth.uid()))
  with check (public.is_workspace_member(workspace_id, auth.uid()));
create policy workspace_social_connections_delete
  on public.workspace_social_connections for delete
  to authenticated using (public.is_workspace_member(workspace_id, auth.uid()));

-- Tokens: NO policies — every client operation is denied. The server-side
-- service role bypasses RLS by design; this is the enforcement point.
-- (No create policy statements on purpose.)

-- OAuth states: members may read their workspace's state rows (safe fields
-- only — hashes, never verifiers). Creation/verification happens through the
-- server-side service (service role); interactive cleanup is member-scoped.
create policy social_connection_oauth_states_read
  on public.social_connection_oauth_states for select
  to authenticated using (public.is_workspace_member(workspace_id, auth.uid()));
create policy social_connection_oauth_states_delete
  on public.social_connection_oauth_states for delete
  to authenticated using (public.is_workspace_member(workspace_id, auth.uid()));

-- Events: read-only for members — the audit timeline cannot be rewritten.
create policy social_connection_events_read
  on public.social_connection_events for select
  to authenticated using (public.is_workspace_member(workspace_id, auth.uid()));
