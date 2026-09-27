/**
 * Environment Spec diff — pure helpers for the two-version comparison.
 *
 * Mirrors the Models `modelDiff` behaviour: field-by-field differences across
 * every protected anchor, including changed AND unchanged fields.
 */
import type { EnvironmentSpecRecord } from '../../domain/environments';

export interface SpecFieldDiff {
  field: string;
  label: string;
  before: string;
  after: string;
  changed: boolean;
}

/** Every protected anchor, in display order. */
const FIELDS: Array<{ field: keyof EnvironmentSpecRecord; label: string }> = [
  { field: 'roomType', label: 'Room type' },
  { field: 'layoutFeel', label: 'Layout feel' },
  { field: 'heroAngle', label: 'Hero angle' },
  { field: 'lightingStyle', label: 'Lighting style' },
  { field: 'furnitureAnchors', label: 'Furniture anchors' },
  { field: 'signatureProps', label: 'Signature props' },
  { field: 'paletteMaterials', label: 'Palette & materials' },
  { field: 'productZone', label: 'Product zone' },
  { field: 'continuityNotes', label: 'Continuity notes' },
  { field: 'lockRules', label: 'Lock rules' },
];

export function jsonToText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === 'string' ? item : JSON.stringify(item))).join('\n');
  }
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `${key}: ${typeof item === 'string' ? item : JSON.stringify(item)}`)
      .join('\n');
  }
  return String(value);
}

/** Field-by-field spec differences, unchanged fields included. */
export function diffEnvironmentSpecs(
  before: EnvironmentSpecRecord,
  after: EnvironmentSpecRecord,
): SpecFieldDiff[] {
  return FIELDS.map(({ field, label }) => {
    const beforeText = jsonToText(before[field]);
    const afterText = jsonToText(after[field]);
    return { field: String(field), label, before: beforeText, after: afterText, changed: beforeText !== afterText };
  });
}

export function countSpecChanges(diffs: SpecFieldDiff[]): number {
  return diffs.filter((diff) => diff.changed).length;
}
