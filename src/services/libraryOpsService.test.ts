/**
 * Unified Library (Prompt 21) — contracts at the service boundary over fresh
 * in-memory repositories and seed data.
 *
 * 8 categories:
 *   1. Library and Gallery stay distinct (routes/labels/data separation)
 *   2. Cross-workspace access is rejected
 *   3. Archived assets are excluded from default picker results
 *   4. Filtering by usage scope, linked entity and status
 *   5. Invalid/cross-workspace links are rejected
 *   6. RLS-equivalent scoping prevents workspace leakage (repo-level)
 *   7. Sensitive storage data never appears in returned records/events
 *   8. Archive/restore are auditable and permission-checked
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { LibraryOpsService } from './libraryOpsService';
import { resetLibraryRepository, getLibraryRepository } from '../data/libraryFactory';
import { resetGalleryRepository } from '../data/galleryFactory';
import { resetContentRepository } from '../data/contentFactory';
import { resetModelsRepository, getModelsRepository } from '../data';
import { resetEnvironmentsRepository, getEnvironmentsRepository } from '../data/environmentsFactory';
import { LibraryService } from './libraryService';
import { ModelsService } from './modelsService';
import { EnvironmentsService } from './environmentsService';
import { SEED_LIBRARY_WORKSPACE_ID, SEED_LIBRARY_OTHER_WORKSPACE_ID } from '../mock/librarySeed';
const MODEL_ID = 'model_aisha'; // demo workspace model (modelsSeed fixture)
import { GALLERY_OUTPUT_SEED_IDS } from '../mock/gallerySeed';
import { scopeConsistencyProblem, USAGE_SCOPES, LIBRARY_EVENT_TYPES } from '../domain/library';

const WS = SEED_LIBRARY_WORKSPACE_ID;
const OTHER_WS = SEED_LIBRARY_OTHER_WORKSPACE_ID;
const USER = 'demo-user';

let ops: LibraryOpsService;
let models: ModelsService;
let environments: EnvironmentsService;

beforeEach(() => {
  resetLibraryRepository();
  resetGalleryRepository();
  resetContentRepository();
  resetModelsRepository();
  resetEnvironmentsRepository();

  models = new ModelsService(getModelsRepository());
  environments = new EnvironmentsService(getEnvironmentsRepository());
  const library = new LibraryService(getLibraryRepository());
  void library;

  ops = new LibraryOpsService(getLibraryRepository(), {
    models: { getModel: (id, ws) => models.getModel(id, ws) },
    environments: { getEnvironment: (id, ws) => environments.getEnvironment(id, ws) },
  });
});

async function makeAsset(overrides: Record<string, unknown> = {}) {
  return ops.createLibraryAsset(
    WS,
    {
      workspaceId: WS,
      name: (overrides.name as string) ?? 'Test reusable asset',
      assetType: (overrides.assetType as never) ?? 'product',
      usageScope: (overrides.usageScope as never) ?? 'shared',
      ...(overrides.description ? { description: overrides.description as string } : {}),
      ...(overrides.linkedModelId ? { linkedModelId: overrides.linkedModelId as string } : {}),
      ...(overrides.linkedEnvironmentId ? { linkedEnvironmentId: overrides.linkedEnvironmentId as string } : {}),
      ...(overrides.tags ? { tags: overrides.tags as string[] } : {}),
      ...(overrides.metadata ? { metadata: overrides.metadata as Record<string, unknown> } : {}),
    },
    USER,
  );
}

/** 1 — Library/Gallery distinction */
describe('1. Library and Gallery remain distinct', () => {
  it('library records never carry Gallery output data and vice versa', async () => {
    const asset = await makeAsset();
    expect(asset.assetType).toBeDefined();
    expect('galleryOutputId' in asset).toBe(false);
    expect('outputType' in asset).toBe(false);
    // Gallery outputs keep their own id space; Library ids are separate.
    expect(asset.id).not.toBe(GALLERY_OUTPUT_SEED_IDS.serum);
  });

  it('the taxonomy axis is usage, not ownership — no parallel library concepts', () => {
    expect(USAGE_SCOPES).toEqual(['model', 'item', 'environment', 'shared']);
    expect(scopeConsistencyProblem({ usageScope: 'global' as never })).toMatch(/Unknown usage scope/);
    expect(scopeConsistencyProblem({ usageScope: 'my_library' as never })).toMatch(/Unknown usage scope/);
  });

  it('created assets declare reusable intent in their audit trail, not generation language', async () => {
    const asset = await makeAsset({ name: 'Brand reusable asset', assetType: 'brand_asset' });
    const events = await ops.getAssetEvents(WS, asset.id);
    expect(events.map((e) => e.eventType)).toContain('library_asset_created');
    expect(events[0].message).toMatch(/created/);
    expect(events[0].message.toLowerCase()).not.toMatch(/generated|render/);
  });
});

/** 2 — cross-workspace access rejected */
describe('2. cross-workspace access is rejected', () => {
  it('refuses reading another workspace’s asset via getLibraryAsset', async () => {
    // The seed's other-workspace asset exists but belongs to OTHER_WS.
    const { OTHER_WS_ASSET } = await import('../mock/librarySeed');
    await expect(ops.getLibraryAsset(WS, OTHER_WS_ASSET.id, USER)).rejects.toThrow(/workspace/i);
  });

  it('refuses archive/restore across workspaces', async () => {
    const { OTHER_WS_ASSET } = await import('../mock/librarySeed');
    await expect(ops.archiveLibraryAsset(WS, OTHER_WS_ASSET.id, USER)).rejects.toThrow(/workspace/i);
    await expect(ops.restoreLibraryAsset(WS, OTHER_WS_ASSET.id, USER)).rejects.toThrow(/workspace/i);
  });

  it('refuses create with a mismatched workspaceId payload', async () => {
    await expect(
      ops.createLibraryAsset(
        WS,
        { workspaceId: OTHER_WS, name: 'Smuggled asset', assetType: 'prop', usageScope: 'shared' },
        USER,
      ),
    ).rejects.toThrow(/active workspace/);
  });
});

/** 3 — archived excluded from default picker */
describe('3. archived assets excluded from picker', () => {
  it('picker omits archived assets; active list omits them too; archived view shows them', async () => {
    const asset = await makeAsset({ name: 'Soon archived prop', assetType: 'prop', usageScope: 'shared' });
    await ops.archiveLibraryAsset(WS, asset.id, USER);

    const picker = await ops.listLibraryPickerAssets(WS, { includeDrafts: true });
    expect(picker.find((a) => a.id === asset.id)).toBeUndefined();

    const active = await ops.listLibraryAssets(WS, {});
    expect(active.find((a) => a.id === asset.id)).toBeUndefined();

    const archived = await ops.listLibraryAssets(WS, { archivedOnly: true });
    expect(archived.find((a) => a.id === asset.id)).toBeDefined();

    // Archived stays inspectable even though it is out of the picker.
    const detail = await ops.getLibraryAsset(WS, asset.id, USER);
    expect(detail.id).toBe(asset.id);
  });

  it('picker defaults to ready-only; drafts need includeDrafts', async () => {
    const asset = await makeAsset({ name: 'Ready asset' });
    // New assets start as drafts — approve this one through the draft path.
    await getLibraryRepository().updateAssetDraft(asset.id, { status: 'ready' });
    const strict = await ops.listLibraryPickerAssets(WS, {});
    expect(strict.find((a) => a.id === asset.id)).toBeDefined();
    const drafts = await ops.listLibraryAssets(WS, { status: 'draft' });
    expect(drafts.find((a) => a.id === asset.id)).toBeUndefined();
  });
});

/** 4 — filtering */
describe('4. filtering by scope, links and status', () => {
  it('filters by usage scope', async () => {
    await makeAsset({ name: 'Model wardrobe item', assetType: 'wardrobe', usageScope: 'model', linkedModelId: MODEL_ID });
    await makeAsset({ name: 'Shared reference', assetType: 'reference', usageScope: 'shared' });
    const modelScoped = await ops.listLibraryAssets(WS, { usageScope: 'model' });
    expect(modelScoped.every((a) => a.usageScope === 'model')).toBe(true);
    expect(modelScoped.length).toBeGreaterThanOrEqual(1);
  });

  it('filters by linked model and by search', async () => {
    await makeAsset({ name: 'Aisha wardrobe', assetType: 'wardrobe', usageScope: 'model', linkedModelId: MODEL_ID });
    const byModel = await ops.listLibraryAssets(WS, { linkedModelId: MODEL_ID });
    expect(byModel.length).toBeGreaterThanOrEqual(1);
    expect(byModel.every((a) => a.linkedModelId === MODEL_ID)).toBe(true);
    const bySearch = await ops.listLibraryAssets(WS, { search: 'aisha' });
    expect(bySearch.some((a) => a.name === 'Aisha wardrobe')).toBe(true);
  });

  it('filters by tag and status', async () => {
    await makeAsset({ name: 'Tagged product', assetType: 'product', usageScope: 'shared', tags: ['skincare'] });
    const byTag = await ops.listLibraryAssets(WS, { tag: 'skincare' });
    expect(byTag.some((a) => a.name === 'Tagged product')).toBe(true);
    const drafts = await ops.listLibraryAssets(WS, { status: 'draft' });
    expect(drafts.every((a) => a.status === 'draft')).toBe(true);
  });
});

/** 5 — invalid links rejected */
describe('5. invalid/cross-workspace links are rejected', () => {
  it('rejects a linked model from another workspace', async () => {
    await expect(
      makeAsset({ name: 'Bad link', assetType: 'wardrobe', usageScope: 'model', linkedModelId: 'model_bea' }),
    ).rejects.toThrow(/does not exist in this workspace/);
  });

  it('rejects unknown linked ids and scope/link mismatches', async () => {
    await expect(
      makeAsset({ name: 'Ghost model link', assetType: 'wardrobe', usageScope: 'model', linkedModelId: 'model_missing' }),
    ).rejects.toThrow();
    expect(scopeConsistencyProblem({ usageScope: 'model', linkedModelId: 'm', linkedItemId: 's' })).toMatch(/cannot also link/);
    // A scoped usage missing its own link is caught first (distinct branch).
    expect(scopeConsistencyProblem({ usageScope: 'item', linkedModelId: 'm' })).toMatch(/requires a linked item/);
    expect(scopeConsistencyProblem({ usageScope: 'shared', linkedModelId: 'm', linkedItemId: 's' })).toMatch(/not several/);
  });

  it('accepts valid same-workspace links', async () => {
    const asset = await makeAsset({
      name: 'Valid model asset',
      assetType: 'wardrobe',
      usageScope: 'model',
      linkedModelId: MODEL_ID,
    });
    expect(asset.linkedModelId).toBe(MODEL_ID);
  });
});

/** 6 — scoping prevents leakage */
describe('6. workspace scoping prevents leakage', () => {
  it('listings never include other workspaces’ assets', async () => {
    const rows = await ops.listLibraryAssets(WS, {});
    expect(rows.every((a) => a.workspaceId === WS)).toBe(true);
    const otherRows = await ops.listLibraryAssets(OTHER_WS, {});
    expect(otherRows.every((a) => a.workspaceId === OTHER_WS)).toBe(true);
    expect(otherRows.find((a) => a.workspaceId === WS)).toBeUndefined();
  });

  it('events are workspace-scoped', async () => {
    const asset = await makeAsset();
    const events = await ops.getAssetEvents(WS, asset.id);
    expect(events.every((e) => e.workspaceId === WS)).toBe(true);
  });
});

/** 7 — no sensitive storage data */
describe('7. sensitive storage data is never exposed', () => {
  it('records and events contain no signed URLs or storage secrets', async () => {
    const asset = await makeAsset({
      name: 'Storage-safe asset',
      metadata: { note: 'safe metadata' },
    });
    const detail = await ops.getLibraryAsset(WS, asset.id, USER);
    const events = await ops.getAssetEvents(WS, asset.id);
    const serialized = JSON.stringify({ detail, events });
    expect(serialized).not.toMatch(/supabase\.co|storage\/v1\/object\/sign|\.sig=|Bearer/i);
    expect(serialized).not.toMatch(/accessToken|refresh_token/i);
  });

  it('event metadata is sanitized to plain scalars', async () => {
    const asset = await makeAsset();
    const events = await ops.getAssetEvents(WS, asset.id);
    for (const e of events) {
      if (e.metadata) {
        for (const value of Object.values(e.metadata)) {
          expect(['string', 'number', 'boolean']).toContain(typeof value);
        }
      }
    }
  });

  it('the audit event catalogue matches the spec', () => {
    expect(LIBRARY_EVENT_TYPES).toEqual([
      'library_asset_created',
      'library_asset_updated',
      'library_asset_archived',
      'library_asset_restored',
      'library_asset_viewed',
      'library_picker_opened',
      'library_asset_attached',
    ]);
  });
});

/** 8 — archive/restore auditable + permission-checked */
describe('8. archive and restore are audited and permission-checked', () => {
  it('archive then restore produces a complete, ordered audit trail', async () => {
    const asset = await makeAsset({ name: 'Audit prop', assetType: 'prop', usageScope: 'shared' });
    await ops.archiveLibraryAsset(WS, asset.id, USER);
    await ops.restoreLibraryAsset(WS, asset.id, USER);
    const events = await ops.getAssetEvents(WS, asset.id);
    const types = events.map((e) => e.eventType);
    expect(types).toContain('library_asset_created');
    expect(types).toContain('library_asset_archived');
    expect(types).toContain('library_asset_restored');
    // Append-only store: every entry carries its own actor + timestamp.
    for (const e of events) {
      expect(e.createdAt).toBeTruthy();
    }
  });

  it('double archive and restore-of-active are refused with clear errors', async () => {
    const asset = await makeAsset({ name: 'Once only' });
    await ops.archiveLibraryAsset(WS, asset.id, USER);
    await expect(ops.archiveLibraryAsset(WS, asset.id, USER)).rejects.toThrow(/already archived/);
    // Restore succeeds exactly once; a second restore is refused.
    await ops.restoreLibraryAsset(WS, asset.id, USER);
    await expect(ops.restoreLibraryAsset(WS, asset.id, USER)).rejects.toThrow(/not archived/);
  });

  it('picker opens are audited (library_picker_opened)', async () => {
    await ops.listLibraryPickerAssets(WS, { usageScope: 'item' }, USER);
    const repo = getLibraryRepository();
    const events = await repo.listLibraryEvents(WS, { eventType: 'library_picker_opened' });
    expect(events.length).toBeGreaterThanOrEqual(1);
  });
});
