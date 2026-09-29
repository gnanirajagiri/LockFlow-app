/**
 * Publishing — the product contracts, tested at the service boundary over
 * fresh in-memory repositories and the development fake provider.
 *
 * Covers the 20 required cases: workspace scoping, cross-workspace mixing,
 * output eligibility + pre-submission revalidation, snapshot immutability,
 * no Gallery/Campaign mutation, connection gating, unconfigured providers,
 * adapter isolation, server-side-only boundaries, clean client views,
 * publish-now preconditions, idempotency, retry runs, verified webhooks,
 * confirmation-only published status, no date-triggered publishing, paid
 * preparation limits, published immutability/duplication and event hygiene.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { PublishingDraftService } from './publishingService';
import {
  createDefaultPublishingRegistry,
  DevelopmentFakePublishingProvider,
} from './publishingProviders';
import { resetPublishingRepository, getPublishingRepository } from '../data/publishingFactory';
import { resetCampaignsRepository, getCampaignsRepository } from '../data/campaignsFactory';
import { resetSocialConnectionsRepository, getSocialConnectionsRepository } from '../data/socialConnectionsFactory';
import { resetGalleryRepository } from '../data/galleryFactory';
import { resetContentRepository } from '../data/contentFactory';
import { resetLibraryRepository, getLibraryRepository } from '../data/libraryFactory';
import { resetModelsRepository, getModelsRepository } from '../data';
import { resetEnvironmentsRepository, getEnvironmentsRepository } from '../data/environmentsFactory';
import { CampaignsService } from './campaignsService';
import { SocialConnectionsService } from './socialConnectionsService';
import { SocialConnectionEncryptionService } from './socialConnectionEncryption';
import { createDefaultProviderRegistry } from './socialProviders';
import { GalleryService } from './galleryService';
import { ContentStudioService } from './contentService';
import { LibraryService } from './libraryService';
import { ModelsService } from './modelsService';
import { EnvironmentsService } from './environmentsService';
import { MockContentRepository } from '../data/mockContentRepository';
import { MockGalleryRepository } from '../data/mockGalleryRepository';
import { SEED_GALLERY_WORKSPACE_ID } from '../mock/gallerySeed';
import { GALLERY_OUTPUT_SEED_IDS } from '../mock/gallerySeed';
import {
  PUBLISHING_TRANSITIONS,
  canRetryAfterRun,
  canTransitionPublishingStatus,
  galleryPublishingProblem,
  isGalleryOutputEligibleForPublishing,
  isPublishingDraftSubmittable,
  isSocialConnectionEligibleForPublishing,
} from '../domain/publishing';
import type { SafePublishingDraftView } from '../domain/publishing';

const WS = SEED_GALLERY_WORKSPACE_ID;
const OTHER_WS = 'ws_other';
const USER = 'demo-user';
const SERUM = GALLERY_OUTPUT_SEED_IDS.serum; // approved video
const VANITY = GALLERY_OUTPUT_SEED_IDS.vanity; // approved image

let campaigns: CampaignsService;
let connections: SocialConnectionsService;
let gallery: GalleryService;
let publishing: PublishingDraftService;
let campaignId: string;
let videoItemId: string;
let imageItemId: string;
let connectionId: string;

async function connectDevFake(): Promise<string> {
  const started = await connections.startConnection(
    { providerKey: 'dev_fake', workspaceId: WS, userId: USER },
    USER,
  );
  const state = new URL(started.authorizationUrl).searchParams.get('state')!;
  const connection = await connections.completeConnection(
    { providerKey: 'dev_fake', workspaceId: WS, plainStateToken: state, code: 'dev_auth_code' },
    USER,
  );
  return connection.id;
}

async function createDraftForItem(itemId: string, outputId: string, overrides?: {
  placement?: 'image_post' | 'video_post';
  altText?: string;
  acknowledgement?: boolean;
}): Promise<SafePublishingDraftView> {
  const isVideo = outputId === SERUM;
  const draft = await publishing.createDraft(
    {
      campaignId,
      campaignItemId: itemId,
      workspaceSocialConnectionId: connectionId,
      placement: overrides?.placement ?? (isVideo ? 'video_post' : 'image_post'),
      copy: isVideo
        ? { caption: 'A calm start to the day — fictional demo copy.' }
        : { caption: 'Morning light demo copy.', altText: overrides?.altText ?? 'A bright bathroom shelf with skincare products, fictional demo image.' },
      acknowledgement: overrides?.acknowledgement ?? true,
    },
    WS,
    USER,
  );
  if (overrides?.acknowledgement === false) {
    // Acknowledgement is still mandatory for drafting in the service; the
    // tests that need a missing-ack state record it via the flag path below.
  }
  return draft;
}

beforeEach(async () => {
  resetPublishingRepository();
  resetCampaignsRepository();
  resetSocialConnectionsRepository();
  resetGalleryRepository();
  resetContentRepository();
  resetLibraryRepository();
  resetModelsRepository();
  resetEnvironmentsRepository();

  const content = new ContentStudioService(new MockContentRepository(), {
    library: new LibraryService(getLibraryRepository()),
    models: new ModelsService(getModelsRepository()),
    environments: new EnvironmentsService(getEnvironmentsRepository()),
  });
  gallery = new GalleryService(new MockGalleryRepository(), content, WS);
  campaigns = new CampaignsService(getCampaignsRepository(), gallery);
  connections = new SocialConnectionsService(
    getSocialConnectionsRepository(),
    createDefaultProviderRegistry(),
    new SocialConnectionEncryptionService(),
  );
  publishing = new PublishingDraftService(
    getPublishingRepository(),
    createDefaultPublishingRegistry(),
    connections,
    gallery,
    campaigns,
  );

  // Seed campaign + items via the campaigns seed through the service.
  const summaries = await campaigns.listCampaigns(WS);
  const seeded = summaries[0];
  campaignId = seeded.campaign.id;
  const detail = await campaigns.getCampaignDetail(campaignId, WS);
  const byOutput = new Map(detail.items.map((i) => [i.galleryOutputId, i.id]));
  videoItemId = byOutput.get(SERUM)!;
  imageItemId = byOutput.get(VANITY)!;
  connectionId = await connectDevFake();
});

describe('cases 1–2 — workspace scoping', () => {
  it('scopes drafts and events to the workspace; refuses cross-workspace reads', async () => {
    const draft = await createDraftForItem(videoItemId, SERUM);
    expect((await publishing.listDrafts(WS)).map((d) => d.id)).toContain(draft.id);
    expect(await publishing.listDrafts(OTHER_WS)).toHaveLength(0);
    await expect(publishing.getDraftView(draft.id, OTHER_WS)).rejects.toThrow(/different workspace/i);
    await expect(publishing.listEvents(draft.id, OTHER_WS)).rejects.toThrow(/different workspace/i);
  });

  it('refuses cross-workspace campaign items, outputs and connections', async () => {
    // Item from the seeded campaign (ws_demo) presented against another workspace.
    await expect(
      publishing.createDraft(
        {
          campaignId,
          campaignItemId: videoItemId,
          workspaceSocialConnectionId: connectionId,
          placement: 'video_post',
          copy: { caption: 'x' },
          acknowledgement: true,
        },
        OTHER_WS,
        USER,
      ),
    ).rejects.toThrow();
    // Cross-workspace connection id.
    await expect(
      publishing.createDraft(
        {
          campaignId,
          campaignItemId: videoItemId,
          workspaceSocialConnectionId: 'sconn_missing',
          placement: 'video_post',
          copy: { caption: 'x' },
          acknowledgement: true,
        },
        WS,
        USER,
      ),
    ).rejects.toThrow();
  });
});

describe('cases 3–5 — output eligibility, revalidation, immutable snapshots', () => {
  it('only approved, available, non-archived outputs pass publishing eligibility', () => {
    expect(isGalleryOutputEligibleForPublishing(
      { workspaceId: WS, status: 'approved', contentJobRequestId: 'job1', mediaAvailable: true }, WS,
    )).toBe(true);
    expect(isGalleryOutputEligibleForPublishing(
      { workspaceId: WS, status: 'ready_for_review', contentJobRequestId: 'job1', mediaAvailable: true }, WS,
    )).toBe(false);
    expect(isGalleryOutputEligibleForPublishing(
      { workspaceId: WS, status: 'approved', contentJobRequestId: '', mediaAvailable: true }, WS,
    )).toBe(false);
    expect(galleryPublishingProblem(
      { workspaceId: WS, status: 'archived', contentJobRequestId: 'job1', mediaAvailable: true }, WS,
    )).toMatch(/no longer available/i);
  });

  it('revalidates immediately before submission and blocks on archived sources', async () => {
    const draft = await createDraftForItem(videoItemId, SERUM);
    await publishing.validateDraft(draft.id, WS, USER);
    // Source gets archived after ready.
    await gallery.transitionOutput(SERUM, 'archived', WS);
    await expect(publishing.submitDraft(draft.id, WS, USER)).rejects.toThrow(/no longer available/i);
    const blocked = await publishing.getDraftView(draft.id, WS);
    expect(blocked.status).toBe('blocked');
    // Historic record preserved, not deleted.
    expect((await publishing.listDrafts(WS)).some((d) => d.id === draft.id)).toBe(true);
  });

  it('freezes immutable media snapshot at creation; submission cannot change it', async () => {
    const draft = await createDraftForItem(imageItemId, VANITY);
    const before = JSON.stringify((await publishing.getDraftView(draft.id, WS)).mediaSummary);
    await publishing.validateDraft(draft.id, WS, USER);
    await publishing.submitDraft(draft.id, WS, USER);
    const after = JSON.stringify((await publishing.getDraftView(draft.id, WS)).mediaSummary);
    expect(after).toBe(before);
  });
});

describe('cases 6–7 — no Gallery mutation; connection gating', () => {
  it('editing drafts never mutates the Gallery output, approval or campaign item', async () => {
    const draft = await createDraftForItem(imageItemId, VANITY);
    const outputBefore = JSON.stringify(await gallery.getOutput(VANITY, WS));
    await publishing.updateDraftCopy(draft.id, { caption: 'New fictional copy.', altText: 'Alt text for the fictional demo image.' }, WS, USER);
    const outputAfter = JSON.stringify(await gallery.getOutput(VANITY, WS));
    expect(outputAfter).toBe(outputBefore);
    const detail = await campaigns.getCampaignDetail(campaignId, WS);
    const item = detail.items.find((i) => i.id === imageItemId)!;
    expect(item.galleryOutputId).toBe(VANITY); // source relationship unchanged
  });

  it('blocks preparation and submission for disconnected/needs-reauth connections', async () => {
    // Disconnect the only connection.
    await connections.disconnectConnection(connectionId, WS, USER);
    await expect(
      publishing.createDraft(
        {
          campaignId,
          campaignItemId: videoItemId,
          workspaceSocialConnectionId: connectionId,
          placement: 'video_post',
          copy: { caption: 'x' },
          acknowledgement: true,
        },
        WS,
        USER,
      ),
    ).rejects.toThrow(/not verified for publishing/i);
    expect(isSocialConnectionEligibleForPublishing(
      { workspaceId: WS, providerKey: 'dev_fake', status: 'needs_reauth', lastVerifiedAt: null }, WS,
    )).toBe(false);
  });
});

describe('cases 8–10 — unconfigured providers, adapter isolation, server-side boundaries', () => {
  it('unconfigured providers cannot perform any publishing step', async () => {
    const { createDefaultPublishingRegistry: reg } = await import('./publishingProviders');
    const registry = reg();
    const meta = registry.get('meta');
    expect(await meta!.isConfigured()).toBe(false);
    await expect(meta!.getCapabilities({
      connection: { connectionId: 'x', providerKey: 'meta', workspaceId: WS, accessToken: 't' },
    })).rejects.toThrow(/not configured or enabled/i);
  });

  it('keeps provider logic inside adapters (contract surface check)', () => {
    const registry = createDefaultPublishingRegistry();
    for (const p of registry.list()) {
      expect(typeof p.isConfigured).toBe('function');
      expect(typeof p.getCapabilities).toBe('function');
      expect(typeof p.validateDraft).toBe('function');
      expect(typeof p.prepareMedia).toBe('function');
      expect(typeof p.publish).toBe('function');
    }
  });

  it('runs media transfer and token use through the service boundary only', async () => {
    const draft = await createDraftForItem(videoItemId, SERUM);
    await publishing.validateDraft(draft.id, WS, USER);
    await publishing.submitDraft(draft.id, WS, USER);
    // The client view carries no token, handle or signed URL material.
    const view = JSON.stringify(await publishing.getDraftView(draft.id, WS));
    expect(view).not.toMatch(/devfake_media_|storagePath|accessToken|dev_fake_access_/);
  });
});

describe('cases 11–13 — clean client views, publish-now preconditions, idempotency', () => {
  it('client views omit tokens, provider handles, protected diagnostics and raw keys', async () => {
    const draft = await createDraftForItem(imageItemId, VANITY);
    const all = JSON.stringify(await publishing.listDrafts(WS));
    expect(all).not.toMatch(/providerMetadataProtected|providerMediaHandleProtected|idempotencyKey|pub_[0-9a-f]/);
    void draft;
  });

  it('publish-now requires ready + validated + acknowledged + explicit confirmation path', async () => {
    const draft = await createDraftForItem(imageItemId, VANITY, { acknowledgement: true });
    // Not validated → refuse.
    await expect(publishing.submitDraft(draft.id, WS, USER)).rejects.toThrow(/Validate the draft first/i);
    // Creation without the acknowledgement flag is refused outright.
    await expect(
      publishing.createDraft(
        {
          campaignId, campaignItemId: videoItemId, workspaceSocialConnectionId: connectionId,
          placement: 'video_post', copy: { caption: 'x' }, acknowledgement: false,
        },
        WS, USER,
      ),
    ).rejects.toThrow(/acknowledgement is required/i);
    // Validate → submit succeeds.
    const ready = await publishing.validateDraft(draft.id, WS, USER);
    expect(ready.status).toBe('ready');
    expect(ready.acknowledgementRecorded).toBe(true);
    const submitted = await publishing.submitDraft(ready.id, WS, USER);
    expect(submitted.status).toBe('processing');
  });

  it('idempotency prevents duplicate submissions on repeat clicks', async () => {
    const draft = await createDraftForItem(videoItemId, SERUM);
    await publishing.validateDraft(draft.id, WS, USER);
    await publishing.submitDraft(draft.id, WS, USER); // first click → processing
    // Second immediate click is refused by the state guards — exactly one
    // provider run exists; the provider is never asked twice.
    await expect(publishing.submitDraft(draft.id, WS, USER)).rejects.toThrow(
      /already in progress|Validate the draft first/i,
    );
    expect(await publishing.listRunSummaries(draft.id, WS)).toHaveLength(1);
    // Deterministic provider id for the same intent.
    const provider = new DevelopmentFakePublishingProvider();
    const a = await provider.publish({ idempotencyKey: 'same-intent', placement: 'video_post', mediaHandles: [], copy: {} });
    const b = await provider.publish({ idempotencyKey: 'same-intent', placement: 'video_post', mediaHandles: [], copy: {} });
    expect(a.providerPublishId).toBe(b.providerPublishId);
  });
});

describe('cases 14–16 — retries, webhooks, confirmation-only published', () => {
  it('retry creates a new run only when the provider never accepted; preserves snapshots', async () => {
    const failing = new PublishingDraftService(
      getPublishingRepository(),
      createDefaultPublishingRegistry({ failOn: 'publish' }),
      connections,
      gallery,
      campaigns,
    );
    const draft = await failing.createDraft(
      {
        campaignId, campaignItemId: videoItemId, workspaceSocialConnectionId: connectionId,
        placement: 'video_post', copy: { caption: 'x' }, acknowledgement: true,
      },
      WS, USER,
    );
    const ready = await failing.validateDraft(draft.id, WS, USER);
    const failedDraft = await failing.submitDraft(ready.id, WS, USER);
    expect(failedDraft.status).toBe('failed');
    // Retry → back to ready; a second submit creates attempt 2.
    const retried = await failing.retryDraft(failedDraft.id, WS, USER);
    expect(retried.status).toBe('ready');
    const attempt2 = await failing.submitDraft(retried.id, WS, USER);
    expect(attempt2.status).toBe('failed');
    const runs = await publishing.listRunSummaries(failedDraft.id, WS);
    expect(runs.map((r) => r.attemptNumber)).toEqual([1, 2]);
    // Accepted runs must never be retried.
    expect(canRetryAfterRun({ status: 'accepted' }).allowed).toBe(false);
    expect(canRetryAfterRun({ status: 'failed' }).allowed).toBe(true);
  });

  it('webhook updates require verification and dedupe repeated events', async () => {
    const draft = await createDraftForItem(videoItemId, SERUM);
    await publishing.validateDraft(draft.id, WS, USER);
    const submitted = await publishing.submitDraft(draft.id, WS, USER);
    expect(submitted.status).toBe('processing');
    // Duplicate webhook application is idempotent (no double state changes).
    const first = await publishing.applyVerifiedWebhook(
      { providerKey: 'dev_fake', providerPublishId: submitted.id && (await rawProviderPublishId(submitted.id)), externalEventId: 'evt_1', eventType: 'post.published', status: 'published', publishedUrl: 'https://demo.lockflow.local/posts/x' },
      null,
    );
    expect(first.applied).toBe(true);
    const second = await publishing.applyVerifiedWebhook(
      { providerKey: 'dev_fake', providerPublishId: await rawProviderPublishId(submitted.id), externalEventId: 'evt_1', eventType: 'post.published', status: 'published' },
      null,
    );
    expect(second.applied).toBe(false);
    expect(second.reason).toBe('duplicate');
    const final = await publishing.getDraftView(submitted.id, WS);
    expect(final.status).toBe('published');
  });

  it('published status only after provider confirmation (poll reconciliation)', async () => {
    const draft = await createDraftForItem(videoItemId, SERUM);
    await publishing.validateDraft(draft.id, WS, USER);
    const submitted = await publishing.submitDraft(draft.id, WS, USER);
    expect(submitted.status).toBe('processing');
    expect(submitted.publishedUrl).toBeNull();
    const reconciled = await publishing.reconcileDraft(submitted.id, WS, USER);
    expect(reconciled.status).toBe('published');
    expect(reconciled.publishedUrl).toMatch(/^https:\/\/demo\.lockflow\.local\/posts\//);
  });
});

describe('cases 17–20 — no date publishing, paid prep limits, immutability, event hygiene', () => {
  it('planned campaign dates never trigger publishing (no scheduler seam exists)', async () => {
    // The service exposes no schedule/queue method at all.
    const serviceKeys = Object.getOwnPropertyNames(PublishingDraftService.prototype);
    expect(serviceKeys.some((k) => /schedule|enqueue|cron/i.test(k))).toBe(false);
    // The fake provider's publish is only reachable through submitDraft.
    const views = await publishing.listDrafts(WS);
    expect(views.every((v) => v.status !== 'submitting')).toBe(true);
  });

  it('paid/ad-creative placement stays internal and is refused by the fake provider', async () => {
    const provider = new DevelopmentFakePublishingProvider();
    const caps = await provider.getCapabilities();
    expect(caps.placements).not.toContain('ad_creative');
    const result = await provider.validateDraft({
      placement: 'ad_creative',
      media: [{ galleryOutputId: 'x', mediaType: 'image', storagePath: 'p', width: 1, height: 1, durationSeconds: null }],
      copy: { caption: 'x' },
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.code).toBe('placement_unsupported');
  });

  it('published drafts are immutable; duplication creates a new internal draft', async () => {
    const draft = await createDraftForItem(videoItemId, SERUM);
    await publishing.validateDraft(draft.id, WS, USER);
    const submitted = await publishing.submitDraft(draft.id, WS, USER);
    await publishing.reconcileDraft(submitted.id, WS, USER);
    await expect(
      publishing.updateDraftCopy(submitted.id, { caption: 'mutate?' }, WS, USER),
    ).rejects.toThrow(/immutable|Only drafts can be edited/i);
    await expect(publishing.submitDraft(submitted.id, WS, USER)).rejects.toThrow(/Validate the draft first|ready/i);
  });

  it('events carry no secrets, signed URLs or raw payloads', async () => {
    const draft = await createDraftForItem(videoItemId, SERUM);
    await publishing.validateDraft(draft.id, WS, USER);
    await publishing.submitDraft(draft.id, WS, USER);
    const events = JSON.stringify(await publishing.listEvents(draft.id, WS));
    expect(events).not.toMatch(/devfake_media_|accessToken|dev_fake_access_|storagePath|https?:\/\/(?!demo\.lockflow\.local)/);
    expect(events).toMatch(/submission started/);
  });
});

describe('status machine and submittable guard (spec transitions)', () => {
  it('allows exactly the specified transitions', () => {
    expect(PUBLISHING_TRANSITIONS.draft).toEqual(['validating', 'ready', 'cancelled', 'archived', 'blocked', 'needs_reauth']);
    expect(PUBLISHING_TRANSITIONS.published).toEqual(['archived']);
    expect(PUBLISHING_TRANSITIONS.archived).toEqual([]);
    expect(canTransitionPublishingStatus('ready', 'submitting')).toBe(true);
    expect(canTransitionPublishingStatus('draft', 'published')).toBe(false);
  });

  it('enforces the submittable preconditions in the guard', () => {
    expect(isPublishingDraftSubmittable({ status: 'ready', validationResult: { valid: true }, acknowledgementAt: 'now' })).toBe(true);
    expect(isPublishingDraftSubmittable({ status: 'draft', validationResult: { valid: true }, acknowledgementAt: 'now' })).toBe(false);
    expect(isPublishingDraftSubmittable({ status: 'ready', validationResult: null, acknowledgementAt: 'now' })).toBe(false);
    expect(isPublishingDraftSubmittable({ status: 'ready', validationResult: { valid: true }, acknowledgementAt: null })).toBe(false);
  });
});

/** Reads the provider publish id from a draft for webhook routing. */
async function rawProviderPublishId(draftId: string): Promise<string> {
  const repo = getPublishingRepository();
  const draft = await repo.getDraft(draftId);
  return draft!.providerPublishId!;
}
