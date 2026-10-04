/**
 * Prompt 33 — Environment Builder completion: reference import, reusable
 * layout, camera views, lock-and-save (workflow).
 *
 * Completes the Environment Builder on top of the EXISTING
 * environment/version/spec/reference structures — nothing replaces them.
 * Environments are independently reusable locations/scenes: never tied to a
 * model, never globally exclusive, and locked versions stay visually stable
 * across every generation set that uses them.
 *
 * Everything here is pure and deterministic: the service composes these
 * rules with workspace guards; the UI reads the same classification so
 * coverage and readiness render honestly.
 */
import type {
  EnvironmentReferenceRecord,
  EnvironmentSpecRecord,
  EnvironmentVersionRecord,
} from '../domain/environments/types';

// ── Reference categories (labeled roles) ─────────────────────────────────────

/**
 * The labeled reference roles of the builder. Existing
 * `EnvironmentReferenceType` values map onto these; layout/lighting/material
 * roles define the environment, inspiration roles never overwrite it.
 */
export type EnvironmentBuilderReferenceRole =
  | 'primary_environment'
  | 'layout'
  | 'lighting_mood'
  | 'material_color'
  | 'prop_furnishing'
  | 'camera_view'
  | 'supporting_inspiration';

export const ENVIRONMENT_REFERENCE_ROLE_LABELS: Record<EnvironmentBuilderReferenceRole, string> = {
  primary_environment: 'Primary environment',
  layout: 'Layout',
  lighting_mood: 'Lighting / mood',
  material_color: 'Material / color',
  prop_furnishing: 'Prop / furnishing',
  camera_view: 'Camera / view',
  supporting_inspiration: 'Supporting inspiration',
};

/** Defining roles — the environment's visual definition evidence. */
export const DEFINING_REFERENCE_ROLES: readonly EnvironmentBuilderReferenceRole[] = [
  'primary_environment',
  'layout',
  'lighting_mood',
];

/** Mapping from the existing reference types to builder roles. */
export const ENV_REFERENCE_TYPE_TO_ROLE: Record<EnvironmentReferenceRecord['referenceType'], EnvironmentBuilderReferenceRole> = {
  wide: 'primary_environment',
  hero_angle: 'camera_view',
  layout: 'layout',
  lighting: 'lighting_mood',
  detail: 'material_color',
  product_zone: 'prop_furnishing',
  other: 'supporting_inspiration',
};

/** Map a stored reference onto its labeled builder role (caption tag wins). */
export function roleForEnvironmentReference(
  reference: Pick<EnvironmentReferenceRecord, 'caption' | 'referenceType'>,
): EnvironmentBuilderReferenceRole {
  const tagged = /^\[envbuilder:([a-z_]+)\]/.exec(reference.caption)?.[1];
  if (tagged && tagged in ENVIRONMENT_REFERENCE_ROLE_LABELS) {
    return tagged as EnvironmentBuilderReferenceRole;
  }
  return ENV_REFERENCE_TYPE_TO_ROLE[reference.referenceType];
}

/** True when a role defines the environment (vs. inspiration-only). */
export function isDefiningRole(role: EnvironmentBuilderReferenceRole): boolean {
  return DEFINING_REFERENCE_ROLES.includes(role);
}

// ── Coverage slots ───────────────────────────────────────────────────────────

export interface EnvironmentCoverageSlot {
  key: EnvironmentBuilderReferenceRole;
  label: string;
  required: boolean;
}

/** Coverage panel: primary + layout + lighting required; others optional. */
export const ENVIRONMENT_COVERAGE_SLOTS: readonly EnvironmentCoverageSlot[] = [
  { key: 'primary_environment', label: 'Primary environment', required: true },
  { key: 'layout', label: 'Layout', required: true },
  { key: 'lighting_mood', label: 'Lighting / mood', required: true },
  { key: 'material_color', label: 'Material / color', required: false },
  { key: 'prop_furnishing', label: 'Prop / furnishing', required: false },
  { key: 'camera_view', label: 'Camera / view', required: false },
  { key: 'supporting_inspiration', label: 'Supporting inspiration', required: false },
];

export interface EnvironmentCoverageReport {
  slots: Array<EnvironmentCoverageSlot & { filled: boolean }>;
  filledCount: number;
  requiredFilled: number;
  requiredTotal: number;
  missingRequired: string[];
  missingOptional: string[];
  /** "reference complete" = all required slots filled. */
  referenceCompleteness: 'incomplete' | 'core_complete' | 'complete';
}

export function evaluateEnvironmentReferenceCoverage(
  references: Array<Pick<EnvironmentReferenceRecord, 'id' | 'caption' | 'referenceType'>>,
): EnvironmentCoverageReport {
  const slots = ENVIRONMENT_COVERAGE_SLOTS.map((slot) => ({
    ...slot,
    filled: references.some((reference) => roleForEnvironmentReference(reference) === slot.key),
  }));
  const missingRequired = slots.filter((slot) => slot.required && !slot.filled).map((slot) => slot.label);
  const missingOptional = slots.filter((slot) => !slot.required && !slot.filled).map((slot) => slot.label);
  const requiredTotal = slots.filter((slot) => slot.required).length;
  const requiredFilled = requiredTotal - missingRequired.length;
  const referenceCompleteness: EnvironmentCoverageReport['referenceCompleteness'] =
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
    referenceCompleteness,
  };
}

// ── Camera / view records (environment-specific, never model identity) ───────

/** One reusable saved camera/view of this environment version. */
export interface EnvironmentCameraViewRecord {
  id: string;
  workspaceId: string;
  environmentVersionId: string;
  /** e.g. "hero", "wide", "over-the-shoulder", "dolly-in". */
  name: string;
  /** Camera angle/height description in safe product terms. */
  angle: string | null;
  /** Movement metadata (dolly/trolley) where applicable. */
  movement: 'static' | 'dolly_in' | 'dolly_out' | 'trolley_left' | 'trolley_right' | null;
  /** Free-form safe metadata (framing, lens feel, staging notes). */
  configuration: Record<string, unknown> | null;
  createdBy: string;
  createdAt: string;
}

export const CAMERA_MOVEMENT_LABELS: Record<NonNullable<EnvironmentCameraViewRecord['movement']>, string> = {
  static: 'Static',
  dolly_in: 'Dolly in',
  dolly_out: 'Dolly out',
  trolley_left: 'Trolley left',
  trolley_right: 'Trolley right',
};

/** Pure validation for a camera-view save. */
export function validateCameraViewInput(input: {
  name: string;
  angle?: string | null;
  movement?: EnvironmentCameraViewRecord['movement'];
}): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!input.name || input.name.trim().length === 0) errors.push('Give the view a name.');
  if (input.name && input.name.trim().length > 80) errors.push('View names must be 80 characters or fewer.');
  if (input.angle && input.angle.length > 500) errors.push('Angle description must be 500 characters or fewer.');
  return { ok: errors.length === 0, errors };
}

// ── Readiness & lock rules ───────────────────────────────────────────────────

export type EnvironmentReadinessState =
  | 'collecting_references'
  | 'spec_incomplete'
  | 'ready_to_lock'
  | 'locked';

export const ENVIRONMENT_READINESS_LABELS: Record<EnvironmentReadinessState, string> = {
  collecting_references: 'Collecting references',
  spec_incomplete: 'Environment definition incomplete',
  ready_to_lock: 'Ready to lock',
  locked: 'Locked',
};

/** Spec fields that must be non-empty for a lock (the defining anchors). */
export function specIsComplete(spec: EnvironmentSpecRecord | null): boolean {
  if (!spec) return false;
  return (
    spec.roomType.trim().length > 0
    && spec.layoutFeel.trim().length > 0
    && spec.heroAngle.trim().length > 0
    && spec.lightingStyle.trim().length > 0
  );
}

export interface EnvironmentReadinessCheck {
  ok: boolean;
  /** Safe, product-friendly blockers. */
  blockers: string[];
  readiness: EnvironmentReadinessState;
}

/**
 * Lock readiness: draft status + defining anchors in the spec + core
 * reference coverage (primary, layout, lighting).
 */
export function validateEnvironmentReadinessForLock(input: {
  version: Pick<EnvironmentVersionRecord, 'id' | 'status'>;
  spec: EnvironmentSpecRecord | null;
  references: Array<Pick<EnvironmentReferenceRecord, 'id' | 'caption' | 'referenceType'>>;
}): EnvironmentReadinessCheck {
  const blockers: string[] = [];
  const coverage = evaluateEnvironmentReferenceCoverage(input.references);

  if (input.version.status !== 'draft') {
    blockers.push(`Only draft versions can be locked (status: ${input.version.status}).`);
  }
  if (!specIsComplete(input.spec)) {
    blockers.push('The environment definition is incomplete — fill room type, layout feel, hero angle and lighting style first.');
  }
  for (const label of coverage.missingRequired) {
    blockers.push(`Missing required reference coverage: ${label}.`);
  }

  let readiness: EnvironmentReadinessState;
  if (input.version.status !== 'draft') {
    readiness = 'locked';
  } else if (blockers.length === 0) {
    readiness = 'ready_to_lock';
  } else if (!specIsComplete(input.spec)) {
    readiness = 'spec_incomplete';
  } else {
    readiness = 'collecting_references';
  }
  return { ok: blockers.length === 0, blockers, readiness };
}

/** Immutable lock guard: locked versions refuse every mutation. */
export function assertEnvironmentVersionEditable(
  version: Pick<EnvironmentVersionRecord, 'id' | 'status'>,
): void {
  if (version.status !== 'draft') {
    throw new Error(
      `This version is ${version.status} and cannot be edited — create a new draft from it instead.`,
    );
  }
}
