/**
 * Prompt 26 — Character Sheet domain: protection classification, derived
 * protected-trait rows, reference ordering, active-version selection and
 * generation-time validation. Pure domain tests; service-level lock safety
 * lives in characterSheetVersion.test.ts.
 */
import { describe, expect, it } from 'vitest';
import {
  buildTraitMap,
  classifyTraitKey,
  compareCandidateTraitsToProtectedTraits,
  getCharacterSheetReferencesForGeneration,
  getProtectedIdentityTraits,
  getProtectedTraitKeys,
  protectionLevelOf,
  protectionLevelOfGroup,
  selectActiveIdentityVersion,
  traitMayBeEdited,
  validateModelGenerationAgainstCharacterSheet,
} from '../../domain/models';
import type {
  CharacterSheetRecord,
  ModelReferenceRecord,
  ModelVersionRecord,
} from '../../domain/models';

const SHEET: CharacterSheetRecord = {
  id: 'cs_v1',
  modelVersionId: 'mv_v1',
  identitySummary: 'Warm oval face, defined cheekbones, open confident expression.',
  faceFeatures: { faceShape: 'oval', eyes: 'almond, dark brown' },
  hairIdentity: { colour: 'deep black', texture: 'dense, 3B curls' },
  complexion: { skinTone: 'medium-deep with golden undertone' },
  bodyProportions: { height: '175cm' },
  distinctiveDetails: { marks: 'small mole below the left eye' },
  lockRules: { immutableTraits: ['faceFeatures'], note: 'Identity locks with the version.' },
  referenceNotes: 'Approved for production use.',
  createdAt: '2026-09-20T09:00:00.000Z',
  updatedAt: '2026-09-21T10:00:00.000Z',
};

describe('protection classification', () => {
  it('protects identity and physical/facial groups', () => {
    expect(protectionLevelOfGroup('identity')).toBe('protected');
    expect(protectionLevelOfGroup('faceFeatures')).toBe('protected');
    expect(protectionLevelOfGroup('hairIdentity')).toBe('protected');
    expect(protectionLevelOfGroup('complexion')).toBe('protected');
    expect(protectionLevelOfGroup('bodyProportions')).toBe('protected');
    expect(protectionLevelOfGroup('distinctiveDetails')).toBe('protected');
  });

  it('treats lock rules and reference notes as supporting, not identity', () => {
    expect(protectionLevelOfGroup('lockRules')).toBe('supporting');
    expect(protectionLevelOf('lockRules.note')).toBe('supporting');
    expect(protectionLevelOf('faceFeatures.eyes')).toBe('protected');
    expect(protectionLevelOf('identity.identitySummary')).toBe('protected');
  });

  it('classifies dot-prefixed keys and rejects unknown shapes', () => {
    expect(classifyTraitKey('faceFeatures.eyes')).toBe('faceFeatures');
    expect(classifyTraitKey('distinctiveDetails.marks')).toBe('distinctiveDetails');
    expect(classifyTraitKey('identity.identitySummary')).toBe('identity');
    expect(classifyTraitKey('noGroupKey')).toBeNull();
    expect(classifyTraitKey('unknownGroup.key')).toBeNull();
  });

  it('builds a flattened trait map with group prefixes', () => {
    const map = buildTraitMap(SHEET);
    expect(map['identity.identitySummary']).toBe(SHEET.identitySummary);
    expect(map['faceFeatures.eyes']).toBe('almond, dark brown');
    expect(map['hairIdentity.colour']).toBe('deep black');
    expect(map['lockRules.note']).toBe('Identity locks with the version.');
    expect(map['referenceNotes']).toBeUndefined(); // supporting text stays off the trait map
  });

  it('lists protected trait keys and never lock rules', () => {
    const keys = getProtectedTraitKeys(SHEET);
    expect(keys).toContain('identity.identitySummary');
    expect(keys).toContain('faceFeatures.eyes');
    expect(keys).toContain('distinctiveDetails.marks');
    expect(keys.some((key) => key.startsWith('lockRules.'))).toBe(false);
  });
});

describe('trait edit rules', () => {
  it('refuses every edit on locked and superseded versions', () => {
    for (const status of ['locked', 'superseded'] as const) {
      const result = traitMayBeEdited(status, 'faceFeatures.eyes');
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/draft version/i);
    }
  });

  it('allows draft edits and warns on protected keys', () => {
    const replaceable = traitMayBeEdited('draft', 'lockRules.note');
    expect(replaceable.allowed).toBe(true);
    expect(replaceable.reason).toBeUndefined();

    const protectedEdit = traitMayBeEdited('draft', 'faceFeatures.eyes');
    expect(protectedEdit.allowed).toBe(true);
    expect(protectedEdit.reason).toMatch(/protected identity trait/i);
  });
});

describe('protected identity trait rows', () => {
  it('derives explicit rows from the identity groups', () => {
    const rows = getProtectedIdentityTraits(SHEET);
    const keys = rows.map((row) => row.traitKey);
    expect(keys).toContain('identity.identitySummary');
    expect(keys).toContain('faceFeatures.eyes');
    expect(keys).toContain('hairIdentity.texture');
    expect(keys).toContain('distinctiveDetails.marks');
    expect(rows.every((row) => row.protectionLevel === 'protected')).toBe(true);
    expect(rows.every((row) => row.isEditable === false)).toBe(true);
    expect(rows.every((row) => row.characterSheetId === SHEET.id)).toBe(true);
  });

  it('skips empty values and excludes lock rules', () => {
    const sparse: CharacterSheetRecord = {
      ...SHEET,
      identitySummary: '',
      faceFeatures: {},
      distinctiveDetails: {},
    };
    const rows = getProtectedIdentityTraits(sparse);
    expect(rows.map((row) => row.traitKey)).toEqual([
      'hairIdentity.colour',
      'hairIdentity.texture',
      'complexion.skinTone',
      'bodyProportions.height',
    ]);
  });

  it('uses stable ids derived from the sheet and trait key', () => {
    const [identityRow] = getProtectedIdentityTraits(SHEET);
    expect(identityRow.id).toBe(`${SHEET.id}:identity.identitySummary`);
  });
});

describe('generation references', () => {
  it('orders portrait evidence first and honours sort order ties', () => {
    const ref = (id: string, referenceType: ModelReferenceRecord['referenceType'], sortOrder: number): ModelReferenceRecord => ({
      id,
      modelVersionId: 'mv_v1',
      storagePath: `placeholders/${id}.svg`,
      referenceType,
      caption: id,
      sortOrder,
      createdAt: '2026-09-20T09:00:00.000Z',
      updatedAt: '2026-09-20T09:00:00.000Z',
    });
    const ordered = getCharacterSheetReferencesForGeneration([
      ref('detail-1', 'detail', 0),
      ref('full-1', 'full_body', 1),
      ref('portrait-2', 'portrait', 1),
      ref('portrait-1', 'portrait', 0),
    ]);
    expect(ordered.map((row) => row.id)).toEqual(['portrait-1', 'portrait-2', 'full-1', 'detail-1']);
  });
});

describe('active identity version selection', () => {
  const version = (id: string, versionNumber: number, status: ModelVersionRecord['status']): ModelVersionRecord => ({
    id,
    modelId: 'm1',
    versionNumber,
    status,
    changeSummary: '',
    coverImagePath: null,
    lockedAt: status === 'locked' ? '2026-09-21T10:00:00.000Z' : null,
    createdBy: 'demo-user',
    createdAt: '2026-09-20T09:00:00.000Z',
    updatedAt: '2026-09-21T10:00:00.000Z',
  });

  it('prefers the model active version', () => {
    const versions = [version('v1', 1, 'superseded'), version('v2', 2, 'locked'), version('v3', 3, 'draft')];
    expect(selectActiveIdentityVersion({ activeVersionId: 'v2' }, versions)?.id).toBe('v2');
  });

  it('falls back to the latest locked version, then the newest draft', () => {
    const versions = [version('v1', 1, 'superseded'), version('v2', 2, 'locked'), version('v3', 3, 'draft')];
    expect(selectActiveIdentityVersion({ activeVersionId: null }, versions)?.id).toBe('v2');
    const draftOnly = [version('v1', 1, 'draft')];
    expect(selectActiveIdentityVersion({ activeVersionId: null }, draftOnly)?.id).toBe('v1');
  });

  it('returns null for models without versions', () => {
    expect(selectActiveIdentityVersion({ activeVersionId: null }, [])).toBeNull();
  });
});

describe('generation-time validation', () => {
  it('accepts candidates whose claimed traits match the protected identity', () => {
    const result = validateModelGenerationAgainstCharacterSheet(SHEET, {
      'faceFeatures.eyes': 'almond, dark brown',
      'distinctiveDetails.marks': 'small mole below the left eye',
    });
    expect(result.valid).toBe(true);
    expect(result.mismatches).toEqual([]);
    expect(result.protectedTraitCount).toBe(getProtectedIdentityTraits(SHEET).length);
  });

  it('flags any protected trait that disagrees with the sheet', () => {
    const result = validateModelGenerationAgainstCharacterSheet(SHEET, {
      'faceFeatures.eyes': 'round, green',
    });
    expect(result.valid).toBe(false);
    expect(result.mismatches[0]).toContain('faceFeatures.eyes');
    expect(result.mismatches[0]).toContain('almond, dark brown');
  });

  it('allows partial candidates and ignores non-protected keys', () => {
    const partial = validateModelGenerationAgainstCharacterSheet(SHEET, {
      'faceFeatures.faceShape': 'oval',
      'wardrobe.item': 'beige blazer', // replaceable styling, never identity
    });
    expect(partial.valid).toBe(true);
  });

  it('compares through the shared comparison seam', () => {
    const rows = getProtectedIdentityTraits(SHEET);
    expect(compareCandidateTraitsToProtectedTraits({}, rows).matches).toBe(true);
    expect(
      compareCandidateTraitsToProtectedTraits({ 'complexion.skinTone': 'pale' }, rows).matches,
    ).toBe(false);
  });
});
