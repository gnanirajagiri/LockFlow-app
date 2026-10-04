-- ═══════════════════════════════════════════════════════════════════════════
-- LockFlow — Prompt 31: platform adaptation & campaign item packaging.
--
-- Turns approved Gallery outputs into platform-ready campaign packages —
-- one package per channel/placement, all referencing the SAME source
-- output. Packages are presentation/configuration records, never unmanaged
-- duplicates: the Gallery output and its locked baseline stay untouched,
-- and packaging is reversible (delete the package; the output is unchanged).
--
-- Rules encoded:
--   * Workspace membership gates every row (RLS below).
--   * Statuses cover the honest readiness ladder: draft → needs_* →
--     ready_for_review → handed_to_publishing (the existing explicit
--     publishing-review flow is the only exit toward publishing).
--   * Validation results are stored (state + safe error list) so readiness
--     decisions are inspectable, not client-side guesses.
--   * Per-channel media variants are recorded honestly (requested /
--     applied / unsupported) — the app never pretends a transform exists.
--   * The audit trail is append-only (select + insert policies only).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── A. Campaign content packages (per channel/placement) ────────────────────
create table public.campaign_content_packages (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  campaign_id       uuid not null references public.campaigns (id) on delete cascade,
  campaign_item_id  uuid references public.campaign_items (id) on delete set null,
  channel           text not null check (channel in (
                      'instagram', 'tiktok', 'youtube', 'facebook', 'linkedin',
                      'x', 'pinterest', 'website', 'email', 'paid_social', 'other')),
  placement         text not null check (placement in (
                      'feed_post', 'reel', 'story', 'short_video',
                      'video_post', 'image_post', 'ad_creative', 'other')),
  connected_account_id uuid references public.workspace_social_connections (id) on delete set null,
  source_gallery_output_id uuid not null references public.gallery_outputs (id) on delete cascade,
  caption_or_copy   text,
  headline          text,
  call_to_action    text,
  hashtags_or_tags  text,
  destination_url   text,
  media_variant_reference uuid,
  crop_or_format_settings_json jsonb,
  adaptation_status text not null default 'source_fits'
                    check (adaptation_status in ('source_fits', 'variant_needed', 'unsupported')),
  validation_state  text not null default 'unvalidated'
                    check (validation_state in ('unvalidated', 'valid', 'invalid')),
  validation_errors_json jsonb not null default '[]'::jsonb,
  status            text not null default 'draft'
                    check (status in (
                      'draft', 'needs_media_adaptation', 'needs_copy', 'needs_account',
                      'blocked', 'ready_for_review', 'approved_for_publish', 'handed_to_publishing')),
  created_by        uuid not null references auth.users (id) on delete cascade,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create trigger trg_campaign_content_packages_updated_at
  before update on public.campaign_content_packages
  for each row execute function public.set_updated_at();

create index campaign_content_packages_campaign_idx
  on public.campaign_content_packages (campaign_id);
create index campaign_content_packages_output_idx
  on public.campaign_content_packages (source_gallery_output_id);
create index campaign_content_packages_item_idx
  on public.campaign_content_packages (campaign_item_id);

-- ── B. Per-channel media variants (honest transform requests) ───────────────
create table public.campaign_package_media_variants (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  package_id        uuid not null references public.campaign_content_packages (id) on delete cascade,
  source_gallery_output_id uuid not null references public.gallery_outputs (id) on delete cascade,
  target_aspect_ratio text,
  crop_settings_json jsonb,
  status            text not null default 'requested'
                    check (status in ('requested', 'applied', 'unsupported')),
  notes             text,
  created_by        uuid not null references auth.users (id) on delete cascade,
  created_at        timestamptz not null default now()
);

create index campaign_package_media_variants_package_idx
  on public.campaign_package_media_variants (package_id);

-- ── C. Append-only audit trail ───────────────────────────────────────────────
create table public.campaign_package_audit (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  package_id        uuid references public.campaign_content_packages (id) on delete cascade,
  campaign_id       uuid references public.campaigns (id) on delete cascade,
  event             text not null check (event in (
    'campaign_package_created',
    'campaign_package_updated',
    'campaign_package_validation_passed',
    'campaign_package_validation_blocked',
    'campaign_package_variant_requested',
    'campaign_package_sent_to_review'
  )),
  detail            text,
  created_at        timestamptz not null default now()
);

create index campaign_package_audit_package_idx
  on public.campaign_package_audit (package_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- Row-level security — workspace-scoped access only
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.campaign_content_packages enable row level security;
alter table public.campaign_package_media_variants enable row level security;
alter table public.campaign_package_audit enable row level security;

create policy "campaign_content_packages_select_member" on public.campaign_content_packages
  for select using (public.is_workspace_member(workspace_id));
create policy "campaign_content_packages_insert_member" on public.campaign_content_packages
  for insert with check (public.is_workspace_member(workspace_id) and auth.uid() = created_by);
create policy "campaign_content_packages_update_member" on public.campaign_content_packages
  for update using (public.is_workspace_member(workspace_id));
create policy "campaign_content_packages_delete_member" on public.campaign_content_packages
  for delete using (public.is_workspace_member(workspace_id));

create policy "campaign_package_media_variants_select_member" on public.campaign_package_media_variants
  for select using (public.is_workspace_member(workspace_id));
create policy "campaign_package_media_variants_insert_member" on public.campaign_package_media_variants
  for insert with check (public.is_workspace_member(workspace_id) and auth.uid() = created_by);
create policy "campaign_package_media_variants_delete_member" on public.campaign_package_media_variants
  for delete using (public.is_workspace_member(workspace_id));

-- Audit: append-only — select + insert, never update/delete.
create policy "campaign_package_audit_select_member" on public.campaign_package_audit
  for select using (public.is_workspace_member(workspace_id));
create policy "campaign_package_audit_insert_member" on public.campaign_package_audit
  for insert with check (public.is_workspace_member(workspace_id));
