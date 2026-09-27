/**
 * Environments domain — validation schemas.
 *
 * Dependency-free composable validators, matching the Models domain
 * conventions. Reuses `slugify` from the Models schemas as a shared utility
 * (no changes to the Models module).
 */
import { slugify } from '../models/schemas';
import type { ValidationResult } from '../models/schemas';
import type {
  CreateEnvironmentInput,
  CreateEnvironmentVersionInput,
  EnvironmentAssetCategory,
  EnvironmentLockLevel,
  EnvironmentReferenceType,
  EnvironmentStatus,
  EnvironmentVersionStatus,
  SpecJson,
  UpdateEnvironmentDraftInput,
  UpdateEnvironmentSpecInput,
} from './types';

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function validateCreateEnvironment(input: unknown): ValidationResult<CreateEnvironmentInput> {
  const errors: string[] = [];
  const raw = (input ?? {}) as Record<string, unknown>;
  const workspaceId = str(raw.workspaceId);
  const name = str(raw.name).trim();
  const slug = str(raw.slug).trim() || slugify(name);

  if (!workspaceId) errors.push('workspaceId is required');
  if (name.length < 1 || name.length > 80) errors.push('name must be 1–80 characters');
  if (!SLUG_RE.test(slug)) errors.push('slug must be kebab-case (a–z, 0–9, hyphens)');

  return errors.length ? { ok: false, errors } : { ok: true, value: { workspaceId, name, slug } };
}

const ENVIRONMENT_STATUSES: EnvironmentStatus[] = ['draft', 'ready', 'archived'];

export function validateUpdateEnvironmentDraft(
  input: unknown,
): ValidationResult<UpdateEnvironmentDraftInput> {
  const errors: string[] = [];
  const raw = (input ?? {}) as Record<string, unknown>;
  const out: UpdateEnvironmentDraftInput = {};

  if (raw.name !== undefined) {
    const name = str(raw.name).trim();
    if (name.length < 1 || name.length > 80) errors.push('name must be 1–80 characters');
    else out.name = name;
  }
  if (raw.status !== undefined) {
    const status = raw.status as EnvironmentStatus;
    if (!ENVIRONMENT_STATUSES.includes(status)) errors.push('invalid environment status');
    else out.status = status;
  }
  if (raw.coverImagePath !== undefined) {
    out.coverImagePath = raw.coverImagePath === null ? null : str(raw.coverImagePath);
  }

  return errors.length ? { ok: false, errors } : { ok: true, value: out };
}

/** JSON payload fields must be plain objects (or null for productZone). */
function isSpecJson(value: unknown): value is SpecJson {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const SPEC_JSON_KEYS = [
  'furnitureAnchors',
  'signatureProps',
  'paletteMaterials',
  'lockRules',
] as const;

const SPEC_TEXT_KEYS = ['roomType', 'layoutFeel', 'heroAngle', 'lightingStyle', 'continuityNotes'] as const;

export function validateUpdateEnvironmentSpec(
  input: unknown,
): ValidationResult<UpdateEnvironmentSpecInput> {
  const errors: string[] = [];
  const raw = (input ?? {}) as Record<string, unknown>;
  const out: UpdateEnvironmentSpecInput = {};

  for (const key of SPEC_TEXT_KEYS) {
    const value = raw[key];
    if (value === undefined) continue;
    (out as Record<string, unknown>)[key] = str(value).slice(0, 2000);
  }

  for (const key of SPEC_JSON_KEYS) {
    const value = raw[key];
    if (value === undefined) continue;
    if (!isSpecJson(value)) {
      errors.push(`${key} must be a JSON object`);
      continue;
    }
    (out as Record<string, unknown>)[key] = value;
  }

  if (raw.productZone !== undefined) {
    if (raw.productZone === null) {
      out.productZone = null;
    } else if (isSpecJson(raw.productZone)) {
      out.productZone = raw.productZone;
    } else {
      errors.push('productZone must be a JSON object or null');
    }
  }

  if (Object.keys(out).length === 0) errors.push('at least one field must be provided');

  return errors.length ? { ok: false, errors } : { ok: true, value: out };
}

export function validateCreateEnvironmentVersion(
  input: unknown,
): ValidationResult<CreateEnvironmentVersionInput> {
  const errors: string[] = [];
  const raw = (input ?? {}) as Record<string, unknown>;
  const environmentId = str(raw.environmentId);
  const sourceVersionId = str(raw.sourceVersionId);
  const changeSummary = str(raw.changeSummary).slice(0, 500);

  if (!environmentId) errors.push('environmentId is required');
  if (!sourceVersionId) errors.push('sourceVersionId is required');

  return errors.length
    ? { ok: false, errors }
    : { ok: true, value: { environmentId, sourceVersionId, changeSummary } };
}

const REFERENCE_TYPES: EnvironmentReferenceType[] = [
  'wide',
  'hero_angle',
  'detail',
  'layout',
  'lighting',
  'product_zone',
  'other',
];
const SHORTCUT_CATEGORIES: EnvironmentAssetCategory[] = [
  'furniture',
  'prop',
  'product',
  'lighting',
  'decor',
  'other',
];
export const LOCK_LEVELS: EnvironmentLockLevel[] = ['flexible', 'balanced', 'strict'];
const VERSION_STATUSES: EnvironmentVersionStatus[] = ['draft', 'locked', 'superseded'];

export function isEnvironmentReferenceType(value: unknown): value is EnvironmentReferenceType {
  return REFERENCE_TYPES.includes(value as EnvironmentReferenceType);
}

export function isEnvironmentAssetCategory(value: unknown): value is EnvironmentAssetCategory {
  return SHORTCUT_CATEGORIES.includes(value as EnvironmentAssetCategory);
}

export function isEnvironmentLockLevel(value: unknown): value is EnvironmentLockLevel {
  return LOCK_LEVELS.includes(value as EnvironmentLockLevel);
}

export function isEnvironmentVersionStatus(value: unknown): value is EnvironmentVersionStatus {
  return VERSION_STATUSES.includes(value as EnvironmentVersionStatus);
}
