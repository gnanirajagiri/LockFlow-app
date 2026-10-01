/**
 * Publishing Operations (Prompt 20) — guards.
 *
 * Pure functions: failure classification, provider→LockFlow status mapping,
 * timezone sanity and refresh eligibility. No provider data beyond the
 * declared safe shapes ever reaches these helpers.
 */
import type { PublishingReviewRunStatus } from '../publishingReview';
import type {
  PublishFailureCategory,
  CalendarPublishingState,
} from './types';
import { isRetryableFailureCategory } from './types';

export class PublishingOpsStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PublishingOpsStateError';
  }
}

/** Safe classification input — the ONLY provider surface this module sees. */
export interface FailureClassificationInput {
  /** Safe error code already stored on the run (e.g. submission_failed). */
  errorCode?: string | null;
  /** Safe message already mapped by the lower layer. */
  errorMessageSafe?: string | null;
  /** Connection state at failure time, if known. */
  connectionStatus?: string | null;
  /** Placement involved, if known. */
  placement?: string | null;
}

/**
 * Maps a safe failure surface to the user-friendly taxonomy. Never sees raw
 * provider payloads; classification is based on safe codes/messages and
 * workspace state. Defaults to UNKNOWN_RETRYABLE for transient-looking
 * errors and UNKNOWN_FINAL otherwise.
 */
export function classifyPublishFailure(input: FailureClassificationInput): PublishFailureCategory {
  const code = (input.errorCode ?? '').toLowerCase();
  const message = (input.errorMessageSafe ?? '').toLowerCase();
  const connection = input.connectionStatus ?? null;

  if (connection === 'needs_reauth' || connection === 'revoked') return 'AUTHORIZATION_REQUIRED';
  if (/reauth|unauthor|auth|token|permission|forbidden/.test(`${code} ${message}`)) return 'AUTHORIZATION_REQUIRED';
  if (/expired|session/.test(`${code} ${message}`)) return 'CONNECTION_EXPIRED';
  if (/rate.?limit|too many/.test(`${code} ${message}`)) return 'RATE_LIMITED';
  if (/media|format|size|codec|aspect/.test(`${code} ${message}`)) return 'MEDIA_REJECTED';
  if (/placement/.test(`${code} ${message}`)) return 'PLACEMENT_UNSUPPORTED';
  if (/required|missing|caption|alt.?text/.test(`${code} ${message}`)) return 'REQUIRED_FIELD_MISSING';
  if (/validation|rejected details|invalid/.test(`${code} ${message}`)) return 'PROVIDER_VALIDATION_FAILED';
  if (/unavailable|timeout|network|temporar|5\d\d/.test(`${code} ${message}`)) return 'PROVIDER_UNAVAILABLE';
  if (/review_blocked|eligib/.test(`${code} ${message}`)) return 'REQUIRED_FIELD_MISSING';
  return 'UNKNOWN_RETRYABLE';
}

/**
 * Maps a provider status response (safe shape from the Prompt 18 adapter
 * contract) onto the run machine. Unknown or missing statuses never promote
 * a run — honesty over optimism.
 */
export function mapProviderStatusToRunStatus(
  providerStatus: 'processing' | 'published' | 'failed' | 'unknown' | null | undefined,
): { next: PublishingReviewRunStatus | null; terminal: boolean } {
  switch (providerStatus) {
    case 'published':
      return { next: 'published', terminal: true };
    case 'failed':
      return { next: 'failed', terminal: true };
    case 'processing':
      return { next: null, terminal: false }; // keep waiting — no state change
    default:
      return { next: null, terminal: false };
  }
}

/** Terminal run statuses: refresh never needs to poll these. */
export function isTerminalRunStatus(status: PublishingReviewRunStatus): boolean {
  return status === 'published' || status === 'failed' || status === 'cancelled';
}

/** Runs that may be auto-refreshed in a bulk pass (non-terminal, submitted+). */
export function isRefreshableRunStatus(status: PublishingReviewRunStatus): boolean {
  return status === 'submitted' || status === 'accepted';
}

/** Basic IANA-style timezone sanity (region/area format, no absolute URLs). */
export function timezoneLooksValid(tz: string | null | undefined): boolean {
  if (!tz) return true; // null is allowed
  if (tz.length > 64) return false;
  return /^[A-Za-z0-9_+\-/.]+$/.test(tz) && tz.includes('/') || tz === 'UTC';
}

/** Planning-date sanity: parseable ISO, not absurdly far in the past. */
export function planningDateProblem(iso: string | null): string | null {
  if (iso === null) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 'The planned date is not a valid date.';
  if (t < Date.parse('2000-01-01T00:00:00Z')) return 'The planned date is unreasonably far in the past.';
  return null;
}

/** Unified-state → summary bucket for the status overview counts. */
export function summarizeState(states: CalendarPublishingState[]) {
  const counts = {
    planned: 0,
    ready: 0,
    blocked: 0,
    queuedOrSubmitting: 0,
    submitted: 0,
    published: 0,
    failed: 0,
    retryRequired: 0,
  };
  for (const s of states) {
    switch (s) {
      case 'planned':
        counts.planned += 1;
        break;
      case 'ready_for_review':
        counts.ready += 1;
        break;
      case 'blocked':
        counts.blocked += 1;
        break;
      case 'queued':
      case 'submitting':
        counts.queuedOrSubmitting += 1;
        break;
      case 'submitted':
        counts.submitted += 1;
        break;
      case 'published':
        counts.published += 1;
        break;
      case 'failed':
        counts.failed += 1;
        break;
      case 'retry_required':
        counts.retryRequired += 1;
        break;
      case 'cancelled':
        break; // cancelled items leave the operational counts
    }
  }
  return counts;
}

export { isRetryableFailureCategory };
