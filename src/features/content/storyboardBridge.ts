/**
 * Prompt 34 — the bridge between the Content Studio storyboard UI and the
 * REAL generation services (prompts 27/28). This is the only place that
 * wires persistJobPins + identity baselines into submitSceneGeneration, so
 * handed-off scenes run through the same eligibility, quota, Character Sheet
 * and ingestion paths as every other generation job. Results flow to Gallery
 * through the existing ingestion; nothing here publishes.
 *
 * Demo mode: the mock/fake providers complete synchronously.
 */
import { ContentStudioService } from '../../services/contentService';
import { getContentRepository } from '../../data/contentFactory';
import { LibraryService } from '../../services/libraryService';
import { getLibraryRepository } from '../../data/libraryFactory';
import { ModelsService } from '../../services/modelsService';
import { getModelsRepository } from '../../data';
import { EnvironmentsService } from '../../services/environmentsService';
import { getEnvironmentsRepository } from '../../data/environmentsFactory';
import { createGenerationService, createVideoGenerationService } from '../../generation/factory';
import {
  StoryboardService,
  InMemorySceneBindingStore,
  InMemoryHandoffStore,
  InMemoryStoryboardAuditStore,
} from '../../studio/storyboardService';
import type { SceneGenerationType } from '../../studio/storyboardWorkflow';

export interface StoryboardBridge {
  listSceneBindings(
    workspaceId: string,
    sceneId: string,
  ): Promise<Array<{ id: string; kind: string; refId: string; label: string; role: string | null }>>;
  unbindSceneAsset(workspaceId: string, sceneId: string, bindingId: string): Promise<void>;
  validateSceneForGeneration(
    workspaceId: string,
    sceneId: string,
    generationType: SceneGenerationType,
  ): Promise<{ ready: boolean; blockers: string[]; modelGoverned: boolean }>;
  submitSceneGeneration(
    workspaceId: string,
    sceneId: string,
    generationType: Exclude<SceneGenerationType, 'content_set'>,
  ): Promise<{ jobId: string; runId: string | null; eligible: boolean; blocking: string[] }>;
  listSceneHandoffs(
    workspaceId: string,
    sceneId: string,
  ): Promise<Array<{ id: string; generationType: string; status: string; contentJobRequestId: string | null; createdAt: string }>>;
}

let bridgeInstance: StoryboardBridge | null = null;

/** Shared storyboard bridge (module singleton; state must survive remounts). */
export function getStoryboardBridge(): StoryboardBridge {
  if (bridgeInstance) return bridgeInstance;

  const content = new ContentStudioService(getContentRepository(), {
    library: new LibraryService(getLibraryRepository()),
    models: new ModelsService(getModelsRepository()),
    environments: new EnvironmentsService(getEnvironmentsRepository()),
  });
  const models = new ModelsService(getModelsRepository());
  const environments = new EnvironmentsService(getEnvironmentsRepository());
  const library = new LibraryService(getLibraryRepository());

  const image = createGenerationService();
  const video = createVideoGenerationService();
  const contentRepo = getContentRepository();

  const storyboard = new StoryboardService(
    content,
    {
      models,
      environments,
      library,
      persistJobPins: async ({ jobId, pins }) => {
        // Same immutable-pin contract as createJobPinsFromProject: the mock
        // repo refuses non-draft jobs, and pin rows carry the minimal locked
        // reproducibility context resolved in buildJobPins. The generation
        // seam reads pinType without the `_version` suffix (the same cast
        // the generation factory applies to rows written by the existing
        // pin flow).
        await contentRepo.createJobPins(
          pins.map((pin) => ({
            contentJobRequestId: jobId,
            pinType: pin.pinType as 'model_version' | 'environment_version' | 'library_asset_version' | 'look_version',
            sourceRecordId: pin.sourceRecordId,
            sourceVersionId: pin.sourceVersionId,
            resolvedDetails: pin.resolvedDetails,
            role: pin.role,
            sortOrder: pin.sortOrder,
          })),
        );
      },
      submitImage: async (input) => {
        const result = await image.service.submitImageGeneration(input.jobId, input.workspaceId, input.userId, {
          pins: [],
          references: input.references,
          assets: input.assets,
          prompt: input.prompt,
          requireIdentityBaseline: input.requireIdentityBaseline,
          identityTraits: input.identityTraits,
        });
        return { runId: result.run?.id ?? null, eligible: result.eligible, blocking: result.blocking };
      },
      submitVideo: async (input) => {
        const result = await video.service.submitVideoGeneration(input.jobId, input.workspaceId, input.userId, {
          selection: {
            sceneId: null,
            beatId: null,
            durationSeconds: input.durationSeconds,
            aspectRatio: input.aspectRatio,
            outputCount: input.outputCount,
            mediaFlavor: input.mediaFlavor,
            ...(input.mediaFlavor === 'story'
              ? { storyFrames: input.storyFrames ?? [] }
              : {}),
          },
          prompt: input.prompt,
          requireIdentityBaseline: input.requireIdentityBaseline,
          identityTraits: input.identityTraits,
        });
        return { runId: result.run?.id ?? null, eligible: result.eligible, blocking: result.blocking };
      },
    },
    new InMemoryStoryboardAuditStore(),
    new InMemorySceneBindingStore(),
    new InMemoryHandoffStore(),
  );

  bridgeInstance = {
    async listSceneBindings(workspaceId, sceneId) {
      return storyboard.listSceneBindings(workspaceId, sceneId);
    },
    async unbindSceneAsset(workspaceId, sceneId, bindingId) {
      await storyboard.unbindSceneAsset(workspaceId, sceneId, bindingId, 'demo-user');
    },
    async validateSceneForGeneration(workspaceId, sceneId, generationType) {
      return storyboard.validateSceneForGeneration(workspaceId, sceneId, generationType);
    },
    async submitSceneGeneration(workspaceId, sceneId, generationType) {
      return storyboard.submitSceneGeneration(workspaceId, sceneId, generationType, 'demo-user');
    },
    async listSceneHandoffs(workspaceId, sceneId) {
      const rows = await storyboard.listSceneHandoffs(workspaceId, sceneId);
      return rows.map((row) => ({
        id: row.id,
        generationType: row.generationType,
        status: row.status,
        contentJobRequestId: row.contentJobRequestId,
        createdAt: row.createdAt,
      }));
    },
  } satisfies StoryboardBridge;

  return bridgeInstance;
}
