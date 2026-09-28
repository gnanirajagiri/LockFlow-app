/**
 * Library UI helpers — lock gate, structured-details diff, and display
 * vocabulary. Pure and unit-tested.
 */
import type {
  LibraryAssetVersionRecord,
  LibraryReferenceType,
} from '../../domain/library';

export const LIBRARY_LOCK_COPY =
  'Locking saves this approved asset version for consistent reuse. Future changes create a new version.';

export const LIBRARY_HELPER_COPY =
  'Library stores reusable inputs. Generated content lives in Gallery.';

export const ASSET_ADD_COPY =
  'Assets are reusable across models, environments and campaigns. Add only material you have the right to use.';

export const LOOKS_HEADER_COPY =
  'Reusable wardrobe and accessory combinations linked to a model. Looks do not change protected model identity.';

export const LOOK_IDENTITY_NOTE = 'Looks change presentation, not protected identity.';

export const USAGE_PLACEHOLDER_COPY = 'Usage tracking coming with Content Studio';

export const RIGHTS_LABELS: Record<LibraryAssetVersionRecord['rightsStatus'], string> = {
  unknown: 'Unknown rights',
  confirmed: 'Rights confirmed',
  restricted: 'Restricted rights',
};

export const REFERENCE_TYPE_LABELS: Record<LibraryReferenceType, string> = {
  front: 'Front',
  back: 'Back',
  detail: 'Detail',
  in_context: 'In context',
  label: 'Label',
  material: 'Material',
  other: 'Other',
};

/**
 * Rule 3 — the complete lock gate for Library asset versions: draft status +
 * explicit confirmation + rights acknowledgement + a decided rights status.
 * Pure; the service guard still runs on the actual call.
 */
export function assertAssetLockAllowed(
  version: Pick<LibraryAssetVersionRecord, 'status' | 'rightsStatus'>,
  options: { confirmed: boolean; rightsAcknowledged: boolean },
): void {
  if (version.status !== 'draft') {
    throw new Error('Only draft asset versions can be locked.');
  }
  if (!options.confirmed) {
    throw new Error('Lock confirmation is required.');
  }
  if (!options.rightsAcknowledged) {
    throw new Error('Rights confirmation is required before locking.');
  }
  if (version.rightsStatus === 'unknown') {
    throw new Error('Set the rights status (Confirmed or Restricted) before locking.');
  }
}

// ── Structured-details diff ────────────────────────────────────────────────

export interface DetailFieldDiff {
  field: string;
  label: string;
  before: string;
  after: string;
  changed: boolean;
}

const DETAIL_LABELS: Array<{ key: string; label: string }> = [
  { key: 'colour', label: 'Colour' },
  { key: 'material', label: 'Material' },
  { key: 'dimensions', label: 'Dimensions / fit' },
  { key: 'fit', label: 'Fit' },
  { key: 'condition', label: 'Condition' },
  { key: 'size', label: 'Size' },
  { key: 'finish', label: 'Finish' },
  { key: 'mood', label: 'Mood' },
  { key: 'grooming', label: 'Grooming' },
  { key: 'keyDetails', label: 'Key details' },
  { key: 'usageNotes', label: 'Usage notes' },
  { key: 'careNote', label: 'Care' },
];

function detailText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((item) => String(item)).join(', ');
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, entry]) => `${key}: ${typeof entry === 'string' ? entry : JSON.stringify(entry)}`)
      .join('\n');
  }
  return String(value);
}

/** Field-by-field diff of two versions' structured details (unchanged kept). */
export function diffAssetDetails(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): DetailFieldDiff[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const ordered = [
    ...DETAIL_LABELS.filter((entry) => keys.has(entry.key)),
    ...[...keys]
      .filter((key) => !DETAIL_LABELS.some((entry) => entry.key === key))
      .map((key) => ({ key, label: key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()) })),
  ];

  return ordered.map(({ key, label }) => {
    const beforeText = detailText(before[key]);
    const afterText = detailText(after[key]);
    return { field: key, label, before: beforeText, after: afterText, changed: beforeText !== afterText };
  });
}

export function countDetailChanges(diffs: DetailFieldDiff[]): number {
  return diffs.filter((diff) => diff.changed).length;
}
