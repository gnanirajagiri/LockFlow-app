/**
 * Generation factory — wires the GenerationService to real domain services
 * and media sources. One construction path for both modes:
 *   * Demo mode: mock repos, in-memory media, the development fake provider.
 *   * Supabase mode: Supabase repos/Storage-backed media handling; the
 *     configured provider must be a real adapter (fail-closed otherwise).
 */
import { GenerationService } from './generationService';
import type { GenerationDependencies } from './generationService';
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

/** Demo-mode defaults for the UI readiness display (fail-closed in prod). */
export const DEMO_GENERATION_CONFIG = {
  imageGenerationEnabled: true,
  providerName: 'development-fake',
  imageMaxOutputsPerJob: 4,
  imageMaxJobsPerUserPerPeriod: 5,
  imageMaxJobsPerWorkspacePerPeriod: 20,
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

  return { service: new GenerationService(repo, deps), repo };
}
