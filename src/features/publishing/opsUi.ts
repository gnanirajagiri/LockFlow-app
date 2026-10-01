/**
 * Publishing Operations UI helpers — unified state labels/tones, failure
 * categories and formatting shared by the calendar, history, run detail
 * and status pages.
 */
import type {
  CalendarPublishingState,
  PublishFailureCategory,
} from '../../domain/publishingOps';
import { CALENDAR_STATE_LABELS, FAILURE_CATEGORY_EXPLANATIONS } from '../../domain/publishingOps';

export const OPS_STATE_LABELS: Record<CalendarPublishingState, string> = Object.fromEntries(
  Object.entries(CALENDAR_STATE_LABELS).map(([k, v]) => [k, v.label]),
) as Record<CalendarPublishingState, string>;

export const OPS_STATE_TONES: Record<CalendarPublishingState, 'success' | 'warning' | 'danger' | 'neutral' | 'info'> =
  Object.fromEntries(Object.entries(CALENDAR_STATE_LABELS).map(([k, v]) => [k, v.tone])) as Record<
    CalendarPublishingState,
    'success' | 'warning' | 'danger' | 'neutral' | 'info'
  >;

export const FAILURE_LABELS: Record<PublishFailureCategory, string> = {
  AUTHORIZATION_REQUIRED: 'Authorization required',
  CONNECTION_EXPIRED: 'Connection expired',
  PROVIDER_UNAVAILABLE: 'Provider unavailable',
  RATE_LIMITED: 'Rate limited',
  MEDIA_REJECTED: 'Media rejected',
  PLACEMENT_UNSUPPORTED: 'Placement unsupported',
  REQUIRED_FIELD_MISSING: 'Required field missing',
  PROVIDER_VALIDATION_FAILED: 'Provider validation failed',
  UNKNOWN_RETRYABLE: 'Temporary error (retryable)',
  UNKNOWN_FINAL: 'Unclear failure (final)',
};

export function failureExplanation(category: PublishFailureCategory): string {
  return FAILURE_CATEGORY_EXPLANATIONS[category];
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
