/**
 * Shared UI helpers for the Quality module.
 * Small pure helpers reused by the review, create-correction, detail and
 * list pages. Generic placeholders only — no real people/brands/imagery.
 */
import type {
  CorrectionRequestStatus,
  QualityFindingCategory,
  QualityResult,
  QualityReviewStatus,
} from '../../quality/types';
import { CATEGORY_SECTION_MAP } from '../../quality/types';

export function statusLabel(status: string): string {
  return status.replace(/_/g, ' ');
}

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export const REVIEW_STATUS_TONE: Record<QualityReviewStatus, 'neutral' | 'success' | 'warning' | 'locked' | 'primary'> = {
  draft: 'warning',
  completed: 'success',
  archived: 'locked',
};

export const CORRECTION_STATUS_TONE: Record<CorrectionRequestStatus, 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'locked' | 'primary'> = {
  draft: 'warning',
  ready: 'primary',
  submitted: 'info',
  processing: 'info',
  completed: 'success',
  failed: 'danger',
  cancelled: 'neutral',
  archived: 'locked',
};

export const RESULT_TONE: Record<QualityResult, 'success' | 'warning' | 'danger' | 'neutral'> = {
  pass: 'success',
  warning: 'warning',
  fail: 'danger',
  not_checked: 'neutral',
};

/** Checklist section → finding categories it groups. */
export const SECTION_CATEGORIES: Record<string, QualityFindingCategory[]> = {
  model_identity: ['model_identity', 'face', 'hairstyle', 'skin_tone', 'body_proportions'],
  wardrobe_accessories: ['wardrobe', 'accessory'],
  product_props: ['product', 'prop', 'palette_material'],
  environment_lighting: ['environment_layout', 'furniture_anchor', 'lighting'],
  camera_composition: ['camera', 'composition', 'text_overlay'],
  motion_continuity: ['motion', 'continuity'],
  other: ['other'],
};

export const SECTION_TITLES: Record<string, string> = {
  model_identity: 'Model identity',
  wardrobe_accessories: 'Wardrobe and accessories',
  product_props: 'Product and props',
  environment_lighting: 'Environment and lighting',
  camera_composition: 'Camera and composition',
  motion_continuity: 'Motion and continuity (video/story)',
  other: 'Other',
};

export function sectionForCategory(category: QualityFindingCategory): string {
  return CATEGORY_SECTION_MAP[category] ?? 'other';
}

/** Compact quality summary computed from completed reviews for an output. */
export function qualitySummaryLabel(
  reviews: Array<{ status: QualityReviewStatus; overallResult: QualityResult }>,
): 'Not reviewed' | 'Passed' | 'Warnings' | 'Issues found' {
  const completed = reviews.filter((review) => review.status === 'completed');
  if (completed.length === 0) return 'Not reviewed';
  if (completed.some((review) => review.overallResult === 'fail')) return 'Issues found';
  if (completed.some((review) => review.overallResult === 'warning')) return 'Warnings';
  return 'Passed';
}

/**
 * Expected-detail summary for a finding row, rendered from the immutable
 * expected_context (never from live source records).
 */
export function expectedSummary(expectedContext: Record<string, unknown>): string {
  const pins = (expectedContext.pinned_versions ?? []) as Array<Record<string, unknown>>;
  if (pins.length === 0) return 'No pinned sources apply to this category.';
  return pins
    .map((pin) => {
      const label = typeof pin.label === 'string' ? pin.label : String(pin.source_version_id);
      const via = pin.resolved_via ? ' · via Look' : '';
      return `${label}${via}`;
    })
    .join(' · ');
}
