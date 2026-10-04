-- ═══════════════════════════════════════════════════════════════════════════
-- LockFlow — Prompt 28: AI video & story generation with locked inputs,
-- Character Sheet enforcement & media job orchestration.
--
-- Extends the prompt-27 media-generation architecture additively. No new
-- tables are needed: video/story runs live in generation_provider_runs
-- (generation_kind='video'), and the media flavor, story grouping and
-- identity-validation results are recorded in the run snapshots. This
-- migration indexes variant lineage and documents the story grouping keys.
--
-- Rules encoded:
--   * A story run's outputs share one story group key (story:<run_id>) and
--     carry their 1-based sequence position + total in Gallery metadata —
--     grouping is reconstructable from the run alone.
--   * Variants point at their parent run via parent_run_id (added in the
--     prompt-27 migration) and inherit the locked input snapshot verbatim
--     unless the caller explicitly changes the setup.
--   * Character Sheet enforcement for model-based media runs is recorded in
--     the run snapshot (identityValidation) and audited via
--     character_sheet_media_generation_validation_failed on the shared
--     generation audit store. RLS is unchanged (workspace membership).
-- ═══════════════════════════════════════════════════════════════════════════

-- Story outputs are grouped per run; index the run → outputs path so a
-- story set can be reassembled in order without full scans.
create index if not exists generation_runs_media_flavor_idx
  on public.generation_provider_runs (
    workspace_id,
    (request_snapshot ->> 'mediaFlavor'),
    created_at
  )
  where generation_kind = 'video';

-- Gallery story grouping: outputs of one story run share the group key.
-- The gallery_outputs metadata JSONB already carries story_group_key /
-- story_sequence / story_sequence_total; a functional index keeps grouped
-- reads fast without a schema change to the Gallery (Gallery remains the
-- single home for generated outputs — Library is untouched).
create index if not exists gallery_outputs_story_group_idx
  on public.gallery_outputs ((metadata ->> 'story_group_key'))
  where metadata ->> 'story_group_key' is not null;

-- ── Audit-event vocabulary additions (prompt 28) ────────────────────────────
-- Recorded on the shared generation_audit_events store (free-form event type
-- column by design):
--   video_generation_requested
--   story_generation_requested
--   media_generation_validated            (eligibility + identity passed)
--   media_generation_blocked              (eligibility/identity failure)
--   media_generation_submitted            (provider accepted the request)
--   media_generation_completed            (ingestion finished)
--   media_generation_failed               (safe failure; retry available)
--   media_generation_retried
--   media_generation_variant_requested    (parent linkage audited)
--   locked_media_input_snapshot_created   (baseline assembled)
--   character_sheet_media_generation_validation_failed

comment on column public.generation_provider_runs.request_snapshot is
  'Prompt 27/28: immutable provider request snapshot — normalized prompt, media flavor (video|story), ordered story frame plan, identity validation results, pin summary. Client-safe: identifiers and labels only, never provider tokens, signed URLs or storage internals.';
