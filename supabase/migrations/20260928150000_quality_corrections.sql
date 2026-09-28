-- ═══════════════════════════════════════════════════════════════════════════
-- LockFlow — Continuity Quality Review and Correction Workflow
--
-- Adds review/correction records ONLY. This migration never touches source
-- tables (models/environments/library), job pins, provider runs or gallery
-- media. Rules encoded here:
--   * quality_reviews / quality_findings — human continuity review records.
--     Expected context is captured at review creation from immutable job pins
--     (a minimal read model, never a duplicate source row). Findings are
--     editable only while the parent review is a draft; completed reviews are
--     append-only except safe archival metadata.
--   * correction_requests — controlled derivative jobs. source/pin snapshots
--     are built server-side from the parent output's historical provenance and
--     become immutable once the request leaves draft. No asset/version
--     selectors exist by design; newer sources can never be substituted.
--   * correction_request_events — append-only audit. No secrets, no signed
--     URLs, no raw media (enforced by service discipline + no UPDATE policy).
--   * recurring_quality_issues — advisory escalation aggregates keyed by
--     workspace + deterministic issue key (category + pinned-version hash,
--     never contents). Updated ONLY through the record_quality_issue_occurrence
--     security-definer RPC — no client write path exists.
--   * Quality/correction data is bound to gallery_outputs (Gallery domain) and
--     can never create or modify Library assets.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── A. Quality reviews ──────────────────────────────────────────────────────
create table public.quality_reviews (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  gallery_output_id uuid not null references public.gallery_outputs (id) on delete cascade,
  status text not null default 'draft'
    check (status in ('draft', 'completed', 'archived')),
  overall_result text not null default 'not_checked'
    check (overall_result in ('pass', 'warning', 'fail', 'not_checked')),
  reviewer_id uuid not null references auth.users (id) on delete cascade,
  summary text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_quality_reviews_updated_at
  before update on public.quality_reviews
  for each row execute function public.set_updated_at();

-- One active draft per reviewer per output (history is preserved, never
-- replaced); completed reviews stay append-only.
create unique index quality_reviews_one_draft_per_reviewer_idx
  on public.quality_reviews (gallery_output_id, reviewer_id)
  where status = 'draft';

create index quality_reviews_output_idx
  on public.quality_reviews (gallery_output_id);
create index quality_reviews_workspace_idx
  on public.quality_reviews (workspace_id, status, updated_at);

alter table public.quality_reviews enable row level security;

create policy "quality_reviews_select_member" on public.quality_reviews
  for select using (public.is_workspace_member(workspace_id));

create policy "quality_reviews_insert_member" on public.quality_reviews
  for insert with check (
    public.is_workspace_member(workspace_id) and auth.uid() = reviewer_id
  );

-- Draft-phase edits only. Completed/archived rows are read-only here; the
-- final archival flip is performed by the service (archived stays archived).
create policy "quality_reviews_update_member" on public.quality_reviews
  for update using (public.is_workspace_member(workspace_id) and status = 'draft')
  with check (public.is_workspace_member(workspace_id) and status = 'draft');

-- ── B. Quality findings ─────────────────────────────────────────────────────
create table public.quality_findings (
  id uuid primary key default gen_random_uuid(),
  quality_review_id uuid not null references public.quality_reviews (id) on delete cascade,
  category text not null check (category in (
    'model_identity', 'face', 'hairstyle', 'skin_tone', 'body_proportions',
    'wardrobe', 'accessory', 'product', 'prop',
    'environment_layout', 'furniture_anchor', 'lighting', 'palette_material',
    'camera', 'composition', 'text_overlay', 'motion', 'continuity', 'other'
  )),
  result text not null check (result in ('pass', 'warning', 'fail', 'not_checked')),
  severity text not null default 'low' check (severity in ('low', 'medium', 'high')),
  expected_context jsonb not null default '{}'::jsonb,
  observed_note text,
  correction_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_quality_findings_updated_at
  before update on public.quality_findings
  for each row execute function public.set_updated_at();

create index quality_findings_review_idx
  on public.quality_findings (quality_review_id);

alter table public.quality_findings enable row level security;

create policy "quality_findings_select_member" on public.quality_findings
  for select using (
    exists (
      select 1 from public.quality_reviews r
      where r.id = quality_review_id and public.is_workspace_member(r.workspace_id)
    )
  );

create policy "quality_findings_insert_member" on public.quality_findings
  for insert with check (
    exists (
      select 1 from public.quality_reviews r
      where r.id = quality_review_id
        and public.is_workspace_member(r.workspace_id)
        and r.status = 'draft'
    )
  );

create policy "quality_findings_update_member" on public.quality_findings
  for update using (
    exists (
      select 1 from public.quality_reviews r
      where r.id = quality_review_id
        and public.is_workspace_member(r.workspace_id)
        and r.status = 'draft'
    )
  )
  with check (
    exists (
      select 1 from public.quality_reviews r
      where r.id = quality_review_id and r.status = 'draft'
    )
  );

-- Findings of completed/archived reviews are not deletable client-side; there
-- is no DELETE policy at all. Draft-phase removal goes through the service.

-- ── C. Correction requests ──────────────────────────────────────────────────
create table public.correction_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  source_gallery_output_id uuid not null references public.gallery_outputs (id) on delete cascade,
  source_content_job_request_id uuid not null references public.content_job_requests (id) on delete cascade,
  source_generation_provider_run_id uuid references public.generation_provider_runs (id) on delete set null,
  status text not null default 'draft'
    check (status in ('draft', 'ready', 'submitted', 'processing', 'completed', 'failed', 'cancelled', 'archived')),
  title text not null,
  requested_change text not null,
  scope text not null check (scope in (
    'composition', 'framing', 'camera', 'lighting', 'product_framing',
    'motion', 'continuity', 'prompt_direction', 'other'
  )),
  source_snapshot jsonb not null default '{}'::jsonb,
  pin_snapshot jsonb not null default '{}'::jsonb,
  provider_options_snapshot jsonb,
  created_by uuid not null references auth.users (id) on delete cascade,
  submitted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_correction_requests_updated_at
  before update on public.correction_requests
  for each row execute function public.set_updated_at();

create index correction_requests_status_idx
  on public.correction_requests (status);
create index correction_requests_workspace_idx
  on public.correction_requests (workspace_id, status, updated_at);
create index correction_requests_source_output_idx
  on public.correction_requests (source_gallery_output_id);

alter table public.correction_requests enable row level security;

create policy "correction_requests_select_member" on public.correction_requests
  for select using (public.is_workspace_member(workspace_id));

create policy "correction_requests_insert_member" on public.correction_requests
  for insert with check (
    public.is_workspace_member(workspace_id) and auth.uid() = created_by
  );

-- Draft-phase edits only; snapshots become immutable once the status leaves
-- draft (enforced again by the service transition guards).
create policy "correction_requests_update_member" on public.correction_requests
  for update using (public.is_workspace_member(workspace_id) and status = 'draft')
  with check (public.is_workspace_member(workspace_id) and status = 'draft');

-- ── D. Correction request ↔ finding links ───────────────────────────────────
create table public.correction_request_findings (
  correction_request_id uuid not null references public.correction_requests (id) on delete cascade,
  quality_finding_id uuid not null references public.quality_findings (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (correction_request_id, quality_finding_id)
);

create index correction_request_findings_finding_idx
  on public.correction_request_findings (quality_finding_id);

alter table public.correction_request_findings enable row level security;

create policy "correction_request_findings_select_member" on public.correction_request_findings
  for select using (
    exists (
      select 1
      from public.correction_requests c
      join public.quality_findings f on f.id = quality_finding_id
      join public.quality_reviews r on r.id = f.quality_review_id
      where c.id = correction_request_id
        and c.workspace_id = r.workspace_id
        and public.is_workspace_member(c.workspace_id)
    )
  );

create policy "correction_request_findings_insert_member" on public.correction_request_findings
  for insert with check (
    exists (
      select 1
      from public.correction_requests c
      join public.quality_findings f on f.id = quality_finding_id
      join public.quality_reviews r on r.id = f.quality_review_id
      where c.id = correction_request_id
        and c.workspace_id = r.workspace_id
        and public.is_workspace_member(c.workspace_id)
    )
  );

-- Links are removed only via the service (no DELETE policy).

-- ── E. Correction request events (append-only audit) ────────────────────────
create table public.correction_request_events (
  id uuid primary key default gen_random_uuid(),
  correction_request_id uuid not null references public.correction_requests (id) on delete cascade,
  event_type text not null check (event_type in (
    'created', 'updated', 'validation_failed', 'marked_ready', 'submitted',
    'provider_accepted', 'provider_failed', 'output_created', 'cancelled',
    'archived', 'restored'
  )),
  message text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index correction_request_events_request_idx
  on public.correction_request_events (correction_request_id, created_at);

alter table public.correction_request_events enable row level security;

create policy "correction_request_events_select_member" on public.correction_request_events
  for select using (
    exists (
      select 1 from public.correction_requests c
      where c.id = correction_request_id
        and public.is_workspace_member(c.workspace_id)
    )
  );

create policy "correction_request_events_insert_member" on public.correction_request_events
  for insert with check (
    exists (
      select 1 from public.correction_requests c
      where c.id = correction_request_id
        and public.is_workspace_member(c.workspace_id)
    )
  );

-- Append-only: no UPDATE or DELETE policies exist for events.

-- ── F. Recurring quality issues (advisory escalation) ───────────────────────
create table public.recurring_quality_issues (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  issue_key text not null,
  category text not null check (category in (
    'model_identity', 'face', 'hairstyle', 'skin_tone', 'body_proportions',
    'wardrobe', 'accessory', 'product', 'prop',
    'environment_layout', 'furniture_anchor', 'lighting', 'palette_material',
    'camera', 'composition', 'text_overlay', 'motion', 'continuity', 'other'
  )),
  source_context_hash text not null,
  occurrence_count integer not null default 1 check (occurrence_count >= 1),
  last_seen_at timestamptz not null default now(),
  escalation_level text not null default 'first_notice'
    check (escalation_level in ('first_notice', 'strengthen_references', 'constrain_prompt', 'provider_review')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, issue_key)
);

create trigger trg_recurring_quality_issues_updated_at
  before update on public.recurring_quality_issues
  for each row execute function public.set_updated_at();

-- The unique (workspace_id, issue_key) index IS the recurring-lookup index.
create index recurring_quality_issues_workspace_idx
  on public.recurring_quality_issues (workspace_id, escalation_level, last_seen_at);

alter table public.recurring_quality_issues enable row level security;

create policy "recurring_quality_issues_select_member" on public.recurring_quality_issues
  for select using (public.is_workspace_member(workspace_id));

-- No insert/update/delete policies: aggregates change only through the
-- security-definer RPC below (server-side service path).

-- ── G. Server-side escalation recording ─────────────────────────────────────
-- Deterministic occurrence recording for advisory escalation. The issue key
-- and hash arrive precomputed (category + pinned version IDs only — never
-- contents, never media, never URLs). Workspace membership is re-verified;
-- escalation level derives from occurrence count.
create or replace function public.record_quality_issue_occurrence(
  p_workspace_id uuid,
  p_issue_key text,
  p_category text,
  p_source_context_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.recurring_quality_issues;
  v_level text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if not public.is_workspace_member(p_workspace_id) then
    raise exception 'You do not have access to this workspace.' using errcode = '42501';
  end if;

  insert into public.recurring_quality_issues (
    workspace_id, issue_key, category, source_context_hash, occurrence_count, last_seen_at
  ) values (
    p_workspace_id, p_issue_key, p_category, p_source_context_hash, 1, now()
  )
  on conflict (workspace_id, issue_key) do update
    set occurrence_count = recurring_quality_issues.occurrence_count + 1,
        last_seen_at = now(),
        updated_at = now()
  returning * into v_row;

  v_level := case
    when v_row.occurrence_count <= 1 then 'first_notice'
    when v_row.occurrence_count = 2 then 'strengthen_references'
    when v_row.occurrence_count = 3 then 'constrain_prompt'
    else 'provider_review'
  end;

  update public.recurring_quality_issues
  set escalation_level = v_level
  where id = v_row.id;

  return jsonb_build_object(
    'issue_key', p_issue_key,
    'occurrence_count', v_row.occurrence_count,
    'escalation_level', v_level
  );
end;
$$;

grant execute on function public.record_quality_issue_occurrence(uuid, text, text, text) to authenticated;
revoke execute on function public.record_quality_issue_occurrence(uuid, text, text, text) from anon;
