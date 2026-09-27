/**
 * Character Sheet diffing — pure functions used by the Versions comparison
 * view. Field-level: each of the eight identity fields is compared as JSON;
 * unchanged fields are still listed (the comparison must show both).
 */
import type { CharacterSheetRecord, SheetTraits } from '../../domain/models';

export interface SheetFieldDiff {
  field: string;
  label: string;
  before: string;
  after: string;
  changed: boolean;
}

const FIELD_LABELS: Array<{ field: keyof CharacterSheetRecord | 'identitySummary' | 'referenceNotes'; label: string }> = [
  { field: 'identitySummary', label: 'Identity summary' },
  { field: 'faceFeatures', label: 'Face & features' },
  { field: 'hairIdentity', label: 'Hair identity' },
  { field: 'complexion', label: 'Complexion' },
  { field: 'bodyProportions', label: 'Body proportions' },
  { field: 'distinctiveDetails', label: 'Distinctive details' },
  { field: 'referenceNotes', label: 'Reference notes' },
  { field: 'lockRules', label: 'Lock rules' },
];

/** Pretty-print a field value for the comparison table. */
function renderValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value.trim() === '' ? '—' : value;
  if (typeof value === 'object') {
    const entries = Object.entries(value as SheetTraits);
    if (entries.length === 0) return '—';
    return entries.map(([key, val]) => `${key}: ${renderValue(val)}`).join('\n');
  }
  return String(value);
}

export function diffCharacterSheets(
  before: CharacterSheetRecord,
  after: CharacterSheetRecord,
): SheetFieldDiff[] {
  return FIELD_LABELS.map(({ field, label }) => {
    const beforeText = renderValue(before[field]);
    const afterText = renderValue(after[field]);
    return {
      field: String(field),
      label,
      before: beforeText,
      after: afterText,
      changed: beforeText !== afterText,
    };
  });
}

export function countChanged(diffs: SheetFieldDiff[]): number {
  return diffs.filter((diff) => diff.changed).length;
}
