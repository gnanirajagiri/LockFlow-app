/**
 * Models domain — validation schemas.
 *
 * Deliberately dependency-free: tiny composable validators so the domain
 * layer stays lean and testable. (Swap for zod later if schemas grow.)
 */
import type {
  AssetShortcutCategory,
  CreateModelInput,
  CreateVersionInput,
  ModelStatus,
  ReferenceType,
  SheetTraits,
  UpdateCharacterSheetInput,
  UpdateModelDraftInput,
} from './types';

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function validateCreateModel(input: unknown): ValidationResult<CreateModelInput> {
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

const MODEL_STATUSES: ModelStatus[] = ['draft', 'ready', 'archived'];

export function validateUpdateModelDraft(input: unknown): ValidationResult<UpdateModelDraftInput> {
  const errors: string[] = [];
  const raw = (input ?? {}) as Record<string, unknown>;
  const out: UpdateModelDraftInput = {};

  if (raw.name !== undefined) {
    const name = str(raw.name).trim();
    if (name.length < 1 || name.length > 80) errors.push('name must be 1–80 characters');
    else out.name = name;
  }
  if (raw.status !== undefined) {
    const status = raw.status as ModelStatus;
    if (!MODEL_STATUSES.includes(status)) errors.push('invalid model status');
    else out.status = status;
  }
  if (raw.coverImagePath !== undefined) {
    out.coverImagePath = raw.coverImagePath === null ? null : str(raw.coverImagePath);
  }

  return errors.length ? { ok: false, errors } : { ok: true, value: out };
}

/** Trait objects must be JSON objects (not arrays/scalars) or undefined. */
function isTraits(value: unknown): value is SheetTraits {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const TRAIT_KEYS = [
  'faceFeatures',
  'hairIdentity',
  'complexion',
  'bodyProportions',
  'distinctiveDetails',
  'lockRules',
] as const;

export function validateUpdateCharacterSheet(
  input: unknown,
): ValidationResult<UpdateCharacterSheetInput> {
  const errors: string[] = [];
  const raw = (input ?? {}) as Record<string, unknown>;
  const out: UpdateCharacterSheetInput = {};

  if (raw.identitySummary !== undefined) out.identitySummary = str(raw.identitySummary).slice(0, 2000);
  if (raw.referenceNotes !== undefined) out.referenceNotes = str(raw.referenceNotes).slice(0, 2000);

  for (const key of TRAIT_KEYS) {
    const value = raw[key];
    if (value === undefined) continue;
    if (!isTraits(value)) {
      errors.push(`${key} must be a JSON object`);
      continue;
    }
    (out as Record<string, unknown>)[key] = value;
  }

  if (Object.keys(out).length === 0) errors.push('at least one field must be provided');

  return errors.length ? { ok: false, errors } : { ok: true, value: out };
}

export function validateCreateVersion(input: unknown): ValidationResult<CreateVersionInput> {
  const errors: string[] = [];
  const raw = (input ?? {}) as Record<string, unknown>;
  const modelId = str(raw.modelId);
  const sourceVersionId = str(raw.sourceVersionId);
  const changeSummary = str(raw.changeSummary).slice(0, 500);

  if (!modelId) errors.push('modelId is required');
  if (!sourceVersionId) errors.push('sourceVersionId is required');

  return errors.length
    ? { ok: false, errors }
    : { ok: true, value: { modelId, sourceVersionId, changeSummary } };
}

const REFERENCE_TYPES: ReferenceType[] = ['portrait', 'full_body', 'profile', 'detail', 'other'];
const SHORTCUT_CATEGORIES: AssetShortcutCategory[] = [
  'wardrobe',
  'accessory',
  'personal_item',
  'product',
  'creator_tool',
  'other',
];

export function isReferenceType(value: unknown): value is ReferenceType {
  return REFERENCE_TYPES.includes(value as ReferenceType);
}

export function isShortcutCategory(value: unknown): value is AssetShortcutCategory {
  return SHORTCUT_CATEGORIES.includes(value as AssetShortcutCategory);
}
