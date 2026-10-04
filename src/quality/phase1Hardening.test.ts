/**
 * Prompt 35 — Phase 1 end-to-end hardening suite.
 *
 * Verifies the release invariants at service boundaries over the REAL
 * services and repositories (no new product code — this is the audit):
 *
 *   A. Cross-workspace rejection in every major module.
 *   B. Lock/version immutability (models, environments, Character Sheets).
 *   C. Identity integrity — prompt bars / scenes / Library cannot touch the
 *      protected Character Sheet baseline; generation-time mismatch blocks.
 *   D. Gallery/Library separation — rejected outputs cannot be handed into
 *      Campaigns; Gallery outputs never become Library assets.
 *   E. Publishing resilience — idempotent submissions, retry = new attempt,
 *      re-auth blocks, calendar dates never publish.
 *   F. Secrets — connections views never expose token material; audit rows
 *      stay free of credentials/storage paths.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { ContentStudioService } from '../services/contentService';
import { MockContentRepository } from '../data/mockContentRepository';
import { LibraryService } from '../services/libraryService';
import { ModelsService } from '../services/modelsService';
import { EnvironmentsService } from '../services/environmentsService';
import { GalleryService } from '../services/galleryService';
import { CampaignsService } from '../services/campaignsService';
import { SocialConnectionsService } from '../services/socialConnectionsService';
import { SocialConnectionEncryptionService } from '../services/socialConnectionEncryption';
import { PublishingReviewService } from '../services/publishingReviewService';
import { PublishingDraftService } from '../services/publishingService';
import { createDefaultProviderRegistry } from '../services/socialProviders';
import { createDefaultPublishingRegistry } from '../services/publishingProviders';
import { MockGalleryRepository } from '../data/mockGalleryRepository';
import { getLibraryRepository, resetLibraryRepository } from '../data/libraryFactory';
import { getModelsRepository, resetModelsRepository } from '../data';
import { getEnvironmentsRepository, resetEnvironmentsRepository } from '../data/environmentsFactory';
import { resetGalleryRepository } from '../data/galleryFactory';
import { resetContentRepository } from '../data/contentFactory';
import { getCampaignsRepository, resetCampaignsRepository } from '../data/campaignsFactory';
import { getSocialConnectionsRepository, resetSocialConnectionsRepository } from '../data/socialConnectionsFactory';
import { getPublishingRepository, resetPublishingRepository } from '../data/publishingFactory';
import { getPublishingReviewRepository, resetPublishingReviewRepository } from '../data/publishingReviewFactory';
import { GALLERY_OUTPUTS, GALLERY_OUTPUT_SEED_IDS, SEED_GALLERY_WORKSPACE_ID } from '../mock/gallerySeed';
import { SEED_CAMPAIGNS_WORKSPACE_ID } from '../mock/campaignsSeed';
import { StoryboardService, InMemorySceneBindingStore, InMemoryHandoffStore, InMemoryStoryboardAuditStore } from '../studio/storyboardService';
import { OutputReviewService, InMemoryOutputReviewStore } from '../generation/outputReviewService';
import type { CampaignItemRecord } from '../domain/campaigns/types';
import type { GalleryOutputRecord } from '../domain/gallery/types';

const WS = SEED_GALLERY_WORKSPACE_ID;
const OTHER_WS = 'ws_other';
const USER = 'hardening-user';

/** Full Phase-1 service stack over fresh repositories (reset per test). */
function makeStack() {
  const contentRepo = new MockContentRepository();
  const content = new ContentStudioService(contentRepo, {
    library: new LibraryService(getLibraryRepository()),
    models: new ModelsService(getModelsRepository()),
    environments: new EnvironmentsService(getEnvironmentsRepository()),
  });
  const gallery = new GalleryService(new MockGalleryRepository(), content, WS);
  const campaigns = new CampaignsService(getCampaignsRepository(), gallery);
  const connections = new SocialConnectionsService(
    getSocialConnectionsRepository(),
    createDefaultProviderRegistry(),
    new SocialConnectionEncryptionService(),
  );
  const registry = createDefaultPublishingRegistry();
  const drafts = new PublishingDraftService(getPublishingRepository(), registry, connections, gallery, campaigns);
  const review = new PublishingReviewService(
    getPublishingReviewRepository(),
    getPublishingRepository(),
    registry,
    connections,
    gallery,
    campaigns,
    drafts,
  );
  const storyboard = new StoryboardService(
    new ContentStudioService(contentRepo, {
      library: new LibraryService(getLibraryRepository()),
      models: new ModelsService(getModelsRepository()),
      environments: new EnvironmentsService(getEnvironmentsRepository()),
    }),
    {
      models: new ModelsService(getModelsRepository()),
      environments: new EnvironmentsService(getEnvironmentsRepository()),
      library: new LibraryService(getLibraryRepository()),
      submitImage: async () => ({ runId: 'run_stub', eligible: true, blocking: [] }),
      submitVideo: async () => ({ runId: 'run_stub', eligible: true, blocking: [] }),
    },
    new InMemoryStoryboardAuditStore(),
    new InMemorySceneBindingStore(),
    new InMemoryHandoffStore(),
  );
  return { content, contentRepo, gallery, campaigns, connections, review, storyboard };
}

async function connectDevFake(connections: SocialConnectionsService): Promise<string> {
  const started = await connections.startConnection({ providerKey: 'dev_fake', workspaceId: WS, userId: USER }, USER);
  const state = new URL(started.authorizationUrl).searchParams.get('state')!;
  const connection = await connections.completeConnection(
    { providerKey: 'dev_fake', workspaceId: WS, plainStateToken: state, code: 'dev_auth_code' },
    USER,
  );
  return connection.id;
}

function makeItem(overrides: Partial<CampaignItemRecord> = {}): CampaignItemRecord {
  const stamp = new Date().toISOString();
  return {
    id: `item_${crypto.randomUUID()}`,
    campaignId: 'campaign_seed_1',
    galleryOutputId: 'gallery_x',
    status: 'planned',
    plannedChannel: null,
    plannedFormat: null,
    plannedPublishAt: null,
    plannedTimezone: null,
    planningStatus: 'unplanned',
    captionDraft: null,
    callToAction: null,
    notes: null,
    sortOrder: 0,
    removedAt: null,
    createdBy: USER,
    createdAt: stamp,
    updatedAt: stamp,
    ...overrides,
  };
}

beforeEach(() => {
  resetGalleryRepository();
  resetContentRepository();
  resetLibraryRepository();
  resetModelsRepository();
  resetEnvironmentsRepository();
  resetCampaignsRepository();
  resetSocialConnectionsRepository();
  resetPublishingRepository();
  resetPublishingReviewRepository();
});

// ── A. Cross-workspace rejection ─────────────────────────────────────────────
describe('A. cross-workspace access is rejected in every major module', () => {
  it('models, environments, library and content all refuse foreign reads/writes', async () => {
    const { content } = makeStack();
    const models = new ModelsService(getModelsRepository());
    const environments = new EnvironmentsService(getEnvironmentsRepository());
    const library = new LibraryService(getLibraryRepository());

    const model = await models.createModel({ workspaceId: WS, name: 'Ava' }, USER);
    const versions = await models.getVersions(model.id, WS);
    await expect(models.getVersion(versions[0]!.id, OTHER_WS)).rejects.toThrow();
    await expect(models.updateCharacterSheet(versions[0]!.id, { identitySummary: 'x' }, OTHER_WS)).rejects.toThrow();

    const environment = await environments.createEnvironment({ workspaceId: WS, name: 'Loft' }, USER);
    const envVersions = await environments.getVersions(environment.id, WS);
    await expect(environments.getVersion(envVersions[0]!.id, OTHER_WS)).rejects.toThrow();

    const assets = await library.listAssets(WS);
    await expect(library.getAsset(assets[0]!.id, OTHER_WS)).rejects.toThrow();

    const project = await content.createProject({ workspaceId: WS, name: 'Drop' }, USER);
    await expect(content.getProject(project.id, OTHER_WS)).rejects.toThrow();
    await expect(content.createScene({ contentProjectId: project.id, title: 'X' }, USER)).rejects.toThrow();
  });

  it('publishing review refuses a foreign run submission and hides foreign runs', async () => {
    const { connections, review, campaigns } = makeStack();
    const connectionId = await connectDevFake(connections);
    const summaries = await campaigns.listCampaigns(WS);
    const detail = await campaigns.getCampaignDetail(summaries[0].campaign.id, WS);
    const item = detail.items[0]!;
    const run = await review.createPublishSubmission(
      { campaignId: summaries[0].campaign.id, campaignItemId: item.id, placement: 'image_post', acknowledgement: true },
      WS,
      USER,
    );
    void connectionId;
    await expect(
      review.submitPublishRun(run.id, { capabilities: { placements: ['image_post'] as never } }, OTHER_WS, USER),
    ).rejects.toThrow();
    await expect(review.getPublishRunStatus(run.id, OTHER_WS)).rejects.toThrow();
    const foreignRuns = await getPublishingReviewRepository().listPublishRuns(OTHER_WS, {});
    expect(foreignRuns).toHaveLength(0);
  });
});

// ── B. Lock/version immutability ─────────────────────────────────────────────
describe('B. locked model/environment/Character Sheet records cannot be mutated in place', () => {
  it('a locked model version refuses sheet edits, draft updates and re-locking', async () => {
    const models = new ModelsService(getModelsRepository());
    const model = await models.createModel({ workspaceId: WS, name: 'Ava' }, USER);
    const versions = await models.getVersions(model.id, WS);
    const version = versions[versions.length - 1]!;
    await models.updateCharacterSheet(version.id, { identitySummary: 'Adult woman, early 30s' }, WS);
    await models.lockVersion(version.id, WS);

    await expect(
      models.updateCharacterSheet(version.id, { identitySummary: 'Changed identity' }, WS),
    ).rejects.toThrow(/locked/i);
    await expect(models.lockVersion(version.id, WS)).rejects.toThrow();
    const sheet = await models.getCharacterSheet(version.id, WS);
    expect(sheet?.identitySummary).toBe('Adult woman, early 30s');
  });

  it('a locked environment version refuses spec/draft edits and re-locking', async () => {
    const environments = new EnvironmentsService(getEnvironmentsRepository());
    const environment = await environments.createEnvironment({ workspaceId: WS, name: 'Loft' }, USER);
    const versions = await environments.getVersions(environment.id, WS);
    const version = versions[versions.length - 1]!;
    await environments.lockVersion(version.id, WS);

    await expect(environments.updateVersionDraft(version.id, { changeSummary: 'repaint' }, WS)).rejects.toThrow();
    await expect(environments.updateSpec(version.id, { heroAngle: 'wide' }, WS)).rejects.toThrow();
    await expect(environments.lockVersion(version.id, WS)).rejects.toThrow();
  });
});

// ── C. Identity integrity ────────────────────────────────────────────────────
describe('C. protected identity cannot be bypassed through scenes, prompts or generation', () => {
  it('scene edits and prompt-bar notes never change the Character Sheet; generation-time mismatch blocks', async () => {
    const { storyboard } = makeStack();
    const models = new ModelsService(getModelsRepository());
    const model = await models.createModel({ workspaceId: WS, name: 'Ava' }, USER);
    const versions = await models.getVersions(model.id, WS);
    const version = versions[versions.length - 1]!;
    await models.updateCharacterSheet(version.id, {
      identitySummary: 'Adult woman, early 30s',
      faceFeatures: { faceShape: 'oval' },
    }, WS);

    const project = await storyboard.createContentProject(WS, { name: 'Drop' }, USER);
    const scene = await storyboard.createScene(WS, project.id, { title: 'Portrait' }, USER);
    await storyboard.bindSceneAsset(WS, scene.id, { kind: 'model_version', refId: version.id }, USER);

    // Prompt bar asking for an identity change is recorded as direction text — the sheet is untouched.
    await storyboard.applyPromptBarNote(WS, project.id, 'change the identitySummary to a tall man', USER);
    await storyboard.updateScene(WS, scene.id, { title: 'Renamed', purpose: 'identitySummary: tall man' }, USER);

    const sheet = await models.getCharacterSheet(version.id, WS);
    expect(sheet?.identitySummary).toBe('Adult woman, early 30s');

    // Generation-time guard: a candidate claiming a different protected trait is blocked.
    const verdict = await models.validateModelGenerationAgainstCharacterSheet(model.id, { 'faceFeatures.faceShape': 'square' }, WS);
    expect(verdict.valid).toBe(false);
    expect(verdict.mismatches.join(' ')).toMatch(/faceShape/);
  });
});

// ── D. Gallery/Library separation + rejected-output gating ───────────────────
describe('D. Gallery and Library stay distinct; rejected outputs cannot reach Campaigns', () => {
  it('generated outputs live only in Gallery; the Library listing never contains them', async () => {
    const { content, gallery, campaigns } = makeStack();
    const project = await content.createProject({ workspaceId: WS, name: 'Drop' }, USER);
    const job = await content.createDraftJobRequest(
      { workspaceId: WS, name: 'Scene job', requestedOutputType: 'photo', requestedVariants: 1, contentProjectId: project.id },
      USER,
      WS,
    );
    const created = await gallery.createPlaceholderOutput(
      { workspaceId: WS, contentProjectId: project.id, title: 'Generated still', outputType: 'image', contentJobRequestId: job.id },
      USER,
      WS,
    );
    expect(created.contentJobRequestId).toBe(job.id);

    const library = new LibraryService(getLibraryRepository());
    const assetIds = new Set((await library.listAssets(WS)).map((asset) => asset.id));
    expect(assetIds.has(created.id)).toBe(false);

    // Not approved → campaigns cannot consume it.
    await expect(
      campaigns.addItem({ campaignId: (await campaigns.listCampaigns(WS))[0].campaign.id, galleryOutputId: created.id }, USER, WS),
    ).rejects.toThrow();
  });

  it('rejected outputs are blocked from handoff and never become campaign items', async () => {
    const store = new InMemoryOutputReviewStore();
    const rejected = structuredClone(GALLERY_OUTPUTS.find((row) => row.id === GALLERY_OUTPUT_SEED_IDS.story)!);
    store.seedOutputs([{ ...rejected, status: 'rejected' } as GalleryOutputRecord]);
    let itemCreated = false;
    const service = new OutputReviewService(store, {
      addCampaignItem: async () => {
        itemCreated = true;
        return makeItem();
      },
    });
    const result = await service.handoffOutputsToCampaign(WS, {
      campaignId: 'campaign_seed_1',
      galleryOutputIds: [rejected.id],
      actorId: USER,
    });
    expect(result.blocked.length).toBe(1);
    expect(result.items).toHaveLength(0);
    expect(result.links).toHaveLength(0);
    expect(itemCreated).toBe(false);
    const events = (await store.listAudit(WS)).map((row) => row.event);
    expect(events).toContain('generated_output_handoff_blocked');
  });
});

// ── E. Publishing resilience ─────────────────────────────────────────────────
describe('E. publishing stays idempotent, explicit and re-auth safe; calendar never publishes', () => {
  it('re-confirming one intent returns the same run; retry creates a NEW failed-run attempt', async () => {
    const { connections, review, campaigns } = makeStack();
    await connectDevFake(connections);
    const summaries = await campaigns.listCampaigns(WS);
    const campaignId = summaries[0].campaign.id;
    const detail = await campaigns.getCampaignDetail(campaignId, WS);
    const item = detail.items[0]!;

    const first = await review.createPublishSubmission(
      { campaignId, campaignItemId: item.id, placement: 'image_post', acknowledgement: true },
      WS,
      USER,
    );
    const second = await review.createPublishSubmission(
      { campaignId, campaignItemId: item.id, placement: 'image_post', acknowledgement: true },
      WS,
      USER,
    );
    expect(second.id).toBe(first.id); // idempotent re-confirm

    // Force a failure, then retry: a NEW run, the failed original untouched.
    await getPublishingReviewRepository().updatePublishRun(first.id, {
      status: 'failed',
      errorCode: 'submission_failed',
      errorMessageSafe: 'Provider rejected the submission.',
      completedAt: new Date().toISOString(),
    });
    const retry = await review.retryPublishRun(first.id, WS, USER);
    expect(retry.id).not.toBe(first.id);
    expect(retry.status).toBe('pending');
    const original = await review.getPublishRunStatus(first.id, WS);
    expect(original.run.status).toBe('failed');
  });

  it('a needs_reauth connection blocks review before any provider activity', async () => {
    const { connections, review, campaigns } = makeStack();
    const connectionId = await connectDevFake(connections);
    await getSocialConnectionsRepository().updateConnection(connectionId, { status: 'needs_reauth' });
    const summaries = await campaigns.listCampaigns(WS);
    const campaignId = summaries[0].campaign.id;
    const detail = await campaigns.getCampaignDetail(campaignId, WS);
    const item = detail.items[0]!;
    const eligibility = await review.getPublishingEligibility(campaignId, item.id, 'image_post', WS);
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.blockers.some((blocker) => blocker.code === 'CONNECTION_NEEDS_REAUTH')).toBe(true);
    await expect(
      review.createPublishSubmission({ campaignId, campaignItemId: item.id, placement: 'image_post', acknowledgement: true }, WS, USER),
    ).rejects.toThrow();
  });

  it('planning dates write planning metadata only — zero runs, zero drafts', async () => {
    const { campaigns } = makeStack();
    const summaries = await campaigns.listCampaigns(SEED_CAMPAIGNS_WORKSPACE_ID);
    const campaignId = summaries[0].campaign.id;
    const detail = await campaigns.getCampaignDetail(campaignId, SEED_CAMPAIGNS_WORKSPACE_ID);
    await campaigns.updateItemPlannedDate(detail.items[0]!.id, campaignId, '2026-10-10T09:00:00.000Z', SEED_CAMPAIGNS_WORKSPACE_ID);
    expect(await getPublishingReviewRepository().listPublishRuns(SEED_CAMPAIGNS_WORKSPACE_ID, {})).toHaveLength(0);
    expect(await getPublishingRepository().listDrafts(SEED_CAMPAIGNS_WORKSPACE_ID)).toHaveLength(0);
  });
});

// ── F. Secrets never reach browser-visible state; audit stays safe ───────────
describe('F. secrets never reach browser state; snapshots stay inspectable', () => {
  it('connection views expose status only — never token material', async () => {
    const { connections } = makeStack();
    const connectionId = await connectDevFake(connections);
    const connection = await connections.getConnection(connectionId, WS);
    const serialized = JSON.stringify(connection).toLowerCase();
    expect(serialized).not.toMatch(/"accesstoken|"refreshtoken|"clientsecret|token_material/);

    const listed = await connections.listConnections(WS);
    for (const row of listed) {
      expect(JSON.stringify(row).toLowerCase()).not.toMatch(/"accesstoken|"refreshtoken/);
    }
  });

  it('generation snapshots captured before downstream edits remain inspectable and unchanged', async () => {
    const { storyboard } = makeStack();
    const project = await storyboard.createContentProject(WS, { name: 'Drop' }, USER);
    const scene = await storyboard.createScene(WS, project.id, { title: 'Opening', purpose: 'Set the scene' }, USER);
    await storyboard.createBeat(WS, scene.id, { title: 'Turn' }, USER);
    const snapshot = await storyboard.buildSceneGenerationSnapshot(WS, scene.id, 'image', USER);
    expect(snapshot.scene.title).toBe('Opening');

    await storyboard.updateScene(WS, scene.id, { title: 'Renamed later' }, USER);
    await storyboard.deleteBeat(WS, snapshot.beats[0]!.id, USER);

    // The captured snapshot is frozen: it still shows the pre-handoff state.
    expect(snapshot.scene.title).toBe('Opening');
    expect(snapshot.beats).toHaveLength(1);
    const handoffs = await storyboard.listSceneHandoffs(WS, scene.id);
    expect(handoffs.length).toBeGreaterThanOrEqual(1);

    // Serialized payloads never carry storage paths or credentials.
    const serialized = JSON.stringify(snapshot).toLowerCase();
    expect(serialized).not.toMatch(/storage|secret|token|\.png|\.jpg/);
  });
});
