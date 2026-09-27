import { describe, expect, it } from 'vitest';
import {
  LockedEnvironmentVersionError,
  canTransitionEnvironmentVersion,
  copyEnvironmentSpec,
  nextVersionNumber,
  refuseEnvironmentLocked,
} from './guards';
import { isEnvironmentLockLevel, validateUpdateEnvironmentSpec } from './schemas';
import type { EnvironmentSpecRecord, EnvironmentVersionRecord } from './types';

function version(status: EnvironmentVersionRecord['status']): Pick<EnvironmentVersionRecord, 'id' | 'status'> {
  return { id: 'ver_test', status };
}

function specSample(): EnvironmentSpecRecord {
  return {
    id: 'spec_1',
    environmentVersionId: 'ver_1',
    roomType: 'bedroom creator setup',
    layoutFeel: 'warm, lived-in',
    heroAngle: 'three-quarter',
    lightingStyle: 'morning window light',
    furnitureAnchors: { items: ['bed', 'desk'] },
    signatureProps: { items: ['plant'] },
    paletteMaterials: { palette: ['cream', 'oak'] },
    productZone: { area: 'vanity' },
    continuityNotes: 'keep the corner composition',
    lockRules: { immutableAnchors: ['heroAngle'] },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('environment version guards', () => {
  it('refuses edits to locked environment versions', () => {
    expect(() => refuseEnvironmentLocked(version('locked'))).toThrow(LockedEnvironmentVersionError);
    expect(() => refuseEnvironmentLocked(version('locked'))).toThrow(/locked and cannot be edited/);
  });

  it('allows draft and superseded-status reads through the guard (drafts are editable)', () => {
    expect(() => refuseEnvironmentLocked(version('draft'))).not.toThrow();
  });

  it('increments version numbers safely from any history', () => {
    expect(nextVersionNumber([])).toBe(1);
    expect(nextVersionNumber([1])).toBe(2);
    expect(nextVersionNumber([1, 2, 5])).toBe(6);
  });

  it('permits only the sanctioned lifecycle transitions', () => {
    expect(canTransitionEnvironmentVersion('draft', 'locked')).toBe(true);
    expect(canTransitionEnvironmentVersion('locked', 'superseded')).toBe(true); // lock RPC only
    expect(canTransitionEnvironmentVersion('locked', 'draft')).toBe(false);
    expect(canTransitionEnvironmentVersion('superseded', 'draft')).toBe(false);
    expect(canTransitionEnvironmentVersion('superseded', 'locked')).toBe(false);
  });
});

describe('environment spec copying', () => {
  it('copies every defining anchor to the target version without mutating the source', () => {
    const source = specSample();
    const snapshot = structuredClone(source);

    const copy = copyEnvironmentSpec(source, 'ver_2');

    expect(copy.environmentVersionId).toBe('ver_2');
    expect(copy.roomType).toBe(source.roomType);
    expect(copy.heroAngle).toBe(source.heroAngle);
    expect(copy.furnitureAnchors).toEqual(source.furnitureAnchors);
    expect(copy.productZone).toEqual(source.productZone);

    // Mutating the copy's JSON must not affect the source.
    (copy.furnitureAnchors.items as string[]).push('shelf');
    expect(source).toEqual(snapshot);
  });

  it('keeps productZone null when the source has none', () => {
    const source = { ...specSample(), productZone: null };
    const copy = copyEnvironmentSpec(source, 'ver_2');
    expect(copy.productZone).toBeNull();
  });
});

describe('environment schemas', () => {
  it('rejects non-object JSON anchor payloads', () => {
    const result = validateUpdateEnvironmentSpec({ furnitureAnchors: ['bed'] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatch(/furnitureAnchors must be a JSON object/);
  });

  it('accepts productZone as object or null only', () => {
    expect(validateUpdateEnvironmentSpec({ productZone: null }).ok).toBe(true);
    expect(validateUpdateEnvironmentSpec({ productZone: { area: 'desk' } }).ok).toBe(true);
    const bad = validateUpdateEnvironmentSpec({ productZone: 'vanity' });
    expect(bad.ok).toBe(false);
  });

  it('validates lock-level vocabulary', () => {
    expect(isEnvironmentLockLevel('balanced')).toBe(true);
    expect(isEnvironmentLockLevel('ultra')).toBe(false);
  });
});
