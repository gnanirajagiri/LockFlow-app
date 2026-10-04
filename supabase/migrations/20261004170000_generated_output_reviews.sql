-- ═══════════════════════════════════════════════════════════════════════════
-- LockFlow — Prompt 30: generated-set approval, selection & campaign handoff.
--
-- The formal workflow between generation (prompts 27–29) and campaign
-- execution. Generated outputs stay in Gallery; campaigns consume approved
-- outputs through controlled references — never copies, never Library
-- assets, never untraceable.
--
-- Rules encoded:
--   * Every row is workspace-scoped (RLS via is_workspace_member).
--   * Review states: pending_review → approved | rejected; approved →
--     shortlisted → selected_for_campaign → handed_off.
--   * Rejected outputs stay inspectable but are excluded from selection
--     defaults and blocked from handoff (service layer enforces; schema
--     stores the state honestly).
--   * campaign_output_links preserve the source generation job / campaign
--     generation run — full traceability from campaign item back to the
--     locked baseline.
--   * The audit trail is append-only (select + insert policies only).
-- ═══════════════════════════════════════════════════════════════════════════

create type public.generated_output_review_status as enum (
  'pending_review', 'approved', 'rejected',
  'shortlisted', 'selected_for_campaign', 'handed_off'
);

-- ── A. Per-output review state ───────────────────────────────────────────────
create table public.generated_output_reviews (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  gallery_output_id uuid not null references public.gallery_outputs (id) on delete cascade,
  generation_job_id uuid references public.generation_provider_runs (id) on delete set null,
  campaign_generation_run_id uuid references public.campaign_generation_runs (id) on delete set null,
  review_status     generated_output_review_status not null default 'pending_review',
  review_notes      text,
  reviewed_by       uuid references auth.users (id) on delete set null,
  reviewed_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (workspace_id, gallery_output_id)
);

create trigger trg_generated_output_reviews_updated_at
  before update on public.generated_output_reviews
  for each row execute function public.set_updated_at();

create index generated_output_reviews_output_idx
  on public.generated_output_reviews (gallery_output_id);
create index generated_output_reviews_run_idx
  on public.generated_output_reviews (campaign_generation_run_id);

-- ── B. Final selection sets (the curated chosen subset) ─────────────────────
create table public.generated_output_selections (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  campaign_generation_run_id uuid references public.campaign_generation_runs (id) on delete set null,
  name              text,
  selection_status  text not null default 'draft'
                    check (selection_status in ('draft', 'finalized', 'handed_off')),
  created_by        uuid not null references auth.users (id) on delete cascade,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create trigger trg_generated_output_selections_updated_at
  before update on public.generated_output_selections
  for each row execute function public.set_updated_at();

create index generated_output_selections_run_idx
  on public.generated_output_selections (campaign_generation_run_id);

-- ── C. Selection items (ordered, role-aware) ────────────────────────────────
create table public.generated_output_selection_items (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  selection_id      uuid not null references public.generated_output_selections (id) on delete cascade,
  gallery_output_id uuid not null references public.gallery_outputs (id) on delete cascade,
  selection_role    text,
  output_order      integer not null default 0,
  created_at        timestamptz not null default now(),
  unique (selection_id, gallery_output_id)
);

create index generated_output_selection_items_selection_idx
  on public.generated_output_selection_items (selection_id, output_order);

-- ── D. Campaign handoff links (traceability: item ← output ← run/job) ───────
create table public.campaign_output_links (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  campaign_id       uuid not null references public.campaigns (id) on delete cascade,
  campaign_item_id  uuid references public.campaign_items (id) on delete set null,
  gallery_output_id uuid not null references public.gallery_outputs (id) on delete cascade,
  source_generation_job_id uuid references public.generation_provider_runs (id) on delete set null,
  source_campaign_generation_run_id uuid references public.campaign_generation_runs (id) on delete set null,
  handoff_status    text not null default 'linked'
                    check (handoff_status in ('linked')),
  linked_by         uuid not null references auth.users (id) on delete cascade,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create trigger trg_campaign_output_links_updated_at
  before update on public.campaign_output_links
  for each row execute function public.set_updated_at();

create index campaign_output_links_campaign_idx
  on public.campaign_output_links (campaign_id);
create index campaign_output_links_output_idx
  on public.campaign_output_links (gallery_output_id);
create index campaign_output_links_run_idx
  on public.campaign_output_links (source_campaign_generation_run_id);

-- ── E. Append-only audit trail ───────────────────────────────────────────────
create table public.generated_output_audit (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  gallery_output_id uuid references public.gallery_outputs (id) on delete set null,
  event             text not null check (event in (
    'generated_output_approved',
    'generated_output_rejected',
    'generated_output_shortlisted',
    'generated_output_selection_created',
    'generated_output_added_to_selection',
    'generated_output_removed_from_selection',
    'generated_output_selection_reordered',
    'generated_output_handoff_requested',
    'generated_output_handed_off_to_campaign',
    'generated_output_handoff_blocked'
  )),
  detail            text,
  created_at        timestamptz not null default now()
);

create index generated_output_audit_output_idx
  on public.generated_output_audit (gallery_output_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- Row-level security — workspace-scoped access only
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.generated_output_reviews enable row level security;
alter table public.generated_output_selections enable row level security;
alter table public.generated_output_selection_items enable row level security;
alter table public.campaign_output_links enable row level security;
alter table public.generated_output_audit enable row level security;

create policy "generated_output_reviews_select_member" on public.generated_output_reviews
  for select using (public.is_workspace_member(workspace_id));
create policy "generated_output_reviews_insert_member" on public.generated_output_reviews
  for insert with check (public.is_workspace_member(workspace_id));
create policy "generated_output_reviews_update_member" on public.generated_output_reviews
  for update using (public.is_workspace_member(workspace_id));

create policy "generated_output_selections_select_member" on public.generated_output_selections
  for select using (public.is_workspace_member(workspace_id));
create policy "generated_output_selections_insert_member" on public.generated_output_selections
  for insert with check (public.is_workspace_member(workspace_id) and auth.uid() = created_by);
create policy "generated_output_selections_update_member" on public.generated_output_selections
  for update using (public.is_workspace_member(workspace_id));

create policy "generated_output_selection_items_select_member" on public.generated_output_selection_items
  for select using (public.is_workspace_member(workspace_id));
create policy "generated_output_selection_items_insert_member" on public.generated_output_selection_items
  for insert with check (public.is_workspace_member(workspace_id));
create policy "generated_output_selection_items_delete_member" on public.generated_output_selection_items
  for delete using (public.is_workspace_member(workspace_id));

create policy "campaign_output_links_select_member" on public.campaign_output_links
  for select using (public.is_workspace_member(workspace_id));
create policy "campaign_output_links_insert_member" on public.campaign_output_links
  for insert with check (public.is_workspace_member(workspace_id) and auth.uid() = linked_by);
create policy "campaign_output_links_update_member" on public.campaign_output_links
  for update using (public.is_workspace_member(workspace_id));

-- Audit: append-only — select + insert, never update/delete.
create policy "generated_output_audit_select_member" on public.generated_output_audit
  for select using (public.is_workspace_member(workspace_id));
create policy "generated_output_audit_insert_member" on public.generated_output_audit
  for insert with check (public.is_workspace_member(workspace_id));
