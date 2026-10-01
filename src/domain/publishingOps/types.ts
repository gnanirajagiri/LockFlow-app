/**
 * Publishing Operations (Prompt 20) — domain types.
 *
 * The post-submission OPERATIONAL layer: run status tracking, campaign
 * publishing calendar, provider-status refresh, publish history, failure
 * resolution and lightweight campaign delivery status.
 *
 * Honesty and safety contracts:
 *   * Calendar/planning data NEVER triggers publishing. Planned dates are
 *     internal planning metadata; no worker, trigger or service path may
 *     create or submit a publish run because a date arrived.
 *   * Published is shown ONLY on explicit provider (or labelled mock)
 *     confirmation — never inferred from a date or a UI toggle.
 *   * Refresh flows through the Prompt 17/18 secure provider abstraction.
 *     Raw provider responses, tokens and signed URLs stay server-side.
 *   * Failure categories are a safe, user-friendly taxonomy — no raw
 *     provider error strings in records or UI.
 *   * Everything is workspace-scoped; cross-workspace access throws.
 */

import type {
  PublishRunRecord,
  PublishingReviewAuditEventType,
} from '../publishingReview';
import type {
  CampaignChannelKey,
  CampaignItemRecord,
} from '../campaigns';
import type { PublishingPlacement } from '../publishing';

// ── Failure taxonomy (safe, user-friendly) ──────────────────────────────────

export type PublishFailureCategory =
  | 'AUTHORIZATION_REQUIRED'
  | 'CONNECTION_EXPIRED'
  | 'PROVIDER_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'MEDIA_REJECTED'
  | 'PLACEMENT_UNSUPPORTED'
  | 'REQUIRED_FIELD_MISSING'
  | 'PROVIDER_VALIDATION_FAILED'
  | 'UNKNOWN_RETRYABLE'
  | 'UNKNOWN_FINAL';

/** Failure categories a user can act on by retrying without changes. */
export const RETRYABLE_FAILURE_CATEGORIES: PublishFailureCategory[] = [
  'PROVIDER_UNAVAILABLE',
  'RATE_LIMITED',
  'UNKNOWN_RETRYABLE',
];

/** Whether a failure category is inherently retryable. */
export function isRetryableFailureCategory(category: PublishFailureCategory): boolean {
  return RETRYABLE_FAILURE_CATEGORIES.includes(category);
}

/** Plain-language explanation for each failure category. */
export const FAILURE_CATEGORY_EXPLANATIONS: Record<PublishFailureCategory, string> = {
  AUTHORIZATION_REQUIRED: 'The account authorization was rejected. Reconnect the account, then retry.',
  CONNECTION_EXPIRED: 'The stored session expired. Reconnect the account, then retry.',
  PROVIDER_UNAVAILABLE: 'The platform was temporarily unreachable. Retry in a few minutes.',
  RATE_LIMITED: 'The platform limited the request rate. Wait a little, then retry.',
  MEDIA_REJECTED: 'The media did not meet platform requirements. Check format, size and length, then retry.',
  PLACEMENT_UNSUPPORTED: 'The account does not support this placement. Pick another placement or account.',
  REQUIRED_FIELD_MISSING: 'Required copy or metadata is missing. Complete the item and retry.',
  PROVIDER_VALIDATION_FAILED: 'The platform rejected the content details. Adjust the copy or media, then retry.',
  UNKNOWN_RETRYABLE: 'A temporary error occurred. You can retry safely.',
  UNKNOWN_FINAL: 'The attempt failed for an unclear reason. Inspect the run and contact support if it repeats.',
};

// ── Unified calendar/publishing state ───────────────────────────────────────

/**
 * One display state per timeline entry, merging item planning state with
 * the latest run state. Pure derivation — no persistence.
 */
export type CalendarPublishingState =
  | 'planned'
  | 'ready_for_review'
  | 'blocked'
  | 'queued'
  | 'submitting'
  | 'submitted'
  | 'published'
  | 'failed'
  | 'retry_required'
  | 'cancelled';

export interface CalendarStateDescriptor {
  label: string;
  tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
}

export const CALENDAR_STATE_LABELS: Record<CalendarPublishingState, CalendarStateDescriptor> = {
  planned: { label: 'Planned', tone: 'neutral' },
  ready_for_review: { label: 'Ready for review', tone: 'info' },
  blocked: { label: 'Blocked', tone: 'warning' },
  queued: { label: 'Queued', tone: 'neutral' },
  submitting: { label: 'Submitting', tone: 'info' },
  submitted: { label: 'Submitted', tone: 'info' },
  published: { label: 'Published', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  retry_required: { label: 'Retry required', tone: 'warning' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

/** Item statuses that must never be silently rescheduled. */
export function requiresRescheduleWarning(runState: CalendarPublishingState): boolean {
  return (
    runState === 'queued' ||
    runState === 'submitting' ||
    runState === 'submitted' ||
    runState === 'published' ||
    runState === 'failed' ||
    runState === 'retry_required'
  );
}

/**
 * Derives the unified publishing state for an item from its planning state,
 * its output's continued eligibility (Prompt 16 semantics: an active item
 * whose output became ineligible surfaces as blocked) and its latest run
 * (if any). Run state wins over planning state; a failed non-retryable run
 * maps to failed, a retryable one to retry_required.
 */
export function deriveCalendarState(
  item: Pick<CampaignItemRecord, 'status' | 'removedAt'>,
  latestRun: Pick<PublishRunRecord, 'status' | 'isRetryable'> | null,
  outputStillEligible = true,
): CalendarPublishingState {
  if (item.status === 'removed' || item.removedAt) return 'blocked';
  if (latestRun) {
    switch (latestRun.status) {
      case 'pending':
        return 'queued';
      case 'validated':
        return 'queued';
      case 'submitted':
        return 'submitting';
      case 'accepted':
        return 'submitted';
      case 'published':
        return 'published';
      case 'failed':
        return latestRun.isRetryable ? 'retry_required' : 'failed';
      case 'cancelled':
        return 'cancelled';
    }
  }
  if (item.status === 'blocked' || !outputStillEligible) return 'blocked';
  if (item.status === 'ready') return 'ready_for_review';
  return 'planned';
}

// ── Timeline read models ────────────────────────────────────────────────────

export interface TimelineEntry {
  campaignItemId: string;
  galleryOutputId: string;
  title: string;
  mediaType: 'image' | 'video';
  plannedPublishAt: string | null;
  plannedTimezone: string | null;
  channel: CampaignChannelKey | string | null;
  accountLabel: string | null;
  placement: PublishingPlacement | null;
  itemStatus: CampaignItemRecord['status'];
  publishingState: CalendarPublishingState;
  latestRunId: string | null;
  latestAttemptNumber: number | null;
  failureCategory: PublishFailureCategory | null;
  contentJobRequestId: string | null;
}

export interface TimelineFilters {
  channel?: string;
  accountLabel?: string;
  state?: CalendarPublishingState;
  contentType?: 'image' | 'video';
  from?: string;
  to?: string;
}

export interface CampaignPublishingTimeline {
  campaignId: string;
  generatedAt: string;
  entries: TimelineEntry[];
}

// ── Run detail read model ───────────────────────────────────────────────────

export interface PublishRunDetail {
  run: PublishRunRecord;
  draftStatus: string | null;
  publishedUrl: string | null;
  failureCategory: PublishFailureCategory | null;
  failureExplanation: string | null;
  isRetryable: boolean;
  retryRunId: string | null;
  originalRunId: string | null;
  connectionStatus: 'connected' | 'needs_reauth' | 'other' | null;
  mockProvider: boolean;
  auditEvents: Array<{
    id: string;
    eventType: PublishingReviewAuditEventType | string;
    message: string;
    createdAt: string;
  }>;
}

export interface RetryOptions {
  allowed: boolean;
  reason: string | null;
  /** New attempt number a retry would receive. */
  nextAttemptNumber: number | null;
  /** Suggested first step, e.g. reconnect before retry. */
  requiresReconnect: boolean;
  failureCategory: PublishFailureCategory | null;
}

// ── Campaign status overview ────────────────────────────────────────────────

export interface ChannelDeliverySummary {
  channel: string;
  total: number;
  published: number;
  failed: number;
  pending: number;
}

export interface UpcomingPlannedItem {
  campaignItemId: string;
  title: string;
  plannedPublishAt: string;
  channel: string | null;
  publishingState: CalendarPublishingState;
}

export interface NeedsAttentionItem {
  kind: 'blocked_item' | 'connection_needs_reauth' | 'failed_run' | 'retryable_run';
  label: string;
  campaignItemId: string | null;
  publishRunId: string | null;
}

export interface CampaignStatusOverview {
  campaignId: string;
  generatedAt: string;
  counts: {
    planned: number;
    ready: number;
    blocked: number;
    queuedOrSubmitting: number;
    submitted: number;
    published: number;
    failed: number;
    retryRequired: number;
  };
  channels: ChannelDeliverySummary[];
  upcoming: UpcomingPlannedItem[];
  needsAttention: NeedsAttentionItem[];
  recentPublications: UpcomingPlannedItem[];
  primaryNextAction: { label: string; targetRoute: string } | null;
}

// ── Refresh read model ──────────────────────────────────────────────────────

export interface PublishRunRefreshResult {
  run: PublishRunRecord;
  changed: boolean;
  /** Why nothing changed (terminal, provider unavailable, re-auth…). */
  reason: 'updated' | 'terminal' | 'reauth_required' | 'provider_unavailable' | 'no_provider_status' | 'skipped';
  safeMessage: string;
  mock: boolean;
}

export interface CampaignRefreshSummary {
  checked: number;
  updated: number;
  skipped: number;
  reauthRequired: number;
  results: PublishRunRefreshResult[];
}
