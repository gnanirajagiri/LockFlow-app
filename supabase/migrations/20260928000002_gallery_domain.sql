-- ═══════════════════════════════════════════════════════════════════════════
-- LockFlow — Gallery data foundation
-- gallery_outputs, gallery_output_reviews, gallery_output_tags,
-- gallery_output_tag_links, gallery_collections, gallery_collection_items,
-- gallery_output_events + RLS + workspace consistency + review immutability.
--
-- Product rules encoded here:
--   * Gallery is distinct from the Library: it holds GENERATED content only.
--     An output references the immutable job pins that produced it but never
--     becomes a reusable Library source asset.
--   * Every output belongs to exactly one content_job_request in the SAME
--     workspace. Provenance flows through the job's pins and snapshots —
--     later source-version changes never alter historic records.
--   * Review decisions append history (never overwrite) and cannot mutate
--     job pins. Rejection stores feedback for future variant workflows.
--   * Archive is soft only; there is no hard delete through standard flows.
--   * Storage paths are private metadata placeholders until secure storage
--     and a real provider are connected.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Enums ───────────────────────────────────────────────────────────────────
create type public.gallery_output_type as enum ('image', 'video', 'story');
create type public.gallery_output_status as enum (
  'draft', 'processing', 'ready_for_review', 'approved', 'rejected', 'archived', 'failed'
);
create type public.gallery_review_decision as enum ('approved', 'rejected', 'changes_requested');
create type public.gallery_collection_status as enum ('active', 'archived');

-- ── A. Gallery outputs ──────────────────────────────────────────────────────
create table public.gallery_outputs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  content_job_request_id uuid not null references public.content_job_requests (id) on delete cascade,
  parent_gallery_output_id uuid references public.gallery_outputs (id) on delete set null,
  title text not null check (char_length(title) between 1 and 120),
  output_type gallery_output_type not null,
  status gallery_output_status not null default 'draft',
  -- Private storage metadata; placeholders until secure storage exists.
  media_storage_path text,
  thumbnail_storage_path text,
  duration_seconds numeric check (duration_seconds is null or duration_seconds >= 0),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  file_size_bytes bigint check (file_size_bytes is null or file_size_bytes > 0),
  mime_type text,
  output_index integer not null default 1 check (output_index >= 1),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (content_job_request_id, output_index)
);

create index gallery_outputs_workspace_idx on public.gallery_outputs (workspace_id);
create index gallery_outputs_job_idx on public.gallery_outputs (content_job_request_id);
create index gallery_outputs_status_idx on public.gallery_outputs (workspace_id, status);

create trigger trg_gallery_outputs_updated_at
  before update on public.gallery_outputs
  for each row execute function public.set_updated_at();

-- The output's job (and therefore provenance) must live in the same workspace.
create function public.guard_gallery_output_workspace()
returns trigger
language plpgsql
as $$
declare
  v_job_workspace uuid;
begin
  select workspace_id into v_job_workspace
  from public.content_job_requests where id = new.content_job_request_id;
  if v_job_workspace is null then
    raise exception 'content job request not found' using errcode = 'P0002';
  end if;
  if v_job_workspace <> new.workspace_id then
    raise exception 'gallery output and content job must share a workspace'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger trg_gallery_outputs_workspace_guard
  before insert or update on public.gallery_outputs
  for each row execute function public.guard_gallery_output_workspace();

-- ── B. Review history (append-only decisions) ───────────────────────────────
create table public.gallery_output_reviews (
  id uuid primary key default gen_random_uuid(),
  gallery_output_id uuid not null references public.gallery_outputs (id) on delete cascade,
  reviewer_id uuid not null references auth.users (id) on delete cascade,
  decision gallery_review_decision not null,
  feedback text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index gallery_output_reviews_output_idx
  on public.gallery_output_reviews (gallery_output_id, created_at);

create trigger trg_gallery_output_reviews_updated_at
  before update on public.gallery_output_reviews
  for each row execute function public.set_updated_at();

-- Review history is append-only: rows are never updated or deleted.
create function public.guard_gallery_reviews_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'gallery reviews are an append-only history'
    using errcode = 'check_violation';
end;
$$;

create trigger trg_gallery_output_reviews_no_update
  before update on public.gallery_output_reviews
  for each row execute function public.guard_gallery_reviews_append_only();

create trigger trg_gallery_output_reviews_no_delete
  before delete on public.gallery_output_reviews
  for each row execute function public.guard_gallery_reviews_append_only();

-- ── C. Output tags (workspace-scoped vocabulary) ────────────────────────────
create table public.gallery_output_tags (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  normalized_name text not null check (normalized_name ~ '^[a-z0-9]+(-?[a-z0-9]+)*$'),
  created_at timestamptz not null default now(),
  unique (workspace_id, normalized_name)
);

create index gallery_output_tags_workspace_idx on public.gallery_output_tags (workspace_id);

-- ── D. Tag links (composite pair, workspace-consistent) ─────────────────────
create table public.gallery_output_tag_links (
  gallery_output_id uuid not null references public.gallery_outputs (id) on delete cascade,
  tag_id uuid not null references public.gallery_output_tags (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (gallery_output_id, tag_id)
);

create index gallery_output_tag_links_tag_idx on public.gallery_output_tag_links (tag_id);

-- ── E. Collections (group Gallery outputs only) ─────────────────────────────
create table public.gallery_collections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  description text,
  status gallery_collection_status not null default 'active',
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index gallery_collections_workspace_idx on public.gallery_collections (workspace_id);

create trigger trg_gallery_collections_updated_at
  before update on public.gallery_collections
  for each row execute function public.set_updated_at();

-- ── F. Collection items (ordered membership) ────────────────────────────────
create table public.gallery_collection_items (
  id uuid primary key default gen_random_uuid(),
  gallery_collection_id uuid not null references public.gallery_collections (id) on delete cascade,
  gallery_output_id uuid not null references public.gallery_outputs (id) on delete cascade,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (gallery_collection_id, gallery_output_id)
);

create index gallery_collection_items_collection_idx
  on public.gallery_collection_items (gallery_collection_id, sort_order);

create trigger trg_gallery_collection_items_updated_at
  before update on public.gallery_collection_items
  for each row execute function public.set_updated_at();

-- ── G. Output events (append-only audit timeline) ───────────────────────────
create table public.gallery_output_events (
  id uuid primary key default gen_random_uuid(),
  gallery_output_id uuid not null references public.gallery_outputs (id) on delete cascade,
  event_type text not null,
  message text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index gallery_output_events_output_idx
  on public.gallery_output_events (gallery_output_id, created_at);

create function public.guard_gallery_events_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'gallery output events are an append-only audit timeline'
    using errcode = 'check_violation';
end;
$$;

create trigger trg_gallery_output_events_no_update
  before update on public.gallery_output_events
  for each row execute function public.guard_gallery_events_append_only();

create trigger trg_gallery_output_events_no_delete
  before delete on public.gallery_output_events
  for each row execute function public.guard_gallery_events_append_only();

-- ═══════════════════════════════════════════════════════════════════════════
-- Row-level security — workspace membership gates every path
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.gallery_outputs enable row level security;
alter table public.gallery_output_reviews enable row level security;
alter table public.gallery_output_tags enable row level security;
alter table public.gallery_output_tag_links enable row level security;
alter table public.gallery_collections enable row level security;
alter table public.gallery_collection_items enable row level security;
alter table public.gallery_output_events enable row level security;

-- gallery_outputs ────────────────────────────────────────────────────────────
create policy "gallery_outputs_select_member" on public.gallery_outputs
  for select using (public.is_workspace_member(workspace_id));

create policy "gallery_outputs_insert_member" on public.gallery_outputs
  for insert with check (public.is_workspace_member(workspace_id) and auth.uid() = created_by);

create policy "gallery_outputs_update_member" on public.gallery_outputs
  for update using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

-- gallery_output_reviews ─────────────────────────────────────────────────────
create policy "gallery_reviews_select_member" on public.gallery_output_reviews
  for select using (
    exists (
      select 1 from public.gallery_outputs o
      where o.id = gallery_output_id and public.is_workspace_member(o.workspace_id)
    )
  );

create policy "gallery_reviews_insert_member" on public.gallery_output_reviews
  for insert with check (
    auth.uid() = reviewer_id
    and exists (
      select 1 from public.gallery_outputs o
      where o.id = gallery_output_id and public.is_workspace_member(o.workspace_id)
    )
  );

-- gallery_output_tags ────────────────────────────────────────────────────────
create policy "gallery_tags_select_member" on public.gallery_output_tags
  for select using (public.is_workspace_member(workspace_id));

create policy "gallery_tags_insert_member" on public.gallery_output_tags
  for insert with check (public.is_workspace_member(workspace_id));

create policy "gallery_tags_update_member" on public.gallery_output_tags
  for update using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

-- gallery_output_tag_links ───────────────────────────────────────────────────
create policy "gallery_tag_links_select_member" on public.gallery_output_tag_links
  for select using (
    exists (
      select 1 from public.gallery_outputs o
      join public.gallery_output_tags t on t.id = tag_id
      where o.id = gallery_output_id
        and o.workspace_id = t.workspace_id
        and public.is_workspace_member(o.workspace_id)
    )
  );

create policy "gallery_tag_links_insert_member" on public.gallery_output_tag_links
  for insert with check (
    exists (
      select 1 from public.gallery_outputs o
      join public.gallery_output_tags t on t.id = tag_id
      where o.id = gallery_output_id
        and o.workspace_id = t.workspace_id
        and public.is_workspace_member(o.workspace_id)
    )
  );

create policy "gallery_tag_links_delete_member" on public.gallery_output_tag_links
  for delete using (
    exists (
      select 1 from public.gallery_outputs o
      join public.gallery_output_tags t on t.id = tag_id
      where o.id = gallery_output_id
        and o.workspace_id = t.workspace_id
        and public.is_workspace_member(o.workspace_id)
    )
  );

-- gallery_collections ────────────────────────────────────────────────────────
create policy "gallery_collections_select_member" on public.gallery_collections
  for select using (public.is_workspace_member(workspace_id));

create policy "gallery_collections_insert_member" on public.gallery_collections
  for insert with check (public.is_workspace_member(workspace_id) and auth.uid() = created_by);

create policy "gallery_collections_update_member" on public.gallery_collections
  for update using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

-- gallery_collection_items ───────────────────────────────────────────────────
create policy "gallery_collection_items_select_member" on public.gallery_collection_items
  for select using (
    exists (
      select 1 from public.gallery_collections c
      where c.id = gallery_collection_id and public.is_workspace_member(c.workspace_id)
    )
  );

create policy "gallery_collection_items_insert_member" on public.gallery_collection_items
  for insert with check (
    exists (
      select 1 from public.gallery_collections c
      where c.id = gallery_collection_id and public.is_workspace_member(c.workspace_id)
    )
  );

create policy "gallery_collection_items_update_member" on public.gallery_collection_items
  for update using (
    exists (
      select 1 from public.gallery_collections c
      where c.id = gallery_collection_id and public.is_workspace_member(c.workspace_id)
    )
  );

create policy "gallery_collection_items_delete_member" on public.gallery_collection_items
  for delete using (
    exists (
      select 1 from public.gallery_collections c
      where c.id = gallery_collection_id and public.is_workspace_member(c.workspace_id)
    )
  );

-- gallery_output_events ──────────────────────────────────────────────────────
create policy "gallery_events_select_member" on public.gallery_output_events
  for select using (
    exists (
      select 1 from public.gallery_outputs o
      where o.id = gallery_output_id and public.is_workspace_member(o.workspace_id)
    )
  );

create policy "gallery_events_insert_member" on public.gallery_output_events
  for insert with check (
    exists (
      select 1 from public.gallery_outputs o
      where o.id = gallery_output_id and public.is_workspace_member(o.workspace_id)
    )
  );
