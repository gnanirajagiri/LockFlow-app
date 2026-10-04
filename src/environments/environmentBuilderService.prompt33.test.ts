/**
 * Prompt 33 — Environment Builder completion: reference import, reusable
 * layout, camera views, lock-and-save. Service-boundary tests over the
 * existing MockEnvironmentsRepository (the adapter the app runs on):
 *
 *   1. Locked environment versions are immutable; changes create new drafts.
 *   2. Environments stay independent from models (no model coupling anywhere).
 *   3. Attached props/assets are explicit, inspectable and reversible.
 *   4. Camera/view data is environment-specific staging metadata.
 *   5. Lock readiness blocks incomplete specs/coverage; lock-and-save
 *      captures a snapshot through the existing guards.
 *   6. Cross-workspace access is rejected; the audit trail is safe.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { EnvironmentsService } from '../services/environmentsService';
import { MockEnvironmentsRepository } from '../data/mockEnvironmentsRepository';
import { LibraryService } from '../services/libraryService';
import { getLibraryRepository } from '../data/libraryFactory';
import {
  EnvironmentBuilderService,
  InMemoryEnvironmentBuilderAuditStore,
  InMemoryEnvironmentCameraViewStore,
  InMemoryEnvironmentAssetLinkStore,
} from './environmentBuilderService';
import {
  ENVIRONMENT_COVERAGE_SLOTS,
  evaluateEnvironmentReferenceCoverage,
  roleForEnvironmentReference,
} from './environmentBuilderWorkflow';

const WS = 'ws_demo';
const OTHER_WS = 'ws_other';
const USER = 'env-builder-user';

/** Full builder stack per test (fresh mock repo + stores). */
function makeBuilder() {
  const repo = new MockEnvironmentsRepository();
  const environments = new EnvironmentsService(repo);
  const audit = new InMemoryEnvironmentBuilderAuditStore();
  const cameraViews = new InMemoryEnvironmentCameraViewStore();
  const assetLinks = new InMemoryEnvironmentAssetLinkStore();
  const library = new LibraryService(getLibraryRepository());
  const deps = {
    getLibraryAsset: async (assetId: string, workspaceId: string) => {
      const asset = await library.getAsset(assetId, workspaceId);
      return { id: asset.id, workspaceId, name: asset.name, storagePath: asset.coverImagePath };
    },
  };
  const builder = new EnvironmentBuilderService(
    environments, repo, deps, audit, cameraViews, assetLinks,
  );
  return { builder, environments, repo, audit, cameraViews, assetLinks, library };
}

/** Fills the spec anchors + required coverage so a version can lock. */
async function makeLockable(stack: ReturnType<typeof makeBuilder>, versionId: string) {
  await stack.environments.updateSpec(
    versionId,
    {
      roomType: 'Sunlit studio loft',
      layoutFeel: 'Open, airy, minimal',
      heroAngle: 'Wide from the north window',
      lightingStyle: 'Soft morning daylight',
    },
    WS,
  );
  for (const role of ['primary_environment', 'layout', 'lighting_mood'] as const) {
    await stack.builder.attachEnvironmentReference(WS, versionId, {
      role,
      source: { kind: 'upload', storagePath: `environments/refs/${role}.png` },
    }, USER);
  }
}

describe('reference roles and coverage (pure)', () => {
  it('maps roles, honors caption tags and computes coverage honestly', () => {
    const refs = [
      { id: 'r1', caption: '[envbuilder:primary_environment] Wide', referenceType: 'other' },
      { id: 'r2', caption: '[envbuilder:layout] Floor plan', referenceType: 'other' },
      { id: 'r3', caption: '[envbuilder:lighting_mood] Golden hour', referenceType: 'other' },
    ] as Array<{ id: string; caption: string; referenceType: 'wide' | 'hero_angle' | 'detail' | 'layout' | 'lighting' | 'product_zone' | 'other' }>;

    expect(roleForEnvironmentReference(refs[0])).toBe('primary_environment');
    expect(roleForEnvironmentReference(refs[2])).toBe('lighting_mood');

    // Untagged rows fall back to the existing reference-type mapping.
    expect(roleForEnvironmentReference({ caption: 'plain', referenceType: 'hero_angle' })).toBe('camera_view');
    expect(roleForEnvironmentReference({ caption: 'plain', referenceType: 'layout' })).toBe('layout');

    const report = evaluateEnvironmentReferenceCoverage(refs);
    expect(report.missingRequired).toHaveLength(0);
    expect(report.referenceCompleteness).toBe('core_complete');
    expect(report.missingRequired).toEqual([]);
    expect(report.missingOptional).toContain('Material / color');
    expect(ENVIRONMENT_COVERAGE_SLOTS.filter((slot) => slot.required)).toHaveLength(3);
  });
});

describe('environment draft workflow', () => {
  let stack: ReturnType<typeof makeBuilder>;
  beforeEach(() => { stack = makeBuilder(); });

  it('creates a draft, imports labeled references and attaches reversible assets', async () => {
    const { builder, assetLinks, library } = stack;
    const { environment, version } = await builder.createEnvironmentDraft(WS, { name: 'Loft' }, USER);
    expect(version.status).toBe('draft');

    const view = await builder.attachEnvironmentReference(WS, version.id, {
      role: 'primary_environment',
      source: { kind: 'upload', storagePath: 'environments/refs/wide.png' },
    }, USER);
    expect(view.role).toBe('primary_environment');
    expect(view.defining).toBe(true);

    // Attach a real Library asset as an environment prop (pointer only).
    const assets = await library.listAssets(WS);
    expect(assets.length).toBeGreaterThan(0);
    const asset = assets[0]!;
    const link = await builder.attachEnvironmentAsset(WS, version.id, {
      libraryAssetId: asset.id,
      category: 'prop',
    }, USER);
    expect(link.libraryAssetId).toBe(asset.id);
    expect((await assetLinks.list(version.id)).some((row) => row.id === link.id)).toBe(true);
    // Reversible: removing detaches the pointer; the Library is unchanged.
    await builder.removeEnvironmentAsset(WS, version.id, link.id);
    expect((await assetLinks.list(version.id)).find((row) => row.id === link.id)).toBeUndefined();
    // Re-attach and leave it in place for the snapshot path.
    await builder.attachEnvironmentAsset(WS, version.id, { libraryAssetId: asset.id, category: 'prop' }, USER);

    const coverage = await builder.validateEnvironmentReferenceCoverage(WS, version.id);
    expect(coverage.slots.find((slot) => slot.key === 'primary_environment')?.filled).toBe(true);

    const events = (await stack.audit.list(WS)).map((row) => row.event);
    expect(events).toContain('environment_draft_created');
    expect(events).toContain('environment_reference_added');
    expect(events).toContain('environment_asset_attached');
    expect(environment.id).toBeTruthy();
  });

  it('blocks lock readiness until spec anchors and coverage are complete', async () => {
    const { builder } = stack;
    const { version } = await builder.createEnvironmentDraft(WS, { name: 'Loft' }, USER);

    const early = await builder.validateEnvironmentReadinessForLock(WS, version.id);
    expect(early.ok).toBe(false);
    expect(early.blockers.join(' ')).toMatch(/environment definition is incomplete/i);
    expect(early.blockers.join(' ')).toMatch(/Primary environment/);
    expect(early.readiness).toBe('spec_incomplete');

    await makeLockable(stack, version.id);
    const ready = await builder.validateEnvironmentReadinessForLock(WS, version.id);
    expect(ready.ok).toBe(true);
    expect(ready.readiness).toBe('ready_to_lock');
  });

  it('saves environment-specific camera views with movement metadata', async () => {
    const { builder, cameraViews } = stack;
    const { version } = await builder.createEnvironmentDraft(WS, { name: 'Loft' }, USER);

    const saved = await builder.saveEnvironmentCameraView(WS, version.id, {
      name: 'Hero north window',
      angle: 'Eye level, wide, from the north window',
      movement: 'dolly_in',
      configuration: { framing: 'full room', notes: 'Keep the product zone in frame' },
    }, USER);
    expect(saved.movement).toBe('dolly_in');

    await expect(
      builder.saveEnvironmentCameraView(WS, version.id, { name: '   ' }, USER),
    ).rejects.toThrow(/name/i);

    const views = await cameraViews.list(version.id);
    expect(views).toHaveLength(1);
    expect(views[0]?.name).toBe('Hero north window');

    const events = (await stack.audit.list(WS)).map((row) => row.event);
    expect(events).toContain('environment_camera_view_saved');
  });

  it('lock-and-save captures a snapshot and locked versions are immutable', async () => {
    const { builder } = stack;
    const { version } = await builder.createEnvironmentDraft(WS, { name: 'Loft' }, USER);
    await makeLockable(stack, version.id);
    await builder.saveEnvironmentCameraView(WS, version.id, { name: 'Hero', movement: 'static' }, USER);

    const { version: locked, snapshot } = await builder.lockAndSaveEnvironmentVersion(WS, version.id, USER);
    expect(locked.status).toBe('locked');
    expect(snapshot.versionNumber).toBe(1);
    expect(snapshot.spec?.roomType).toBe('Sunlit studio loft');
    expect(snapshot.coverageSummary.requiredFilled).toBe(3);
    expect(snapshot.cameraViews).toHaveLength(1);
    expect(JSON.stringify(snapshot)).not.toContain('environments/refs/'); // no storage paths

    // Immutable: references, assets, spec and re-locking all refuse.
    await expect(
      builder.attachEnvironmentReference(WS, locked.id, {
        role: 'supporting_inspiration',
        source: { kind: 'upload', storagePath: 'environments/refs/x.png' },
      }, USER),
    ).rejects.toThrow(/draft/i);
    await expect(
      builder.attachEnvironmentAsset(WS, locked.id, { libraryAssetId: 'a1', category: 'prop' }, USER),
    ).rejects.toThrow(/draft/i);
    await expect(
      stack.environments.updateSpec(locked.id, { roomType: 'Changed' }, WS),
    ).rejects.toThrow();
    await expect(
      stack.environments.lockVersion(locked.id, WS),
    ).rejects.toThrow();

    const events = (await stack.audit.list(WS)).map((row) => row.event);
    expect(events).toContain('environment_version_locked');

    // A blocked lock attempt on an unready draft is audited honestly.
    const { version: unready } = await builder.createEnvironmentDraft(WS, { name: 'Blocked Loft' }, USER);
    await expect(builder.lockAndSaveEnvironmentVersion(WS, unready.id, USER)).rejects.toThrow(/Cannot lock yet/);
    const blockedEvents = (await stack.audit.list(WS)).map((row) => row.event);
    expect(blockedEvents).toContain('environment_lock_blocked');
  });

  it('creates a safe draft from a locked version; the original stays locked', async () => {
    const { builder } = stack;
    const { version } = await builder.createEnvironmentDraft(WS, { name: 'Loft' }, USER);
    await makeLockable(stack, version.id);
    const { version: locked, snapshot } = await builder.lockAndSaveEnvironmentVersion(WS, version.id, USER);

    const draft = await builder.createEnvironmentDraftFromLockedVersion(WS, locked.id, USER, 'Repaint walls');
    expect(draft.status).toBe('draft');
    expect(draft.versionNumber).toBe(2);

    // Original untouched: same locked state, same spec content.
    expect((await stack.environments.getVersion(locked.id, WS)).status).toBe('locked');
    const sourceSpec = await stack.repo.getSpec(locked.id);
    expect(sourceSpec.roomType).toBe(snapshot.spec?.roomType);

    // Styling change on the new draft (new paint) leaves the locked spec alone.
    await stack.environments.updateSpec(draft.id, { paletteMaterials: { walls: 'sage green' } }, WS);
    expect((await stack.repo.getSpec(locked.id)).paletteMaterials).toEqual(snapshot.spec?.paletteMaterials);

    const events = (await stack.audit.list(WS)).map((row) => row.event);
    expect(events).toContain('environment_draft_created_from_locked_version');
  });

  it('keeps environments independent from models', async () => {
    const { builder } = stack;
    const { version } = await builder.createEnvironmentDraft(WS, { name: 'Loft' }, USER);
    const view = await builder.getEnvironmentBuilderView(WS, version.id);
    // No model coupling anywhere in the builder view or snapshot shape.
    const serialized = JSON.stringify(view);
    expect(serialized).not.toMatch(/modelId|model_id|characterSheet/i);
  });
});

describe('workspace security', () => {
  let stack: ReturnType<typeof makeBuilder>;
  beforeEach(() => { stack = makeBuilder(); });

  it('rejects cross-workspace reads, edits and lock paths', async () => {
    const { builder } = stack;
    const { version } = await builder.createEnvironmentDraft(WS, { name: 'Loft' }, USER);

    await expect(builder.getEnvironmentBuilderView(OTHER_WS, version.id)).rejects.toThrow();
    await expect(
      builder.attachEnvironmentReference(OTHER_WS, version.id, {
        role: 'layout',
        source: { kind: 'upload', storagePath: 'x.png' },
      }, USER),
    ).rejects.toThrow();
    await expect(builder.lockAndSaveEnvironmentVersion(OTHER_WS, version.id, USER)).rejects.toThrow();
    await expect(builder.saveEnvironmentCameraView(OTHER_WS, version.id, { name: 'V' }, USER)).rejects.toThrow();
    expect(await stack.audit.list(OTHER_WS)).toHaveLength(0);
  });

  it('records the audit trail with safe details only', async () => {
    const { audit } = stack;
    const { builder } = stack;
    const { version } = await builder.createEnvironmentDraft(WS, { name: 'Loft' }, USER);
    await makeLockable(stack, version.id);
    const rows = await audit.list(WS);
    const details = rows.map((row) => row.detail ?? '').join(' ');
    expect(details).not.toMatch(/storage|environments\/refs/i);
    expect(rows.every((row) => row.workspaceId === WS)).toBe(true);
  });
});
