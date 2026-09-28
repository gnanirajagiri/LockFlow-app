/**
 * Content Studio domain — guard functions.
 *
 * Pure, framework-free and unit-tested. Mirrors the Models/Environments/
 * Library guard conventions: refuse structurally invalid edits before any
 * repository touch, and keep job state transitions strict.
 */
import type {
  ContentJobPinRecord,
  ContentJobRequestRecord,
  ContentJobStatus,
  ContentProjectInputRecord,
  ContentProjectRecord,
} from './types';

/** Rule 3 — only draft projects accept structural edits (inputs/scenes/beats). */
export class ContentProjectLockedError extends Error {
  constructor(projectId: string) {
    super(`Content project ${projectId} is not draft and cannot be structurally edited.`);
    this.name = 'ContentProjectLockedError';
  }
}

export function assertProjectDraftEditable(
  project: Pick<ContentProjectRecord, 'id' | 'status'>,
): void {
  if (project.status !== 'draft') {
    throw new ContentProjectLockedError(project.id);
  }
}

/** Soft archive only: archived projects can never reopen. */
export function assertProjectArchiveAllowed(
  project: Pick<ContentProjectRecord, 'status'>,
): void {
  if (project.status === 'archived') return; // idempotent
  if (project.status !== 'draft' && project.status !== 'ready') {
    throw new Error(`Archive is a soft status change only (current status: ${project.status}).`);
  }
}

/**
 * Exactly one target shape per input, according to inputType. Returns a
 * human-readable problem or null.
 */
export function inputTargetProblem(
  input: Pick<
    ContentProjectInputRecord,
    'inputType' | 'modelId' | 'modelVersionId' | 'environmentId' | 'environmentVersionId' | 'libraryAssetId' | 'libraryAssetVersionId'
  >,
): string | null {
  switch (input.inputType) {
    case 'model':
      if (!input.modelId || !input.modelVersionId) return 'model inputs require modelId and modelVersionId';
      if (input.environmentId || input.environmentVersionId || input.libraryAssetId || input.libraryAssetVersionId) {
        return 'model inputs must not carry environment or library targets';
      }
      return null;
    case 'environment':
      if (!input.environmentId || !input.environmentVersionId) return 'environment inputs require environmentId and environmentVersionId';
      if (input.modelId || input.modelVersionId || input.libraryAssetId || input.libraryAssetVersionId) {
        return 'environment inputs must not carry model or library targets';
      }
      return null;
    case 'library_asset':
    case 'look':
      if (!input.libraryAssetId || !input.libraryAssetVersionId) return `${input.inputType} inputs require libraryAssetId and libraryAssetVersionId`;
      if (input.modelId || input.modelVersionId || input.environmentId || input.environmentVersionId) {
        return `${input.inputType} inputs must not carry model or environment targets`;
      }
      return null;
    default:
      return 'unknown input type';
  }
}

// ── Job state machine ───────────────────────────────────────────────────────

/**
 * Permitted job-state transitions. `queued`, `processing` and `review` are
 * only reachable through a future provider integration — no UI or service
 * path may set them while no provider exists (enforced additionally by
 * `refuseJobStatusWithoutProvider`).
 */
export const JOB_STATUS_TRANSITIONS: Record<ContentJobStatus, ContentJobStatus[]> = {
  draft: ['queued', 'cancelled'],
  queued: ['processing', 'cancelled'],
  processing: ['review', 'failed', 'cancelled'],
  review: ['completed', 'failed'],
  completed: [],
  failed: ['draft'],
  cancelled: [],
};

export function canTransitionJobStatus(from: ContentJobStatus, to: ContentJobStatus): boolean {
  return JOB_STATUS_TRANSITIONS[from].includes(to);
}

export class ContentJobStateError extends Error {
  constructor(from: ContentJobStatus, to: ContentJobStatus) {
    super(`A content job cannot move from ${from} to ${to}.`);
    this.name = 'ContentJobStateError';
  }
}

export function refuseInvalidJobTransition(from: ContentJobStatus, to: ContentJobStatus): void {
  if (!canTransitionJobStatus(from, to)) {
    throw new ContentJobStateError(from, to);
  }
}

/**
 * Provider-boundary guard: statuses that imply real generation/queue work
 * cannot be entered while no provider integration exists.
 */
export function refuseJobStatusWithoutProvider(
  to: ContentJobStatus,
  options: { hasProvider: boolean },
): void {
  const PROVIDER_BOUND = new Set<ContentJobStatus>(['queued', 'processing', 'review']);
  if (PROVIDER_BOUND.has(to) && !options.hasProvider) {
    throw new Error(
      'No provider integration exists yet — job requests stay as drafts until generation is connected.',
    );
  }
}

/**
 * Rule 5 — pins are immutable once the job leaves draft. A returned-to-draft
 * job (failed → draft retry path, future) may regain editability by design.
 */
export function refuseJobPinsEditable(job: Pick<ContentJobRequestRecord, 'status'>): void {
  if (job.status !== 'draft') {
    throw new Error(`Job pins are immutable while the job is ${job.status}.`);
  }
}

/** Every pin must point at a locked version for execution readiness. */
export function assertAllPinsLocked(
  pins: Array<Pick<ContentJobPinRecord, 'pinType' | 'sourceVersionId' | 'resolvedDetails'>>,
): void {
  for (const pin of pins) {
    const status = (pin.resolvedDetails as { versionStatus?: string } | null)?.versionStatus;
    if (status !== 'locked') {
      throw new Error(
        `Pin ${pin.sourceVersionId} (${pin.pinType}) is not a locked version — select locked versions before preparing this job.`,
      );
    }
  }
}
