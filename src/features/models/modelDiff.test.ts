import { describe, expect, it } from 'vitest';
import { countChanged, diffCharacterSheets } from './modelDiff';
import type { CharacterSheetRecord } from '../../domain/models';

function sheet(overrides: Partial<CharacterSheetRecord> = {}): CharacterSheetRecord {
  return {
    id: 'cs-1',
    modelVersionId: 'v-1',
    identitySummary: 'Warm oval face.',
    faceFeatures: { eyes: 'almond, dark brown' },
    hairIdentity: { colour: 'deep black' },
    complexion: { skinTone: 'medium-deep' },
    bodyProportions: { height: '175cm' },
    distinctiveDetails: { marks: 'mole below left eye' },
    lockRules: { immutableTraits: ['faceFeatures'] },
    referenceNotes: 'Approved.',
    createdAt: '2026-09-20T09:00:00.000Z',
    updatedAt: '2026-09-20T09:00:00.000Z',
    ...overrides,
  };
}

describe('diffCharacterSheets', () => {
  it('reports all eight identity fields, unchanged included', () => {
    const diffs = diffCharacterSheets(sheet(), sheet({ modelVersionId: 'v-2' }));
    expect(diffs.map((d) => d.field)).toEqual([
      'identitySummary',
      'faceFeatures',
      'hairIdentity',
      'complexion',
      'bodyProportions',
      'distinctiveDetails',
      'referenceNotes',
      'lockRules',
    ]);
    expect(diffs.every((d) => !d.changed)).toBe(true);
    expect(countChanged(diffs)).toBe(0);
  });

  it('flags changed fields with both values', () => {
    const diffs = diffCharacterSheets(sheet(), sheet({ hairIdentity: { colour: 'light brown' } }));
    const hair = diffs.find((d) => d.field === 'hairIdentity');
    expect(hair?.changed).toBe(true);
    expect(hair?.before).toContain('deep black');
    expect(hair?.after).toContain('light brown');
    expect(countChanged(diffs)).toBe(1);
  });

  it('renders empty objects and blank strings as em-dashes', () => {
    const diffs = diffCharacterSheets(
      sheet({ identitySummary: '  ', complexion: {} }),
      sheet({ identitySummary: 'A face.', complexion: { skinTone: 'olive' } }),
    );
    const summary = diffs.find((d) => d.field === 'identitySummary');
    expect(summary?.before).toBe('—');
    const complexion = diffs.find((d) => d.field === 'complexion');
    expect(complexion?.before).toBe('—');
    expect(complexion?.after).toBe('skinTone: olive');
  });
});
