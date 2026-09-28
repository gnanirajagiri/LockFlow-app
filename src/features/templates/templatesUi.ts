/**
 * Templates UI — shared labels and copy.
 *
 * All copy is honest by rule: templates never generate media, suggestions
 * never pin versions, and the prompt bars save local text only.
 */
import type {
  ContentTemplateRecord,
  TemplateCategory,
  TemplateStatus,
} from '../../domain/templates';

export const TEMPLATE_CATEGORY_LABELS: Record<TemplateCategory, string> = {
  product_launch: 'Product launch',
  social_series: 'Social series',
  product_demo: 'Product demo',
  tutorial: 'Tutorial',
  testimonial: 'Testimonial',
  lifestyle: 'Lifestyle',
  announcement: 'Announcement',
  seasonal: 'Seasonal',
  creator_content: 'Creator content',
  custom: 'Custom',
};

export const TEMPLATE_STATUS_TONE: Record<TemplateStatus, 'neutral' | 'success' | 'warning'> = {
  draft: 'neutral',
  active: 'success',
  archived: 'warning',
};

export const TEMPLATE_OUTPUT_LABELS: Record<ContentTemplateRecord['defaultOutputType'], string> = {
  photo: 'Photo',
  video: 'Video',
  story: 'Story',
  content_set: 'Content set',
};

/** Honest prompt-bar note — the current behaviour, stated plainly. */
export const TEMPLATE_PROMPT_NOTE =
  'This saves your direction as an editable template draft. It does not generate media.';

export const NEW_TEMPLATE_PROMPT_PLACEHOLDER =
  'For example: a three-scene vertical product demo with a calm creator voice and a close-up product moment…';

export const STORYBOARD_PROMPT_PLACEHOLDER =
  'Add a product close-up after the opening scene, with slow camera movement…';

export const SUGGESTION_ONLY_COPY =
  'Suggestion only — exact approved versions are selected and pinned in Content Studio.';

export const APPLY_EXPLANATION_COPY =
  'This creates a new editable Content Studio draft. LockFlow will not select or pin source versions until you choose them in Content Studio.';

export function formatTemplateDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
