/**
 * Publishing Review UI helpers — blocker codes, run labels and tones.
 */
import type {
  PublishRunRecord,
  PublishingReviewBlockerCode,
  PublishingReviewRunStatus,
} from '../../domain/publishingReview';

export const REVIEW_BLOCKER_LABELS: Record<PublishingReviewBlockerCode, string> = {
  OUTPUT_NOT_APPROVED: 'Output not approved',
  OUTPUT_ARCHIVED: 'Output archived',
  CAMPAIGN_ITEM_INACTIVE: 'Campaign item inactive',
  CHANNEL_NOT_ASSIGNED: 'Channel not assigned',
  CONNECTION_NOT_FOUND: 'No connected account',
  CONNECTION_NEEDS_REAUTH: 'Account needs re-auth',
  PLACEMENT_UNSUPPORTED: 'Placement unsupported',
  REQUIRED_FIELD_MISSING: 'Required field missing',
  DUPLICATE_SUBMISSION: 'Submission already exists',
};

export const REVIEW_RUN_STATUS_LABELS: Record<PublishingReviewRunStatus, string> = {
  pending: 'Pending submit',
  validated: 'Validated',
  submitted: 'Submitted',
  accepted: 'Accepted by provider',
  published: 'Published',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export const REVIEW_RUN_STATUS_TONES: Record<
  PublishingReviewRunStatus,
  'success' | 'warning' | 'danger' | 'neutral' | 'info'
> = {
  pending: 'neutral',
  validated: 'info',
  submitted: 'info',
  accepted: 'info',
  published: 'success',
  failed: 'danger',
  cancelled: 'neutral',
};

export function runAttemptLabel(run: PublishRunRecord): string {
  return `Attempt ${run.attemptNumber} · ${REVIEW_RUN_STATUS_LABELS[run.status]}`;
}
