/**
 * Quality domain — transition guards.
 *
 * Pure state machines mirroring the Gallery guards: reviews and correction
 * requests move through guarded transitions, findings are editable only while
 * the parent review is a draft, snapshots freeze the moment a correction
 * leaves draft, and archive/restore are soft-state only. Nothing here touches
 * source assets, job pins or Gallery approval status.
 */
import type {
  CorrectionRequestEventType,
  CorrectionRequestStatus,
  QualityReviewStatus,
} from './types';

export class QualityStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QualityStateError';
  }
}

// ── Review state machine ────────────────────────────────────────────────────

export const QUALITY_REVIEW_TRANSITIONS: Record<QualityReviewStatus, QualityReviewStatus[]> = {
  draft: ['completed', 'archived'],
  completed: ['archived'],
  archived: [],
};

export function canTransitionQualityReview(from: QualityReviewStatus, to: QualityReviewStatus): boolean {
  return QUALITY_REVIEW_TRANSITIONS[from].includes(to);
}

export function refuseInvalidQualityReviewTransition(from: QualityReviewStatus, to: QualityReviewStatus): void {
  if (!canTransitionQualityReview(from, to)) {
    throw new QualityStateError(`A quality review cannot move from ${from} to ${to}.`);
  }
}

export function assertReviewDraft(review: { status: QualityReviewStatus }): void {
  if (review.status !== 'draft') {
    throw new QualityStateError(
      'This review is completed and read-only. Findings and the summary can no longer change.',
    );
  }
}

/** Completed reviews stay append-only except safe archival metadata flips. */
export function isArchivalOnlyPatch(review: { status: QualityReviewStatus }, patch: Record<string, unknown>): boolean {
  if (review.status !== 'completed') return false;
  return Object.keys(patch).length === 1 && patch.status === 'archived';
}

// ── Correction request state machine ────────────────────────────────────────

export const CORRECTION_REQUEST_TRANSITIONS: Record<CorrectionRequestStatus, CorrectionRequestStatus[]> = {
  draft: ['ready', 'cancelled', 'archived'],
  ready: ['submitted', 'cancelled', 'archived'],
  submitted: ['processing', 'completed', 'failed'],
  processing: ['completed', 'failed'],
  completed: [],
  failed: ['submitted', 'cancelled'],
  cancelled: [],
  archived: [],
};

export function canTransitionCorrectionRequest(
  from: CorrectionRequestStatus,
  to: CorrectionRequestStatus,
): boolean {
  return CORRECTION_REQUEST_TRANSITIONS[from].includes(to);
}

export function refuseInvalidCorrectionTransition(from: CorrectionRequestStatus, to: CorrectionRequestStatus): void {
  if (!canTransitionCorrectionRequest(from, to)) {
    throw new QualityStateError(`A correction request cannot move from ${from} to ${to}.`);
  }
}

/** Snapshots freeze the moment the request leaves draft. */
export function assertSnapshotFrozen(request: { status: CorrectionRequestStatus }): void {
  if (request.status !== 'draft') {
    throw new QualityStateError(
      'Correction snapshots are immutable once a request leaves draft.',
    );
  }
}

/** Draft-only editability for title/requested change/scope. */
export function assertCorrectionDraft(request: { status: CorrectionRequestStatus }): void {
  if (request.status !== 'draft') {
    throw new QualityStateError(
      `This correction request is ${request.status} and read-only — draft requests can still be edited.`,
    );
  }
}

/** Terminal-ish statuses where submission is impossible without a retry path. */
export function canSubmitCorrection(request: { status: CorrectionRequestStatus }): boolean {
  return request.status === 'ready' || request.status === 'failed';
}

/** Events are append-only: the repository contract must never expose updates. */
export const APPENDABLE_EVENT_TYPES: CorrectionRequestEventType[] = [
  'created',
  'updated',
  'validation_failed',
  'marked_ready',
  'submitted',
  'provider_accepted',
  'provider_failed',
  'output_created',
  'cancelled',
  'archived',
  'restored',
];

/**
 * Archive/restore is soft-state: nothing is deleted. Restore returns an
 * archived request to the status it was archived from.
 */
export function restoreTargetForCorrection(
  request: { status: CorrectionRequestStatus; updatedAt: string; metadata?: Record<string, unknown> },
): CorrectionRequestStatus {
  const prior = (request.metadata?.archivedFrom as CorrectionRequestStatus | undefined) ?? null;
  const allowed: CorrectionRequestStatus[] = ['draft', 'ready', 'completed', 'cancelled'];
  if (prior && allowed.includes(prior)) return prior;
  return 'ready';
}
