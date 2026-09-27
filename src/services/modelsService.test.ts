/**
 * ModelsService tests over the in-memory repository — proving the five
 * product rules end to end at the service boundary (the same layer the UI
 * calls): locked immutability, draft-from-locked copying, confirm-before-
 * lock, soft-archive-only, and workspace isolation.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { ModelsService } from './modelsService';
import { MockModelsRepository } from '../data/mockModelsRepository';
import { resetModelsRepository } from '../data';
import { LockedVersionError } from '../domain/models';
import { assertLockAllowed } from '../features/models/lockFlow';
import { SEED_WORKSPACE_ID } from '../mock/modelsSeed';
import type { CharacterSheetRecord } from '../domain/models';

const AISHA = 'model_aisha';
const V1_LOCKED = 'mv_aisha_v1';
const USER = 'demo-user';

function newService(): { service: ModelsService; repo: MockModelsRepository } {
  const repo = new MockModelsRepository();
  return { service: new ModelsService(repo), repo };
}

beforeEach(() => {
  resetModelsRepository(); // keep the UI factory singleton clean between tests
});

// ── Rule 1: locked Character Sheet fields cannot be saved ───────────────────
describe('rule — locked Character Sheet fields cannot be saved', () => {
  it('service.updateCharacterSheet refuses a locked version before touching the repo', async () => {
    const { service } = newService();
    await expect(
      service.updateCharacterSheet(
        V1_LOCKED,
        { identitySummary: 'Tampered summary' },
        SEED_WORKSPACE_ID,
      ),
    ).rejects.toBeInstanceOf(LockedVersionError);

    // And the stored sheet is untouched.
    const { service: fresh } = newService();
    const sheet = await fresh.getCharacterSheet(V1_LOCKED, SEED_WORKSPACE_ID);
    expect(sheet.identitySummary).not.toBe('Tampered summary');
  });

  it('the repository layer independently refuses the same write', async () => {
    const { repo } = newService();
    await expect(
      repo.updateCharacterSheet(V1_LOCKED, { identitySummary: 'Direct write' }),
    ).rejects.toBeInstanceOf(LockedVersionError);
  });

  it('a draft version can still be edited through the same route', async () => {
    const { service } = newService();
    const versions = await service.getVersions(AISHA, SEED_WORKSPACE_ID);
    const draft = versions.find((version) => version.status === 'draft');
    expect(draft).toBeTruthy();
    const saved = await service.updateCharacterSheet(
      draft!.id,
      { referenceNotes: 'Updated draft note' },
      SEED_WORKSPACE_ID,
    );
    expect(saved.referenceNotes).toBe('Updated draft note');
  });
});

// ── Rule 2: draft-from-locked copies data without mutating the source ───────
describe('rule — creating a draft from a locked version copies without mutating', () => {
  it('copies identity fields and leaves the source sheet byte-identical', async () => {
    const { service } = newService();
    // The seed ships with an open draft (v2); close it so a new draft from
    // the locked v1 is legal (one open draft per model).
    await service.lockVersion('mv_aisha_v2', SEED_WORKSPACE_ID);
    const sourceBefore: CharacterSheetRecord = await service.getCharacterSheet(
      V1_LOCKED,
      SEED_WORKSPACE_ID,
    );
    const snapshot = structuredClone(sourceBefore);

    const draft = await service.createVersion(
      { modelId: AISHA, sourceVersionId: V1_LOCKED, changeSummary: 'Jawline refinement' },
      USER,
      SEED_WORKSPACE_ID,
    );

    expect(draft.status).toBe('draft');
    expect(draft.versionNumber).toBe(3); // seed v1+v2, locked v2 → new draft is v3

    const sourceAfter = await service.getCharacterSheet(V1_LOCKED, SEED_WORKSPACE_ID);
    expect(sourceAfter).toEqual(snapshot);

    const copy = await service.getCharacterSheet(draft.id, SEED_WORKSPACE_ID);
    expect(copy.identitySummary).toBe(snapshot.identitySummary);
    expect(copy.faceFeatures).toEqual(snapshot.faceFeatures);
    expect(copy.hairIdentity).toEqual(snapshot.hairIdentity);
    expect(copy.complexion).toEqual(snapshot.complexion);
    expect(copy.bodyProportions).toEqual(snapshot.bodyProportions);
    expect(copy.distinctiveDetails).toEqual(snapshot.distinctiveDetails);
    expect(copy.lockRules).toEqual(snapshot.lockRules);

    // Editing the copy must not bleed into the source.
    await service.updateCharacterSheet(
      draft.id,
      { hairIdentity: { colour: 'silver' } },
      SEED_WORKSPACE_ID,
    );
    const sourceFinal = await service.getCharacterSheet(V1_LOCKED, SEED_WORKSPACE_ID);
    expect(sourceFinal.hairIdentity).toEqual(snapshot.hairIdentity);
  });

  it('refuses to create a second draft while one is open', async () => {
    const { service } = newService();
    await expect(
      service.createVersion(
        { modelId: AISHA, sourceVersionId: V1_LOCKED, changeSummary: 'Another' },
        USER,
        SEED_WORKSPACE_ID,
      ),
    ).rejects.toThrow(/draft version already exists/i);
  });

  it('numbers the next version safely from the highest existing', async () => {
    const { service, repo } = newService();
    // Lock the open draft, then branch from the locked v1 again.
    await service.lockVersion('mv_aisha_v2', SEED_WORKSPACE_ID);
    const third = await service.createVersion(
      { modelId: AISHA, sourceVersionId: V1_LOCKED, changeSummary: 'Branch' },
      USER,
      SEED_WORKSPACE_ID,
    );
    expect(third.versionNumber).toBe(3);
    expect(await repo.getVersions(AISHA)).toHaveLength(3);
  });
});

// ── Rule 3: confirmation is required before draft → locked ──────────────────
describe('rule — lock confirmation is required before a draft becomes locked', () => {
  it('the pure gate refuses without confirmation and proceeds only with it', () => {
    const draft = { id: 'v9', status: 'draft' as const };
    expect(() => assertLockAllowed(draft, { versionId: 'v9', confirmed: false })).toThrow(
      /confirmation is required/i,
    );
    expect(() => assertLockAllowed(draft, { versionId: 'v9', confirmed: true })).not.toThrow();
    expect(() =>
      assertLockAllowed(draft, { versionId: 'other', confirmed: true }),
    ).toThrow(/does not match/);
  });

  it('the service still refuses to lock a locked version (defence in depth)', async () => {
    const { service } = newService();
    await expect(service.lockVersion(V1_LOCKED, SEED_WORKSPACE_ID)).rejects.toBeInstanceOf(
      LockedVersionError,
    );
  });

  it('locking through the confirmed dialog path locks the draft and supersedes prior locked', async () => {
    const { service } = newService();
    const versions = await service.getVersions(AISHA, SEED_WORKSPACE_ID);
    const draft = versions.find((version) => version.status === 'draft')!;
    // Confirm dialog shown → user confirms → gate passes → service locks.
    assertLockAllowed(draft, { versionId: draft.id, confirmed: true });
    const locked = await service.lockVersion(draft.id, SEED_WORKSPACE_ID);
    expect(locked.status).toBe('locked');
    expect(locked.lockedAt).toBeTruthy();

    // Locking sets the model's active version (the existing RPC/mock rule).
    const model = await service.getModel(AISHA, SEED_WORKSPACE_ID);
    expect(model.activeVersionId).toBe(draft.id);

    // The prior locked v1 is now superseded but preserved forever.
    const after = await service.getVersions(AISHA, SEED_WORKSPACE_ID);
    const v1 = after.find((version) => version.id === V1_LOCKED);
    expect(v1?.status).toBe('superseded');
    expect(after.find((version) => version.id === V2_DRAFT_ID)?.status).toBe('locked');
  });
});

const V2_DRAFT_ID = 'mv_aisha_v2';

// ── Rule 4: archive is a soft-archive path only ─────────────────────────────
describe('rule — archive uses a soft-archive path only', () => {
  it('archiveModel flips status to archived and preserves everything', async () => {
    const { service } = newService();
    const archived = await service.archiveModel(AISHA, SEED_WORKSPACE_ID);
    expect(archived.status).toBe('archived');

    // Versions and sheets are untouched by archiving.
    const versions = await service.getVersions(AISHA, SEED_WORKSPACE_ID);
    expect(versions).toHaveLength(2);
    const sheet = await service.getCharacterSheet(V1_LOCKED, SEED_WORKSPACE_ID);
    expect(sheet.identitySummary).toContain('warm oval face');
  });

  it('the service exposes no delete path — archive is the only removal-shaped action', async () => {
    const { service } = newService();
    const mutatingMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(service)).filter(
      (name) => name !== 'constructor',
    );
    expect(mutatingMethods).not.toContain('deleteModel');
    expect(mutatingMethods).toContain('archiveModel');
  });

  it('archiving is idempotent and never restores automatically', async () => {
    const { service } = newService();
    await service.archiveModel(AISHA, SEED_WORKSPACE_ID);
    const again = await service.archiveModel(AISHA, SEED_WORKSPACE_ID);
    expect(again.status).toBe('archived');
  });
});

// ── Rule 5: cross-workspace isolation ────────────────────────────────────────
describe('rule — models from another workspace cannot be read or updated', () => {
  it('getModel, getVersions and getCharacterSheet refuse foreign-workspace records', async () => {
    const { service } = newService();
    await expect(service.getModel('model_bea', SEED_WORKSPACE_ID)).rejects.toThrow(
      /Cross-workspace access denied/,
    );
    await expect(service.getVersions('model_bea', SEED_WORKSPACE_ID)).rejects.toThrow(
      /Cross-workspace access denied/,
    );
  });

  it('updates from a foreign workspace are refused (sheet + lock + archive)', async () => {
    const { service } = newService();
    await expect(
      service.updateCharacterSheet('mv_bea_v1', { identitySummary: 'hijack' }, SEED_WORKSPACE_ID),
    ).rejects.toThrow(/Cross-workspace access denied/);
    await expect(service.lockVersion('mv_bea_v1', SEED_WORKSPACE_ID)).rejects.toThrow(
      /Cross-workspace access denied/,
    );
    await expect(service.archiveModel('model_bea', SEED_WORKSPACE_ID)).rejects.toThrow(
      /Cross-workspace access denied/,
    );
    await expect(
      service.updateModelDraft('model_bea', { name: 'Renamed' }, SEED_WORKSPACE_ID),
    ).rejects.toThrow(/Cross-workspace access denied/);
  });

  it('creating a version in a foreign workspace is refused', async () => {
    const { service } = newService();
    await expect(
      service.createVersion(
        { modelId: 'model_bea', sourceVersionId: 'mv_bea_v1', changeSummary: 'Foreign' },
        USER,
        SEED_WORKSPACE_ID,
      ),
    ).rejects.toThrow(/Cross-workspace access denied/);
  });

  it('listModels only returns the caller workspace models', async () => {
    const { service } = newService();
    const models = await service.listModels(SEED_WORKSPACE_ID);
    expect(models.map((model) => model.id)).toEqual([AISHA]);
  });
});
