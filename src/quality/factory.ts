/**
 * Quality factory — wires the quality services to the Gallery provenance
 * resolver. Demo mode uses the in-memory repositories; the submission
 * boundary is intentionally left unwired (provider correction support does
 * not exist yet), so submission is refused with honest UI copy.
 */
import { GalleryService } from '../services/galleryService';
import { ContentStudioService } from '../services/contentService';
import { LibraryService } from '../services/libraryService';
import { ModelsService } from '../services/modelsService';
import { EnvironmentsService } from '../services/environmentsService';
import { getGalleryRepository } from '../data/galleryFactory';
import { getContentRepository } from '../data/contentFactory';
import { getLibraryRepository } from '../data/libraryFactory';
import { getModelsRepository } from '../data';
import { getEnvironmentsRepository } from '../data/environmentsFactory';
import { MockQualityRepository } from './mockQualityRepository';
import { CorrectionRequestService } from './correctionRequestService';
import { QualityReviewService } from './qualityReviewService';

export interface QualityServices {
  reviews: QualityReviewService;
  corrections: CorrectionRequestService;
  repo: MockQualityRepository;
}

let instance: QualityServices | null = null;

export function createQualityServices(gallery?: GalleryService): QualityServices {
  const content =
    gallery === undefined
      ? new ContentStudioService(getContentRepository(), {
          library: new LibraryService(getLibraryRepository()),
          models: new ModelsService(getModelsRepository()),
          environments: new EnvironmentsService(getEnvironmentsRepository()),
        })
      : (gallery as unknown as { content: ContentStudioService }).content;
  const galleryService =
    gallery ?? new GalleryService(getGalleryRepository(), content as ContentStudioService, 'ws_demo');

  const repo = new MockQualityRepository();
  const resolveProvenance = (outputId: string, workspaceId: string) =>
    galleryService.resolveProvenance(outputId, workspaceId);

  const reviews = new QualityReviewService(
    repo,
    repo,
    repo,
    resolveProvenance,
    (outputId, workspaceId) => galleryService.getOutput(outputId, workspaceId),
    'ws_demo',
  );
  const corrections = new CorrectionRequestService(repo, repo, repo, resolveProvenance, null);

  return { reviews, corrections, repo };
}

/** Memoised app-level instance (demo state must survive remounts). */
export function getQualityServices(): QualityServices {
  if (!instance) instance = createQualityServices();
  return instance;
}

/** Test isolation hook. */
export function resetQualityServices(): void {
  instance = null;
}
