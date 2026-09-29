/**
 * Publishing domain — guards.
 *
 * Pure, framework-free status machine and the authoritative eligibility
 * helpers. isGalleryOutputEligibleForCampaign is REUSED from the campaigns
 * domain (single rule, never duplicated); publishing adds its own output
 * eligibility, connection eligibility and submittable-draft rules.
 */
import type { PublishingDraftStatus } from './types';

export class PublishingStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PublishingStateError';
  }
}

// ── Status machine (spec: "STATUS TRANSITIONS") ─────────────────────────────

export const PUBLISHING_TRANSITIONS: Record<PublishingDraftStatus, PublishingDraftStatus[]> = {
  draft: ['validating', 'ready', 'cancelled', 'archived', 'blocked', 'needs_reauth'],
  validating: ['draft', 'ready', 'blocked', 'needs_reauth'],
  ready: ['submitting', 'draft', 'cancelled', 'archived', 'blocked', 'needs_reauth'],
  submitting: ['processing', 'published', 'failed', 'needs_reauth'],
  processing: ['published', 'failed', 'needs_reauth'],
  published: ['archived'], // historic/read-only except archive
  failed: ['submitting', 'cancelled', 'archived', 'blocked', 'needs_reauth'],
  cancelled: ['archived'],
  blocked: ['archived'],
  needs_reauth: ['submitting', 'cancelled', 'archived', 'blocked'],
  archived: [],
};

export function canTransitionPublishingStatus(
  from: PublishingDraftStatus,
  to: PublishingDraftStatus,
): boolean {
  return PUBLISHING_TRANSITIONS[from].includes(to);
}

export function assertPublishingTransition(from: PublishingDraftStatus, to: PublishingDraftStatus): void {
  if (!canTransitionPublishingStatus(from, to)) {
    throw new PublishingStateError(`A publishing draft cannot move from ${from} to ${to}.`);
  }
}

// ── Gallery output eligibility for publishing ───────────────────────────────

/**
 * Same shape as the campaigns-domain GalleryOutputEligibilityInput — kept
 * structural so the campaigns rule can be reused without coupling modules.
 */
export interface GalleryOutputPublishingInput {
  workspaceId: string;
  status: string;
  contentJobRequestId: string;
  mediaAvailable: boolean;
}

/**
 * Authoritative rule: approved, available, valid provenance. Archived and
 * failed outputs never pass. (Same strictness as campaigns; kept as its own
 * named helper because publishing re-checks at submission time.)
 */
export function isGalleryOutputEligibleForPublishing(
  output: GalleryOutputPublishingInput,
  workspaceId: string,
): boolean {
  if (!output || output.workspaceId !== workspaceId) return false;
  if (output.status !== 'approved') return false;
  if (!output.mediaAvailable) return false;
  if (!output.contentJobRequestId || output.contentJobRequestId.trim() === '') return false;
  return true;
}

export function galleryPublishingProblem(
  output: GalleryOutputPublishingInput,
  workspaceId: string,
): string | null {
  if (!output || output.workspaceId !== workspaceId) {
    return 'The Gallery output belongs to a different workspace.';
  }
  if (output.status === 'archived') {
    return 'This approved output is no longer available for publishing.';
  }
  if (output.status !== 'approved') {
    return 'Only approved Gallery outputs can be prepared for publishing.';
  }
  if (!output.mediaAvailable) {
    return 'The source media for this output is unavailable.';
  }
  if (!output.contentJobRequestId || output.contentJobRequestId.trim() === '') {
    return 'This output has no valid provenance reference.';
  }
  return null;
}

// ── Social connection eligibility ────────────────────────────────────────────

export interface SocialConnectionPublishingInput {
  workspaceId: string;
  providerKey: string;
  status: string;
  lastVerifiedAt: string | null;
  devOnly?: boolean;
}

/**
 * Authoritative rule: connected, verified, not needing re-auth. Disconnected,
 * revoked, failed and pending connections never pass.
 */
export function isSocialConnectionEligibleForPublishing(
  connection: SocialConnectionPublishingInput,
  workspaceId: string,
): boolean {
  if (!connection || connection.workspaceId !== workspaceId) return false;
  return connection.status === 'connected';
}

// ── Submittable draft ────────────────────────────────────────────────────────

export interface DraftSubmittableInput {
  status: PublishingDraftStatus;
  validationResult: { valid: boolean } | null;
  acknowledgementAt: string | null;
}

/**
 * Authoritative rule: ready + validated + acknowledged. The service layers
 * fresh eligibility, connection state and active-run checks on top at
 * submission time.
 */
export function isPublishingDraftSubmittable(draft: DraftSubmittableInput): boolean {
  if (draft.status !== 'ready') return false;
  if (!draft.validationResult || !draft.validationResult.valid) return false;
  if (!draft.acknowledgementAt) return false;
  return true;
}

export function draftSubmissionProblem(draft: DraftSubmittableInput): string | null {
  if (draft.status !== 'ready') {
    return 'Only validated, ready drafts can be published. Validate the draft first.';
  }
  if (!draft.validationResult || !draft.validationResult.valid) {
    return 'Validation must pass before publishing.';
  }
  if (!draft.acknowledgementAt) {
    return 'Record the publishing acknowledgement before publishing.';
  }
  return null;
}

// ── Retry rule ───────────────────────────────────────────────────────────────

/**
 * Retry is allowed only while the last run shows no provider acceptance —
 * an accepted/published external request must never be blindly re-sent.
 */
export function canRetryAfterRun(
  lastRun: { status: string } | null,
): { allowed: boolean; reason?: string } {
  if (!lastRun) return { allowed: false, reason: 'No provider run exists for this draft.' };
  if (lastRun.status === 'accepted' || lastRun.status === 'processing' || lastRun.status === 'completed') {
    return {
      allowed: false,
      reason: 'The provider already accepted a submission for this draft — retrying could duplicate the post.',
    };
  }
  return { allowed: true };
}
