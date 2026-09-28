/**
 * Content Studio domain — validation schemas.
 *
 * Dependency-free validators matching the Models/Library conventions.
 * Reuses `slugify` and the shared ValidationResult type.
 */
import { slugify } from '../models/schemas';
import type { ValidationResult } from '../models/schemas';
import type {
  ContentInputRole,
  ContentInputType,
  ContentJobStatus,
  ContentOutputType,
  CreateContentBeatInput,
  CreateContentJobRequestInput,
  CreateContentProjectInput,
  CreateContentProjectInputPayload,
  CreateContentSceneInput,
  UpdateContentBeatInput,
  UpdateContentProjectDraftInput,
  UpdateContentSceneInput,
} from './types';

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export const CONTENT_INPUT_TYPES: ContentInputType[] = ['model', 'environment', 'library_asset', 'look'];

export const CONTENT_INPUT_ROLES: ContentInputRole[] = [
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

export const CONTENT_OUTPUT_TYPES: ContentOutputType[] = ['photo', 'video', 'story', 'content_set'];

const JOB_STATUSES: ContentJobStatus[] = [
  'draft',
  'queued',
  'processing',
  'review',
  'completed',
  'failed',
  'cancelled',
];

export function isContentInputType(value: unknown): value is ContentInputType {
  return CONTENT_INPUT_TYPES.includes(value as ContentInputType);
}

export function isContentInputRole(value: unknown): value is ContentInputRole {
  return CONTENT_INPUT_ROLES.includes(value as ContentInputRole);
}

export function isContentOutputType(value: unknown): value is ContentOutputType {
  return CONTENT_OUTPUT_TYPES.includes(value as ContentOutputType);
}

export function isContentJobStatus(value: unknown): value is ContentJobStatus {
  return JOB_STATUSES.includes(value as ContentJobStatus);
}

/** Reorder payloads: array of record ids in their new order. */
export function validateReorder(input: unknown): ValidationResult<string[]> {
  if (!Array.isArray(input)) return { ok: false, errors: ['order must be an array of ids'] };
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const entry of input) {
    const id = str(entry);
    if (!id) return { ok: false, errors: ['order entries must be non-empty ids'] };
    if (seen.has(id)) return { ok: false, errors: [`duplicate id in order: ${id}`] };
    seen.add(id);
    ids.push(id);
  }
  if (ids.length === 0) return { ok: false, errors: ['order must contain at least one id'] };
  return { ok: true, value: ids };
}

export function validateCreateContentProject(
  input: unknown,
): ValidationResult<CreateContentProjectInput> {
  const errors: string[] = [];
  const raw = (input ?? {}) as Record<string, unknown>;
  const workspaceId = str(raw.workspaceId);
  const name = str(raw.name).trim();
  const slug = str(raw.slug).trim() || slugify(name);
  const campaignBrief = raw.campaignBrief === undefined ? undefined : str(raw.campaignBrief).slice(0, 4000);
  const objective = raw.objective === undefined ? undefined : str(raw.objective).slice(0, 1000);
  const audience = raw.audience === undefined ? undefined : str(raw.audience).slice(0, 1000);
  const brandVoice = raw.brandVoice === undefined ? undefined : str(raw.brandVoice).slice(0, 1000);
  const plannedOutputType = raw.plannedOutputType === undefined ? undefined : raw.plannedOutputType;
  const requestedVariants = raw.requestedVariants === undefined ? undefined : raw.requestedVariants;

  if (!workspaceId) errors.push('workspaceId is required');
  if (name.length < 1 || name.length > 80) errors.push('name must be 1–80 characters');
  if (!SLUG_RE.test(slug)) errors.push('slug must be kebab-case (a–z, 0–9, hyphens)');
  if (plannedOutputType !== undefined && !isContentOutputType(plannedOutputType)) {
    errors.push('plannedOutputType must be photo, video, story or content_set');
  }
  if (
    requestedVariants !== undefined &&
    (typeof requestedVariants !== 'number' || !Number.isInteger(requestedVariants) || requestedVariants < 1 || requestedVariants > 10)
  ) {
    errors.push('requestedVariants must be an integer between 1 and 10');
  }

  return errors.length
    ? { ok: false, errors }
    : {
        ok: true,
        value: {
          workspaceId,
          name,
          slug,
          ...(campaignBrief !== undefined ? { campaignBrief } : {}),
          ...(objective !== undefined ? { objective } : {}),
          ...(audience !== undefined ? { audience } : {}),
          ...(brandVoice !== undefined ? { brandVoice } : {}),
          ...(plannedOutputType !== undefined ? { plannedOutputType: plannedOutputType as ContentOutputType } : {}),
          ...(requestedVariants !== undefined ? { requestedVariants: requestedVariants as number } : {}),
        },
      };
}

export function validateUpdateContentProjectDraft(
  input: unknown,
): ValidationResult<UpdateContentProjectDraftInput> {
  const errors: string[] = [];
  const raw = (input ?? {}) as Record<string, unknown>;
  const out: UpdateContentProjectDraftInput = {};

  if (raw.name !== undefined) {
    const name = str(raw.name).trim();
    if (name.length < 1 || name.length > 80) errors.push('name must be 1–80 characters');
    else out.name = name;
  }
  for (const key of ['campaignBrief', 'objective', 'audience', 'brandVoice', 'creativeDirection', 'storyboardDirection'] as const) {
    if (raw[key] !== undefined) {
      out[key] = raw[key] === null ? null : str(raw[key]).slice(0, 4000);
    }
  }
  if (raw.plannedOutputType !== undefined) {
    if (raw.plannedOutputType === null) out.plannedOutputType = null;
    else if (isContentOutputType(raw.plannedOutputType)) out.plannedOutputType = raw.plannedOutputType;
    else errors.push('plannedOutputType must be photo, video, story or content_set');
  }
  if (raw.requestedVariants !== undefined) {
    const variants = raw.requestedVariants;
    if (typeof variants === 'number' && Number.isInteger(variants) && variants >= 1 && variants <= 10) {
      out.requestedVariants = variants;
    } else {
      errors.push('requestedVariants must be an integer between 1 and 10');
    }
  }
  if (Object.keys(out).length === 0) errors.push('at least one field must be provided');

  return errors.length ? { ok: false, errors } : { ok: true, value: out };
}

/**
 * Exactly one valid input target per record, according to inputType. The
 * relevant pair is required (record + version); all other targets must be
 * absent. Look inputs always carry both libraryAssetId and its version id.
 */
export function validateCreateProjectInputPayload(
  input: unknown,
): ValidationResult<CreateContentProjectInputPayload> {
  const errors: string[] = [];
  const raw = (input ?? {}) as Record<string, unknown>;
  const contentProjectId = str(raw.contentProjectId);
  const inputType = raw.inputType;
  const role = raw.role;
  const notes = raw.notes === undefined ? undefined : str(raw.notes).slice(0, 1000);

  if (!contentProjectId) errors.push('contentProjectId is required');
  if (!isContentInputType(inputType)) errors.push('inputType must be model, environment, library_asset or look');
  if (!isContentInputRole(role)) errors.push('role must be a valid content input role');

  if (isContentInputType(inputType)) {
    const ids: Array<[string, string | undefined]> =
      inputType === 'model'
        ? [['modelId', str(raw.modelId)], ['modelVersionId', str(raw.modelVersionId)]]
        : inputType === 'environment'
          ? [['environmentId', str(raw.environmentId)], ['environmentVersionId', str(raw.environmentVersionId)]]
          : inputType === 'library_asset'
            ? [['libraryAssetId', str(raw.libraryAssetId)], ['libraryAssetVersionId', str(raw.libraryAssetVersionId)]]
            : [['libraryAssetId', str(raw.libraryAssetId)], ['libraryAssetVersionId', str(raw.libraryAssetVersionId)]];

    if (ids.some(([, value]) => !value)) {
      errors.push(`${inputType} inputs require both the record and version id`);
    }
  }

  return errors.length
    ? { ok: false, errors }
    : {
        ok: true,
        value: {
          contentProjectId,
          inputType: inputType as ContentInputType,
          role: role as ContentInputRole,
          ...(notes !== undefined ? { notes } : {}),
          ...(raw.modelId !== undefined ? { modelId: str(raw.modelId) } : {}),
          ...(raw.modelVersionId !== undefined ? { modelVersionId: str(raw.modelVersionId) } : {}),
          ...(raw.environmentId !== undefined ? { environmentId: str(raw.environmentId) } : {}),
          ...(raw.environmentVersionId !== undefined ? { environmentVersionId: str(raw.environmentVersionId) } : {}),
          ...(raw.libraryAssetId !== undefined ? { libraryAssetId: str(raw.libraryAssetId) } : {}),
          ...(raw.libraryAssetVersionId !== undefined ? { libraryAssetVersionId: str(raw.libraryAssetVersionId) } : {}),
        },
      };
}

export function validateCreateContentScene(
  input: unknown,
): ValidationResult<CreateContentSceneInput> {
  const errors: string[] = [];
  const raw = (input ?? {}) as Record<string, unknown>;
  const contentProjectId = str(raw.contentProjectId);
  const title = str(raw.title).trim();
  const purpose = raw.purpose === undefined ? undefined : str(raw.purpose).slice(0, 2000);
  const settingNotes = raw.settingNotes === undefined ? undefined : str(raw.settingNotes).slice(0, 4000);
  const shotNotes = raw.shotNotes === undefined ? undefined : str(raw.shotNotes).slice(0, 4000);

  if (!contentProjectId) errors.push('contentProjectId is required');
  if (title.length < 1 || title.length > 120) errors.push('title must be 1–120 characters');

  return errors.length
    ? { ok: false, errors }
    : {
        ok: true,
        value: {
          contentProjectId,
          title,
          ...(purpose !== undefined ? { purpose } : {}),
          ...(settingNotes !== undefined ? { settingNotes } : {}),
          ...(shotNotes !== undefined ? { shotNotes } : {}),
        },
      };
}

export function validateUpdateContentScene(
  input: unknown,
): ValidationResult<UpdateContentSceneInput> {
  const errors: string[] = [];
  const raw = (input ?? {}) as Record<string, unknown>;
  const out: UpdateContentSceneInput = {};

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

export function validateCreateContentBeat(
  input: unknown,
): ValidationResult<CreateContentBeatInput> {
  const errors: string[] = [];
  const raw = (input ?? {}) as Record<string, unknown>;
  const contentSceneId = str(raw.contentSceneId);
  const title = str(raw.title).trim();
  const duration = raw.durationSeconds;

  if (!contentSceneId) errors.push('contentSceneId is required');
  if (title.length < 1 || title.length > 120) errors.push('title must be 1–120 characters');
  if (duration !== undefined && (typeof duration !== 'number' || duration < 0 || !Number.isFinite(duration))) {
    errors.push('durationSeconds must be a non-negative number');
  }

  return errors.length
    ? { ok: false, errors }
    : {
        ok: true,
        value: {
          contentSceneId,
          title,
          ...(raw.actionDescription !== undefined ? { actionDescription: str(raw.actionDescription).slice(0, 4000) } : {}),
          ...(raw.dialogueOrOverlay !== undefined ? { dialogueOrOverlay: str(raw.dialogueOrOverlay).slice(0, 2000) } : {}),
          ...(raw.cameraDirection !== undefined ? { cameraDirection: str(raw.cameraDirection).slice(0, 2000) } : {}),
          ...(duration !== undefined ? { durationSeconds: duration as number } : {}),
        },
      };
}

export function validateUpdateContentBeat(
  input: unknown,
): ValidationResult<UpdateContentBeatInput> {
  const errors: string[] = [];
  const raw = (input ?? {}) as Record<string, unknown>;
  const out: UpdateContentBeatInput = {};

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

export function validateCreateContentJobRequest(
  input: unknown,
): ValidationResult<CreateContentJobRequestInput> {
  const errors: string[] = [];
  const raw = (input ?? {}) as Record<string, unknown>;
  const workspaceId = str(raw.workspaceId);
  const contentProjectId = raw.contentProjectId === undefined ? undefined : str(raw.contentProjectId);
  const name = str(raw.name).trim();
  const outputType = raw.requestedOutputType;
  const variants = raw.requestedVariants === undefined ? 1 : raw.requestedVariants;

  if (!workspaceId) errors.push('workspaceId is required');
  if (name.length < 1 || name.length > 120) errors.push('name must be 1–120 characters');
  if (!isContentOutputType(outputType)) {
    errors.push('requestedOutputType must be photo, video, story or content_set');
  }
  if (typeof variants !== 'number' || !Number.isInteger(variants) || variants < 1 || variants > 10) {
    errors.push('requestedVariants must be an integer between 1 and 10');
  }

  return errors.length
    ? { ok: false, errors }
    : {
        ok: true,
        value: {
          workspaceId,
          name,
          requestedOutputType: outputType as ContentOutputType,
          requestedVariants: variants as number,
          ...(contentProjectId ? { contentProjectId } : {}),
          ...(raw.briefSnapshot !== undefined ? { briefSnapshot: raw.briefSnapshot as Record<string, unknown> } : {}),
          ...(raw.planSnapshot !== undefined ? { planSnapshot: raw.planSnapshot as Record<string, unknown> } : {}),
        },
      };
}
