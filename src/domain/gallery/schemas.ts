/**
 * Gallery domain — validation schemas.
 *
 * Dependency-free validators matching the Content Studio/Library conventions.
 */
import type { ValidationResult } from '../models/schemas';
import type {
  CreateGalleryCollectionInput,
  CreateGalleryOutputInput,
  GalleryOutputStatus,
  GalleryOutputType,
  GalleryReviewDecision,
  SubmitGalleryReviewInput,
  UpdateGalleryOutputInput,
} from './types';

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export const GALLERY_OUTPUT_TYPES: GalleryOutputType[] = ['image', 'video', 'story'];

export const GALLERY_OUTPUT_STATUSES: GalleryOutputStatus[] = [
  'draft',
  'processing',
  'ready_for_review',
  'approved',
  'rejected',
  'archived',
  'failed',
];

export const GALLERY_REVIEW_DECISIONS: GalleryReviewDecision[] = [
  'approved',
  'rejected',
  'changes_requested',
];

export function isGalleryOutputType(value: unknown): value is GalleryOutputType {
  return GALLERY_OUTPUT_TYPES.includes(value as GalleryOutputType);
}

export function isGalleryOutputStatus(value: unknown): value is GalleryOutputStatus {
  return GALLERY_OUTPUT_STATUSES.includes(value as GalleryOutputStatus);
}

export function isGalleryReviewDecision(value: unknown): value is GalleryReviewDecision {
  return GALLERY_REVIEW_DECISIONS.includes(value as GalleryReviewDecision);
}

export function validateCreateGalleryOutput(
  input: unknown,
): ValidationResult<CreateGalleryOutputInput> {
  const errors: string[] = [];
  const raw = (input ?? {}) as Record<string, unknown>;
  const workspaceId = str(raw.workspaceId);
  const contentJobRequestId = str(raw.contentJobRequestId);
  const title = str(raw.title).trim();
  const outputType = raw.outputType;
  const status = raw.status === undefined ? 'draft' : raw.status;
  const outputIndex = raw.outputIndex === undefined ? undefined : raw.outputIndex;
  const duration = raw.durationSeconds;

  if (!workspaceId) errors.push('workspaceId is required');
  if (!contentJobRequestId) errors.push('contentJobRequestId is required — every output belongs to a job');
  if (title.length < 1 || title.length > 120) errors.push('title must be 1–120 characters');
  if (!isGalleryOutputType(outputType)) errors.push('outputType must be image, video or story');
  if (status !== undefined && !isGalleryOutputStatus(status)) errors.push('invalid output status');
  if (
    outputIndex !== undefined &&
    (typeof outputIndex !== 'number' || !Number.isInteger(outputIndex) || outputIndex < 0)
  ) {
    errors.push('outputIndex must be a non-negative integer');
  }
  if (duration !== undefined && duration !== null && (typeof duration !== 'number' || duration < 0)) {
    errors.push('durationSeconds must be a non-negative number');
  }

  return errors.length
    ? { ok: false, errors }
    : {
        ok: true,
        value: {
          workspaceId,
          contentJobRequestId,
          title,
          outputType: outputType as GalleryOutputType,
          status: status as GalleryOutputStatus,
          ...(raw.parentGalleryOutputId !== undefined ? { parentGalleryOutputId: str(raw.parentGalleryOutputId) } : {}),
          ...(raw.mediaStoragePath !== undefined ? { mediaStoragePath: str(raw.mediaStoragePath) } : {}),
          ...(raw.thumbnailStoragePath !== undefined ? { thumbnailStoragePath: str(raw.thumbnailStoragePath) } : {}),
          ...(duration !== undefined ? { durationSeconds: duration as number | null } : {}),
          ...(raw.width !== undefined ? { width: raw.width as number | null } : {}),
          ...(raw.height !== undefined ? { height: raw.height as number | null } : {}),
          ...(raw.fileSizeBytes !== undefined ? { fileSizeBytes: raw.fileSizeBytes as number | null } : {}),
          ...(raw.mimeType !== undefined ? { mimeType: str(raw.mimeType) } : {}),
          ...(outputIndex !== undefined ? { outputIndex: outputIndex as number } : {}),
          ...(raw.metadata !== undefined ? { metadata: raw.metadata as Record<string, unknown> } : {}),
        } as CreateGalleryOutputInput,
      };
}

export function validateUpdateGalleryOutput(
  input: unknown,
): ValidationResult<UpdateGalleryOutputInput> {
  const errors: string[] = [];
  const raw = (input ?? {}) as Record<string, unknown>;
  const out: UpdateGalleryOutputInput = {};

  if (raw.title !== undefined) {
    const title = str(raw.title).trim();
    if (title.length < 1 || title.length > 120) errors.push('title must be 1–120 characters');
    else out.title = title;
  }
  if (raw.durationSeconds !== undefined) {
    const duration = raw.durationSeconds;
    if (duration === null) out.durationSeconds = null;
    else if (typeof duration === 'number' && duration >= 0) out.durationSeconds = duration;
    else errors.push('durationSeconds must be a non-negative number or null');
  }
  for (const key of ['width', 'height'] as const) {
    if (raw[key] !== undefined) {
      const value = raw[key];
      if (value === null) out[key] = null;
      else if (typeof value === 'number' && value > 0) out[key] = value;
      else errors.push(`${key} must be a positive number or null`);
    }
  }
  if (raw.metadata !== undefined) {
    const metadata = raw.metadata;
    if (metadata !== null && typeof metadata === 'object' && !Array.isArray(metadata)) {
      out.metadata = metadata as Record<string, unknown>;
    } else {
      errors.push('metadata must be a JSON object');
    }
  }

  if (Object.keys(out).length === 0) errors.push('at least one field must be provided');
  return errors.length ? { ok: false, errors } : { ok: true, value: out };
}

export function validateSubmitGalleryReview(
  input: unknown,
): ValidationResult<SubmitGalleryReviewInput> {
  const errors: string[] = [];
  const raw = (input ?? {}) as Record<string, unknown>;
  const galleryOutputId = str(raw.galleryOutputId);
  const reviewerId = str(raw.reviewerId);
  const decision = raw.decision;
  const feedback = raw.feedback === undefined ? undefined : str(raw.feedback).slice(0, 4000);

  if (!galleryOutputId) errors.push('galleryOutputId is required');
  if (!reviewerId) errors.push('reviewerId is required');
  if (!isGalleryReviewDecision(decision)) {
    errors.push('decision must be approved, rejected or changes_requested');
  }
  // Reject and request-changes are review feedback; require a reason.
  if (
    (decision === 'rejected' || decision === 'changes_requested') &&
    (feedback === undefined || feedback.trim() === '')
  ) {
    errors.push('feedback is required when rejecting or requesting changes');
  }

  return errors.length
    ? { ok: false, errors }
    : {
        ok: true,
        value: {
          galleryOutputId,
          reviewerId,
          decision: decision as GalleryReviewDecision,
          ...(feedback !== undefined ? { feedback } : {}),
        },
      };
}

export function validateCreateGalleryCollection(
  input: unknown,
): ValidationResult<CreateGalleryCollectionInput> {
  const errors: string[] = [];
  const raw = (input ?? {}) as Record<string, unknown>;
  const workspaceId = str(raw.workspaceId);
  const name = str(raw.name).trim();
  const description = raw.description === undefined ? undefined : str(raw.description).slice(0, 2000);

  if (!workspaceId) errors.push('workspaceId is required');
  if (name.length < 1 || name.length > 80) errors.push('name must be 1–80 characters');

  return errors.length
    ? { ok: false, errors }
    : {
        ok: true,
        value: {
          workspaceId,
          name,
          ...(description !== undefined ? { description } : {}),
        },
      };
}

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
