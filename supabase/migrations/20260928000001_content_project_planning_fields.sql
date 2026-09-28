-- ═══════════════════════════════════════════════════════════════════════════
-- LockFlow — Content Studio planning fields (additive)
--
-- Adds the plan-level fields the functional Content Studio interface needs:
--   * planned_output_type  — Phase-1 format captured on the plan (photo, video,
--     story, content_set). The job request still carries its own output type;
--     this one documents intent while planning.
--   * requested_variants   — per-plan default (1–10), copied into draft jobs.
--   * creative_direction   — natural-language direction captured by the intent
--     bar in the Brief editor. Plain text saved to the draft; NO AI is invoked.
--   * storyboard_direction — natural-language direction captured by the intent
--     bar in the Storyboard. Same honest copy-to-draft behaviour.
--
-- No generation fields, no provider columns, no output records.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.content_projects
  add column if not exists planned_output_type public.content_output_type;

alter table public.content_projects
  add column if not exists requested_variants integer
    not null default 1
    check (requested_variants between 1 and 10);

alter table public.content_projects
  add column if not exists creative_direction text;

alter table public.content_projects
  add column if not exists storyboard_direction text;
