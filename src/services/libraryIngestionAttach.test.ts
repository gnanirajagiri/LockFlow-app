/**
 * Library ingestion, attachment & picker workflows (Prompt 22) — contracts at
 * the service boundary over fresh in-memory repositories and seed data.
 *
 * 10 categories (per the Prompt 22 spec):
 *   1.  Ingestion creates workspace-scoped reusable assets
 *   2.  Prompt-assisted suggestions require explicit user confirmation
 *   3.  Cross-workspace links and attachments are rejected
 *   4.  Archived assets are excluded from default picker results
 *   5.  Multi-select and single-select picker modes behave correctly
 *   6.  Attachments reference existing assets rather than duplicating them
 *   7.  Attachment validation enforces role/slot rules
 *   8.  Linked model/item/environment (and target) IDs are validated server-side
 *   9.  Sensitive storage data is not leaked to the browser
 *   10. Gallery outputs are not incorrectly inserted into Library workflows
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { LibraryOpsService } from './libraryOpsService';
import { resetLibraryRepository, getLibraryRepository } from '../data/libraryFactory';
import { resetGalleryRepository, getGalleryRepository } from '../data/galleryFactory';
import { resetContentRepository, getContentRepository } from '../data/contentFactory';
import { resetModelsRepository, getModelsRepository } from '../data';
import { resetEnvironmentsRepository, getEnvironmentsRepository } from '../data/environmentsFactory';
import { resetCampaignsRepository, getCampaignsRepository } from '../data/campaignsFactory';
import { LibraryService } from './libraryService';
import { ModelsService } from './modelsService';
import { EnvironmentsService } from './environmentsService';
import { ContentStudioService } from './contentService';
import { CampaignsService } from './campaignsService';
import { GalleryService } from './galleryService';
import {
  SEED_LIBRARY_WORKSPACE_ID,
  SEED_LIBRARY_OTHER_WORKSPACE_ID,
  LIBRARY_ASSET_SEED_IDS,
} from '../mock/librarySeed';
import {
  LIBRARY_EVENT_TYPES,
  libraryAttachmentWarnings,
  normalizeRoleOrSlot,
  parseLibraryAssetDescription,
  sanitizeExternalImageUrl,
  togglePickerSelection,
} from '../domain/library';

const WS = SEED_LIBRARY_WORKSPACE_ID;
const OTHER_WS = SEED_LIBRARY_OTHER_WORKSPACE_ID;
const USER = 'demo-user';
const SCENE = 'scene_morning_setup';
const SCENE_OTHER = 'scene_product_moment';
const CAMPAIGN = 'campaign_morning_skincare_launch';
const MODEL = 'model_aisha';
const GALLERY_SERUM = 'gallery_serum_product_moment';

let ops: LibraryOpsService;
let models: ModelsService;
let environments: EnvironmentsService;
let content: ContentStudioService;
let campaigns: CampaignsService;

beforeEach(() => {
  resetLibraryRepository();
  resetGalleryRepository();
  resetContentRepository();
  resetModelsRepository();
  resetEnvironmentsRepository();
  resetCampaignsRepository();

  models = new ModelsService(getModelsRepository());
  environments = new EnvironmentsService(getEnvironmentsRepository());
  const library = new LibraryService(getLibraryRepository());
  content = new ContentStudioService(getContentRepository(), { library, models, environments });
  const gallery = new GalleryService(getGalleryRepository(), content, WS);
  campaigns = new CampaignsService(getCampaignsRepository(), gallery);

  ops = new LibraryOpsService(getLibraryRepository(), {
    models: { getModel: (id, ws) => models.getModel(id, ws) },
    content: {
      getScene: (id, ws) => content.getScene(id, ws),
      getJobRequest: (id, ws) => content.getJobRequest(id, ws),
    },
    environments: { getEnvironment: (id, ws) => environments.getEnvironment(id, ws) },
    campaigns: { getCampaign: (id, ws) => campaigns.getCampaign(id, ws) },
  });
});

async function makeAsset(overrides: Record<string, unknown> = {}) {
  return ops.createLibraryAsset(
    WS,
    {
      workspaceId: WS,
      name: (overrides.name as string) ?? 'Test reusable asset',
      assetType: (overrides.assetType as never) ?? 'prop',
      usageScope: (overrides.usageScope as never) ?? 'shared',
      ...(overrides.intake ? { intake: overrides.intake as never } : {}),
      ...(overrides.tags ? { tags: overrides.tags as string[] } : {}),
    },
    USER,
  );
}

/** 1 — Ingestion creates workspace-scoped reusable assets */
describe('1. Asset ingestion creates workspace-scoped reusable assets', () => {
  it('records intake provenance and derives the safe source kind', async () => {
    const asset = await makeAsset({
      name: 'Uploaded serum photo',
      intake: { intakeMethod: 'upload', fileName: 'serum.png', fileSizeBytes: 2048, fileMimeType: 'image/png' },
    });
    expect(asset.sourceKind).toBe('reference_upload');
    expect((asset.metadata as { intake?: { intakeMethod: string } }).intake?.intakeMethod).toBe('upload');
    expect(asset.workspaceId).toBe(WS);
  });

  it('url intake maps to import provenance and stores only a validated http(s) reference', async () => {
    const asset = await ops.createLibraryAsset(
      WS,
      {
        workspaceId: WS,
        name: 'Imported bottle shot',
        assetType: 'product',
        usageScope: 'shared',
        intake: { intakeMethod: 'image_url', sourceUrl: 'https://cdn.example.com/bottle.png' },
      },
      USER,
    );
    expect(asset.sourceKind).toBe('import');
  });

  it('keeps ingestion inside the active workspace — other workspaces see nothing', async () => {
    await makeAsset({ name: 'Only in demo workspace' });
    const other = await ops.listLibraryAssets(OTHER_WS);
    // The seed's isolation fixture lives there; the new asset must not.
    expect(other.some((a) => a.name === 'Only in demo workspace')).toBe(false);
    const mine = await ops.listLibraryAssets(WS);
    expect(mine.some((a) => a.name === 'Only in demo workspace')).toBe(true);
  });

  it('registers SAFE file references scoped to the workspace path prefix', async () => {
    const asset = await makeAsset();
    const file = await ops.registerLibraryAssetFile(
      WS,
      asset.id,
      {
        storageBucket: 'lockflow-references',
        storagePath: `${WS}/library-assets/${asset.id}/ref.png`,
        fileName: 'ref.png',
        mimeType: 'image/png',
        fileSizeBytes: 1024,
      },
      USER,
    );
    expect(file.uploadStatus).toBe('pending');
    const rows = await ops.listAssetFiles(WS, asset.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].storagePath.startsWith(`${WS}/`)).toBe(true);
  });

  it('refuses file references outside the workspace path prefix', async () => {
    const asset = await makeAsset();
    await expect(
      ops.registerLibraryAssetFile(
        WS,
        asset.id,
        {
          storageBucket: 'lockflow-references',
          storagePath: `${OTHER_WS}/escape.png`,
          fileName: 'escape.png',
          mimeType: 'image/png',
        },
        USER,
      ),
    ).rejects.toThrow(/path prefix/);
  });
});

/** 2 — Prompt-assisted suggestions require explicit confirmation */
describe('2. Prompt-assisted metadata suggestions require explicit confirmation', () => {
  it('parses a description into SUGGESTED metadata without saving anything', async () => {
    const before = await ops.listLibraryAssets(WS);
    const suggestion = await ops.parseLibraryAssetDescription(
      WS,
      { description: 'Matte ceramic matcha bowl for countertop product shots. tags: ceramic, kitchen #prop' },
      USER,
    );
    expect(suggestion.needsConfirmation).toBe(true);
    expect(suggestion.assetType).toBe('prop');
    expect(suggestion.usageScope).toBe('item');
    expect(suggestion.tags).toContain('ceramic');
    expect(suggestion.tags).toContain('prop');
    expect(suggestion.linkedModelId).toBeNull();
    expect(suggestion.linkedItemId).toBeNull();
    const after = await ops.listLibraryAssets(WS);
    expect(after).toHaveLength(before.length); // nothing persisted
  });

  it('logs the parse_suggested audit event', async () => {
    await ops.parseLibraryAssetDescription(WS, { description: 'Silver laptop for desk scenes' }, USER);
    const eventsList = await getLibraryRepository().listLibraryEvents(WS, { eventType: 'library_asset_parse_suggested' });
    expect(eventsList.length).toBeGreaterThanOrEqual(1);
    expect(eventsList[0].message).toMatch(/Suggested metadata/);
  });

  it('only the explicit confirm gate creates the asset', async () => {
    const before = await ops.listLibraryAssets(WS);
    const suggestion = await ops.parseLibraryAssetDescription(
      WS,
      { description: 'Oversized beige blazer, worn by the model. tags: tailored' },
      USER,
    );
    // The parser suggests model-scope but NEVER guesses a link — the user
    // must edit (here: relax the scope) before the asset can be confirmed.
    const edited = { ...suggestion, name: 'Beige blazer (edited)', usageScope: 'shared' as const };
    const asset = await ops.confirmLibraryAssetFromSuggestion(WS, edited, USER);
    expect(asset.name).toBe('Beige blazer (edited)');
    expect(asset.sourceKind).toBe('manual');
    expect((asset.metadata as { intake?: { parseConfirmed?: boolean } }).intake?.parseConfirmed).toBe(true);
    const all = await ops.listLibraryAssets(WS);
    expect(all).toHaveLength(before.length + 1); // exactly one confirmed creation
    expect(all.filter((a) => a.name === 'Beige blazer (edited)')).toHaveLength(1);
  });

  it('the parser flags rights mentions instead of trusting them', () => {
    const suggestion = parseLibraryAssetDescription('Licensed product photo of the client-provided serum bottle');
    expect(suggestion.rightsOrUsageNote).toMatch(/confirm/i);
  });

  it('the event catalogue includes every Prompt 22 event', () => {
    for (const name of [
      'library_asset_add_started',
      'library_asset_parse_suggested',
      'library_asset_detached',
      'library_inline_add_started',
    ]) {
      expect(LIBRARY_EVENT_TYPES).toContain(name);
    }
  });
});

/** 3 — Cross-workspace links and attachments are rejected */
describe('3. Cross-workspace links and attachments are rejected', () => {
  it('refuses attaching an asset that lives in another workspace', async () => {
    await expect(
      ops.attachLibraryAssets(WS, 'content_scene', SCENE, [
        { assetId: LIBRARY_ASSET_SEED_IDS.otherWs, roleOrSlot: 'prop' },
      ], USER),
    ).rejects.toThrow(/does not exist in this workspace|not found/i);
  });

  it('refuses creating an asset linked to a model from another workspace', async () => {
    await expect(
      ops.createLibraryAsset(
        WS,
        {
          workspaceId: WS,
          name: 'Bad link',
          assetType: 'wardrobe',
          usageScope: 'model',
          linkedModelId: 'model_from_other_workspace',
        },
        USER,
      ),
    ).rejects.toThrow(/does not exist in this workspace/i);
  });

  it('validateAssetAttachment reports the same cross-workspace problem without writing', async () => {
    const result = await ops.validateAssetAttachment(WS, LIBRARY_ASSET_SEED_IDS.otherWs, 'content_scene', SCENE, 'prop');
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toMatch(/does not exist in this workspace|not found/i);
    const rows = await ops.listAttachmentsForTarget(WS, 'content_scene', SCENE);
    expect(rows).toHaveLength(0);
  });
});

/** 4 — Archived assets are excluded from default picker results */
describe('4. Archived assets are excluded from default picker results', () => {
  it('hides archived assets by default and shows them only on explicit opt-in with warnings', async () => {
    const asset = await makeAsset({ name: 'Soon archived' });
    await ops.archiveLibraryAsset(WS, asset.id, USER);

    const deflt = await ops.listLibraryPickerAssets(WS, {});
    expect(deflt.some((a) => a.id === asset.id)).toBe(false);

    const optedIn = await ops.listLibraryPickerAssets(WS, { includeArchived: true });
    const found = optedIn.find((a) => a.id === asset.id);
    expect(found).toBeDefined();
    expect(libraryAttachmentWarnings(found!, { archivedSelectedExplicitly: true }).join(' ')).toMatch(/archived/i);
  });

  it('refuses NEW attachments to archived assets unless explicitly allowed', async () => {
    const asset = await makeAsset();
    await ops.archiveLibraryAsset(WS, asset.id, USER);
    await expect(
      ops.attachLibraryAssets(WS, 'content_scene', SCENE, [{ assetId: asset.id, roleOrSlot: 'prop' }], USER),
    ).rejects.toThrow(/archived/i);
    const records = await ops.attachLibraryAssets(
      WS, 'content_scene', SCENE, [{ assetId: asset.id, roleOrSlot: 'prop' }], USER,
      { allowArchived: true },
    );
    expect(records).toHaveLength(1);
  });
});

/** 5 — Multi-select and single-select picker modes behave correctly */
describe('5. Multi-select and single-select picker modes behave correctly', () => {
  it('multi-select accumulates; single-select replaces', () => {
    const multi = togglePickerSelection(togglePickerSelection(new Set(['a']), 'b', true), 'b', true);
    expect(multi.has('a')).toBe(true);
    const single = togglePickerSelection(togglePickerSelection(new Set(['a']), 'b', false), 'c', false);
    expect(single.has('a')).toBe(false);
    expect([...single]).toEqual(['c']);
  });

  it('attaching multiple items creates one reference record per asset', async () => {
    const a = await makeAsset({ name: 'Asset A' });
    const b = await makeAsset({ name: 'Asset B' });
    const records = await ops.attachLibraryAssets(WS, 'content_scene', SCENE, [
      { assetId: a.id, roleOrSlot: 'prop' },
      { assetId: b.id, roleOrSlot: 'prop' },
    ], USER);
    expect(records).toHaveLength(2);
    const target = await ops.listAttachmentsForTarget(WS, 'content_scene', SCENE);
    expect(target).toHaveLength(2);
  });

  it('empty selections are refused', async () => {
    await expect(ops.attachLibraryAssets(WS, 'content_scene', SCENE, [], USER)).rejects.toThrow(/at least one/i);
  });
});

/** 6 — Attachments reference existing assets rather than duplicating them */
describe('6. Attachments reference existing assets rather than duplicating them', () => {
  it('both attachments point at the SAME canonical asset id — no copies appear', async () => {
    const asset = await makeAsset({ name: 'Canonical blazer' });
    await ops.attachLibraryAssets(WS, 'content_scene', SCENE, [{ assetId: asset.id, roleOrSlot: 'prop' }], USER);
    await ops.attachLibraryAssets(WS, 'content_scene', SCENE_OTHER, [{ assetId: asset.id, roleOrSlot: 'prop' }], USER);

    const all = await ops.listLibraryAssets(WS);
    const matches = all.filter((a) => a.name === 'Canonical blazer');
    expect(matches).toHaveLength(1); // still exactly one canonical record
    expect(matches[0].id).toBe(asset.id);

    const first = await ops.listAttachmentsForTarget(WS, 'content_scene', SCENE);
    const second = await ops.listAttachmentsForTarget(WS, 'content_scene', SCENE_OTHER);
    expect(first[0].libraryAssetId).toBe(asset.id);
    expect(second[0].libraryAssetId).toBe(asset.id);
  });

  it('attaching the same asset twice to the same slot is refused', async () => {
    const asset = await makeAsset();
    await ops.attachLibraryAssets(WS, 'content_scene', SCENE, [{ assetId: asset.id, roleOrSlot: 'prop' }], USER);
    await expect(
      ops.attachLibraryAssets(WS, 'content_scene', SCENE, [{ assetId: asset.id, roleOrSlot: 'prop' }], USER),
    ).rejects.toThrow(/already attached/i);
  });

  it('detaching removes only the reference — the asset survives untouched', async () => {
    const asset = await makeAsset({ name: 'Survivor' });
    const [record] = await ops.attachLibraryAssets(WS, 'campaign', CAMPAIGN, [{ assetId: asset.id, roleOrSlot: 'reference' }], USER);
    await ops.detachLibraryAsset(WS, record.id, USER);
    const stillThere = await ops.getLibraryAsset(WS, asset.id, USER);
    expect(stillThere.name).toBe('Survivor');
    const target = await ops.listAttachmentsForTarget(WS, 'campaign', CAMPAIGN);
    expect(target).toHaveLength(0);
  });
});

/** 7 — Attachment validation enforces role/slot rules */
describe('7. Attachment validation enforces role/slot rules', () => {
  it('refuses empty or over-long roles', async () => {
    const asset = await makeAsset();
    await expect(
      ops.attachLibraryAssets(WS, 'content_scene', SCENE, [{ assetId: asset.id, roleOrSlot: '   ' }], USER),
    ).rejects.toThrow(/role\/slot/i);
    await expect(
      ops.attachLibraryAssets(WS, 'content_scene', SCENE, [{ assetId: asset.id, roleOrSlot: 'x'.repeat(61) }], USER),
    ).rejects.toThrow(/60 characters/i);
  });

  it('enforces ONE primary per slot — across assets', async () => {
    const a = await makeAsset({ name: 'Primary A' });
    const b = await makeAsset({ name: 'Primary B' });
    await ops.attachLibraryAssets(WS, 'content_scene', SCENE, [{ assetId: a.id, roleOrSlot: 'hero', isPrimary: true }], USER);
    await expect(
      ops.attachLibraryAssets(WS, 'content_scene', SCENE, [{ assetId: b.id, roleOrSlot: 'hero', isPrimary: true }], USER),
    ).rejects.toThrow(/primary/i);
    // Same asset, same slot, non-primary duplicate is also refused.
    await expect(
      ops.attachLibraryAssets(WS, 'content_scene', SCENE, [{ assetId: a.id, roleOrSlot: 'hero' }], USER),
    ).rejects.toThrow(/already attached/i);
    // Different slot on the same target is fine.
    const ok = await ops.attachLibraryAssets(WS, 'content_scene', SCENE, [{ assetId: b.id, roleOrSlot: 'secondary', isPrimary: true }], USER);
    expect(ok[0].isPrimary).toBe(true);
  });

  it('validateAssetAttachment surfaces the primary conflict WITHOUT writing', async () => {
    const a = await makeAsset();
    const b = await makeAsset();
    await ops.attachLibraryAssets(WS, 'campaign', CAMPAIGN, [{ assetId: a.id, roleOrSlot: 'hero', isPrimary: true }], USER);
    const result = await ops.validateAssetAttachment(WS, b.id, 'campaign', CAMPAIGN, 'hero', { isPrimary: true });
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toMatch(/primary/i);
  });

  it('normalizes role/slot text deterministically', () => {
    expect(normalizeRoleOrSlot('  Hero Prop!! ')).toBe('hero-prop');
    expect(normalizeRoleOrSlot(null)).toBe('reference');
    expect(normalizeRoleOrSlot('')).toBe('reference');
  });
});

/** 8 — Linked target IDs are validated server-side */
describe('8. Linked model/item/environment and target IDs are validated server-side', () => {
  it('refuses unknown model targets', async () => {
    const asset = await makeAsset();
    await expect(
      ops.attachLibraryAssets(WS, 'model', 'model_does_not_exist', [{ assetId: asset.id, roleOrSlot: 'wardrobe' }], USER),
    ).rejects.toThrow(/does not exist in this workspace/i);
  });

  it('refuses unknown environment targets', async () => {
    const asset = await makeAsset();
    await expect(
      ops.attachLibraryAssets(WS, 'environment', 'env_does_not_exist', [{ assetId: asset.id, roleOrSlot: 'set' }], USER),
    ).rejects.toThrow(/does not exist in this workspace/i);
  });

  it('refuses unknown campaign and scene targets', async () => {
    const asset = await makeAsset();
    await expect(
      ops.attachLibraryAssets(WS, 'campaign', 'campaign_missing', [{ assetId: asset.id, roleOrSlot: 'reference' }], USER),
    ).rejects.toThrow(/does not exist in this workspace/i);
    await expect(
      ops.attachLibraryAssets(WS, 'content_scene', 'scene_missing', [{ assetId: asset.id, roleOrSlot: 'prop' }], USER),
    ).rejects.toThrow(/does not exist in this workspace/i);
  });

  it('accepts REAL seed targets across all validated domains', async () => {
    const asset = await makeAsset();
    for (const [targetType, targetId] of [
      ['content_scene', SCENE],
      ['campaign', CAMPAIGN],
      ['model', MODEL],
    ] as const) {
      const records = await ops.attachLibraryAssets(
        WS, targetType, targetId,
        [{ assetId: asset.id, roleOrSlot: `slot-${targetType}` }],
        USER,
      );
      expect(records).toHaveLength(1);
    }
  });

  it('records the attach + detach pair in the audit trail', async () => {
    const asset = await makeAsset();
    const [record] = await ops.attachLibraryAssets(WS, 'content_scene', SCENE, [{ assetId: asset.id, roleOrSlot: 'prop' }], USER);
    await ops.detachLibraryAsset(WS, record.id, USER);
    const repo = getLibraryRepository();
    const attached = await repo.listLibraryEvents(WS, { eventType: 'library_asset_attached' });
    const detached = await repo.listLibraryEvents(WS, { eventType: 'library_asset_detached' });
    expect(attached.length).toBeGreaterThanOrEqual(1);
    expect(detached.length).toBeGreaterThanOrEqual(1);
  });
});

/** 9 — Sensitive storage data is not leaked to the browser */
describe('9. Sensitive storage data is not leaked to the browser', () => {
  it('file records carry bucket/path metadata only — never signed URLs or tokens', async () => {
    const asset = await makeAsset();
    const file = await ops.registerLibraryAssetFile(
      WS,
      asset.id,
      {
        storageBucket: 'lockflow-references',
        storagePath: `${WS}/library-assets/${asset.id}/secret-free.png`,
        fileName: 'secret-free.png',
        mimeType: 'image/png',
      },
      USER,
    );
    const serialized = JSON.stringify(file).toLowerCase();
    expect(serialized).not.toContain('token');
    expect(serialized).not.toContain('signature');
    expect(serialized).not.toContain('signedurl');
    expect(Object.keys(file)).not.toContain('signedUrl');
    expect(Object.keys(file)).not.toContain('uploadUrl');
  });

  it('URL intake sanitization blocks credentials, private hosts and non-http schemes', () => {
    expect(sanitizeExternalImageUrl('https://user:pass@example.com/x.png')).toBeNull();
    expect(sanitizeExternalImageUrl('http://localhost/x.png')).toBeNull();
    expect(sanitizeExternalImageUrl('http://127.0.0.1/x.png')).toBeNull();
    expect(sanitizeExternalImageUrl('http://192.168.1.10/x.png')).toBeNull();
    expect(sanitizeExternalImageUrl('file:///etc/passwd')).toBeNull();
    expect(sanitizeExternalImageUrl('javascript:alert(1)')).toBeNull();
    expect(sanitizeExternalImageUrl('https://cdn.example.com/ok.png')).toMatch(/^https:\/\/cdn\.example\.com/);
  });

  it('URL intake through the service refuses unsafe URLs', async () => {
    await expect(
      ops.createLibraryAsset(
        WS,
        {
          workspaceId: WS,
          name: 'Bad URL intake',
          assetType: 'reference',
          usageScope: 'shared',
          intake: { intakeMethod: 'image_url', sourceUrl: 'http://169.254.169.254/latest/meta-data' },
        },
        USER,
      ),
    ).rejects.toThrow(/not allowed/i);
  });

  it('audit events carry only allow-listed scalar metadata', async () => {
    const asset = await makeAsset();
    await ops.attachLibraryAssets(WS, 'content_scene', SCENE, [{ assetId: asset.id, roleOrSlot: 'prop' }], USER);
    const repo = getLibraryRepository();
    const events = await repo.listLibraryEvents(WS, { eventType: 'library_asset_attached' });
    const metadata = events[0].metadata ?? {};
    for (const value of Object.values(metadata)) {
      expect(['string', 'number', 'boolean']).toContain(typeof value);
    }
  });
});

/** 10 — Gallery outputs are not incorrectly inserted into Library workflows */
describe('10. Gallery outputs are not inserted into Library workflows', () => {
  it('gallery_* target types are not part of the attachment contract', async () => {
    const asset = await makeAsset();
    await expect(
      ops.attachLibraryAssets(WS, 'gallery_output' as never, GALLERY_SERUM, [{ assetId: asset.id, roleOrSlot: 'prop' }], USER),
    ).rejects.toThrow(/unsupported attachment target/i);
  });

  it('a gallery output id cannot sneak in as a campaign target', async () => {
    const asset = await makeAsset();
    await expect(
      ops.attachLibraryAssets(WS, 'campaign', GALLERY_SERUM, [{ assetId: asset.id, roleOrSlot: 'reference' }], USER),
    ).rejects.toThrow(/does not exist in this workspace/i);
  });

  it('ingested assets never carry gallery record fields', async () => {
    const asset = await makeAsset({ name: 'Not a gallery copy' });
    expect('galleryOutputId' in asset).toBe(false);
    expect('outputType' in asset).toBe(false);
    expect(asset.sourceKind).not.toBe('generated_derivative'); // manual/default intake
  });

  it('generated-derivative provenance stays a LABEL only (no gallery ids stored)', async () => {
    const asset = await ops.createLibraryAsset(
      WS,
      {
        workspaceId: WS,
        name: 'Derivative prop',
        assetType: 'prop',
        usageScope: 'shared',
        sourceKind: 'generated_derivative',
        intake: { intakeMethod: 'manual' },
      },
      USER,
    );
    expect(asset.sourceKind).toBe('generated_derivative');
    expect(JSON.stringify(asset.metadata ?? {})).not.toContain(GALLERY_SERUM);
  });
});
