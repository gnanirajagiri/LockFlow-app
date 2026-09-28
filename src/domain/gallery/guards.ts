/**
 * Gallery domain — guard functions.
 *
 * Pure, framework-free and unit-tested. The status machine encodes the
 * review/approval lifecycle; archive/restore are soft-state changes only and
 * nothing here touches job pins or source assets.
 */
import type { GalleryOutputStatus, GalleryReviewDecision } from './types';

export class GalleryOutputStateError extends Error {
  constructor(from: GalleryOutputStatus, to: GalleryOutputStatus) {
    super(`A Gallery output cannot move from ${from} to ${to}.`);
    this.name = 'GalleryOutputStateError';
  }
}

/**
 * Allowed output transitions. Normal UI cannot move draft → processing
 * (no provider exists); development seed data may contain non-draft states
 * so the review UI is testable.
 */
export const GALLERY_OUTPUT_TRANSITIONS: Record<GalleryOutputStatus, GalleryOutputStatus[]> = {
  draft: ['processing', 'failed', 'archived'],
  processing: ['ready_for_review', 'failed', 'archived'],
  ready_for_review: ['approved', 'rejected', 'archived'],
  rejected: ['ready_for_review', 'archived'],
  approved: ['archived'],
  failed: ['archived'],
  archived: [],
};

export function canTransitionGalleryOutputStatus(
  from: GalleryOutputStatus,
  to: GalleryOutputStatus,
): boolean {
  return GALLERY_OUTPUT_TRANSITIONS[from].includes(to);
}

export function refuseInvalidGalleryTransition(
  from: GalleryOutputStatus,
  to: GalleryOutputStatus,
): void {
  if (!canTransitionGalleryOutputStatus(from, to)) {
    throw new GalleryOutputStateError(from, to);
  }
}

/**
 * Restore target for an archived output: the prior non-terminal reviewable
 * status recorded in its metadata. Only explicit restores use this.
 */
export function restoreTargetFor(
  output: Pick<GalleryStatusMeta, 'metadata'>,
): GalleryOutputStatus {
  const prior = (output.metadata as { restoredFrom?: GalleryOutputStatus } | null)?.restoredFrom;
  const allowed: GalleryOutputStatus[] = ['draft', 'processing', 'ready_for_review', 'rejected'];
  if (prior && allowed.includes(prior)) return prior;
  return 'ready_for_review';
}

interface GalleryStatusMeta {
  metadata: Record<string, unknown>;
}

/** Maps a review decision to the output status transition it implies. */
export function statusForReviewDecision(
  decision: GalleryReviewDecision,
): Extract<GalleryOutputStatus, 'approved' | 'rejected' | 'ready_for_review'> {
  switch (decision) {
    case 'approved':
      return 'approved';
    case 'rejected':
      return 'rejected';
    case 'changes_requested':
      return 'ready_for_review'; // stays in review with feedback recorded
  }
}

/**
 * Soft archive: archived outputs are hidden but preserved — restore returns
 * them to their prior reviewable status. There is no delete path.
 */
export function assertArchiveAllowed(status: GalleryOutputStatus): void {
  if (status === 'archived') {
    throw new Error('Output is already archived.');
  }
}

/**
 * Placeholder rule: until secure storage/provider integration exists, every
 * output must be clearly identified as a placeholder in its metadata.
 */
export function placeholderFlag(metadata: Record<string, unknown>): boolean {
  return metadata?.placeholder === true;
}

/** Exposed for tests/documentation: review decision → status mapping. */
export function reviewableStatuses(): GalleryOutputStatus[] {
  return ['ready_for_review', 'approved', 'rejected', 'archived'];
}
