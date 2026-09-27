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
  LibraryAssetStatus,
  LibraryAssetType,
  LibraryReferenceType,
  LookItemRole,
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
