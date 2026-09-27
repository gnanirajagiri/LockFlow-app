import { describe, expect, it } from 'vitest';
import {
  RIGHTS_CONFIRMATION_COPY,
  anchorChecks,
  assertEnvironmentLockAllowed,
  incompleteAnchors,
  isEnvironmentLockReady,
} from './envLockReview';
import { countSpecChanges, diffEnvironmentSpecs } from './envDiff';
import type { EnvironmentSpecRecord } from '../../domain/environments';

export function specSample(overrides: Partial<EnvironmentSpecRecord> = {}): EnvironmentSpecRecord {
  return {
    id: 'spec_test',
    environmentVersionId: 'ver_test',
    roomType: 'bedroom creator setup',
    layoutFeel: 'warm, lived-in, clean creator corner',
    heroAngle: 'three-quarter angle facing desk and vanity',
    lightingStyle: 'soft morning window light with warm practical lamp',
    furnitureAnchors: { items: ['bed', 'light oak desk', 'vanity mirror'] },
    signatureProps: { items: ['small plant', 'ceramic mug'] },
    paletteMaterials: { palette: ['cream', 'warm beige', 'oak'] },
    productZone: { area: 'vanity/desk presentation area' },
    continuityNotes: 'Keep the corner composition consistent.',
    lockRules: { immutableAnchors: ['heroAngle', 'lightingStyle'] },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('rule 4 — anchor completeness blocks locking', () => {
  it('reports every required anchor with its state', () => {
    const checks = anchorChecks(specSample());
    expect(checks.map((check) => check.key)).toEqual([
      'roomType',
      'heroAngle',
      'lightingStyle',
      'furnitureAnchors',
      'signatureProps',
      'paletteMaterials',
      'productZone',
    ]);
    expect(checks.every((check) => check.complete)).toBe(true);
    // Product zone is explicitly optional.
    expect(checks.find((check) => check.key === 'productZone')?.required).toBe(false);
  });

  it('flags missing required anchors and keeps the optional one non-blocking', () => {
    const spec = specSample({
      heroAngle: '',
      signatureProps: {},
      productZone: null,
    });
    const missing = incompleteAnchors(spec);
    expect(missing.map((check) => check.key)).toEqual(['heroAngle', 'signatureProps']);
    expect(isEnvironmentLockReady(spec)).toBe(false);
  });

  it('rejects locking with missing anchors even with confirmation + rights', () => {
    const spec = specSample({ lightingStyle: '' });
    expect(() =>
      assertEnvironmentLockAllowed({ status: 'draft' }, spec, {
        confirmed: true,
        rightsAcknowledged: true,
      }),
    ).toThrow(/Complete the required anchors before locking/);
  });

  it('allows locking a complete draft with confirmation + rights', () => {
    expect(() =>
      assertEnvironmentLockAllowed({ status: 'draft' }, specSample(), {
        confirmed: true,
        rightsAcknowledged: true,
      }),
    ).not.toThrow();
  });
});

describe('rule 2 — the lock action requires confirmation and rights acknowledgement', () => {
  it('refuses without explicit confirmation', () => {
    expect(() =>
      assertEnvironmentLockAllowed({ status: 'draft' }, specSample(), {
        confirmed: false,
        rightsAcknowledged: true,
      }),
    ).toThrow(/Lock confirmation is required/);
  });

  it('refuses without the rights acknowledgement', () => {
    expect(() =>
      assertEnvironmentLockAllowed({ status: 'draft' }, specSample(), {
        confirmed: true,
        rightsAcknowledged: false,
      }),
    ).toThrow(/Rights confirmation is required/);
  });

  it('refuses non-draft versions outright', () => {
    expect(() =>
      assertEnvironmentLockAllowed({ status: 'locked' }, specSample(), {
        confirmed: true,
        rightsAcknowledged: true,
      }),
    ).toThrow(/Only draft environment versions can be locked/);
  });

  it('exposes the exact rights copy for the checkbox', () => {
    expect(RIGHTS_CONFIRMATION_COPY).toBe(
      'I have the rights to use uploaded or imported references for this environment.',
    );
  });
});

describe('spec diffing (versions comparison)', () => {
  it('returns every protected anchor including unchanged fields', () => {
    const before = specSample();
    const after = specSample({ heroAngle: 'eye-level angle', lightingStyle: 'evening lamp light' });
    const diffs = diffEnvironmentSpecs(before, after);

    expect(diffs.map((diff) => diff.label)).toEqual([
      'Room type',
      'Layout feel',
      'Hero angle',
      'Lighting style',
      'Furniture anchors',
      'Signature props',
      'Palette & materials',
      'Product zone',
      'Continuity notes',
      'Lock rules',
    ]);
    expect(countSpecChanges(diffs)).toBe(2);
    // Unchanged fields are still present.
    expect(diffs.find((diff) => diff.label === 'Room type')?.changed).toBe(false);
    expect(diffs.find((diff) => diff.label === 'Room type')?.before).toBe('bedroom creator setup');
  });

  it('treats null and missing product zone as equal', () => {
    const before = specSample({ productZone: null });
    const after = specSample({ productZone: null });
    const diffs = diffEnvironmentSpecs(before, after);
    expect(diffs.find((diff) => diff.label === 'Product zone')?.changed).toBe(false);
  });
});
