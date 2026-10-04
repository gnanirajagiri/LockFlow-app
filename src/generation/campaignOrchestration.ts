/**
 * Prompt 29 — campaign brief → multi-format generation orchestration.
 *
 * Deterministic planning layer: one campaign brief becomes an inspectable
 * orchestration plan (media mix, counts, shared baseline, controlled
 * variations). Pure functions — the same brief always yields the same plan,
 * so orchestration decisions are auditable rather than hidden in magic.
 *
 * Child jobs are executed by the existing prompt-27/28 media services; this
 * module only plans and tracks. No provider calls, no writes.
 */
import type { LockedGenerationInputSnapshot, NormalizedPromptRecord } from './types';

// ── Brief input ──────────────────────────────────────────────────────────────

/** Structured campaign brief for a coordinated content set. */
export interface CampaignBriefInput {
  /** Objective / theme in simple language (prompt-bar free text allowed). */
  briefText: string;
  /** Desired media types and their output counts. */
  mediaPlan: {
    images?: number;
    videos?: number;
    stories?: number;
    /** Frames per story run (stories are ordered multi-output jobs). */
    storyFrames?: number;
  };
  /** Optional planned variation rules — explicit and inspectable. */
  variations?: CampaignVariationRules;
  /** Optional placement hints (e.g. 'instagram-story', 'feed', 'banner'). */
  placements?: string[];
  /** Tone / style notes passed through to child prompts. */
  toneNotes?: string;
}

/**
 * Explicit, inspectable variation rules. Anything not listed here stays
 * locked to the shared baseline — no silent drift.
 */
export interface CampaignVariationRules {
  /** Prompt/style may vary per child job (identity and environment stay locked). */
  allowStyleVariation?: boolean;
  /** Placement hints may differ per child job. */
  allowPlacementVariation?: boolean;
  /** Human-readable notes about what may vary and why. */
  notes?: string;
}

// ── Normalized brief + plan ──────────────────────────────────────────────────

export interface NormalizedCampaignBrief {
  briefText: string;
  cleanedBriefText: string;
  mediaPlan: Required<Pick<CampaignBriefInput['mediaPlan'], 'images' | 'videos' | 'stories'>> & {
    storyFrames: number;
  };
  placements: string[];
  toneNotes: string | null;
  variations: Required<CampaignVariationRules>;
  warnings: string[];
  rulesApplied: string[];
  normalizedAt: string;
}

/** One planned child media job. */
export interface PlannedMediaJob {
  /** Stable position within the plan (for traceability and ordering). */
  planIndex: number;
  mediaType: 'image' | 'video' | 'story';
  plannedRole: string;
  outputCount: number;
  /** Frames per story run (story jobs only). */
  storyFrames: number;
  /** The placement hint this child job targets, when provided. */
  placement: string | null;
  /**
   * Whether this child job may vary from the shared baseline. Only true when
   * an explicit variation rule allows it — never inferred.
   */
  controlledVariation: boolean;
  /** Derivable child prompt: brief + tone + placement + role guidance. */
  promptDraft: string;
}

/** The full, inspectable orchestration plan. */
export interface CampaignOrchestrationPlan {
  jobs: PlannedMediaJob[];
  totals: { images: number; videos: number; stories: number; jobs: number };
  /** One shared baseline governs all child jobs (LockFlow's continuity rule). */
  sharedBaseline: true;
  variations: Required<CampaignVariationRules>;
  rulesApplied: string[];
  plannedAt: string;
}

const MAX_OUTPUTS_PER_TYPE = 4;
const MAX_STORY_FRAMES = 4;

/**
 * Normalizes the structured brief. Deterministic; clamps counts to the
 * per-type cap the underlying media services enforce and records warnings.
 */
export function normalizeCampaignBrief(input: CampaignBriefInput): NormalizedCampaignBrief {
  const briefText = input.briefText.trim();
  const warnings: string[] = [];
  const rulesApplied: string[] = [];

  if (briefText.length === 0) {
    warnings.push('The campaign brief is empty — describe the objective, theme or scene.');
  }
  if (briefText.length > 0 && briefText.length < 12) {
    warnings.push('Very short briefs give child jobs little to work with; consider objective, audience and scene details.');
  }

  const clamp = (value: number | undefined, label: string): number => {
    const requested = Math.max(0, Math.floor(value ?? 0));
    const clamped = Math.min(requested, MAX_OUTPUTS_PER_TYPE);
    if (clamped !== requested) {
      warnings.push(`${label} count adjusted from ${requested} to ${clamped} (max ${MAX_OUTPUTS_PER_TYPE} per type).`);
    }
    rulesApplied.push(`${label}:${clamped}`);
    return clamped;
  };

  const images = clamp(input.mediaPlan.images, 'images');
  const videos = clamp(input.mediaPlan.videos, 'videos');
  const stories = clamp(input.mediaPlan.stories, 'stories');

  const requestedFrames = Math.max(1, Math.floor(input.mediaPlan.storyFrames ?? 2));
  const storyFrames = Math.min(requestedFrames, MAX_STORY_FRAMES);
  if (storyFrames !== requestedFrames) {
    warnings.push(`Story frames adjusted from ${requestedFrames} to ${storyFrames} (max ${MAX_STORY_FRAMES}).`);
  }
  if (stories > 0 && requestedFrames < 1) {
    warnings.push('Story runs default to 2 frames each.');
  }

  const placements = (input.placements ?? []).map((placement) => placement.trim()).filter(Boolean);
  const toneNotes = input.toneNotes?.trim() || null;

  const variations: Required<CampaignVariationRules> = {
    allowStyleVariation: input.variations?.allowStyleVariation ?? false,
    allowPlacementVariation: input.variations?.allowPlacementVariation ?? false,
    notes: input.variations?.notes?.trim() || '',
  };
  rulesApplied.push(`variations:${variations.allowStyleVariation ? 'style' : 'none'}`);

  return {
    briefText,
    cleanedBriefText: briefText.replace(/\s+/g, ' ').trim(),
    mediaPlan: { images, videos, stories, storyFrames },
    placements,
    toneNotes,
    variations,
    warnings,
    rulesApplied,
    normalizedAt: new Date().toISOString(),
  };
}

/**
 * Builds the orchestration plan from a normalized brief. Deterministic:
 * child jobs are emitted in a fixed order (images → videos → stories), each
 * carrying its placement, variation flag and a derivable prompt draft.
 */
export function buildCampaignGenerationPlan(brief: NormalizedCampaignBrief): CampaignOrchestrationPlan {
  const jobs: PlannedMediaJob[] = [];
  let planIndex = 0;

  // Placement rotation runs across the WHOLE set (not per media type) so a
  // multi-format set spreads evenly over the requested placements.
  const placementFor = (index: number): string | null => {
    if (brief.placements.length === 0) return null;
    return brief.variations.allowPlacementVariation
      ? brief.placements[index % brief.placements.length]
      : brief.placements[0] ?? null;
  };

  for (let i = 0; i < brief.mediaPlan.images; i += 1) {
    const placement = placementFor(planIndex);
    jobs.push({
      planIndex: planIndex++,
      mediaType: 'image',
      plannedRole: 'campaign image',
      outputCount: 1,
      storyFrames: 0,
      placement,
      controlledVariation: brief.variations.allowStyleVariation,
      promptDraft: [
        brief.cleanedBriefText,
        brief.toneNotes,
        placement ? `Placement: ${placement}.` : null,
      ].filter(Boolean).join(' '),
    });
  }

  for (let i = 0; i < brief.mediaPlan.videos; i += 1) {
    const placement = placementFor(planIndex);
    jobs.push({
      planIndex: planIndex++,
      mediaType: 'video',
      plannedRole: 'campaign clip',
      outputCount: 1,
      storyFrames: 0,
      placement,
      controlledVariation: brief.variations.allowStyleVariation,
      promptDraft: [
        brief.cleanedBriefText,
        brief.toneNotes,
        placement ? `Placement: ${placement}.` : null,
      ].filter(Boolean).join(' '),
    });
  }

  for (let i = 0; i < brief.mediaPlan.stories; i += 1) {
    const placement = placementFor(planIndex);
    jobs.push({
      planIndex: planIndex++,
      mediaType: 'story',
      plannedRole: 'campaign story sequence',
      outputCount: 1,
      storyFrames: brief.mediaPlan.storyFrames,
      placement,
      controlledVariation: brief.variations.allowStyleVariation,
      promptDraft: [
        brief.cleanedBriefText,
        brief.toneNotes,
        placement ? `Placement: ${placement}.` : null,
      ].filter(Boolean).join(' '),
    });
  }

  return {
    jobs,
    totals: {
      images: brief.mediaPlan.images,
      videos: brief.mediaPlan.videos,
      stories: brief.mediaPlan.stories,
      jobs: jobs.length,
    },
    sharedBaseline: true,
    variations: brief.variations,
    rulesApplied: brief.rulesApplied,
    plannedAt: new Date().toISOString(),
  };
}

/** Human-readable mix summary for review UIs: "3 Images, 1 Video, 2 Stories". */
export function describePlanMix(plan: CampaignOrchestrationPlan): string {
  const parts: string[] = [];
  if (plan.totals.images > 0) parts.push(`${plan.totals.images} Image${plan.totals.images === 1 ? '' : 's'}`);
  if (plan.totals.videos > 0) parts.push(`${plan.totals.videos} Video${plan.totals.videos === 1 ? '' : 's'}`);
  if (plan.totals.stories > 0) parts.push(`${plan.totals.stories} Stor${plan.totals.stories === 1 ? 'y' : 'ies'}`);
  return parts.length > 0 ? parts.join(', ') : 'No outputs planned';
}

// ── Parent run status roll-up ────────────────────────────────────────────────

export type CampaignRunStatus =
  | 'draft'
  | 'validating'
  | 'blocked'
  | 'planning'
  | 'queued'
  | 'running'
  | 'partially_completed'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface ChildJobOutcome {
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
}

/**
 * Rolls child-job outcomes up into the parent run status. Pure and
 * deterministic so the parent view never contradicts its children.
 */
export function rollUpCampaignRunStatus(childOutcomes: ChildJobOutcome[]): CampaignRunStatus {
  if (childOutcomes.length === 0) return 'draft';
  const completed = childOutcomes.filter((outcome) => outcome.status === 'completed').length;
  const failed = childOutcomes.filter((outcome) => outcome.status === 'failed').length;
  const cancelled = childOutcomes.filter((outcome) => outcome.status === 'cancelled').length;
  const active = childOutcomes.length - completed - failed - cancelled;

  if (completed === childOutcomes.length) return 'completed';
  if (failed === childOutcomes.length) return 'failed';
  if (cancelled === childOutcomes.length) return 'cancelled';
  if (completed > 0 && (failed > 0 || active > 0)) {
    return active > 0 ? 'running' : 'partially_completed';
  }
  if (active > 0) return 'running';
  if (failed > 0) return 'partially_completed';
  return 'queued';
}

// ── Parent audit helpers ─────────────────────────────────────────────────────

/** The audit rows a parent run writes (mirrors the generation audit store). */
export type CampaignRunAuditEvent =
  | 'campaign_generation_run_requested'
  | 'campaign_generation_run_validated'
  | 'campaign_generation_run_blocked'
  | 'campaign_generation_plan_created'
  | 'campaign_generation_run_submitted'
  | 'campaign_generation_child_job_created'
  | 'campaign_generation_run_completed'
  | 'campaign_generation_run_partially_completed'
  | 'campaign_generation_run_failed'
  | 'campaign_generation_run_retry_requested'
  | 'campaign_generation_locked_baseline_created';

export interface CampaignRunAuditRow {
  id: string;
  workspaceId: string;
  campaignRunId: string;
  event: CampaignRunAuditEvent;
  detail: string | null;
  createdAt: string;
}

/** Convenience: a normal-record for the stored orchestration plan. */
export type StoredOrchestrationPlan = CampaignOrchestrationPlan & {
  normalizedBrief: NormalizedCampaignBrief;
  lockedBaseline: LockedGenerationInputSnapshot | null;
};

/** Unused-import guard: NormalizedPromptRecord is re-exported for hosts. */
export type { NormalizedPromptRecord };
