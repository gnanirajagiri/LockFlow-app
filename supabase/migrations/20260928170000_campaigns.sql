-- ═══════════════════════════════════════════════════════════════════════════
-- LockFlow — Campaigns data foundation
-- campaigns, campaign_channels, campaign_items, campaign_item_variants,
-- campaign_events + RLS + append-only audit + planning-date guarantees.
--
-- Product rules encoded here:
--   * Campaigns organise content; they never own source assets and never
--     modify Gallery media, job pins, provider runs or historic provenance.
--     Items REFERENCE approved Gallery outputs (FK to gallery_outputs, which
--     the Gallery domain guards) — attaching is service-verified.
--   * Only approved, non-archived Gallery outputs may attach as publish-ready
--     content; an attached output that later becomes archived surfaces as a
--     BLOCKED item through the service read model (the historic relation is
--     never deleted).
--   * Campaigns do not publish: planned dates are internal planning metadata,
--     so there are NO connection/token/account columns anywhere in this
--     schema and no scheduling worker concepts.
--   * campaign_events are an append-only audit timeline with minimal,
--     audit-safe metadata (no secrets, signed URLs or raw media).
--   * Phase 1: campaigns are private to their workspace.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Enums ───────────────────────────────────────────────────────────────────
create type public.campaign_status as enum ('draft', 'active', 'completed', 'archived');
create type public.campaign_channel_key as enum (
  'instagram', 'tiktok', 'youtube', 'facebook', 'linkedin', 'x', 'pinterest',
  'website', 'email', 'paid_social', 'other'
);
create type public.campaign_channel_intent as enum ('organic', 'paid', 'both');
create type public.campaign_item_status as enum ('planned', 'ready', 'blocked', 'removed');
create type public.campaign_item_format as enum (
  'feed_post', 'story', 'reel', 'short_video', 'ad_creative', 'website', 'email', 'other'
);
create type public.campaign_event_type as enum (
  'created', 'updated', 'status_changed', 'channel_added', 'channel_removed',
  'item_added', 'item_removed', 'item_updated', 'item_replaced',
  'calendar_updated', 'archived', 'restored'
);

-- ── A. Campaigns ────────────────────────────────────────────────────────────
create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  status public.campaign_status not null default 'draft',
  description text,
  objective text,
  audience text,
  key_message text,
  start_date date,
  end_date date,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  check (start_date is null or end_date is null or start_date <= end_date),
  unique (workspace_id, slug)
);

create index campaigns_workspace_idx on public.campaigns (workspace_id);
create index campaigns_workspace_status_idx on public.campaigns (workspace_id, status);
create index campaigns_workspace_dates_idx on public.campaigns (workspace_id, start_date, end_date);

create trigger trg_campaigns_updated_at
  before update on public.campaigns
  for each row execute function public.set_updated_at();

-- Soft archive bookkeeping: archived_at set iff status is archived.
create function public.guard_campaign_archive()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'archived' and new.archived_at is null and old.status <> 'archived' then
    new.archived_at := now();
  elsif new.status <> 'archived' and new.archived_at is not null then
    new.archived_at := null;
  end if;
  return new;
end;
$$;

create trigger trg_campaigns_archive_guard
  before update on public.campaigns
  for each row execute function public.guard_campaign_archive();

-- ── B. Campaign channels (planning targets only — no account data) ─────────
create table public.campaign_channels (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  channel public.campaign_channel_key not null,
  intent public.campaign_channel_intent not null default 'organic',
  notes text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, channel, intent)
);

create index campaign_channels_campaign_idx on public.campaign_channels (campaign_id, sort_order);

create trigger trg_campaign_channels_updated_at
  before update on public.campaign_channels
  for each row execute function public.set_updated_at();

-- ── C. Campaign items (references to approved Gallery outputs) ─────────────
create table public.campaign_items (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  gallery_output_id uuid not null references public.gallery_outputs (id),
  status public.campaign_item_status not null default 'planned',
  planned_channel public.campaign_channel_key,
  planned_format public.campaign_item_format,
  -- Internal planning date/time ONLY — never an external scheduled post.
  planned_publish_at timestamptz,
  caption_draft text,
  call_to_action text,
  notes text,
  sort_order integer not null default 0,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  removed_at timestamptz,
  unique (campaign_id, sort_order) deferrable initially deferred,
  check (removed_at is null or status = 'removed')
);

create index campaign_items_campaign_idx on public.campaign_items (campaign_id, status, sort_order);
create index campaign_items_planned_idx on public.campaign_items (planned_publish_at);
create index campaign_items_output_idx on public.campaign_items (gallery_output_id);

create trigger trg_campaign_items_updated_at
  before update on public.campaign_items
  for each row execute function public.set_updated_at();

-- Soft remove bookkeeping: removed_at set iff status is removed.
create function public.guard_campaign_item_remove()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'removed' and new.removed_at is null and old.status <> 'removed' then
    new.removed_at := now();
  elsif new.status <> 'removed' and new.removed_at is not null then
    new.removed_at := null;
  end if;
  return new;
end;
$$;

create trigger trg_campaign_items_remove_guard
  before update on public.campaign_items
  for each row execute function public.guard_campaign_item_remove();

-- ── D. Copy variants (planning text only — never media) ────────────────────
create table public.campaign_item_variants (
  id uuid primary key default gen_random_uuid(),
  campaign_item_id uuid not null references public.campaign_items (id) on delete cascade,
  label text not null check (char_length(label) between 1 and 120),
  caption_draft text,
  call_to_action text,
  format_override public.campaign_item_format,
  planned_channel_override public.campaign_channel_key,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index campaign_item_variants_item_idx on public.campaign_item_variants (campaign_item_id);

create trigger trg_campaign_item_variants_updated_at
  before update on public.campaign_item_variants
  for each row execute function public.set_updated_at();

-- ── E. Campaign events (append-only audit) ─────────────────────────────────
create table public.campaign_events (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  event_type public.campaign_event_type not null,
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index campaign_events_campaign_time_idx on public.campaign_events (campaign_id, created_at desc);

-- Append-only enforcement: updates and deletes are refused at the DB level.
create function public.refuse_campaign_event_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'campaign_events are append-only.';
end;
$$;

create trigger trg_campaign_events_no_update
  before update on public.campaign_events
  for each row execute function public.refuse_campaign_event_mutation();

create trigger trg_campaign_events_no_delete
  before delete on public.campaign_events
  for each row execute function public.refuse_campaign_event_mutation();

-- Audit-safe metadata: flat scalar values only (no secrets/media).
create function public.guard_campaign_event_metadata()
returns trigger
language plpgsql
as $$
declare
  v jsonb := new.metadata;
begin
  if jsonb_typeof(v) <> 'object' then
    raise exception 'campaign_events.metadata must be an object.';
  end if;
  if exists (
    select 1
    from jsonb_each_text(v) as e(key, value)
    where length(e.value) > 512
  ) then
    raise exception 'campaign_events.metadata values must be 512 characters or fewer.';
  end if;
  return new;
end;
$$;

create trigger trg_campaign_events_metadata_guard
  before insert or update on public.campaign_events
  for each row execute function public.guard_campaign_event_metadata();

-- ═══════════════════════════════════════════════════════════════════════════
-- Row Level Security — workspace isolation via is_workspace_member.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.campaigns enable row level security;
alter table public.campaign_channels enable row level security;
alter table public.campaign_items enable row level security;
alter table public.campaign_item_variants enable row level security;
alter table public.campaign_events enable row level security;

create policy campaigns_select on public.campaigns
  for select to authenticated
  using (public.is_workspace_member (workspace_id));

create policy campaigns_insert on public.campaigns
  for insert to authenticated
  with check (
    public.is_workspace_member (workspace_id)
    and created_by = auth.uid ()
  );

create policy campaigns_update on public.campaigns
  for update to authenticated
  using (public.is_workspace_member (workspace_id))
  with check (public.is_workspace_member (workspace_id));

create policy campaigns_delete on public.campaigns
  for delete to authenticated
  using (public.is_workspace_member (workspace_id));

create policy campaign_channels_select on public.campaign_channels
  for select to authenticated
  using (
    exists (
      select 1 from public.campaigns c
      where c.id = campaign_id
        and public.is_workspace_member (c.workspace_id)
    )
  );

create policy campaign_channels_write on public.campaign_channels
  for all to authenticated
  using (
    exists (
      select 1 from public.campaigns c
      where c.id = campaign_id
        and public.is_workspace_member (c.workspace_id)
    )
  )
  with check (
    exists (
      select 1 from public.campaigns c
      where c.id = campaign_id
        and public.is_workspace_member (c.workspace_id)
    )
  );

create policy campaign_items_select on public.campaign_items
  for select to authenticated
  using (
    exists (
      select 1 from public.campaigns c
      where c.id = campaign_id
        and public.is_workspace_member (c.workspace_id)
    )
  );

create policy campaign_items_write on public.campaign_items
  for all to authenticated
  using (
    exists (
      select 1 from public.campaigns c
      where c.id = campaign_id
        and public.is_workspace_member (c.workspace_id)
    )
  )
  with check (
    exists (
      select 1 from public.campaigns c
      where c.id = campaign_id
        and public.is_workspace_member (c.workspace_id)
    )
  );

create policy campaign_item_variants_select on public.campaign_item_variants
  for select to authenticated
  using (
    exists (
      select 1
      from public.campaign_items ci
      join public.campaigns c on c.id = ci.campaign_id
      where ci.id = campaign_item_id
        and public.is_workspace_member (c.workspace_id)
    )
  );

create policy campaign_item_variants_write on public.campaign_item_variants
  for all to authenticated
  using (
    exists (
      select 1
      from public.campaign_items ci
      join public.campaigns c on c.id = ci.campaign_id
      where ci.id = campaign_item_id
        and public.is_workspace_member (c.workspace_id)
    )
  )
  with check (
    exists (
      select 1
      from public.campaign_items ci
      join public.campaigns c on c.id = ci.campaign_id
      where ci.id = campaign_item_id
        and public.is_workspace_member (c.workspace_id)
    )
  );

create policy campaign_events_select on public.campaign_events
  for select to authenticated
  using (
    exists (
      select 1 from public.campaigns c
      where c.id = campaign_id
        and public.is_workspace_member (c.workspace_id)
    )
  );

create policy campaign_events_insert on public.campaign_events
  for insert to authenticated
  with check (
    exists (
      select 1 from public.campaigns c
      where c.id = campaign_id
        and public.is_workspace_member (c.workspace_id)
    )
  );
