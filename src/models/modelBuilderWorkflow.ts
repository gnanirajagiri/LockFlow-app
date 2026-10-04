/**
 * Prompt 32 — Model Builder completion: reference import, coverage, lock
 * and version-safe editing (workflow).
 *
 * Completes the Model Builder on top of the EXISTING model/version/Character
 * Sheet structures (prompts 5/24/26) — nothing replaces them:
 *
 *   * A model is a reusable asset, never tied to an environment, prop or
 *     campaign; styling layers attach from the shared Library at job time.
 *   * Protected identity comes from the Character Sheet. Refining identity
 *     means a NEW Character Sheet draft on a NEW model version path.
 *   * Locked versions are immutable: styling/supporting changes after lock
 *     create a draft from the locked version — the locked source never
 *     mutates.
 *
 * Everything here is pure and deterministic: the service composes these
 * rules with workspace guards; the UI reads the same classification so
 * coverage and readiness render honestly.
 */
import type {
  ModelReferenceRecord,
  ModelVersionRecord,
} from '../domain/models/types';
import { PROTECTED_TRAIT_GROUPS } from '../domain/models/characterSheet';
import type { CharacterSheetRecord } from '../domain/models/types';

// ── Reference categories (labeled roles) ─────────────────────────────────────

/**
 * The labeled reference roles of the builder. Existing `ReferenceType`
 * values map onto these; identity roles feed Character Sheet governance,
 * supporting roles never overwrite protected identity.
 */
export type ModelBuilderReferenceRole =
  | 'primary_identity'
  | 'supporting_face'
  | 'full_body_posture'
  | 'angle_left'
  | 'angle_right'
  | 'angle_three_quarter'
  | 'back_360'
  | 'style_look'
  | 'non_identity_supporting';

export const REFERENCE_ROLE_LABELS: Record<ModelBuilderReferenceRole, string> = {
  primary_identity: 'Primary identity',
  supporting_face: 'Supporting face',
  full_body_posture: 'Full body / posture',
  angle_left: 'Left angle',
  angle_right: 'Right angle',
  angle_three_quarter: 'Three-quarter angle',
  back_360: 'Back / 360°',
  style_look: 'Style / look',
  non_identity_supporting: 'Non-identity supporting',
};

/** Identity-governed roles (linked to the Character Sheet). */
export const IDENTITY_REFERENCE_ROLES: readonly ModelBuilderReferenceRole[] = [
  'primary_identity',
  'supporting_face',
  'full_body_posture',
];

/** Mapping from the existing 5-value ReferenceType to builder roles. */
export const REFERENCE_TYPE_TO_ROLE: Record<ModelReferenceRecord['referenceType'], ModelBuilderReferenceRole> = {
  portrait: 'primary_identity',
  full_body: 'full_body_posture',
  profile: 'angle_three_quarter',
  detail: 'supporting_face',
  other: 'non_identity_supporting',
};

/** Map a stored reference onto its labeled builder role (caption override wins). */
export function roleForReference(reference: ModelReferenceRecord): ModelBuilderReferenceRole {
  const tagged = /^\[builder:([a-z_]+)\]/.exec(reference.caption)?.[1];
  if (tagged && tagged in REFERENCE_ROLE_LABELS) return tagged as ModelBuilderReferenceRole;
  return REFERENCE_TYPE_TO_ROLE[reference.referenceType];
}

/** True when a reference's role is Character-Sheet-governed (identity). */
export function isIdentityRole(role: ModelBuilderReferenceRole): boolean {
  return IDENTITY_REFERENCE_ROLES.includes(role);
}

// ── Coverage slots (full posture / angles) ───────────────────────────────────

export interface CoverageSlot {
  key: ModelBuilderReferenceRole;
  label: string;
  /** Optional slots are recorded but never fabricated when missing. */
  required: boolean;
}

/** The coverage panel: front/profile/3-4/full-body required; back/360 optional. */
export const COVERAGE_SLOTS: readonly CoverageSlot[] = [
  { key: 'primary_identity', label: 'Front (identity)', required: true },
  { key: 'full_body_posture', label: 'Full body / posture', required: true },
  { key: 'angle_three_quarter', label: 'Three-quarter', required: true },
  { key: 'angle_left', label: 'Left profile', required: false },
  { key: 'angle_right', label: 'Right profile', required: false },
  { key: 'back_360', label: 'Back / 360°', required: false },
];

export interface CoverageReport {
  slots: Array<CoverageSlot & { filled: boolean }>;
  filledCount: number;
  requiredFilled: number;
  requiredTotal: number;
  /** Honest summary; missing optional views are named, never fabricated. */
  missingRequired: string[];
  missingOptional: string[];
  complete: boolean;
  /** "reference complete" = all required slots filled. */
  referenceCompleteness: 'incomplete' | 'core_complete' | 'complete';
}

export function evaluateReferenceCoverage(
  references: Array<Pick<ModelReferenceRecord, 'id' | 'caption' | 'referenceType'>>,
): CoverageReport {
  const slots = COVERAGE_SLOTS.map((slot) => ({
    ...slot,
    filled: references.some((reference) => roleForReference(reference as ModelReferenceRecord) === slot.key),
  }));
  const missingRequired = slots.filter((slot) => slot.required && !slot.filled).map((slot) => slot.label);
  const missingOptional = slots.filter((slot) => !slot.required && !slot.filled).map((slot) => slot.label);
  const requiredTotal = slots.filter((slot) => slot.required).length;
  const requiredFilled = requiredTotal - missingRequired.length;
  const referenceCompleteness: CoverageReport['referenceCompleteness'] =
    missingRequired.length === 0
      ? missingOptional.length === 0
        ? 'complete'
        : 'core_complete'
      : 'incomplete';
  return {
    slots,
    filledCount: slots.filter((slot) => slot.filled).length,
    requiredFilled,
    requiredTotal,
    missingRequired,
    missingOptional,
    complete: missingRequired.length === 0,
    referenceCompleteness,
  };
}

// ── Readiness & lock rules ───────────────────────────────────────────────────

export type ModelReadinessState =
  | 'collecting_references'
  | 'identity_incomplete'
  | 'ready_to_review'
  | 'ready_to_lock'
  | 'locked';

export const MODEL_READINESS_LABELS: Record<ModelReadinessState, string> = {
  collecting_references: 'Collecting references',
  identity_incomplete: 'Identity incomplete',
  ready_to_review: 'Ready to review',
  ready_to_lock: 'Ready to lock',
  locked: 'Locked',
};

/** Sheet fields that must be non-empty for a lock (identity-critical). */
function sheetHasIdentity(sheet: CharacterSheetRecord | null): boolean {
  if (!sheet) return false;
  return (
    sheet.identitySummary.trim().length > 0
    && PROTECTED_TRAIT_GROUPS.filter((group) => group !== 'identity').every((group) => {
      const traits = sheet[group] as SheetTraitsLike;
      return traits && typeof traits === 'object' && Object.keys(traits).length > 0;
    })
  );
}

type SheetTraitsLike = Record<string, unknown>;

export interface ReadinessCheck {
  ok: boolean;
  /** Safe, product-friendly blockers. */
  blockers: string[];
  readiness: ModelReadinessState;
}

/**
 * Lock readiness: draft status + identity evidence (primary reference),
 * core angle coverage and a filled Character Sheet identity.
 */
export function validateModelReadinessForLock(input: {
  version: Pick<ModelVersionRecord, 'id' | 'status'>;
  sheet: CharacterSheetRecord | null;
  references: Array<Pick<ModelReferenceRecord, 'id' | 'caption' | 'referenceType'>>;
}): ReadinessCheck {
  const blockers: string[] = [];
  const coverage = evaluateReferenceCoverage(input.references);
  const hasPrimary = coverage.slots.find((slot) => slot.key === 'primary_identity')?.filled ?? false;

  if (input.version.status !== 'draft') {
    blockers.push(`Only draft versions can be locked (status: ${input.version.status}).`);
  }
  if (!input.sheet || !sheetHasIdentity(input.sheet)) {
    blockers.push('The Character Sheet identity is incomplete — fill the identity summary and protected trait groups first.');
  }
  if (!hasPrimary) {
    blockers.push('Add a primary identity reference before locking.');
  }
  for (const label of coverage.missingRequired) {
    blockers.push(`Missing required reference coverage: ${label}.`);
  }

  let readiness: ModelReadinessState;
  if (input.version.status === 'locked' || input.version.status === 'superseded') {
    readiness = 'locked';
  } else if (blockers.length === 0) {
    readiness = 'ready_to_lock';
  } else if (!input.sheet || !sheetHasIdentity(input.sheet)) {
    readiness = 'identity_incomplete';
  } else if (!hasPrimary || coverage.missingRequired.length > 0) {
    readiness = 'collecting_references';
  } else {
    readiness = 'ready_to_review';
  }
  return { ok: blockers.length === 0, blockers, readiness };
}

/** Immutable lock guard: locked versions refuse every mutation. */
export function assertVersionEditable(version: Pick<ModelVersionRecord, 'id' | 'status'>): void {
  if (version.status !== 'draft') {
    throw new Error(
      `This version is ${version.status} and cannot be edited — create a new draft from it instead.`,
    );
  }
}

/**
 * Protected-identity edit gate. On a draft, identity edits go through the
 * normal Character Sheet flow (with the explicit warning in the UI); on a
 * locked version they are refused — a new version path is required.
 */
export function assertIdentityEditAllowed(version: Pick<ModelVersionRecord, 'id' | 'status'>): void {
  if (version.status !== 'draft') {
    throw new Error(
      'Protected identity can only change on a new draft version — create a draft from the locked version first.',
    );
  }
}

/**
 * Classifies a patch against the Character Sheet: does it touch protected
 * identity (needs the identity gate + warning) or supporting metadata only?
 */
export function classifyCharacterSheetPatch(
  patch: Record<string, unknown>,
): { touchesProtectedIdentity: boolean; touchedGroups: string[] } {
  const touchedGroups = Object.keys(patch).filter((key) => patch[key] !== undefined);
  const touchesProtectedIdentity = touchedGroups.some(
    (group) => PROTECTED_TRAIT_GROUPS.includes(group as never),
  );
  return { touchesProtectedIdentity, touchedGroups };
}
