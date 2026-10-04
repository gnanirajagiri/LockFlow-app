/**
 * Prompt 26 — Character Sheet version safety through the service layer.
 *
 * Locked versions are immutable (LockedVersionError before any repository
 * touch), drafts are the only identity-edit path, creating a draft from a
 * locked version preserves the original, and the generation-time hooks return
 * the correct protected-trait data inside — and never across — workspaces.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { LockedVersionError } from '../../domain/models';
import type { CharacterSheetRecord, SheetTraits } from '../../domain/models';
import { MockModelsRepository } from '../../data/mockModelsRepository';
import { ModelsService } from '../../services/modelsService';
import { SEED_OTHER_WORKSPACE_ID, SEED_WORKSPACE_ID } from '../../mock/modelsSeed';

const WS = SEED_WORKSPACE_ID;
const OTHER_WS = SEED_OTHER_WORKSPACE_ID;
const USER = 'demo-user';

let repo: MockModelsRepository;
let service: ModelsService;

beforeEach(() => {
  repo = new MockModelsRepository();
  service = new ModelsService(repo);
});

describe('locked versions are immutable', () => {
  it('the service refuses Character Sheet edits on the locked v1', async () => {
    await expect(
      service.updateCharacterSheet('mv_aisha_v1', { identitySummary: 'changed' }, WS),
    ).rejects.toThrow(LockedVersionError);
  });

  it('the mock repository itself also refuses, as defence in depth', async () => {
    await expect(
      repo.updateCharacterSheet('mv_aisha_v1', { identitySummary: 'changed' }),
    ).rejects.toThrow(LockedVersionError);
  });

  it('the locked sheet is byte-identical after a refused edit', async () => {
    const before = await service.getCharacterSheet('mv_aisha_v1', WS);
    await expect(
      service.updateCharacterSheet('mv_aisha_v1', { identitySummary: 'changed' }, WS),
    ).rejects.toThrow(LockedVersionError);
    const after = await service.getCharacterSheet('mv_aisha_v1', WS);
    expect(after).toEqual(before);
  });
});

describe('drafts are the only identity-edit path', () => {
  it('edits the open v2 draft', async () => {
    const saved = await service.updateCharacterSheet(
      'mv_aisha_v2',
      { hairIdentity: { colour: 'deep black with warm undertones', styling: 'softer volume' } },
      WS,
    );
    expect((saved.hairIdentity as SheetTraits).styling).toBe('softer volume');
    // Protected core traits are untouched by the styling-note edit.
    expect((saved.faceFeatures as SheetTraits).eyes).toBe('almond, dark brown, softly arched brows');
  });

  it('refuses Character Sheet edits for cross-workspace callers', async () => {
    await expect(
      service.updateCharacterSheet('mv_aisha_v2', { identitySummary: 'x' }, OTHER_WS),
    ).rejects.toThrow(/Cross-workspace access denied/);
  });
});

describe('a draft created from a locked version preserves the original', () => {
  it('copies identity into the new draft and leaves the locked version untouched', async () => {
    // Fresh model → v1 draft → edit identity → lock → new draft from v1.
    const model = await service.createModel({ workspaceId: WS, name: 'Nova' }, USER);
    const versions = await service.getVersions(model.id, WS);
    expect(versions).toHaveLength(1);

    const identity = {
      identitySummary: 'Square jaw, close-cropped hair, calm expression.',
      faceFeatures: { eyes: 'narrow, dark brown' } as SheetTraits,
    };
    await service.updateCharacterSheet(versions[0].id, identity, WS);
    const locked = await service.lockVersion(versions[0].id, WS);
    expect(locked.status).toBe('locked');

    const draft = await service.createVersion(
      { modelId: model.id, sourceVersionId: locked.id, changeSummary: 'Identity revision' },
      USER,
      WS,
    );
    expect(draft.versionNumber).toBe(2);
    expect(draft.status).toBe('draft');

    const copied = await service.getCharacterSheet(draft.id, WS);
    expect(copied.identitySummary).toBe(identity.identitySummary);
    expect(copied.faceFeatures).toEqual(identity.faceFeatures);

    const original = await service.getCharacterSheet(locked.id, WS);
    expect(original.identitySummary).toBe(identity.identitySummary);
    expect((await service.getVersion(locked.id, WS)).status).toBe('locked');
    // The copy is deep — mutating the draft does not leak into the locked sheet.
    await service.updateCharacterSheet(draft.id, { identitySummary: 'Revised.' }, WS);
    expect((await service.getCharacterSheet(locked.id, WS)).identitySummary).toBe(
      identity.identitySummary,
    );
  });

  it('refuses a second draft while one is already open', async () => {
    // Seed: Aisha already has an open v2 draft.
    await expect(
      service.createVersion(
        { modelId: 'model_aisha', sourceVersionId: 'mv_aisha_v1', changeSummary: 'x' },
        USER,
        WS,
      ),
    ).rejects.toThrow(/draft version already exists/i);
  });
});

describe('generation-time hooks read the active identity', () => {
  it('getActiveCharacterSheet returns the locked active sheet for the seeded model', async () => {
    const sheet = await service.getActiveCharacterSheet('model_aisha', WS);
    expect(sheet).not.toBeNull();
    expect(sheet?.modelVersionId).toBe('mv_aisha_v1'); // model.activeVersionId
  });

  it('getProtectedIdentityTraits returns explicit protected rows', async () => {
    const rows = await service.getProtectedIdentityTraits('model_aisha', WS);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.protectionLevel === 'protected')).toBe(true);
    const keys = rows.map((row) => row.traitKey);
    expect(keys).toContain('identity.identitySummary');
    expect(keys).toContain('faceFeatures.eyes');
    expect(keys.some((key) => key.startsWith('lockRules.'))).toBe(false);
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
  });

  it('validateModelGenerationAgainstCharacterSheet flags mismatched protected traits', async () => {
    const invalid = await service.validateModelGenerationAgainstCharacterSheet(
      'model_aisha',
      { 'faceFeatures.eyes': 'round, green' },
      WS,
    );
    expect(invalid.valid).toBe(false);
    expect(invalid.mismatches[0]).toContain('faceFeatures.eyes');
    expect(invalid.protectedTraitCount).toBeGreaterThan(0);

    const rows = await service.getProtectedIdentityTraits('model_aisha', WS);
    const candidate = Object.fromEntries(rows.map((row) => [row.traitKey, row.traitValue]));
    const valid = await service.validateModelGenerationAgainstCharacterSheet(
      'model_aisha',
      candidate,
      WS,
    );
    expect(valid.valid).toBe(true);
  });

  it('getCharacterSheetReferencesForGeneration orders portrait evidence first', async () => {
    const references = await service.getCharacterSheetReferencesForGeneration('model_aisha', WS);
    expect(references.length).toBeGreaterThan(0);
    expect(references[0].referenceType).toBe('portrait');
  });

  it('models with an untouched first draft expose an empty but present sheet', async () => {
    const model = await service.createModel({ workspaceId: WS, name: 'Empty Sheet' }, USER);
    const sheet: CharacterSheetRecord | null = await service.getActiveCharacterSheet(model.id, WS);
    expect(sheet).not.toBeNull(); // first draft is born with an empty sheet
    expect(sheet?.identitySummary).toBe('');
    expect(await service.getProtectedIdentityTraits(model.id, WS)).toEqual([]);
  });
});

describe('workspace scoping', () => {
  it('cross-workspace reads are refused at the service boundary', async () => {
    await expect(service.getModel('model_aisha', OTHER_WS)).rejects.toThrow(/Cross-workspace access denied/);
    await expect(service.getCharacterSheet('mv_aisha_v1', OTHER_WS)).rejects.toThrow(/Cross-workspace access denied/);
    await expect(service.getActiveCharacterSheet('model_aisha', OTHER_WS)).rejects.toThrow(
      /Cross-workspace access denied/,
    );
  });

  it('other-workspace models never leak into demo listings', async () => {
    const otherModels = await service.listModels(OTHER_WS);
    expect(otherModels.some((model) => model.id === 'model_aisha')).toBe(false);
  });
});

describe('no sensitive storage data on identity views', () => {
  it('trait rows carry no storage internals', async () => {
    const rows = await service.getProtectedIdentityTraits('model_aisha', WS);
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toMatch(/signed|signature|token|X-Amz|storagePath|storageBucket/i);
  });

  it('generation references expose metadata only — no signed URLs', async () => {
    const references = await service.getCharacterSheetReferencesForGeneration('model_aisha', WS);
    const serialized = JSON.stringify(references);
    expect(serialized).not.toMatch(/signed|signature|token|X-Amz/i);
  });
});
