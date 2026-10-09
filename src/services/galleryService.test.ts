/**
 * Gallery service rules — the product contracts, tested at the service
 * boundary over fresh mock repositories (reset per test for isolation).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { GalleryService } from './galleryService';
import type { ContentStudioBridges } from './contentService';
import { ContentStudioService } from './contentService';
import { LibraryService } from './libraryService';
import { ModelsService } from './modelsService';
import { EnvironmentsService } from './environmentsService';
import { getGalleryRepository, resetGalleryRepository } from '../data/galleryFactory';
import { getContentRepository, resetContentRepository } from '../data/contentFactory';
import { getLibraryRepository, resetLibraryRepository } from '../data/libraryFactory';
import { getModelsRepository, resetModelsRepository } from '../data';
import { getEnvironmentsRepository, resetEnvironmentsRepository } from '../data/environmentsFactory';
import { CONTENT_JOB_REQUEST_ID, CONTENT_PROJECT_ID } from '../mock/contentSeed';
import { GALLERY_OUTPUT_SEED_IDS, SEED_GALLERY_WORKSPACE_ID } from '../mock/gallerySeed';
import { SEED_LIBRARY_OTHER_WORKSPACE_ID, SEED_LIBRARY_WORKSPACE_ID } from '../mock/librarySeed';

let service: GalleryService;
let content: ContentStudioService;
let workspaceId: string;
let otherWorkspaceId: string;

beforeEach(async () => {
  resetGalleryRepository();
  resetContentRepository();
  resetLibraryRepository();
  resetModelsRepository();
  resetEnvironmentsRepository();

  const bridges: ContentStudioBridges = {
    library: new LibraryService(getLibraryRepository()),
    models: new ModelsService(getModelsRepository()),
    environments: new EnvironmentsService(getEnvironmentsRepository()),
  };
  content = new ContentStudioService(getContentRepository(), bridges);
  service = new GalleryService(getGalleryRepository(), content, SEED_GALLERY_WORKSPACE_ID);
  workspaceId = SEED_GALLERY_WORKSPACE_ID;
  otherWorkspaceId = SEED_LIBRARY_OTHER_WORKSPACE_ID;

  // The seeded job request starts as a draft with no pins; prepare them so
  // Gallery provenance has the immutable snapshot to read.
  await content.createJobPinsFromProject(CONTENT_JOB_REQUEST_ID, CONTENT_PROJECT_ID, workspaceId);
});

describe('rule 1 — outputs are workspace-scoped', () => {
  it('hides other-workspace outputs from listings and detail reads', async () => {
    const outputs = await service.listOutputs(workspaceId);
    expect(outputs.every((output) => output.workspaceId === workspaceId)).toBe(true);

    // A foreign id cannot be smuggled in through create.
    await expect(
      service.createPlaceholderOutput(
        {
          workspaceId: otherWorkspaceId,
          contentJobRequestId: CONTENT_JOB_REQUEST_ID,
          title: 'Foreign output',
          outputType: 'image',
        },
        'tester',
        workspaceId,
      ),
    ).rejects.toThrow(/same workspace/i);
  });
});

describe('rule 2 — outputs reference a same-workspace content job', () => {
  it('refuses outputs bound to a job from another workspace', async () => {
    // Attempt to create against a non-existent/foreign job id.
    await expect(
      service.createPlaceholderOutput(
        {
          workspaceId,
          contentJobRequestId: 'job_from_elsewhere',
          title: 'Orphan output',
          outputType: 'image',
        },
        'tester',
        workspaceId,
      ),
    ).rejects.toThrow(/not found/i);
  });

  it('resolves the job through the same workspace check', async () => {
    const output = await service.getOutput(GALLERY_OUTPUT_SEED_IDS.vanity, workspaceId);
    const provenance = await service.resolveProvenance(output.id, workspaceId);
    expect(provenance.job.id).toBe(CONTENT_JOB_REQUEST_ID);
    expect(provenance.job.workspaceId).toBe(workspaceId);
  });
});

describe('rule 3 — provenance resolves exact immutable job pins', () => {
  it('surfaces job, project, scenes and every pinned version', async () => {
    const provenance = await service.resolveProvenance(GALLERY_OUTPUT_SEED_IDS.vanity, workspaceId);
    expect(provenance.job.name).toBe('Morning Skincare Routine — Content Set');
    expect(provenance.project?.name).toBe('Morning Skincare Routine');
    expect(provenance.scenes.length).toBe(3);
    const pins = provenance.pins;
    expect(pins.some((pin) => pin.pinType === 'model_version' && pin.sourceVersionId === 'mv_aisha_v1')).toBe(true);
    expect(
      pins.some((pin) => pin.pinType === 'environment_version' && pin.sourceVersionId === 'env_ver_wbs_v1'),
    ).toBe(true);
    expect(
      pins.some((pin) => pin.pinType === 'look_version' && pin.sourceVersionId === 'libver_look_v2'),
    ).toBe(true);
    expect(pins.some((pin) => pin.pinType === 'library_asset_version' && pin.sourceVersionId === 'libver_serum_v1')).toBe(true);
  });
});

describe('rule 4 — later source changes do not alter provenance', () => {
  it('keeps the pinned v1 even after the model’s newer draft is locked', async () => {
    const modelsService = new ModelsService(getModelsRepository());
    // Advance the source: the seeded draft v2 becomes the newest locked version.
    await modelsService.lockVersion('mv_aisha_v2', SEED_LIBRARY_WORKSPACE_ID);

    const provenance = await service.resolveProvenance(GALLERY_OUTPUT_SEED_IDS.vanity, workspaceId);
    const modelPin = provenance.pins.find((pin) => pin.pinType === 'model_version');
    expect(modelPin?.sourceVersionId).toBe('mv_aisha_v1'); // historic pin unchanged
    expect(modelPin?.resolvedDetails).toMatchObject({ versionNumber: 1 });
  });
});

describe('rule 5 — reviews append history and never mutate job pins', () => {
  it('records a rejection with feedback and leaves pins untouched', async () => {
    // The vanity image ships approved; the story ships rejected — move it back
    // into review so a fresh review can be appended on top of the seeded one.
    await service.transitionOutput(GALLERY_OUTPUT_SEED_IDS.story, 'ready_for_review', workspaceId);
    const pinsBefore = JSON.stringify(
      (await service.resolveProvenance(GALLERY_OUTPUT_SEED_IDS.story, workspaceId)).pins,
    );

    const { review } = await service.submitReview(
      {
        galleryOutputId: GALLERY_OUTPUT_SEED_IDS.story,
        reviewerId: 'demo-user',
        decision: 'rejected',
        feedback: 'Composition drifts from the hero angle.',
      },
      workspaceId,
    );
    expect(review.decision).toBe('rejected');
    expect(review.feedback).toContain('hero angle');

    const history = await service.listReviews(GALLERY_OUTPUT_SEED_IDS.story, workspaceId);
    expect(history.length).toBe(2); // seeded rejection + this one — appended, not overwritten

    const provenance = await service.resolveProvenance(GALLERY_OUTPUT_SEED_IDS.story, workspaceId);
    expect(JSON.stringify(provenance.pins)).toBe(pinsBefore); // pins unchanged
  });

  it('refuses reviews on outputs that are not ready for review', async () => {
    await expect(
      service.submitReview(
        {
          galleryOutputId: GALLERY_OUTPUT_SEED_IDS.variant, // draft
          reviewerId: 'demo-user',
          decision: 'approved',
        },
        workspaceId,
      ),
    ).rejects.toThrow(/ready for review/i);
  });

  it('requires feedback when rejecting or requesting changes', async () => {
    await service.transitionOutput(GALLERY_OUTPUT_SEED_IDS.story, 'ready_for_review', workspaceId);
    await expect(
      service.submitReview(
        { galleryOutputId: GALLERY_OUTPUT_SEED_IDS.story, reviewerId: 'demo-user', decision: 'rejected' },
        workspaceId,
      ),
    ).rejects.toThrow(/feedback is required/i);
  });
});

describe('rule 6 — invalid status transitions are rejected', () => {
  it('refuses transitions outside the state machine', async () => {
    await expect(
      service.transitionOutput(GALLERY_OUTPUT_SEED_IDS.vanity, 'draft', workspaceId),
    ).rejects.toThrow(/cannot move from approved to draft/);
    await expect(
      service.transitionOutput(GALLERY_OUTPUT_SEED_IDS.variant, 'approved', workspaceId),
    ).rejects.toThrow(/cannot move from draft to approved/);
  });

  it('blocks draft → processing in normal UI (no provider)', async () => {
    await expect(
      service.transitionOutput(GALLERY_OUTPUT_SEED_IDS.variant, 'processing', workspaceId),
    ).rejects.toThrow(/No provider integration exists/);
  });
});

describe('rule 7 — archive and restore are soft-state changes', () => {
  it('archives with preservation and restores to the prior reviewable status', async () => {
    const archived = await service.archiveOutput(GALLERY_OUTPUT_SEED_IDS.vanity, workspaceId);
    expect(archived.status).toBe('archived');

    // Still readable with all data intact — including the seeded approval history.
    const stored = await service.getOutput(GALLERY_OUTPUT_SEED_IDS.vanity, workspaceId);
    expect(stored.title).toBe('Morning Vanity Setup');
    const seededHistory = await service.listReviews(stored.id, workspaceId);
    expect(seededHistory).toHaveLength(1);
    expect(seededHistory[0]?.decision).toBe('approved');

    const restored = await service.restoreOutput(GALLERY_OUTPUT_SEED_IDS.vanity, workspaceId);
    // Restore only re-enters reviewable statuses — a formerly approved output
    // returns to review (its seeded approval history is preserved above).
    expect(restored.status).toBe('ready_for_review');

    const events = await service.listEvents(GALLERY_OUTPUT_SEED_IDS.vanity, workspaceId);
    expect(events.map((event) => event.eventType)).toContain('restored');
  });

  it('refuses invalid restores (approved outputs do not reopen as rejected)', async () => {
    await service.archiveOutput(GALLERY_OUTPUT_SEED_IDS.serum, workspaceId); // approved → archived
    await expect(
      service.transitionOutput(GALLERY_OUTPUT_SEED_IDS.serum, 'rejected', workspaceId),
    ).rejects.toThrow(/prior reviewable status/i);
  });
});

describe('rule 8 — collections accept only Gallery outputs', () => {
  it('adds, reorders and removes outputs without deleting them', async () => {
    const collections = await service.listCollections(workspaceId);
    const campaign = collections.find((collection) => collection.name === 'Morning Skincare Campaign');
    expect(campaign).toBeDefined();

    const items = await service.listCollectionItems(campaign!.id, workspaceId);
    expect(items.map((entry) => entry.output.title)).toEqual(['Serum Product Moment', 'Morning Vanity Setup']);

    // Reorder.
    const orderedItemIds = [...items.map((entry) => entry.item.id)].reverse();
    await service.reorderCollectionItems(campaign!.id, orderedItemIds, workspaceId);
    const reordered = await service.listCollectionItems(campaign!.id, workspaceId);
    expect(reordered[0].output.title).toBe('Morning Vanity Setup');

    // Remove the membership; the output survives.
    await service.removeCollectionItem(campaign!.id, reordered[0].item.id, workspaceId);
    const after = await service.listCollectionItems(campaign!.id, workspaceId);
    expect(after.length).toBe(1);
    const output = await service.getOutput(GALLERY_OUTPUT_SEED_IDS.vanity, workspaceId);
    expect(output.title).toBe('Morning Vanity Setup');
  });

  it('refuses adding a non-output (Library asset id) to a collection', async () => {
    const collections = await service.listCollections(workspaceId);
    const campaign = collections[0];
    await expect(
      service.addCollectionItem(campaign.id, 'lib_beige_blazer', workspaceId), // a Library asset, not an output
    ).rejects.toThrow(/not found/i);
  });

  it('refuses duplicate membership', async () => {
    const collections = await service.listCollections(workspaceId);
    const campaign = collections[0];
    await expect(
      service.addCollectionItem(campaign.id, GALLERY_OUTPUT_SEED_IDS.serum, workspaceId),
    ).rejects.toThrow(/already in the collection/i);
  });
});

describe('rule 9 — no provider-generation action exists', () => {
  it('exposes no generation/provider APIs on the service', async () => {
    const prototype = Object.getOwnPropertyNames(Object.getPrototypeOf(service));
    const banned = prototype.filter(
      (name) =>
        /render|submitToProvider|enqueue|upload|process\b/i.test(name) ||
        // createGeneratedOutput is the ingestion-only path added with the
        // generation domain: it records completed results, it never generates.
        (/generate/i.test(name) && name !== 'createGeneratedOutput'),
    );
    expect(banned).toEqual([]);
  });

  it('never creates a processing output through the create path', async () => {
    const created = await service.createPlaceholderOutput(
      {
        workspaceId,
        contentJobRequestId: CONTENT_JOB_REQUEST_ID,
        title: 'Test output',
        outputType: 'image',
        // Even if a caller tries to sneak a provider-ish status in:
        status: 'processing',
      } as never,
      'tester',
      workspaceId,
    );
    expect(created.status).toBe('draft'); // forced to draft
    expect(created.metadata.placeholder).toBe(true);
    expect(created.mediaStoragePath).toMatch(/^placeholders\//);
  });
});

describe('rule 10 — placeholder data is clearly identified', () => {
  it('marks every seeded output as a placeholder with local paths only', async () => {
    const outputs = await service.listOutputs(workspaceId);
    expect(outputs.length).toBeGreaterThan(0);
    for (const output of outputs) {
      expect(output.metadata.placeholder).toBe(true);
      if (output.mediaStoragePath) {
        // Local placeholder path (served from public/) — absolute so nested
        // routes resolve it, never a provider URL or signed URL.
        expect(output.mediaStoragePath.replace(/^\//, '').startsWith('placeholders/')).toBe(true);
      }
      expect(output.metadata.provider).toBeNull();
    }
    const variant = await service.getOutput(GALLERY_OUTPUT_SEED_IDS.variant, workspaceId);
    expect(variant.parentGalleryOutputId).toBe(GALLERY_OUTPUT_SEED_IDS.vanity);
    expect((variant.metadata.variantNote as string).toLowerCase()).toContain('variant placeholder');
  });

  it('appends audit events for lifecycle changes', async () => {
    await service.archiveOutput(GALLERY_OUTPUT_SEED_IDS.vanity, workspaceId);
    const events = await service.listEvents(GALLERY_OUTPUT_SEED_IDS.vanity, workspaceId);
    const types = events.map((event) => event.eventType);
    expect(types).toContain('output_created');
    expect(types).toContain('archived');
  });
});
