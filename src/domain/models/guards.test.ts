import { describe, expect, it } from 'vitest';
import {
  LockedVersionError,
  canTransition,
  copyCharacterSheet,
  isInWorkspace,
  isInWorkspaceStrict,
  nextVersionNumber,
  refuseIfLocked,
} from './guards';
import { validateCreateModel, validateUpdateCharacterSheet } from './schemas';
import type { CharacterSheetRecord, ModelVersionRecord } from './types';

const lockedVersion: ModelVersionRecord = {
  id: 'v1',
  modelId: 'm1',
  versionNumber: 1,
  status: 'locked',
  changeSummary: 'Original approved identity',
  coverImagePath: null,
  lockedAt: '2026-09-21T10:00:00.000Z',
  createdBy: 'user1',
  createdAt: '2026-09-20T09:00:00.000Z',
  updatedAt: '2026-09-21T10:00:00.000Z',
};

const draftVersion: ModelVersionRecord = { ...lockedVersion, id: 'v2', versionNumber: 2, status: 'draft', lockedAt: null };

describe('rule 3 — locked versions cannot be edited', () => {
  it('refuses edits to a locked version', () => {
    expect(() => refuseIfLocked(lockedVersion)).toThrow(LockedVersionError);
  });

  it('allows edits to a draft version', () => {
    expect(() => refuseIfLocked(draftVersion)).not.toThrow();
  });

  it('LockedVersionError identifies the offending version', () => {
    try {
      refuseIfLocked(lockedVersion);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(LockedVersionError);
      expect((err as LockedVersionError).message).toContain('v1');
    }
  });

  it('a locked version has no legal outgoing transitions', () => {
    expect(canTransition('locked', 'draft')).toBe(false);
    expect(canTransition('locked', 'superseded')).toBe(false);
    expect(canTransition('locked', 'locked')).toBe(false);
    expect(canTransition('draft', 'locked')).toBe(true);
  });
});

describe('rule 3 — version numbering increments correctly', () => {
  it('starts at 1 for a model with no versions', () => {
    expect(nextVersionNumber([])).toBe(1);
  });

  it('increments by 1 from the highest existing number', () => {
    expect(nextVersionNumber([1])).toBe(2);
    expect(nextVersionNumber([1, 2, 3])).toBe(4);
  });

  it('survives gaps and unordered input', () => {
    expect(nextVersionNumber([3, 1, 7])).toBe(8);
  });
});

describe('rule 3 — a new draft copies the chosen Character Sheet', () => {
  const source: CharacterSheetRecord = {
    id: 'cs-src',
    modelVersionId: 'v1',
    identitySummary: 'Warm oval face, defined cheekbones.',
    faceFeatures: { eyes: 'almond, dark brown' },
    hairIdentity: { colour: 'deep black' },
    complexion: { skinTone: 'medium-deep, golden undertone' },
    bodyProportions: { height: '175cm' },
    distinctiveDetails: { marks: 'mole below left eye' },
    lockRules: { immutableTraits: ['faceFeatures'] },
    referenceNotes: 'Approved for production.',
    createdAt: '2026-09-20T09:00:00.000Z',
    updatedAt: '2026-09-21T10:00:00.000Z',
  };

  it('copies all identity fields to the new version', () => {
    const copy = copyCharacterSheet(source, 'v-new');
    expect(copy.modelVersionId).toBe('v-new');
    expect(copy.identitySummary).toBe(source.identitySummary);
    expect(copy.faceFeatures).toEqual(source.faceFeatures);
    expect(copy.hairIdentity).toEqual(source.hairIdentity);
    expect(copy.complexion).toEqual(source.complexion);
    expect(copy.bodyProportions).toEqual(source.bodyProportions);
    expect(copy.distinctiveDetails).toEqual(source.distinctiveDetails);
    expect(copy.lockRules).toEqual(source.lockRules);
    expect(copy.referenceNotes).toBe(source.referenceNotes);
  });

  it('deep-clones structured traits (no shared references)', () => {
    const copy = copyCharacterSheet(source, 'v-new');
    copy.faceFeatures.eyes = 'changed';
    expect(source.faceFeatures.eyes).toBe('almond, dark brown');
  });
});

describe('rule 1/4 — workspace isolation', () => {
  it('accepts same-workspace records', () => {
    expect(isInWorkspace('ws-1', 'ws-1')).toBe(true);
    expect(() => isInWorkspaceStrict('ws-1', 'ws-1')).not.toThrow();
  });

  it('refuses cross-workspace access', () => {
    expect(isInWorkspace('ws-2', 'ws-1')).toBe(false);
    expect(() => isInWorkspaceStrict('ws-2', 'ws-1')).toThrow(/Cross-workspace access denied/);
  });
});

describe('validation schemas', () => {
  it('accepts a valid create-model payload', () => {
    const result = validateCreateModel({ workspaceId: 'ws-1', name: 'Aisha' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.slug).toBe('aisha');
  });

  it('rejects invalid slugs and empty names', () => {
    const result = validateCreateModel({ workspaceId: 'ws-1', name: '', slug: 'Bad Slug!' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThan(0);
  });

  it('requires at least one field in a sheet update', () => {
    expect(validateUpdateCharacterSheet({}).ok).toBe(false);
    expect(validateUpdateCharacterSheet({ identitySummary: 'x' }).ok).toBe(true);
  });

  it('rejects non-object trait payloads', () => {
    const result = validateUpdateCharacterSheet({ faceFeatures: 'oval face' });
    expect(result.ok).toBe(false);
  });
});
