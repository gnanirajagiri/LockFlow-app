/**
 * Library service rules — the product contracts, tested at the service
 * boundary over a fresh mock repository (reset per test for isolation).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { LibraryService } from './libraryService';
import { getLibraryRepository, resetLibraryRepository } from '../data/libraryFactory';
import {
  LIBRARY_ASSET_SEED_IDS,
  LIBRARY_VERSION_SEED_IDS,
  SEED_LIBRARY_OTHER_WORKSPACE_ID,
  SEED_LIBRARY_WORKSPACE_ID,
} from '../mock/librarySeed';
import type { LibraryAssetVersionRecord } from '../domain/library';

let service: LibraryService;
let workspaceId: string;
let otherWorkspaceId: string;

beforeEach(() => {
  resetLibraryRepository();
  service = new LibraryService(getLibraryRepository());
  workspaceId = SEED_LIBRARY_WORKSPACE_ID;
  otherWorkspaceId = SEED_LIBRARY_OTHER_WORKSPACE_ID;
});

const ASSETS = LIBRARY_ASSET_SEED_IDS;
const VERSIONS = LIBRARY_VERSION_SEED_IDS;

async function createTestAsset(name = 'Test prop set', assetType = 'prop' as const) {
  const asset = await service.createAsset(
    { workspaceId, name, assetType },
    'tester',
  );
  const versions = await service.getVersions(asset.id, workspaceId);
  return { asset, versionId: versions[0].id };
}

describe('rule 1 — locked asset versions cannot be edited', () => {
  it('refuses version-draft updates on locked versions', async () => {
    await expect(
      service.updateVersionDraft(
        VERSIONS.serum,
        { structuredDetails: { bottle: 'hacked' } },
        workspaceId,
      ),
    ).rejects.toThrow(/locked and cannot be edited/);
  });

  it('refuses reference metadata changes on locked versions', async () => {
    await expect(
      service.addReference(
        VERSIONS.serum,
        { storagePath: 'placeholders/x.svg', referenceType: 'front', caption: 'x' },
        workspaceId,
      ),
    ).rejects.toThrow(/locked and cannot be edited/);
  });

  it('refuses locking an already-locked version', async () => {
    await expect(service.lockVersion(VERSIONS.serum, workspaceId)).rejects.toThrow(/locked/);
  });

  it('allows the same operations on drafts', async () => {
    const { versionId } = await createTestAsset();
    const updated = await service.updateVersionDraft(
      versionId,
      { structuredDetails: { colour: 'matte black' }, rightsStatus: 'confirmed' },
      workspaceId,
    );
    expect(updated.structuredDetails).toEqual({ colour: 'matte black' });
    expect(updated.rightsStatus).toBe('confirmed');
  });
});

describe('rule 2 — new asset draft versions increment safely', () => {
  it('assigns max+1 after locking the current draft', async () => {
    const { asset, versionId } = await createTestAsset();
    await service.lockVersion(versionId, workspaceId);

    const next = await service.createVersion(
      { libraryAssetId: asset.id, sourceVersionId: versionId, changeSummary: 'Second configuration' },
      'tester',
      workspaceId,
    );
    expect(next.versionNumber).toBe(2);
    expect(next.status).toBe('draft');

    await service.lockVersion(next.id, workspaceId);
    const third = await service.createVersion(
      { libraryAssetId: asset.id, sourceVersionId: next.id, changeSummary: 'Third' },
      'tester',
      workspaceId,
    );
    expect(third.versionNumber).toBe(3);
  });

  it('refuses a second draft while one is open', async () => {
    const { asset, versionId } = await createTestAsset();
    await expect(
      service.createVersion(
        { libraryAssetId: asset.id, sourceVersionId: versionId, changeSummary: 'dupe' },
        'tester',
        workspaceId,
      ),
    ).rejects.toThrow(/draft version already exists/);
  });
});

describe('rule 3 — draft copies details and references without mutating the source', () => {
  it('copies structured details + reference metadata; source stays byte-identical', async () => {
    const source: LibraryAssetVersionRecord = await service.getVersion(VERSIONS.serum, workspaceId);
    const refsBefore = await service.getReferences(VERSIONS.serum, workspaceId);
    expect(refsBefore.length).toBe(3);

    // Free the one-draft slot? Not needed: serum has no draft — lock guard
    // only blocks *editing* locked versions, not copying them.
    const created = await service.createVersion(
      { libraryAssetId: ASSETS.serum, sourceVersionId: VERSIONS.serum, changeSummary: 'Pump redesign' },
      'tester',
      workspaceId,
    );

    expect(created.versionNumber).toBe(2);
    expect(created.structuredDetails).toEqual(source.structuredDetails);
    expect(created.rightsStatus).toBe(source.rightsStatus);

    const copiedRefs = await service.getReferences(created.id, workspaceId);
    expect(copiedRefs.map((reference) => reference.storagePath)).toEqual(
      refsBefore.map((reference) => reference.storagePath),
    );
    // Copies are new rows, not the source rows.
    expect(copiedRefs.every((reference) => reference.libraryAssetVersionId === created.id)).toBe(true);

    const sourceAfter = await service.getVersion(VERSIONS.serum, workspaceId);
    const refsAfter = await service.getReferences(VERSIONS.serum, workspaceId);
    expect(sourceAfter).toEqual(source);
    expect(refsAfter).toEqual(refsBefore);
  });
});

describe('rule 4 — tags remain workspace-scoped', () => {
  it('creates tags in the asset\u2019s workspace and reuses normalized names', async () => {
    const linked = await service.addTagToAsset(
      { libraryAssetId: ASSETS.serum, name: 'Skincare Routine' },
      workspaceId,
    );
    expect(linked.workspaceId).toBe(workspaceId);
    expect(linked.normalizedName).toBe('skincare-routine');

    // Same normalized name reuses the workspace tag (no duplicate).
    const again = await service.addTagToAsset(
      { libraryAssetId: ASSETS.laptop, name: 'skincare routine' },
      workspaceId,
    );
    expect(again.id).toBe(linked.id);

    const serumTags = await service.getTagsForAsset(ASSETS.serum, workspaceId);
    expect(serumTags.map((tag) => tag.normalizedName)).toContain('skincare-routine');
  });

  it('never leaks the other workspace\u2019s tags or assets', async () => {
    const assets = await service.listAssets(workspaceId);
    expect(assets.some((asset) => asset.workspaceId === otherWorkspaceId)).toBe(false);

    await expect(service.getAsset(ASSETS.otherWs, workspaceId)).rejects.toThrow(
      /Cross-workspace access denied/,
    );
    await expect(
      service.addTagToAsset({ libraryAssetId: ASSETS.otherWs, name: 'sneaky' }, workspaceId),
    ).rejects.toThrow(/Cross-workspace access denied/);
  });
});

describe('rule 5 — Looks require the look asset type', () => {
  it('refuses look_details for a non-look asset', async () => {
    // A fresh DRAFT non-look asset so the type guard (not the lock guard) fires.
    const { versionId } = await createTestAsset('Not a look', 'prop');
    await expect(
      service.ensureLookDetails(versionId, 'model_aisha', workspaceId, 'notes'),
    ).rejects.toThrow(/A Look requires asset_type "look"/);
  });

  it('refuses look_details on locked versions regardless of type', async () => {
    await expect(
      service.ensureLookDetails(VERSIONS.serum, 'model_aisha', workspaceId, 'notes'),
    ).rejects.toThrow(/locked and cannot be edited/);
  });

  it('allows look_details for the seeded look asset', async () => {
    const details = await service.ensureLookDetails(
      VERSIONS.look,
      'model_aisha',
      workspaceId,
      'Existing look',
    );
    expect(details.modelId).toBe('model_aisha');
  });
});

describe('rule 6 — Looks link canonical records, never duplicates', () => {
  it('stores item references pointing at canonical Library assets', async () => {
    const items = await service.setLookItems(
      {
        lookDetailsId: 'lookdetails_neutral_outfit',
        items: [
          { libraryAssetId: ASSETS.blazer, libraryAssetVersionId: VERSIONS.blazer, role: 'wardrobe', sortOrder: 0 },
          { libraryAssetId: ASSETS.earrings, role: 'accessory', sortOrder: 1 },
        ],
      },
      workspaceId,
    );

    expect(items.map((item) => item.libraryAssetId)).toEqual([ASSETS.blazer, ASSETS.earrings]);
    // Items carry only ids + role + order — no duplicated asset data.
    for (const item of items) {
      expect(Object.keys(item)).not.toContain('name');
      expect(Object.keys(item)).not.toContain('structuredDetails');
    }
  });

  it('refuses duplicate asset links and cross-asset version pins', async () => {
    await expect(
      service.setLookItems(
        {
          lookDetailsId: 'lookdetails_neutral_outfit',
          items: [
            { libraryAssetId: ASSETS.blazer, role: 'wardrobe', sortOrder: 0 },
            { libraryAssetId: ASSETS.blazer, role: 'accessory', sortOrder: 1 },
          ],
        },
        workspaceId,
      ),
    ).rejects.toThrow(/cannot link the same asset twice/);

    await expect(
      service.setLookItems(
        {
          lookDetailsId: 'lookdetails_neutral_outfit',
          items: [
            { libraryAssetId: ASSETS.blazer, libraryAssetVersionId: VERSIONS.earrings, role: 'wardrobe', sortOrder: 0 },
          ],
        },
        workspaceId,
      ),
    ).rejects.toThrow(/Pinned version belongs to a different asset/);
  });

  it('refuses look items from another workspace', async () => {
    await expect(
      service.setLookItems(
        {
          lookDetailsId: 'lookdetails_neutral_outfit',
          items: [{ libraryAssetId: ASSETS.otherWs, role: 'other', sortOrder: 0 }],
        },
        workspaceId,
      ),
    ).rejects.toThrow(/Cross-workspace access denied/);
  });
});

describe('rule 7 — shortcuts resolve to the one shared Library asset', () => {
  it('resolves canonical asset records for shortcut ids', async () => {
    const resolved = await service.resolveShortcutAssets([ASSETS.blazer, ASSETS.earrings], workspaceId);
    expect(resolved.map((asset) => asset.id)).toEqual([ASSETS.blazer, ASSETS.earrings]);
    // One canonical record per item — the Look's items and the shortcut
    // resolve to the SAME ids, not copies.
    const items = await service.getLookItems('lookdetails_neutral_outfit', workspaceId);
    expect(items.map((item) => item.libraryAssetId).sort()).toEqual(
      [ASSETS.earrings, ASSETS.blazer].sort(),
    );
  });

  it('refuses shortcuts resolving into another workspace', async () => {
    await expect(service.resolveShortcutAssets([ASSETS.otherWs], workspaceId)).rejects.toThrow(
      /Cross-workspace access denied/,
    );
  });
});

describe('rule 8 — no Gallery-style outputs in Library entities', () => {
  it('exposes no output/generation fields or APIs on assets or versions', async () => {
    const assets = await service.listAssets(workspaceId);
    for (const asset of assets) {
      for (const key of Object.keys(asset)) {
        expect(key).not.toMatch(/output|generated|render|prompt|job|gallery/i);
      }
    }
    for (const version of await service.getVersions(ASSETS.serum, workspaceId)) {
      for (const key of Object.keys(version)) {
        expect(key).not.toMatch(/output|generated|render|prompt|job|gallery/i);
      }
    }

    const prototype = Object.getOwnPropertyNames(Object.getPrototypeOf(service));
    const outputMethods = prototype.filter((name) =>
      /generate|render|output|enqueueJob|gallery/i.test(name),
    );
    expect(outputMethods).toEqual([]);
  });

  it('keeps look items free of output-style fields', async () => {
    const items = await service.getLookItems('lookdetails_neutral_outfit', workspaceId);
    for (const item of items) {
      for (const key of Object.keys(item)) {
        expect(key).not.toMatch(/output|generated|render|prompt|job|gallery/i);
      }
    }
  });
});

describe('asset archive is soft only', () => {
  it('archives by status and preserves everything', async () => {
    const { asset, versionId } = await createTestAsset('Archive me');
    const archived = await service.archiveAsset(asset.id, workspaceId);
    expect(archived.status).toBe('archived');

    // Data preserved and readable.
    const versions = await service.getVersions(asset.id, workspaceId);
    expect(versions.length).toBe(1);
    expect(await service.getVersion(versionId, workspaceId)).toBeDefined();

    // Idempotent.
    expect((await service.archiveAsset(asset.id, workspaceId)).status).toBe('archived');
  });

  it('offers no delete path on the service', async () => {
    const prototype = Object.getOwnPropertyNames(Object.getPrototypeOf(service));
    expect(prototype.filter((name) => /^(delete|remove)Asset/.test(name))).toEqual([]);
  });
});
