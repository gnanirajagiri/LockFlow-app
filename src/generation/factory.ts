/**
 * Generation factory — wires the GenerationService to real domain services
 * and media sources. One construction path for both modes:
 *   * Demo mode: mock repos, in-memory media, the development fake provider.
 *   * Supabase mode: Supabase repos/Storage-backed media handling; the
 *     configured provider must be a real adapter (fail-closed otherwise).
 */
import { GenerationService } from './generationService';
import type { GenerationDependencies } from './generationService';
import { VideoGenerationService } from './videoGenerationService';
import type { VideoGenerationDependencies } from './videoGenerationService';
import type { GenerationRepository } from './repository';
import { MockGenerationRepository } from './mockGenerationRepository';
import { getSupabase } from '../lib/supabase';
import { ContentStudioService } from '../services/contentService';
import { GalleryService } from '../services/galleryService';
import { LibraryService } from '../services/libraryService';
import { ModelsService } from '../services/modelsService';
import { EnvironmentsService } from '../services/environmentsService';
import { getContentRepository } from '../data/contentFactory';
import { getGalleryRepository } from '../data/galleryFactory';
import { getLibraryRepository } from '../data/libraryFactory';
import { getModelsRepository } from '../data';
import { getEnvironmentsRepository } from '../data/environmentsFactory';
import { InMemoryGeneratedMediaStore } from './mediaStore';
import { buildLockedGenerationInputSnapshot } from './lockedInputSnapshot';
import { getCharacterSheetReferencesForGeneration } from '../domain/models';

/** Demo-mode defaults for the UI readiness display (fail-closed in prod). */
export const DEMO_GENERATION_CONFIG = {
  imageGenerationEnabled: true,
  providerName: 'development-fake',
  imageMaxOutputsPerJob: 4,
  imageMaxJobsPerUserPerPeriod: 5,
  imageMaxJobsPerWorkspacePerPeriod: 20,
  videoGenerationEnabled: true,
  videoProviderName: 'development-fake-video',
  videoMaxOutputsPerJob: 2,
  videoMaxJobsPerUserPerPeriod: 3,
  videoMaxJobsPerWorkspacePerPeriod: 10,
  videoMaxSecondsPerUserPerPeriod: 48,
  videoMaxSecondsPerWorkspacePerPeriod: 240,
};

let repoInstance: GenerationRepository | null = null;

export function getGenerationRepository(): GenerationRepository {
  // The SQL RPCs are authoritative in real mode; this repository backs the
  // demo/dev path and the service tests. Memoised per process — run state
  // must survive component remounts (like every other factory here). Demo
  // mode enables the development fake provider; real deployments are
  // fail-closed until the server worker syncs IMAGE_GENERATION_ENABLED +
  // IMAGE_PROVIDER_NAME via sync_generation_config.
  if (repoInstance) return repoInstance;
  const repo = new MockGenerationRepository();
  void repo.setConfig(DEMO_GENERATION_CONFIG);
  repoInstance = repo;
  return repo;
}

const mediaStore = new InMemoryGeneratedMediaStore();

/**
 * Builds the dependency seam around the existing domain services. In demo
 * mode the fake provider completes runs synchronously through the same
 * guarded transitions the production worker uses.
 */
export function createGenerationService(options?: {
  repo?: GenerationRepository;
  content?: ContentStudioService;
  gallery?: GalleryService;
}): { service: GenerationService; repo: GenerationRepository } {
  const repo = options?.repo ?? getGenerationRepository();
  const content =
    options?.content ??
    new ContentStudioService(getContentRepository(), {
      library: new LibraryService(getLibraryRepository()),
      models: new ModelsService(getModelsRepository()),
      environments: new EnvironmentsService(getEnvironmentsRepository()),
    });
  const gallery = options?.gallery ?? new GalleryService(getGalleryRepository(), content, 'ws_demo');

  const deps: GenerationDependencies = {
    content: {
      getJobRequest: (jobId, workspaceId) => content.getJobRequest(jobId, workspaceId),
      transitionJobRequest: (jobId, to, workspaceId, transitionOptions) =>
        content.transitionJobRequest(jobId, to as never, workspaceId, transitionOptions),
    },
    gallery: {
      createGeneratedOutput: (input) =>
        gallery.createGeneratedOutput(input, 'generation-worker', input.workspaceId),
      attachMedia: (outputId, patch, _workspaceId) =>
        // Repository-level write: the service-layer metadata validator strips
        // storage-path fields (a deliberate user-facing guard). Ingestion is
        // a privileged server-side path and writes the private path directly.
        getGalleryRepository().updateOutputMetadata(outputId, {
          mediaStoragePath: patch.mediaStoragePath,
          fileSizeBytes: patch.fileSizeBytes,
          mimeType: patch.mimeType,
          generationProviderRunId: patch.generationProviderRunId,
        }),
      appendEvent: (outputId, eventType, message, metadata) =>
        gallery.appendOutputEvent(outputId, eventType, message, metadata),
      nextOutputIndex: (jobId) => gallery.nextOutputIndexForJob(jobId),
    },
    media: {
      createSignedUrl: async (bucket, path, ttlSeconds) => {
        const client = getSupabase();
        if (!client) return `mock-signed://${bucket}/${path}`;
        const { data, error } = await client.storage.from(bucket).createSignedUrl(path, ttlSeconds);
        if (error || !data) throw error ?? new Error('Could not sign the media URL.');
        return data.signedUrl;
      },
      fetchBytes: async (urlOrDataUrl) => {
        if (urlOrDataUrl.startsWith('data:')) {
          const base64 = urlOrDataUrl.split(',')[1] ?? '';
          const binary = atob(base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
          const mime = urlOrDataUrl.slice(5, urlOrDataUrl.indexOf(';'));
          return { bytes, contentType: mime };
        }
        const response = await fetch(urlOrDataUrl);
        if (!response.ok) throw new Error(`fetch failed with ${response.status}`);
        return {
          bytes: new Uint8Array(await response.arrayBuffer()),
          contentType: response.headers.get('content-type') ?? 'application/octet-stream',
        };
      },
      put: async (bucket, path, bytes, contentType) => {
        const client = getSupabase();
        if (!client) {
          await mediaStore.put(bucket, path, bytes, contentType);
          return;
        }
        const { error } = await client.storage.from(bucket).upload(path, bytes, {
          contentType,
          upsert: false,
        });
        if (error) throw error;
      },
      resolvePinnedReferences: async () => [],
    },
    loadPinsForJob: async (jobId) => {
      const pins = await content.listJobPins(jobId, 'ws_demo');
      return pins.map((pin) => ({
        pinType: pin.pinType as 'model' | 'environment' | 'library_asset' | 'look',
        sourceRecordId: pin.sourceRecordId,
        sourceVersionId: pin.sourceVersionId,
        resolvedDetails: pin.resolvedDetails as {
          versionStatus?: string;
          versionNumber?: number;
          resolvedVia?: string;
        },
      }));
    },
    actorId: 'generation-worker',
  };

  // ── Prompt 27 bridges: Character Sheet enforcement + locked snapshots + variants ─
  const modelsService = new ModelsService(getModelsRepository());
  deps.models = {
    validateGenerationAgainstCharacterSheet: async (modelId, candidateTraits, workspaceId) => {
      const sheet = await modelsService.getActiveCharacterSheet(modelId, workspaceId);
      if (!sheet) return null;
      return modelsService.validateModelGenerationAgainstCharacterSheet(modelId, candidateTraits, workspaceId);
    },
  };
  deps.assembleLockedInputSnapshot = async ({ normalizedPrompt, outputCount, modelPins, environmentPins, assetPins }) => {
    const modelPin = modelPins[0] ?? null;
    const environmentPin = environmentPins[0] ?? null;
    if (!modelPin && !environmentPin && assetPins.length === 0) return null;

    let modelSource: Parameters<typeof buildLockedGenerationInputSnapshot>[0]['model'] = null;
    let sheet = null;
    let references: Awaited<ReturnType<typeof modelsService.getCharacterSheetReferencesForGeneration>> = [];
    if (modelPin) {
      const model = await modelsService.getModel(modelPin.sourceRecordId, 'ws_demo');
      const version = await modelsService.getVersion(modelPin.sourceVersionId, 'ws_demo');
      modelSource = { modelId: model.id, modelName: model.name, version };
      sheet = await modelsService.getActiveCharacterSheet(model.id, 'ws_demo');
      references = await modelsService.getCharacterSheetReferencesForGeneration(model.id, 'ws_demo');
    }

    let environmentSource: Parameters<typeof buildLockedGenerationInputSnapshot>[0]['environment'] = null;
    if (environmentPin) {
      const environments = new EnvironmentsService(getEnvironmentsRepository());
      const environment = await environments.getEnvironment(environmentPin.sourceRecordId, 'ws_demo');
      const version = await environments.getVersion(environmentPin.sourceVersionId, 'ws_demo');
      environmentSource = {
        environmentId: environment.id,
        environmentName: environment.name,
        version: { id: version.id, versionNumber: version.versionNumber, status: version.status },
      };
    }

    const assets = await Promise.all(
      assetPins.map(async (pin) => {
        const library = new LibraryService(getLibraryRepository());
        const asset = await library
          .getAsset(pin.sourceRecordId, 'ws_demo')
          .catch(() => null);
        return {
          assetId: pin.sourceRecordId,
          label: asset?.name ?? pin.resolvedDetails?.assetName ?? pin.sourceRecordId,
          kind: (pin.pinType === 'look' ? 'look' : 'library_asset') as 'look' | 'library_asset',
        };
      }),
    );

    return buildLockedGenerationInputSnapshot({
      normalizedPrompt,
      aspectRatio: normalizedPrompt.aspectRatio,
      outputCount,
      model: modelSource,
      characterSheet: sheet,
      environment: environmentSource,
      assets,
      references: getCharacterSheetReferencesForGeneration(references),
    });
  };
  deps.createVariantJob = async ({ sourceJobId, workspaceId, userId, prompt }) => {
    const created = await content.createDraftJobRequest(
      {
        workspaceId,
        name: `Variant of job ${sourceJobId}`,
        requestedOutputType: 'photo',
        requestedVariants: 1,
        briefSnapshot: {
          variantOf: sourceJobId,
          inheritedPrompt: prompt,
          capturedAt: new Date().toISOString(),
        },
      },
      userId,
      workspaceId,
    );
    return created.id;
  };
  (deps.content as { copyPinsToJob?: unknown }).copyPinsToJob = (sourceJobId: string, targetJobId: string, wsId: string) =>
    content.copyJobPins(sourceJobId, targetJobId, wsId);

  return { service: new GenerationService(repo, deps), repo };
}

/**
 * Builds the video dependency seam. The fake video provider completes runs
 * synchronously in demo mode through the exact production path.
 */
export function createVideoGenerationService(options?: {
  repo?: GenerationRepository;
  content?: ContentStudioService;
  gallery?: GalleryService;
}): { service: VideoGenerationService; repo: GenerationRepository } {
  const repo = options?.repo ?? getGenerationRepository();
  const content =
    options?.content ??
    new ContentStudioService(getContentRepository(), {
      library: new LibraryService(getLibraryRepository()),
      models: new ModelsService(getModelsRepository()),
      environments: new EnvironmentsService(getEnvironmentsRepository()),
    });
  const gallery = options?.gallery ?? new GalleryService(getGalleryRepository(), content, 'ws_demo');

  const deps: VideoGenerationDependencies = {
    content: {
      getJobRequest: (jobId, workspaceId) => content.getJobRequest(jobId, workspaceId),
      transitionJobRequest: (jobId, to, workspaceId, transitionOptions) =>
        content.transitionJobRequest(jobId, to as never, workspaceId, transitionOptions),
      listScenes: (projectId, workspaceId) => content.listScenes(projectId, workspaceId),
      getSceneSnapshot: async (sceneId, workspaceId) => {
        const scene = await content.getScene(sceneId, workspaceId);
        return scene
          ? { id: scene.id, title: scene.title, purpose: scene.purpose, sceneOrder: scene.sceneOrder, settingNotes: scene.settingNotes, shotNotes: scene.shotNotes }
          : null;
      },
      getBeatSnapshot: async (beatId, workspaceId) => {
        const beat = await content.getBeat(beatId, workspaceId);
        return beat
          ? { id: beat.id, contentSceneId: beat.contentSceneId, title: beat.title, beatOrder: beat.beatOrder, actionDescription: beat.actionDescription, dialogueOrOverlay: beat.dialogueOrOverlay, cameraDirection: beat.cameraDirection }
          : null;
      },
    },
    gallery: {
      createGeneratedOutput: (input) =>
        gallery.createGeneratedOutput(input, 'generation-worker', input.workspaceId),
      attachMedia: (outputId, patch) =>
        getGalleryRepository().updateOutputMetadata(outputId, {
          mediaStoragePath: patch.mediaStoragePath,
          thumbnailStoragePath: patch.thumbnailStoragePath,
          fileSizeBytes: patch.fileSizeBytes,
          mimeType: patch.mimeType,
          generationProviderRunId: patch.generationProviderRunId,
        }),
      appendEvent: (outputId, eventType, message, metadata) =>
        gallery.appendOutputEvent(outputId, eventType, message, metadata),
      nextOutputIndex: (jobId) => gallery.nextOutputIndexForJob(jobId),
    },
    media: {
      fetchBytes: async (urlOrDataUrl) => {
        if (urlOrDataUrl.startsWith('data:')) {
          const base64 = urlOrDataUrl.split(',')[1] ?? '';
          const binary = atob(base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
          const mime = urlOrDataUrl.slice(5, urlOrDataUrl.indexOf(';'));
          return { bytes, contentType: mime };
        }
        const response = await fetch(urlOrDataUrl);
        if (!response.ok) throw new Error(`fetch failed with ${response.status}`);
        return {
          bytes: new Uint8Array(await response.arrayBuffer()),
          contentType: response.headers.get('content-type') ?? 'application/octet-stream',
        };
      },
      put: async (bucket, path, bytes, contentType) => {
        const client = getSupabase();
        if (!client) {
          await mediaStore.put(bucket, path, bytes, contentType);
          return;
        }
        const { error } = await client.storage.from(bucket).upload(path, bytes, { contentType, upsert: false });
        if (error) throw error;
      },
      resolvePinnedReferences: async () => [],
    },
    loadPinsForJob: async (jobId) => {
      const pins = await content.listJobPins(jobId, 'ws_demo');
      return pins.map((pin) => ({
        pinType: pin.pinType as 'model' | 'environment' | 'library_asset' | 'look',
        sourceRecordId: pin.sourceRecordId,
        sourceVersionId: pin.sourceVersionId,
        resolvedDetails: pin.resolvedDetails as {
          versionStatus?: string;
          versionNumber?: number;
          resolvedVia?: string;
        },
      }));
    },
    actorId: 'generation-worker',
  };

  return { service: new VideoGenerationService(repo, deps), repo };
}
