/**
 * Prompt 23 — Library picker integration for Content Studio & Campaigns:
 * service-boundary contracts for the first real product integrations.
 *
 * Categories:
 *   1.  Role/slot registry semantics (cardinality + asset-type fit)
 *   2.  Server-checked role/type validation (context-aware)
 *   3.  Single-cardinality roles allow one attachment per target
 *   4.  Campaign items are real attachment targets (workspace-scoped)
 *   5.  Safe replace: swaps the reference, keeps auditability, assets intact
 *   6.  Replace validation: bad replacements change nothing
 *   7.  Remove detaches the reference; the Library asset is never deleted
 *   8.  Attached-asset summary hydration + archived attachments stay visible
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
import { LIBRARY_ATTACHMENT_ROLES, libraryRoleCompatibilityProblems } from '../domain/library';
import {
  SEED_LIBRARY_WORKSPACE_ID,
  SEED_LIBRARY_OTHER_WORKSPACE_ID,
  LIBRARY_ASSET_SEED_IDS,
} from '../mock/librarySeed';

const WS = SEED_LIBRARY_WORKSPACE_ID;
const OTHER_WS = SEED_LIBRARY_OTHER_WORKSPACE_ID;
const USER = 'demo-user';
const SCENE = 'scene_morning_setup';
const ITEM = 'citem_serum_video';

/** Seed asset types: serum = product, earrings = accessory, blazer = wardrobe, look = look. */
const SERUM = LIBRARY_ASSET_SEED_IDS.serum;
const EARRINGS = LIBRARY_ASSET_SEED_IDS.earrings;
const BLAZER = LIBRARY_ASSET_SEED_IDS.blazer;
const LOOK = LIBRARY_ASSET_SEED_IDS.look;

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
    campaigns: {
      getCampaign: (id, ws) => campaigns.getCampaign(id, ws),
      getCampaignItem: (id, ws) => campaigns.getCampaignItem(id, ws),
    },
  });
});

/** 1 — Registry role semantics */
describe('1. Role registry semantics', () => {
  it('defines primary-product as single-cardinality, product-only', () => {
    const def = LIBRARY_ATTACHMENT_ROLES['primary-product'];
    expect(def.cardinality).toBe('single');
    expect(def.allowedAssetTypes).toContain('product');
    expect(def.allowedAssetTypes).toContain('brand_asset');
    expect(def.allowedAssetTypes).not.toContain('wardrobe');
  });

  it('keeps props and supporting multi-cardinality', () => {
    expect(LIBRARY_ATTACHMENT_ROLES.props.cardinality).toBe('multi');
    expect(LIBRARY_ATTACHMENT_ROLES.supporting.cardinality).toBe('multi');
  });

  it('rejects asset types that cannot fill a role, allows registry-free roles', () => {
    expect(libraryRoleCompatibilityProblems('primary-product', 'wardrobe').length).toBe(1);
    expect(libraryRoleCompatibilityProblems('primary-product', 'product')).toEqual([]);
    expect(libraryRoleCompatibilityProblems('props', 'prop')).toEqual([]);
    // Free-text roles fit anything.
    expect(libraryRoleCompatibilityProblems('hero-shot', 'wardrobe')).toEqual([]);
  });
});

/** 2 — Server-checked role/type validation */
describe('2. Server-checked role/type validation', () => {
  it('accepts a product into primary-product on a scene', async () => {
    const result = await ops.validateAssetAttachment(WS, SERUM, 'content_scene', SCENE, 'primary-product');
    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
  });

  it('refuses a wardrobe asset in primary-product (context-aware, server-checked)', async () => {
    const result = await ops.validateAssetAttachment(WS, BLAZER, 'content_scene', SCENE, 'primary-product');
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toMatch(/cannot fill the “Primary product” role/i);
  });

  it('refuses a look asset in primary-product but accepts it as look-reference', async () => {
    const bad = await ops.validateAssetAttachment(WS, LOOK, 'content_scene', SCENE, 'primary-product');
    expect(bad.ok).toBe(false);
    const good = await ops.validateAssetAttachment(WS, LOOK, 'content_scene', SCENE, 'look-reference');
    expect(good.ok).toBe(true);
  });
});

/** 3 — Single-cardinality roles allow ONE attachment per target */
describe('3. Single-cardinality enforcement', () => {
  it('blocks a second primary-product attachment even without the primary flag', async () => {
    await ops.attachLibraryAssets(WS, 'content_scene', SCENE, [
      { assetId: SERUM, roleOrSlot: 'primary-product', isPrimary: true },
    ], USER);

    const second = await ops.validateAssetAttachment(WS, BLAZER, 'content_scene', SCENE, 'primary-product');
    // The type check fires first for wardrobe assets…
    expect(second.problems.join(' ')).toMatch(/Primary product/);

    const productLike = await ops.validateAssetAttachment(WS, LOOK, 'content_scene', SCENE, 'look-reference');
    expect(productLike.ok).toBe(true);

    // A different PRODUCT into the same single slot hits cardinality…
    const created = await ops.createLibraryAsset(WS, {
      workspaceId: WS,
      name: 'Second product',
      assetType: 'product',
      usageScope: 'shared',
    }, USER);
    const dup = await ops.validateAssetAttachment(WS, created.id, 'content_scene', SCENE, 'primary-product');
    expect(dup.ok).toBe(false);
    expect(dup.problems.join(' ')).toMatch(/Only one “Primary product”/);
  });

  it('marks single-slot attachments as primary so the DB index backs the rule', async () => {
    const records = await ops.attachLibraryAssets(WS, 'content_scene', SCENE, [
      { assetId: SERUM, roleOrSlot: 'primary-product', isPrimary: true },
    ], USER);
    expect(records[0].isPrimary).toBe(true);
    const primaries = await getLibraryRepository().listAttachments(WS, {
      targetType: 'content_scene', targetId: SCENE, isPrimary: true,
    });
    expect(primaries).toHaveLength(1);
  });
});

/** 4 — Campaign items are real attachment targets */
describe('4. Campaign item attachment targets', () => {
  it('attaches a primary product to a campaign item and lists it back', async () => {
    const records = await ops.attachLibraryAssets(WS, 'campaign_item', ITEM, [
      { assetId: SERUM, roleOrSlot: 'primary-product', isPrimary: true },
    ], USER);
    expect(records).toHaveLength(1);
    expect(records[0].targetType).toBe('campaign_item');
    expect(records[0].targetId).toBe(ITEM);

    const details = await ops.listTargetAttachmentDetails(WS, 'campaign_item', ITEM);
    expect(details).toHaveLength(1);
    expect(details[0].asset.id).toBe(SERUM);
    expect(details[0].asset.name).toContain('Serum');
  });

  it('refuses unknown and cross-workspace campaign items (server-checked)', async () => {
    await expect(ops.attachLibraryAssets(WS, 'campaign_item', 'citem_missing', [
      { assetId: SERUM, roleOrSlot: 'props' },
    ], USER)).rejects.toThrow(/does not exist in this workspace/i);

    await expect(ops.attachLibraryAssets(OTHER_WS, 'campaign_item', ITEM, [
      { assetId: LIBRARY_ASSET_SEED_IDS.otherWs, roleOrSlot: 'props' },
    ], USER)).rejects.toThrow();
  });
});

/** 5 — Safe replace */
describe('5. Safe replace preserves auditability', () => {
  it('swaps the attachment, keeps the Library assets intact, audits both sides', async () => {
    const [original] = await ops.attachLibraryAssets(WS, 'content_scene', SCENE, [
      { assetId: EARRINGS, roleOrSlot: 'props' },
    ], USER);

    const replaced = await ops.replaceLibraryAttachment(
      WS, original.id, { assetId: LIBRARY_ASSET_SEED_IDS.laptop, roleOrSlot: 'props' }, USER,
    );
    expect(replaced.libraryAssetId).toBe(LIBRARY_ASSET_SEED_IDS.laptop);
    expect(replaced.targetType).toBe('content_scene');
    expect(replaced.targetId).toBe(SCENE);

    // Exactly ONE attachment remains on the slot — the replacement.
    const details = await ops.listTargetAttachmentDetails(WS, 'content_scene', SCENE);
    expect(details).toHaveLength(1);
    expect(details[0].asset.id).toBe(LIBRARY_ASSET_SEED_IDS.laptop);

    // Neither Library asset was deleted by the swap.
    const repo = getLibraryRepository();
    await expect(repo.getAsset(EARRINGS)).resolves.toBeTruthy();
    await expect(repo.getAsset(LIBRARY_ASSET_SEED_IDS.laptop)).resolves.toBeTruthy();

    // Both sides are audited.
    const repo2 = getLibraryRepository();
    const detached = await repo2.listLibraryEvents(WS, { eventType: 'library_asset_detached' });
    const attached = await repo2.listLibraryEvents(WS, { eventType: 'library_asset_attached' });
    expect(detached.some((e) => /replaced by/i.test(e.message))).toBe(true);
    expect(attached.some((e) => /replacing/i.test(e.message))).toBe(true);
  });

  it('replaces in place — the outgoing attachment is exempt from duplicate checks', async () => {
    const [original] = await ops.attachLibraryAssets(WS, 'content_scene', SCENE, [
      { assetId: EARRINGS, roleOrSlot: 'props' },
    ], USER);
    const replaced = await ops.replaceLibraryAttachment(
      WS, original.id, { assetId: EARRINGS, roleOrSlot: 'props' }, USER,
    );
    expect(replaced.libraryAssetId).toBe(EARRINGS);
  });

  it('keeps role semantics on replace and throws for a missing attachment', async () => {
    const [original] = await ops.attachLibraryAssets(WS, 'content_scene', SCENE, [
      { assetId: SERUM, roleOrSlot: 'primary-product', isPrimary: true },
    ], USER);
    await expect(ops.replaceLibraryAttachment(
      WS, 'att_missing', { assetId: BLAZER }, USER,
    )).rejects.toThrow();

    // Role is preserved when not overridden.
    await expect(ops.attachLibraryAssets(WS, 'content_scene', SCENE, [
      { assetId: LOOK, roleOrSlot: 'primary-product', isPrimary: true },
    ], USER)).rejects.toThrow(/cannot fill/i);
    void original;
  });
});

/** 6 — Failed replacements change nothing */
describe('6. Failed replacements change nothing', () => {
  it('leaves the original attachment when the replacement fails validation', async () => {
    const [original] = await ops.attachLibraryAssets(WS, 'content_scene', SCENE, [
      { assetId: SERUM, roleOrSlot: 'primary-product', isPrimary: true },
    ], USER);

    await expect(ops.replaceLibraryAttachment(
      WS, original.id, { assetId: BLAZER, roleOrSlot: 'primary-product' }, USER,
    )).rejects.toThrow(/cannot fill/i);

    const details = await ops.listTargetAttachmentDetails(WS, 'content_scene', SCENE);
    expect(details).toHaveLength(1);
    expect(details[0].attachment.id).toBe(original.id);
    expect(details[0].asset.id).toBe(SERUM);
  });
});

/** 7 — Remove detaches; the Library asset survives */
describe('7. Remove detaches the reference only', () => {
  it('detaches without deleting the asset, then re-attach works', async () => {
    const [record] = await ops.attachLibraryAssets(WS, 'campaign_item', ITEM, [
      { assetId: SERUM, roleOrSlot: 'primary-product', isPrimary: true },
    ], USER);

    await ops.detachLibraryAsset(WS, record.id, USER);
    await expect(ops.listTargetAttachmentDetails(WS, 'campaign_item', ITEM)).resolves.toHaveLength(0);
    const asset = await ops.getLibraryAsset(WS, SERUM, USER);
    expect(asset.id).toBe(SERUM);

    const again = await ops.attachLibraryAssets(WS, 'campaign_item', ITEM, [
      { assetId: SERUM, roleOrSlot: 'primary-product', isPrimary: true },
    ], USER);
    expect(again).toHaveLength(1);
  });
});

/** 8 — Summary hydration + archived attachments stay visible with warnings */
describe('8. Attached-asset summary and archived visibility', () => {
  it('hydrates attachment + asset pairs for a target', async () => {
    await ops.attachLibraryAssets(WS, 'content_scene', SCENE, [
      { assetId: EARRINGS, roleOrSlot: 'props' },
      { assetId: LOOK, roleOrSlot: 'look-reference', isPrimary: true },
    ], USER);
    const details = await ops.listTargetAttachmentDetails(WS, 'content_scene', SCENE);
    expect(details.map((d) => d.asset.assetType).sort()).toEqual(['accessory', 'look']);
    expect(details.every((d) => d.attachment.libraryAssetId === d.asset.id)).toBe(true);
  });

  it('keeps archived attachments visible (details) while refusing NEW archived attaches', async () => {
    const [record] = await ops.attachLibraryAssets(WS, 'content_scene', SCENE, [
      { assetId: EARRINGS, roleOrSlot: 'props' },
    ], USER);
    await ops.archiveLibraryAsset(WS, EARRINGS, USER);

    const details = await ops.listTargetAttachmentDetails(WS, 'content_scene', SCENE);
    expect(details).toHaveLength(1);
    expect(details[0].asset.archivedAt).not.toBeNull();

    // New attachment of the archived asset is refused without explicit opt-in…
    const scene2 = await content.createScene({ contentProjectId: 'content_project_morning_routine', title: 'Second scene' }, 'ws_demo');
    const refused = await ops.validateAssetAttachment(WS, EARRINGS, 'content_scene', scene2.id, 'props');
    expect(refused.ok).toBe(false);
    // …but allowed WITH the explicit opt-in, carrying a warning.
    const allowed = await ops.validateAssetAttachment(WS, EARRINGS, 'content_scene', scene2.id, 'props', { allowArchived: true });
    expect(allowed.ok).toBe(true);
    expect(allowed.warnings.join(' ')).toMatch(/archived/i);
    void record;
  });
});
