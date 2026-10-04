/**
 * Prompt 31 — platform adaptation & campaign item packaging.
 * Service-boundary tests over the in-memory store:
 *
 *   1. Approved outputs package for multiple channels; the source stays
 *      unchanged and remains a Gallery output.
 *   2. Unapproved outputs are refused; unsupported formats and missing
 *      required fields block readiness honestly.
 *   3. Only verified, provider-matching accounts satisfy readiness.
 *   4. Variants are recorded honestly (requested, not faked as applied).
 *   5. Only ready packages enter the existing Publishing Review; nothing
 *      auto-publishes.
 *   6. Cross-workspace creation/linking is rejected; audit covers the
 *      lifecycle.
 */
import { describe, expect, it } from 'vitest';
import { CampaignContentPackageService, InMemoryPackageStore } from './packageService';
import type { PackageDependencies, VerifiedConnectionView } from './packageService';
import {
  CHANNEL_ADAPTATION_PROFILES,
  evaluatePackageMedia,
  getChannelAdaptationRequirements,
} from './packageWorkflow';
import type { GalleryOutputRecord } from '../domain/gallery/types';

const WS = '11111111-1111-1111-1111-111111111111';
const OTHER_WS = '22222222-2222-2222-2222-222222222222';
const USER = '44444444-4444-4444-4444-444444444444';
const CAMPAIGN = 'campaign-1';

/** Per-test factory: ids restart at out-1 in every test (deterministic). */
function makeOutputFactory() {
  let counter = 0;
  return function makeOutput(overrides: Partial<GalleryOutputRecord> = {}): GalleryOutputRecord {
    counter += 1;
    return {
      id: `out-${counter}`,
      workspaceId: WS,
      contentJobRequestId: 'cjob-1',
      parentGalleryOutputId: null,
      title: `Generated ${counter}`,
      outputType: 'image',
      status: 'approved',
      mediaStoragePath: 'workspaces/priv/media',
      thumbnailStoragePath: null,
      durationSeconds: null,
      width: 1024,
      height: 1024,
      fileSizeBytes: 1024,
      mimeType: 'image/png',
      outputIndex: counter,
      metadata: { provider_generated: true },
      createdBy: USER,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...overrides,
    } as GalleryOutputRecord;
  };
}

interface FixtureOptions {
  outputs?: GalleryOutputRecord[];
  connections?: VerifiedConnectionView[];
  reviewEligible?: boolean;
}

function makeDeps(options: FixtureOptions = {}) {
  const outputs = new Map((options.outputs ?? []).map((output) => [output.id, output]));
  const reviewCalls: Array<{ campaignItemId: string; placement: string }> = [];
  const deps: PackageDependencies = {
    getOutput: async (galleryOutputId, workspaceId) => {
      const output = outputs.get(galleryOutputId);
      if (!output) throw new Error(`Gallery output not found: ${galleryOutputId}`);
      if (output.workspaceId !== workspaceId) {
        throw new Error('You do not have access to this workspace.');
      }
      return structuredClone(output);
    },
    getCampaign: async (campaignId, workspaceId) => {
      if (campaignId !== CAMPAIGN || workspaceId !== WS) {
        throw new Error('You do not have access to this workspace.');
      }
      return { id: CAMPAIGN, workspaceId: WS };
    },
    listVerifiedConnections: async () => options.connections ?? [],
    sendToPublishingReview: async (input) => {
      reviewCalls.push({ campaignItemId: input.campaignItemId, placement: input.placement });
      if (options.reviewEligible === false) {
        return { eligible: false, blockers: ['CONNECTION_REQUIRED'] };
      }
      return { eligible: true, blockers: [] };
    },
  };
  return { deps, reviewCalls };
}

async function makeService(options: FixtureOptions = {}) {
  const store = new InMemoryPackageStore();
  const { deps, reviewCalls } = makeDeps(options);
  const service = new CampaignContentPackageService(store, deps);
  return { service, store, reviewCalls };
}

describe('channel requirements and media evaluation (pure)', () => {
  it('declares per-channel rules and rejects unsupported placement/type', () => {
    const ok = getChannelAdaptationRequirements('instagram', 'reel', 'video');
    expect(ok.supported).toBe(true);
    expect(ok.profile.providerKey).toBe('meta');
    expect(ok.profile.acceptedAspectRatios).toContain('9:16');

    const wrongType = getChannelAdaptationRequirements('tiktok', 'video_post', 'image');
    expect(wrongType.supported).toBe(false);
    expect(wrongType.reasons.join(' ')).toMatch(/not supported/i);

    const wrongPlacement = getChannelAdaptationRequirements('instagram', 'short_video', 'video');
    expect(wrongPlacement.supported).toBe(false);
    expect(wrongPlacement.reasons.join(' ')).toMatch(/not a supported placement/i);
  });

  it('marks aspect mismatch as variant_needed and over-length video as unsupported', () => {
    const profile = CHANNEL_ADAPTATION_PROFILES.instagram;
    const wide = evaluatePackageMedia(profile, { outputType: 'image', durationSeconds: null, width: 1920, height: 1080 }, null);
    expect(wide.adaptationStatus).toBe('variant_needed');

    const cropToStory = evaluatePackageMedia(profile, { outputType: 'image', durationSeconds: null, width: 1920, height: 1080 }, { targetAspectRatio: '9:16' });
    expect(cropToStory.adaptationStatus).toBe('variant_needed');
    expect(cropToStory.notes.join(' ')).toMatch(/crop/i);

    // X accepts 16:9 and 1:1 only: a 9:16 source does not fit, and a 1:1
    // target would crop away more than the safe area — honest unsupported.
    const xProfile = CHANNEL_ADAPTATION_PROFILES.x;
    const upscaleCrop = evaluatePackageMedia(xProfile, { outputType: 'image', durationSeconds: null, width: 1080, height: 1920 }, { targetAspectRatio: '1:1' });
    expect(upscaleCrop.adaptationStatus).toBe('unsupported');
    expect(upscaleCrop.notes.join(' ')).toMatch(/not supported|crop/i);

    const longVideo = evaluatePackageMedia(profile, { outputType: 'video', durationSeconds: 120, width: 1080, height: 1920 }, null);
    expect(longVideo.adaptationStatus).toBe('unsupported');

    const fits = evaluatePackageMedia(profile, { outputType: 'image', durationSeconds: null, width: 1080, height: 1080 }, null);
    expect(fits.adaptationStatus).toBe('source_fits');
  });
});

describe('packaging lifecycle', () => {
  it('packages an approved output for multiple channels; source unchanged', async () => {
    const makeOutput = makeOutputFactory();
    const output = makeOutput();
    const { service, store } = await makeService({ outputs: [output] });

    const ig = await service.createCampaignContentPackage(WS, {
      campaignId: CAMPAIGN,
      channel: 'instagram',
      placement: 'feed_post',
      sourceGalleryOutputId: output.id,
      captionOrCopy: 'Launch day',
    }, USER);
    const pinterest = await service.createCampaignContentPackage(WS, {
      campaignId: CAMPAIGN,
      channel: 'pinterest',
      placement: 'image_post',
      sourceGalleryOutputId: output.id,
      captionOrCopy: 'Launch day',
      destinationUrl: 'https://example.com/launch',
    }, USER);

    expect(ig.channel).toBe('instagram');
    expect(pinterest.channel).toBe('pinterest');
    expect(ig.sourceGalleryOutputId).toBe(output.id);
    expect(pinterest.sourceGalleryOutputId).toBe(output.id);

    const all = await service.listCampaignContentPackages(WS, CAMPAIGN);
    expect(all).toHaveLength(2);

    // The source output object is untouched by packaging.
    const stored = store.packages.get(ig.id)!;
    expect(stored.sourceGalleryOutputId).toBe(output.id);
    expect(output.status).toBe('approved');
    expect(output.title).toBe('Generated 1');
  });

  it('refuses unapproved outputs and unsupported channel/type combinations', async () => {
    const makeOutput = makeOutputFactory();
    const draft = makeOutput({ status: 'ready_for_review' });
    const rejected = makeOutput({ status: 'rejected' });
    const video = makeOutput({ outputType: 'video', durationSeconds: 8, width: 1080, height: 1920 });
    const approvedImage = makeOutput();
    const { service } = await makeService({ outputs: [draft, rejected, video, approvedImage] });

    await expect(
      service.createCampaignContentPackage(WS, {
        campaignId: CAMPAIGN, channel: 'instagram', placement: 'feed_post', sourceGalleryOutputId: draft.id,
      }, USER),
    ).rejects.toThrow(/approved/i);
    await expect(
      service.createCampaignContentPackage(WS, {
        campaignId: CAMPAIGN, channel: 'instagram', placement: 'feed_post', sourceGalleryOutputId: rejected.id,
      }, USER),
    ).rejects.toThrow(/approved/i);
    // TikTok is video-only — an approved image output cannot be packaged there.
    await expect(
      service.createCampaignContentPackage(WS, {
        campaignId: CAMPAIGN, channel: 'tiktok', placement: 'video_post', sourceGalleryOutputId: approvedImage.id,
      }, USER),
    ).rejects.toThrow(/not supported/i);
  });

  it('validation blocks on missing copy, account, item and unsupported media; passes when complete', async () => {
    const makeOutput = makeOutputFactory();
    const fits = makeOutput(); // 1:1 fits instagram feed
    const wide = makeOutput({ width: 1920, height: 1080 });
    const connection: VerifiedConnectionView = { id: 'conn-1', providerKey: 'meta', status: 'connected' };
    const { service } = await makeService({ outputs: [fits, wide], connections: [connection] });

    const complete = await service.createCampaignContentPackage(WS, {
      campaignId: CAMPAIGN, channel: 'instagram', placement: 'feed_post', sourceGalleryOutputId: fits.id,
      captionOrCopy: 'Launch day', connectedAccountId: 'conn-1', campaignItemId: 'item-1',
    }, USER);
    const validated = await service.validateCampaignContentPackage(WS, complete.id);
    expect(validated.validationState).toBe('valid');
    expect(validated.status).toBe('ready_for_review');
    expect(validated.adaptationStatus).toBe('source_fits');

    // Missing copy + account + item → honest per-issue errors.
    const sparse = await service.createCampaignContentPackage(WS, {
      campaignId: CAMPAIGN, channel: 'instagram', placement: 'feed_post', sourceGalleryOutputId: fits.id,
    }, USER);
    const blocked = await service.validateCampaignContentPackage(WS, sparse.id);
    expect(blocked.validationState).toBe('invalid');
    expect(blocked.status).toBe('needs_account');
    expect(blocked.validationErrors.join(' ')).toMatch(/caption or copy/i);
    expect(blocked.validationErrors.join(' ')).toMatch(/verified connected account/i);
    expect(blocked.validationErrors.join(' ')).toMatch(/campaign item/i);

    // Media adaptation needed → needs_media_adaptation, never faked ready.
    const needsCrop = await service.createCampaignContentPackage(WS, {
      campaignId: CAMPAIGN, channel: 'instagram', placement: 'feed_post', sourceGalleryOutputId: wide.id,
      captionOrCopy: 'Launch day', connectedAccountId: 'conn-1', campaignItemId: 'item-1',
    }, USER);
    const cropState = await service.validateCampaignContentPackage(WS, needsCrop.id);
    expect(cropState.adaptationStatus).toBe('variant_needed');
    expect(cropState.status).toBe('needs_media_adaptation');

    // Unverified account is rejected honestly.
    const unverified = await service.createCampaignContentPackage(WS, {
      campaignId: CAMPAIGN, channel: 'instagram', placement: 'feed_post', sourceGalleryOutputId: fits.id,
      captionOrCopy: 'Launch day', connectedAccountId: 'conn-stale', campaignItemId: 'item-1',
    }, USER);
    const staleState = await service.validateCampaignContentPackage(WS, unverified.id);
    expect(staleState.status).toBe('needs_account');
    expect(staleState.validationErrors.join(' ')).toMatch(/not currently verified/i);
  });

  it('records variant requests honestly — requested, never faked as applied', async () => {
    const makeOutput = makeOutputFactory();
    const wide = makeOutput({ width: 1920, height: 1080 });
    const connection: VerifiedConnectionView = { id: 'conn-1', providerKey: 'meta', status: 'connected' };
    const { service, store } = await makeService({ outputs: [wide], connections: [connection] });

    const pkg = await service.createCampaignContentPackage(WS, {
      campaignId: CAMPAIGN, channel: 'instagram', placement: 'feed_post', sourceGalleryOutputId: wide.id,
      captionOrCopy: 'Launch', connectedAccountId: 'conn-1', campaignItemId: 'item-1',
    }, USER);
    const variant = await service.createPackageMediaVariant(WS, pkg.id, { targetAspectRatio: '4:5' }, USER);
    expect(variant.status).toBe('requested');

    const updated = await service.validateCampaignContentPackage(WS, pkg.id);
    // No real transform capability exists yet — stays variant_needed.
    expect(updated.adaptationStatus).toBe('variant_needed');
    expect(updated.status).toBe('needs_media_adaptation');
    expect(updated.mediaVariantReference).toBe(variant.id);

    const events = (await store.listAudit(WS)).map((row) => row.event);
    expect(events).toContain('campaign_package_variant_requested');
    expect(events).not.toContain('campaign_package_validation_passed');
  });

  it('only ready packages enter publishing review; ready ones integrate without auto-publish', async () => {
    const makeOutput = makeOutputFactory();
    const output = makeOutput();
    const connection: VerifiedConnectionView = { id: 'conn-1', providerKey: 'meta', status: 'connected' };
    const { service, store, reviewCalls } = await makeService({ outputs: [output], connections: [connection] });

    const pkg = await service.createCampaignContentPackage(WS, {
      campaignId: CAMPAIGN, channel: 'instagram', placement: 'feed_post', sourceGalleryOutputId: output.id,
      captionOrCopy: 'Launch', connectedAccountId: 'conn-1', campaignItemId: 'item-1',
    }, USER);

    // Not validated → refused.
    await expect(service.sendPackageToPublishingReview(WS, pkg.id, USER)).rejects.toThrow(/ready/i);

    await service.validateCampaignContentPackage(WS, pkg.id);
    const result = await service.sendPackageToPublishingReview(WS, pkg.id, USER);
    expect(result.status).toBe('handed_to_publishing');
    expect(reviewCalls).toHaveLength(1);
    expect(reviewCalls[0]?.placement).toBe('feed_post');

    // Status advanced to handed_to_publishing — the existing review flow takes
    // over from here; nothing was auto-published by this service.
    const stored = store.packages.get(pkg.id)!;
    expect(stored.status).toBe('handed_to_publishing');

    const events = (await store.listAudit(WS)).map((row) => row.event);
    expect(events).toContain('campaign_package_sent_to_review');
  });

  it('surfaces publishing-review blockers honestly and keeps the package not-ready', async () => {
    const makeOutput = makeOutputFactory();
    const output = makeOutput();
    const connection: VerifiedConnectionView = { id: 'conn-1', providerKey: 'meta', status: 'connected' };
    const { service } = await makeService({ outputs: [output], connections: [connection], reviewEligible: false });

    const pkg = await service.createCampaignContentPackage(WS, {
      campaignId: CAMPAIGN, channel: 'instagram', placement: 'feed_post', sourceGalleryOutputId: output.id,
      captionOrCopy: 'Launch', connectedAccountId: 'conn-1', campaignItemId: 'item-1',
    }, USER);
    await service.validateCampaignContentPackage(WS, pkg.id);
    const result = await service.sendPackageToPublishingReview(WS, pkg.id, USER);
    expect(result.status).toBe('ready_for_review');
    expect(result.blockers).toEqual(['CONNECTION_REQUIRED']);

    const after = await service.listCampaignContentPackages(WS, CAMPAIGN);
    expect(after[0]?.status).toBe('ready_for_review');
  });
});

describe('workspace security and audit', () => {
  it('rejects cross-workspace creation and package access', async () => {
    const makeOutput = makeOutputFactory();
    const output = makeOutput();
    const { service } = await makeService({ outputs: [output] });

    await expect(
      service.createCampaignContentPackage(OTHER_WS, {
        campaignId: CAMPAIGN, channel: 'instagram', placement: 'feed_post', sourceGalleryOutputId: output.id,
      }, USER),
    ).rejects.toThrow(/access to this workspace/);

    const pkg = await service.createCampaignContentPackage(WS, {
      campaignId: CAMPAIGN, channel: 'instagram', placement: 'feed_post', sourceGalleryOutputId: output.id,
    }, USER);
    await expect(service.validateCampaignContentPackage(OTHER_WS, pkg.id)).rejects.toThrow(/access to this workspace/);
    await expect(service.sendPackageToPublishingReview(OTHER_WS, pkg.id, USER)).rejects.toThrow(/access to this workspace/);
    const otherList = await service.listCampaignContentPackages(OTHER_WS, CAMPAIGN);
    expect(otherList).toHaveLength(0);
  });

  it('audits the full package lifecycle', async () => {
    const makeOutput = makeOutputFactory();
    const output = makeOutput();
    const connection: VerifiedConnectionView = { id: 'conn-1', providerKey: 'meta', status: 'connected' };
    const { service, store } = await makeService({ outputs: [output], connections: [connection] });

    const pkg = await service.createCampaignContentPackage(WS, {
      campaignId: CAMPAIGN, channel: 'instagram', placement: 'feed_post', sourceGalleryOutputId: output.id,
      connectedAccountId: 'conn-1', campaignItemId: 'item-1',
    }, USER);
    await service.updateCampaignContentPackage(WS, pkg.id, { captionOrCopy: 'Updated copy' }, USER);
    await service.validateCampaignContentPackage(WS, pkg.id);
    await service.sendPackageToPublishingReview(WS, pkg.id, USER);

    const events = (await store.listAudit(WS)).map((row) => row.event);
    expect(events).toContain('campaign_package_created');
    expect(events).toContain('campaign_package_updated');
    expect(events).toContain('campaign_package_validation_passed');
    expect(events).toContain('campaign_package_sent_to_review');
  });
});
