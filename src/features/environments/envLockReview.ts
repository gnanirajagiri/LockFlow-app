/**
 * Environment lock review — pure helpers for the final lock review page.
 *
 * The lock flow has two gates, both enforced here and in the UI:
 *   1. Anchor completeness — required defining anchors must be present.
 *   2. Rights acknowledgement — the user must confirm they hold the rights
 *      to uploaded/imported references.
 * The service-layer lock guard (only drafts lock) runs afterwards as before.
 */
import type {
  EnvironmentLockLevel,
  EnvironmentSpecRecord,
  EnvironmentVersionRecord,
} from '../../domain/environments';

export const RIGHTS_CONFIRMATION_COPY =
  'I have the rights to use uploaded or imported references for this environment.';

export const LOCK_REVIEW_COPY =
  'LockFlow will reuse the approved setting and protect its defining anchors in future content jobs.';

export const VERSION_RULES_COPY =
  'Future changes create a new version and never overwrite this one.';

/** Helper copy for each lock level (concise, shown on the segmented selector). */
export const LOCK_LEVEL_HELP: Record<EnvironmentLockLevel, string> = {
  flexible: 'Protects the key mood and setting direction.',
  balanced: 'Protects defining anchors while allowing minor natural variation.',
  strict: 'Protects layout, anchor placement and the core visual setup closely.',
};

export interface AnchorCheck {
  key: string;
  label: string;
  complete: boolean;
  required: boolean;
}

function hasText(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasEntries(value: Record<string, unknown> | undefined): boolean {
  return value !== undefined && Object.keys(value).length > 0;
}

/**
 * Rule 4 — draft validation for locking: every required defining anchor must
 * be filled. `productZone` is optional (not every environment presents
 * products) but reported so the checklist can show its state.
 */
export function anchorChecks(spec: EnvironmentSpecRecord): AnchorCheck[] {
  return [
    { key: 'roomType', label: 'Room type and layout feel', required: true, complete: hasText(spec.roomType) && hasText(spec.layoutFeel) },
    { key: 'heroAngle', label: 'Hero angle', required: true, complete: hasText(spec.heroAngle) },
    { key: 'lightingStyle', label: 'Lighting style', required: true, complete: hasText(spec.lightingStyle) },
    { key: 'furnitureAnchors', label: 'Key furniture anchors', required: true, complete: hasEntries(spec.furnitureAnchors) },
    { key: 'signatureProps', label: 'Signature props', required: true, complete: hasEntries(spec.signatureProps) },
    { key: 'paletteMaterials', label: 'Palette and material direction', required: true, complete: hasEntries(spec.paletteMaterials) },
    { key: 'productZone', label: 'Product zone (optional)', required: false, complete: hasEntries(spec.productZone ?? undefined) },
  ];
}

export function incompleteAnchors(spec: EnvironmentSpecRecord): AnchorCheck[] {
  return anchorChecks(spec).filter((check) => check.required && !check.complete);
}

export function isEnvironmentLockReady(spec: EnvironmentSpecRecord): boolean {
  return incompleteAnchors(spec).length === 0;
}

/**
 * The full lock gate for the review page: draft status + complete anchors +
 * explicit confirmation + rights acknowledgement. Pure and unit-tested; the
 * service lock guard still runs on the actual call.
 */
export function assertEnvironmentLockAllowed(
  version: Pick<EnvironmentVersionRecord, 'status'>,
  spec: EnvironmentSpecRecord,
  options: { confirmed: boolean; rightsAcknowledged: boolean },
): void {
  if (version.status !== 'draft') {
    throw new Error('Only draft environment versions can be locked.');
  }
  if (!options.confirmed) {
    throw new Error('Lock confirmation is required.');
  }
  if (!options.rightsAcknowledged) {
    throw new Error('Rights confirmation is required before locking.');
  }
  const missing = incompleteAnchors(spec);
  if (missing.length > 0) {
    throw new Error(`Complete the required anchors before locking: ${missing.map((c) => c.label).join(', ')}.`);
  }
}
