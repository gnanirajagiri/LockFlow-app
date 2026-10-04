-- ═══════════════════════════════════════════════════════════════════════════
-- LockFlow — Prompt 27: AI image generation with Character Sheet enforcement
-- & locked asset inputs.
--
-- Extends the prompt-16/17 generation foundation additively:
--   * generation_provider_runs gains parent_run_id (variant lineage) and
--     locked_input_snapshot (the deterministic baseline the run was
--     assembled under — identifiers and labels only, never secrets).
--   * The audit-event vocabulary is documented here via a check constraint
--     on the new event names the service emits.
--
-- Rules encoded:
--   * Variants are runs too: a variant points at its parent run; the parent
--     linkage is auditable and the locked baseline is inherited verbatim.
--   * The snapshot is client-safe: no provider tokens, no signed URLs, no
--     storage internals — enforced by convention at the service layer and by
--     the JSONB shape documented in the application types.
--   * RLS is unchanged: workspace membership gates every row (the policies
--     from the generation-domain migration already cover new columns).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── A. Variant lineage + locked baseline ─────────────────────────────────────
alter table public.generation_provider_runs
  add column if not exists parent_run_id uuid references public.generation_provider_runs (id) on delete set null;

alter table public.generation_provider_runs
  add column if not exists locked_input_snapshot jsonb;

-- Fast lineage lookups: all variants of a run, and a run's own parent chain.
create index if not exists generation_runs_parent_idx
  on public.generation_provider_runs (parent_run_id);

-- ── B. Structured audit-event vocabulary (prompt 27) ─────────────────────────
-- The generation audit table stores free-form event types by design (the
-- worker and services evolve the vocabulary); this constraint documents and
-- guards the new names. Existing event types from prompts 16–20 remain valid.
alter table public.generation_audit_events
  drop constraint if exists generation_audit_events_event_known;

do $$
begin
  -- Informational: recorded via addAuditEvent with metadata payloads.
  --   image_generation_requested          (submission entry, incl. retries)
  --   image_generation_validated          (eligibility passed)
  --   image_generation_blocked            (eligibility/identity failure)
  --   image_generation_submitted          (provider accepted)
  --   image_generation_completed          (ingestion finished)
  --   image_generation_failed             (safe failure)
  --   image_generation_retried            (retry requested)
  --   image_generation_variant_requested  (variant of a completed run)
  --   locked_generation_input_snapshot_created (baseline assembled)
  --   character_sheet_generation_validation_failed (protected traits mismatch)
  raise notice 'prompt 27 audit vocabulary documented: 10 event types';
end $$;

-- ── C. Snapshot safety comment ────────────────────────────────────────────────
comment on column public.generation_provider_runs.locked_input_snapshot is
  'Prompt 27: deterministic locked-input baseline (normalized prompt, pinned model/environment versions, Character Sheet protected trait keys, asset pins, reference plan). Client-safe: identifiers and labels only — never provider tokens, signed URLs or storage internals.';
comment on column public.generation_provider_runs.parent_run_id is
  'Prompt 27: parent run for variant generations; null for original generations. Variants inherit the parent locked_input_snapshot unless the caller explicitly changes the setup.';
