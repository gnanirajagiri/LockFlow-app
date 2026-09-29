/**
 * Publishing UI helpers — labels, tones and safe summaries.
 */
import type {
  PublishingDraftStatus,
  PublishingPlacement,
  SafePublishingDraftView,
} from '../../domain/publishing';

export const PUBLISHING_STATUS_LABELS: Record<PublishingDraftStatus, string> = {
  draft: 'Draft',
  validating: 'Validating',
  ready: 'Ready to publish',
  submitting: 'Submitting',
  processing: 'Processing',
  published: 'Published',
  failed: 'Failed',
  cancelled: 'Cancelled',
  blocked: 'Blocked',
  needs_reauth: 'Needs re-auth',
  archived: 'Archived',
};

export const PUBLISHING_STATUS_TONES: Record<
  PublishingDraftStatus,
  'success' | 'warning' | 'danger' | 'neutral' | 'info'
> = {
  draft: 'neutral',
  validating: 'info',
  ready: 'success',
  submitting: 'info',
  processing: 'info',
  published: 'success',
  failed: 'danger',
  cancelled: 'neutral',
  blocked: 'warning',
  needs_reauth: 'warning',
  archived: 'neutral',
};

export const PUBLISHING_PLACEMENT_LABELS: Record<PublishingPlacement, string> = {
  feed_post: 'Feed post',
  reel: 'Reel',
  story: 'Story',
  short_video: 'Short video',
  video_post: 'Video post',
  image_post: 'Image post',
  ad_creative: 'Ad creative (prep only)',
  other: 'Other',
};

export function draftContextLabel(draft: SafePublishingDraftView): string {
  return draft.externalAccount.accountLabel ?? draft.externalAccount.connectionLocalName;
}

export function formatPublishedAt(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Statuses where copy editing is still allowed (pre-submission freeze). */
export function isDraftEditable(status: PublishingDraftStatus): boolean {
  return status === 'draft';
}

/** Primary list filter groups (global publishing list). */
export const PUBLISHING_STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'ready', label: 'Ready' },
  { value: 'submitting', label: 'Submitting' },
  { value: 'processing', label: 'Processing' },
  { value: 'published', label: 'Published' },
  { value: 'failed', label: 'Failed' },
  { value: 'needs_reauth', label: 'Needs re-auth' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'archived', label: 'Archived' },
];
