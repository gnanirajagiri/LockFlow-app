/**
 * Library domain — validation schemas.
 *
 * Dependency-free validators matching the Models/Environments conventions.
 * Reuses `slugify` and the shared ValidationResult type.
 */
import { slugify } from '../models/schemas';
import type { ValidationResult } from '../models/schemas';
import type {
  AddAssetTagInput,
  AssetRightsStatus,
  AssetVersionStatus,
  CreateAssetVersionInput,
  CreateLibraryAssetInput,
  CreateLibraryAssetAttachmentInput,
  LibraryAssetStatus,
  LibraryAssetType,
  LibraryAttachmentTargetType,
  LibraryReferenceType,
  LookItemRole,
  ParseLibraryAssetDescriptionInput,
  RegisterLibraryAssetFileInput,
  SetLookItemsInput,
  UpdateAssetVersionDraftInput,
  UpdateLibraryAssetDraftInput,
} from './types';

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export const LIBRARY_ASSET_TYPES: LibraryAssetType[] = [
  'product',
  'prop',
  'wardrobe',
  'accessory',
  'personal_item',
  'creator_tool',
  'brand_asset',
  'reference',
  'scene',
  'look',
  'other',
];

const ASSET_STATUSES: LibraryAssetStatus[] = ['draft', 'ready', 'archived'];
const RIGHTS_STATUSES: AssetRightsStatus[] = ['unknown', 'confirmed', 'restricted'];
const VERSION_STATUSES: AssetVersionStatus[] = ['draft', 'locked', 'superseded'];
const REFERENCE_TYPES: LibraryReferenceType[] = [
  'front',
  'back',
  'detail',
  'in_context',
  'label',
  'material',
  'other',
];
const LOOK_ROLES: LookItemRole[] = [
  'wardrobe',
  'accessory',
  'personal_item',
  'product',
  'creator_tool',
  'other',
];

export function isLibraryAssetType(value: unknown): value is LibraryAssetType {
  return LIBRARY_ASSET_TYPES.includes(value as LibraryAssetType);
}

// ═══ Prompt 22: ingestion, attachment & file validators ═════════════════════

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export const LIBRARY_ATTACHMENT_TARGET_TYPES: LibraryAttachmentTargetType[] = [
  'content_scene',
  'content_job',
  'campaign',
  'campaign_item',
  'model',
  'environment',
];

export function isLibraryAttachmentTargetType(value: unknown): value is LibraryAttachmentTargetType {
  return LIBRARY_ATTACHMENT_TARGET_TYPES.includes(value as LibraryAttachmentTargetType);
}

/** Allow-listed PRIVATE buckets (same pair the reference-upload flow uses). */
export const LIBRARY_STORAGE_BUCKETS = ['lockflow-references', 'lockflow-previews'] as const;

export const LIBRARY_FILE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/gif',
  'application/pdf',
] as const;

/** 25 MiB — matches the DB CHECK on library_asset_files. */
export const MAX_LIBRARY_FILE_BYTES = 26214400;

export function validateParseLibraryAssetDescription(
  input: unknown,
): ValidationResult<ParseLibraryAssetDescriptionInput> {
  const raw = (input ?? {}) as Record<string, unknown>;
  const description = typeof raw.description === 'string' ? raw.description.trim() : '';
  if (description.length < 10) {
    return { ok: false, errors: ['Describe the asset in at least 10 characters.'] };
  }
  if (description.length > 2000) {
    return { ok: false, errors: ['Keep the description under 2000 characters.'] };
  }
  return { ok: true, value: { description } };
}

export function validateCreateLibraryAssetAttachment(
  input: unknown,
): ValidationResult<CreateLibraryAssetAttachmentInput> {
  const errors: string[] = [];
  const raw = (input ?? {}) as Record<string, unknown>;
  const libraryAssetId = str(raw.libraryAssetId);
  const targetId = str(raw.targetId);
  const targetType = raw.targetType;
  const roleRaw = raw.roleOrSlot;

  if (!isUuid(libraryAssetId)) errors.push('libraryAssetId must be a valid id');
  if (!isUuid(targetId)) errors.push('targetId must be a valid id');
  if (!isLibraryAttachmentTargetType(targetType)) {
    errors.push('targetType must be content_scene, content_job, campaign, model or environment');
  }
  if (roleRaw !== undefined && typeof roleRaw !== 'string') {
    errors.push('roleOrSlot must be a string');
  }

  return errors.length
    ? { ok: false, errors }
    : {
        ok: true,
        value: {
          libraryAssetId,
          targetId,
          targetType: targetType as LibraryAttachmentTargetType,
          ...(typeof roleRaw === 'string' ? { roleOrSlot: roleRaw } : {}),
        },
      };
}

export function validateRegisterLibraryAssetFile(
  input: unknown,
): ValidationResult<RegisterLibraryAssetFileInput> {
  const errors: string[] = [];
  const raw = (input ?? {}) as Record<string, unknown>;
  const storageBucket = str(raw.storageBucket);
  const storagePath = str(raw.storagePath);
  const fileName = str(raw.fileName);
  const mimeType = str(raw.mimeType);
  const sizeRaw = raw.fileSizeBytes;
  const sourceUrl = raw.sourceUrl;
  const fileKind = raw.fileKind;

  if (!(LIBRARY_STORAGE_BUCKETS as readonly string[]).includes(storageBucket)) {
    errors.push('storage_bucket must be one of the allow-listed private buckets');
  }
  if (storagePath.length < 1 || storagePath.length > 512) {
    errors.push('storage_path must be 1–512 characters');
  }
  if (fileName.length < 1 || fileName.length > 200) {
    errors.push('file name must be 1–200 characters');
  }
  if (!(LIBRARY_FILE_MIME_TYPES as readonly string[]).includes(mimeType)) {
    errors.push('That file type is not supported yet — use JPEG, PNG, WebP, AVIF, GIF or PDF.');
  }
  if (sizeRaw !== undefined && sizeRaw !== null) {
    if (typeof sizeRaw !== 'number' || !Number.isFinite(sizeRaw) || sizeRaw <= 0 || sizeRaw > MAX_LIBRARY_FILE_BYTES) {
      errors.push('file size must be between 1 byte and 25 MiB');
    }
  }
  if (sourceUrl !== undefined && sourceUrl !== null && typeof sourceUrl !== 'string') {
    errors.push('sourceUrl must be a string or null');
  }
  if (fileKind !== undefined && !['image', 'document', 'other'].includes(fileKind as string)) {
    errors.push('fileKind must be image, document or other');
  }

  return errors.length
    ? { ok: false, errors }
    : {
        ok: true,
        value: {
          storageBucket,
          storagePath,
          fileName,
          mimeType,
          ...(typeof sizeRaw === 'number' ? { fileSizeBytes: sizeRaw } : {}),
          ...(typeof sourceUrl === 'string' ? { sourceUrl } : {}),
          ...(typeof fileKind === 'string' ? { fileKind: fileKind as 'image' | 'document' | 'other' } : {}),
        },
      };
}

export function isLibraryReferenceType(value: unknown): value is LibraryReferenceType {
  return REFERENCE_TYPES.includes(value as LibraryReferenceType);
}

export function isLookItemRole(value: unknown): value is LookItemRole {
  return LOOK_ROLES.includes(value as LookItemRole);
}

export function isAssetVersionStatus(value: unknown): value is AssetVersionStatus {
  return VERSION_STATUSES.includes(value as AssetVersionStatus);
}

/** Tag names normalize to lowercase kebab for workspace-unique vocabulary. */
export function normalizeTagName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function validateCreateLibraryAsset(
  input: unknown,
): ValidationResult<CreateLibraryAssetInput> {
  const errors: string[] = [];
  const raw = (input ?? {}) as Record<string, unknown>;
  const workspaceId = str(raw.workspaceId);
  const name = str(raw.name).trim();
  const slug = str(raw.slug).trim() || slugify(name);
  const assetType = raw.assetType;
  const description = raw.description === undefined ? undefined : str(raw.description).slice(0, 2000);

  if (!workspaceId) errors.push('workspaceId is required');
  if (name.length < 1 || name.length > 80) errors.push('name must be 1–80 characters');
  if (!SLUG_RE.test(slug)) errors.push('slug must be kebab-case (a–z, 0–9, hyphens)');
  if (!isLibraryAssetType(assetType)) errors.push('assetType must be a valid Library asset type');

  return errors.length
    ? { ok: false, errors }
    : {
        ok: true,
        value: {
          workspaceId,
          name,
          slug,
          assetType: assetType as LibraryAssetType,
          ...(description !== undefined ? { description } : {}),
        },
      };
}

export function validateUpdateLibraryAssetDraft(
  input: unknown,
): ValidationResult<UpdateLibraryAssetDraftInput> {
  const errors: string[] = [];
  const raw = (input ?? {}) as Record<string, unknown>;
  const out: UpdateLibraryAssetDraftInput = {};

  if (raw.name !== undefined) {
    const name = str(raw.name).trim();
    if (name.length < 1 || name.length > 80) errors.push('name must be 1–80 characters');
    else out.name = name;
  }
  if (raw.status !== undefined) {
    if (ASSET_STATUSES.includes(raw.status as LibraryAssetStatus)) out.status = raw.status as LibraryAssetStatus;
    else errors.push('invalid asset status');
  }
  if (raw.coverImagePath !== undefined) {
    out.coverImagePath = raw.coverImagePath === null ? null : str(raw.coverImagePath);
  }
  if (raw.description !== undefined) {
    out.description = raw.description === null ? null : str(raw.description).slice(0, 2000);
  }

  return errors.length ? { ok: false, errors } : { ok: true, value: out };
}

export function validateCreateAssetVersion(
  input: unknown,
): ValidationResult<CreateAssetVersionInput> {
  const errors: string[] = [];
  const raw = (input ?? {}) as Record<string, unknown>;
  const libraryAssetId = str(raw.libraryAssetId);
  const sourceVersionId = str(raw.sourceVersionId);
  const changeSummary = str(raw.changeSummary).slice(0, 500);

  if (!libraryAssetId) errors.push('libraryAssetId is required');
  if (!sourceVersionId) errors.push('sourceVersionId is required');

  return errors.length
    ? { ok: false, errors }
    : { ok: true, value: { libraryAssetId, sourceVersionId, changeSummary } };
}

export function validateUpdateAssetVersionDraft(
  input: unknown,
): ValidationResult<UpdateAssetVersionDraftInput> {
  const errors: string[] = [];
  const raw = (input ?? {}) as Record<string, unknown>;
  const out: UpdateAssetVersionDraftInput = {};

  if (raw.changeSummary !== undefined) out.changeSummary = str(raw.changeSummary).slice(0, 500);
  if (raw.rightsStatus !== undefined) {
    if (RIGHTS_STATUSES.includes(raw.rightsStatus as AssetRightsStatus)) {
      out.rightsStatus = raw.rightsStatus as AssetRightsStatus;
    } else {
      errors.push('rightsStatus must be unknown, confirmed or restricted');
    }
  }
  if (raw.structuredDetails !== undefined) {
    const details = raw.structuredDetails;
    if (details !== null && typeof details === 'object' && !Array.isArray(details)) {
      out.structuredDetails = details as Record<string, unknown>;
    } else {
      errors.push('structuredDetails must be a JSON object');
    }
  }

  if (Object.keys(out).length === 0) errors.push('at least one field must be provided');

  return errors.length ? { ok: false, errors } : { ok: true, value: out };
}

export function validateAddAssetTag(input: unknown): ValidationResult<AddAssetTagInput> {
  const errors: string[] = [];
  const raw = (input ?? {}) as Record<string, unknown>;
  const libraryAssetId = str(raw.libraryAssetId);
  const name = str(raw.name).trim();
  const normalized = normalizeTagName(name);

  if (!libraryAssetId) errors.push('libraryAssetId is required');
  if (name.length < 1 || name.length > 40) errors.push('tag name must be 1–40 characters');
  if (!normalized) errors.push('tag name must contain letters or numbers');

  return errors.length
    ? { ok: false, errors }
    : { ok: true, value: { libraryAssetId, name, ...(normalized !== name ? { normalizedName: normalized } : {}) } as AddAssetTagInput & { normalizedName: string } };
}

export function validateSetLookItems(input: unknown): ValidationResult<SetLookItemsInput> {
  const errors: string[] = [];
  const raw = (input ?? {}) as Record<string, unknown>;
  const lookDetailsId = str(raw.lookDetailsId);
  const items = Array.isArray(raw.items) ? raw.items : null;

  if (!lookDetailsId) errors.push('lookDetailsId is required');
  if (!items) errors.push('items must be an array');

  const clean: SetLookItemsInput['items'] = [];
  if (items) {
    items.forEach((entry, index) => {
      const item = (entry ?? {}) as Record<string, unknown>;
      const libraryAssetId = str(item.libraryAssetId);
      const role = item.role;
      const pinnedRaw = item.libraryAssetVersionId;
      const pinned = pinnedRaw === undefined || pinnedRaw === null ? undefined : pinnedRaw;
      if (!libraryAssetId) errors.push(`items[${index}].libraryAssetId is required`);
      if (!isLookItemRole(role)) errors.push(`items[${index}].role must be a valid look item role`);
      if (pinned !== undefined && typeof pinned !== 'string') {
        errors.push(`items[${index}].libraryAssetVersionId must be a string or null`);
      }
      if (libraryAssetId && isLookItemRole(role)) {
        clean.push({
          libraryAssetId,
          role: role as LookItemRole,
          sortOrder: typeof item.sortOrder === 'number' ? item.sortOrder : index,
          ...(pinned !== undefined ? { libraryAssetVersionId: pinned as string } : {}),
        });
      }
    });
  }

  return errors.length
    ? { ok: false, errors }
    : { ok: true, value: { lookDetailsId, items: clean } };
}
