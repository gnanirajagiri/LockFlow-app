/**
 * Templates domain — validation schemas.
 *
 * Dependency-free validators matching the Content Studio conventions
 * (`ValidationResult<T>`, shared `slugify`). Suggestion validation enforces
 * the product rule structurally: suggestions must never carry a version id —
 * the payload shape itself has nowhere to put one.
 */
import { slugify } from '../models/schemas';
import type { ValidationResult } from '../models/schemas';
import type {
  ContentTemplateEventRecord,
  ContentTemplateRecord,
  CreateTemplateBeatInput,
  CreateTemplateSceneInput,
  CreateTemplateSuggestionInput,
  CreateContentTemplateInput,
  TemplateCategory,
  TemplateSuggestedRole,
  TemplateSuggestionType,
  UpdateContentTemplateInput,
  UpdateTemplateBeatInput,
  UpdateTemplateSceneInput,
  UpdateTemplateSuggestionInput,
} from './types';

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export const TEMPLATE_CATEGORIES: TemplateCategory[] = [
  'product_launch',
  'social_series',
  'product_demo',
  'tutorial',
  'testimonial',
  'lifestyle',
  'announcement',
  'seasonal',
  'creator_content',
  'custom',
];

export const TEMPLATE_OUTPUT_TYPES: ContentTemplateRecord['defaultOutputType'][] = [
  'photo',
  'video',
  'story',
  'content_set',
];

export const TEMPLATE_SUGGESTION_TYPES: TemplateSuggestionType[] = [
  'model',
  'environment',
  'look',
  'library_asset_category',
  'library_asset',
];

export const TEMPLATE_SUGGESTED_ROLES: TemplateSuggestedRole[] = [
  'primary_model',
  'environment',
  'look',
  'product',
  'prop',
  'wardrobe',
  'accessory',
  'creator_tool',
  'brand_asset',
  'reference',
  'other',
];

export const TEMPLATE_EVENT_TYPES: ContentTemplateEventRecord['eventType'][] = [
  'created',
  'updated',
  'duplicated',
  'applied',
  'archived',
  'restored',
];

export function isTemplateCategory(value: unknown): value is TemplateCategory {
  return TEMPLATE_CATEGORIES.includes(value as TemplateCategory);
}

export function isTemplateOutputType(value: unknown): value is ContentTemplateRecord['defaultOutputType'] {
  return TEMPLATE_OUTPUT_TYPES.includes(value as ContentTemplateRecord['defaultOutputType']);
}

export function isTemplateSuggestionType(value: unknown): value is TemplateSuggestionType {
  return TEMPLATE_SUGGESTION_TYPES.includes(value as TemplateSuggestionType);
}

export function isTemplateSuggestedRole(value: unknown): value is TemplateSuggestedRole {
  return TEMPLATE_SUGGESTED_ROLES.includes(value as TemplateSuggestedRole);
}

/** Shared reorder payload validation (same contract as Content Studio). */
export { validateReorder } from '../content/schemas';

/** Suggestion types that may reference a concrete canonical asset. */
export const SUGGESTION_TYPES_WITH_ASSET: ReadonlySet<TemplateSuggestionType> = new Set([
  'model',
  'environment',
  'look',
  'library_asset',
]);

function validateBriefTemplate(
  raw: Record<string, unknown>,
  errors: string[],
): { objective: string; audience: string; brandVoice: string; campaignBrief: string } {
  const objective = str(raw.objective).slice(0, 1000);
  const audience = str(raw.audience).slice(0, 1000);
  const brandVoice = str(raw.brandVoice).slice(0, 1000);
  const campaignBrief = str(raw.campaignBrief).slice(0, 4000);
  for (const [key, value] of Object.entries({ objective, audience, brandVoice, campaignBrief })) {
    if (typeof (raw as Record<string, unknown>)[key] !== 'undefined' && typeof value !== 'string') {
      errors.push(`briefTemplate.${key} must be text`);
    }
  }
  return { objective, audience, brandVoice, campaignBrief };
}

export function validateCreateContentTemplate(
  input: unknown,
): ValidationResult<CreateContentTemplateInput> {
  const errors: string[] = [];
  const raw = (input ?? {}) as Record<string, unknown>;
  const workspaceId = str(raw.workspaceId);
  const name = str(raw.name).trim();
  const slug = str(raw.slug).trim() || slugify(name);
  const description = raw.description === undefined ? undefined : str(raw.description).slice(0, 1000);
  const category = raw.category;
  const defaultOutputType = raw.defaultOutputType;
  const defaultVariants = raw.defaultVariants;
  const creativeDirection = raw.creativeDirection === undefined ? undefined : str(raw.creativeDirection).slice(0, 8000);

  if (!workspaceId) errors.push('workspaceId is required');
  if (name.length < 1 || name.length > 80) errors.push('name must be 1–80 characters');
  if (!SLUG_RE.test(slug)) errors.push('slug must be kebab-case (a–z, 0–9, hyphens)');
  if (!isTemplateCategory(category)) errors.push('category must be a valid template category');
  if (!isTemplateOutputType(defaultOutputType)) {
    errors.push('defaultOutputType must be photo, video, story or content_set');
  }
  if (
    defaultVariants !== undefined &&
    (typeof defaultVariants !== 'number' || !Number.isInteger(defaultVariants) || defaultVariants < 1 || defaultVariants > 10)
  ) {
    errors.push('defaultVariants must be an integer between 1 and 10');
  }

  let briefTemplate: CreateContentTemplateInput['briefTemplate'];
  if (raw.briefTemplate !== undefined && raw.briefTemplate !== null) {
    if (typeof raw.briefTemplate !== 'object') {
      errors.push('briefTemplate must be an object');
    } else {
      briefTemplate = validateBriefTemplate(raw.briefTemplate as Record<string, unknown>, errors);
    }
  }

  return errors.length
    ? { ok: false, errors }
    : {
        ok: true,
        value: {
          workspaceId,
          name,
          slug,
          ...(description !== undefined ? { description } : {}),
          category: category as TemplateCategory,
          defaultOutputType: defaultOutputType as ContentTemplateRecord['defaultOutputType'],
          ...(defaultVariants !== undefined ? { defaultVariants: defaultVariants as number } : {}),
          ...(briefTemplate ?? {}),
          ...(creativeDirection !== undefined ? { creativeDirection } : {}),
        },
      };
}

export function validateUpdateContentTemplate(
  input: unknown,
): ValidationResult<UpdateContentTemplateInput> {
  const errors: string[] = [];
  const raw = (input ?? {}) as Record<string, unknown>;
  const out: UpdateContentTemplateInput = {};

  if (raw.name !== undefined) {
    const name = str(raw.name).trim();
    if (name.length < 1 || name.length > 80) errors.push('name must be 1–80 characters');
    else out.name = name;
  }
  if (raw.description !== undefined) out.description = raw.description === null ? null : str(raw.description).slice(0, 1000);
  if (raw.category !== undefined) {
    if (isTemplateCategory(raw.category)) out.category = raw.category;
    else errors.push('category must be a valid template category');
  }
  if (raw.defaultOutputType !== undefined) {
    if (isTemplateOutputType(raw.defaultOutputType)) out.defaultOutputType = raw.defaultOutputType;
    else errors.push('defaultOutputType must be photo, video, story or content_set');
  }
  if (raw.defaultVariants !== undefined) {
    const variants = raw.defaultVariants;
    if (typeof variants === 'number' && Number.isInteger(variants) && variants >= 1 && variants <= 10) {
      out.defaultVariants = variants;
    } else {
      errors.push('defaultVariants must be an integer between 1 and 10');
    }
  }
  if (raw.creativeDirection !== undefined) out.creativeDirection = raw.creativeDirection === null ? null : str(raw.creativeDirection).slice(0, 8000);
  if (raw.briefTemplate !== undefined) {
    if (typeof raw.briefTemplate !== 'object' || raw.briefTemplate === null) {
      errors.push('briefTemplate must be an object');
    } else {
      const brief = validateBriefTemplate(raw.briefTemplate as Record<string, unknown>, errors);
      out.briefTemplate = brief;
    }
  }
  if (Object.keys(out).length === 0) errors.push('at least one field must be provided');

  return errors.length ? { ok: false, errors } : { ok: true, value: out };
}

export function validateCreateTemplateScene(
  input: unknown,
): ValidationResult<CreateTemplateSceneInput> {
  const errors: string[] = [];
  const raw = (input ?? {}) as Record<string, unknown>;
  const contentTemplateId = str(raw.contentTemplateId);
  const title = str(raw.title).trim();
  const purpose = raw.purpose === undefined ? undefined : str(raw.purpose).slice(0, 2000);
  const settingNotes = raw.settingNotes === undefined ? undefined : str(raw.settingNotes).slice(0, 4000);
  const shotNotes = raw.shotNotes === undefined ? undefined : str(raw.shotNotes).slice(0, 4000);

  if (!contentTemplateId) errors.push('contentTemplateId is required');
  if (title.length < 1 || title.length > 120) errors.push('title must be 1–120 characters');

  return errors.length
    ? { ok: false, errors }
    : {
        ok: true,
        value: {
          contentTemplateId,
          title,
          ...(purpose !== undefined ? { purpose } : {}),
          ...(settingNotes !== undefined ? { settingNotes } : {}),
          ...(shotNotes !== undefined ? { shotNotes } : {}),
        },
      };
}

export function validateUpdateTemplateScene(
  input: unknown,
): ValidationResult<UpdateTemplateSceneInput> {
  const errors: string[] = [];
  const raw = (input ?? {}) as Record<string, unknown>;
  const out: UpdateTemplateSceneInput = {};

  if (raw.title !== undefined) {
    const title = str(raw.title).trim();
    if (title.length < 1 || title.length > 120) errors.push('title must be 1–120 characters');
    else out.title = title;
  }
  for (const key of ['purpose', 'settingNotes', 'shotNotes'] as const) {
    if (raw[key] !== undefined) out[key] = raw[key] === null ? null : str(raw[key]).slice(0, 4000);
  }
  if (Object.keys(out).length === 0) errors.push('at least one field must be provided');

  return errors.length ? { ok: false, errors } : { ok: true, value: out };
}

export function validateCreateTemplateBeat(
  input: unknown,
): ValidationResult<CreateTemplateBeatInput> {
  const errors: string[] = [];
  const raw = (input ?? {}) as Record<string, unknown>;
  const contentTemplateSceneId = str(raw.contentTemplateSceneId);
  const title = str(raw.title).trim();
  const duration = raw.durationSeconds;

  if (!contentTemplateSceneId) errors.push('contentTemplateSceneId is required');
  if (title.length < 1 || title.length > 120) errors.push('title must be 1–120 characters');
  if (duration !== undefined && (typeof duration !== 'number' || duration < 0 || !Number.isFinite(duration))) {
    errors.push('durationSeconds must be a non-negative number');
  }

  return errors.length
    ? { ok: false, errors }
    : {
        ok: true,
        value: {
          contentTemplateSceneId,
          title,
          ...(raw.actionDescription !== undefined ? { actionDescription: str(raw.actionDescription).slice(0, 4000) } : {}),
          ...(raw.dialogueOrOverlay !== undefined ? { dialogueOrOverlay: str(raw.dialogueOrOverlay).slice(0, 2000) } : {}),
          ...(raw.cameraDirection !== undefined ? { cameraDirection: str(raw.cameraDirection).slice(0, 2000) } : {}),
          ...(duration !== undefined ? { durationSeconds: duration as number } : {}),
        },
      };
}

export function validateUpdateTemplateBeat(
  input: unknown,
): ValidationResult<UpdateTemplateBeatInput> {
  const errors: string[] = [];
  const raw = (input ?? {}) as Record<string, unknown>;
  const out: UpdateTemplateBeatInput = {};

  if (raw.title !== undefined) {
    const title = str(raw.title).trim();
    if (title.length < 1 || title.length > 120) errors.push('title must be 1–120 characters');
    else out.title = title;
  }
  for (const key of ['actionDescription', 'dialogueOrOverlay', 'cameraDirection'] as const) {
    if (raw[key] !== undefined) out[key] = raw[key] === null ? null : str(raw[key]).slice(0, 4000);
  }
  if (raw.durationSeconds !== undefined) {
    const duration = raw.durationSeconds;
    if (duration === null) out.durationSeconds = null;
    else if (typeof duration === 'number' && duration >= 0 && Number.isFinite(duration)) out.durationSeconds = duration;
    else errors.push('durationSeconds must be a non-negative number or null');
  }
  if (Object.keys(out).length === 0) errors.push('at least one field must be provided');

  return errors.length ? { ok: false, errors } : { ok: true, value: out };
}

/**
 * Suggestion payload — the product rule lives in the shape: there is no
 * version field to validate, and category suggestions must NOT carry a
 * concrete asset id.
 */
export function validateCreateTemplateSuggestion(
  input: unknown,
): ValidationResult<CreateTemplateSuggestionInput> {
  const errors: string[] = [];
  const raw = (input ?? {}) as Record<string, unknown>;
  const contentTemplateId = str(raw.contentTemplateId);
  const suggestionType = raw.suggestionType;
  const suggestedRole = raw.suggestedRole;
  const suggestedAssetId = raw.suggestedAssetId === undefined ? undefined : str(raw.suggestedAssetId).trim();
  const suggestedAssetType = raw.suggestedAssetType === undefined ? undefined : str(raw.suggestedAssetType).trim();
  const compatibilityNotes = raw.compatibilityNotes === undefined ? undefined : str(raw.compatibilityNotes).slice(0, 1000);

  if (!contentTemplateId) errors.push('contentTemplateId is required');
  if (!isTemplateSuggestionType(suggestionType)) {
    errors.push('suggestionType must be model, environment, look, library_asset_category or library_asset');
  }
  if (!isTemplateSuggestedRole(suggestedRole)) errors.push('suggestedRole must be a valid template suggested role');
  if (isTemplateSuggestionType(suggestionType)) {
    if (SUGGESTION_TYPES_WITH_ASSET.has(suggestionType)) {
      if (!suggestedAssetId) errors.push(`${suggestionType} suggestions require a workspace asset reference`);
      if (suggestionType === 'library_asset' && suggestedAssetType && suggestedAssetType === 'look') {
        errors.push('use the look suggestion type for look assets');
      }
    } else if (suggestedAssetId) {
      errors.push('category suggestions must not reference a concrete asset');
    }
  }

  return errors.length
    ? { ok: false, errors }
    : {
        ok: true,
        value: {
          contentTemplateId,
          suggestionType: suggestionType as TemplateSuggestionType,
          suggestedRole: suggestedRole as TemplateSuggestedRole,
          ...(suggestedAssetId ? { suggestedAssetId } : {}),
          ...(suggestedAssetType ? { suggestedAssetType } : {}),
          ...(compatibilityNotes !== undefined ? { compatibilityNotes } : {}),
        },
      };
}

export function validateUpdateTemplateSuggestion(
  input: unknown,
): ValidationResult<UpdateTemplateSuggestionInput> {
  const errors: string[] = [];
  const raw = (input ?? {}) as Record<string, unknown>;
  const out: UpdateTemplateSuggestionInput = {};

  if (raw.suggestedRole !== undefined) {
    if (isTemplateSuggestedRole(raw.suggestedRole)) out.suggestedRole = raw.suggestedRole;
    else errors.push('suggestedRole must be a valid template suggested role');
  }
  if (raw.suggestedAssetType !== undefined) {
    out.suggestedAssetType = raw.suggestedAssetType === null ? null : str(raw.suggestedAssetType).slice(0, 60);
  }
  if (raw.compatibilityNotes !== undefined) {
    out.compatibilityNotes = raw.compatibilityNotes === null ? null : str(raw.compatibilityNotes).slice(0, 1000);
  }
  if (Object.keys(out).length === 0) errors.push('at least one field must be provided');

  return errors.length ? { ok: false, errors } : { ok: true, value: out };
}
