-- ═══════════════════════════════════════════════════════════════════════════
-- LockFlow — Publishing Operations (Prompt 20)
-- Minimal, additive columns for run status tracking, calendar planning and
-- failure resolution. NO new publishing trigger, worker or auto-publish
-- path exists after this migration: planned dates remain internal planning
-- metadata only.
--
-- Rules encoded here:
--   * campaign_items planning fields are nullable planning metadata.
--   * publish_runs gain status-check bookkeeping, a provider-confirmed
--     permalink (safe/public only), a safe failure category and a
--     retryable flag. Snapshots stay immutable; the existing trigger from
--     20261001100000_publishing_review.sql keeps guarding them.
--   * No tokens, refresh tokens, signed media URLs or raw provider
--     payloads are stored — nothing in this migration can hold them.
--   * RLS: the existing workspace-scoped table policies continue to apply;
--     new columns do not weaken them.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── A. Campaign item planning metadata ──────────────────────────────────────
alter table public.campaign_items
  add column if not exists planned_timezone text,
  add column if not exists planning_status text;

-- ── B. Publish run operational bookkeeping ──────────────────────────────────
alter table public.publish_runs
  add column if not exists last_status_checked_at timestamptz,
  add column if not exists next_status_check_at timestamptz,
  add column if not exists provider_published_at timestamptz,
  add column if not exists provider_permalink text,
  add column if not exists failure_category text,
  add column if not exists is_retryable boolean not null default false;

-- A permalink must be a public http(s) URL — never a signed/private URL.
alter table public.publish_runs
  drop constraint if exists publish_runs_permalink_public_guard;
alter table public.publish_runs
  add constraint publish_runs_permalink_public_guard
  check (provider_permalink is null or provider_permalink ~* '^https?://');

-- Failure category is constrained to the safe taxonomy.
alter table public.publish_runs
  drop constraint if exists publish_runs_failure_category_guard;
alter table public.publish_runs
  add constraint publish_runs_failure_category_guard
  check (
    failure_category is null
    or failure_category in (
      'AUTHORIZATION_REQUIRED', 'CONNECTION_EXPIRED', 'PROVIDER_UNAVAILABLE',
      'RATE_LIMITED', 'MEDIA_REJECTED', 'PLACEMENT_UNSUPPORTED',
      'REQUIRED_FIELD_MISSING', 'PROVIDER_VALIDATION_FAILED',
      'UNKNOWN_RETRYABLE', 'UNKNOWN_FINAL'
    )
  );

-- Operational indexes for history/status views.
create index if not exists publish_runs_status_updated_idx
  on public.publish_runs (status, updated_at desc);
create index if not exists publish_runs_next_status_check_idx
  on public.publish_runs (next_status_check_at)
  where next_status_check_at is not null;

-- ── C. Audit vocabulary (enum extension, idempotent) ────────────────────────
alter type public.publishing_review_event_type add value if not exists
  'campaign_item_planned';
alter type public.publishing_review_event_type add value if not exists
  'campaign_item_rescheduled';
alter type public.publishing_review_event_type add value if not exists
  'publish_status_refresh_requested';
alter type public.publishing_review_event_type add value if not exists
  'publish_status_refreshed';
alter type public.publishing_review_event_type add value if not exists
  'publish_status_refresh_failed';
alter type public.publishing_review_event_type add value if not exists
  'publish_run_marked_published';
alter type public.publishing_review_event_type add value if not exists
  'publish_run_marked_failed';
alter type public.publishing_review_event_type add value if not exists
  'publish_run_retryable';
alter type public.publishing_review_event_type add value if not exists
  'publish_retry_started';
alter type public.publishing_review_event_type add value if not exists
  'connection_reauth_required';

-- NOTE: No scheduled job, trigger or function here creates or submits a
-- publish run from campaign_items.planned_publish_at. The calendar remains
-- planning-only; submission stays an explicit, confirmed user action.
