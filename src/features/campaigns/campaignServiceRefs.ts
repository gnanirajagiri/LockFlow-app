/**
 * Prompt 30 — shared module-level singletons for the campaign content-set
 * review/handoff flow. Follows the app's memoised-factory pattern (state must
 * survive component remounts) without widening the outlet-context contract.
 */
import { GalleryService } from '../../services/galleryService';
import { CampaignsService } from '../../services/campaignsService';
import { ContentStudioService } from '../../services/contentService';
import { LibraryService } from '../../services/libraryService';
import { ModelsService } from '../../services/modelsService';
import { EnvironmentsService } from '../../services/environmentsService';
import { getGalleryRepository } from '../../data/galleryFactory';
import { getCampaignsRepository } from '../../data/campaignsFactory';
import { getContentRepository } from '../../data/contentFactory';
import { getLibraryRepository } from '../../data/libraryFactory';
import { getModelsRepository } from '../../data';
import { getEnvironmentsRepository } from '../../data/environmentsFactory';
import { SEED_GALLERY_WORKSPACE_ID } from '../../mock/gallerySeed';

let contentInstance: ContentStudioService | null = null;

/** Shared ContentStudioService (job requests + eligibility listing). */
export function getContentService(): ContentStudioService {
  if (!contentInstance) {
    contentInstance = new ContentStudioService(getContentRepository(), {
      library: new LibraryService(getLibraryRepository()),
      models: new ModelsService(getModelsRepository()),
      environments: new EnvironmentsService(getEnvironmentsRepository()),
    });
  }
  return contentInstance;
}

let galleryInstance: GalleryService | null = null;

/** Shared GalleryService (same construction pattern as the other tabs). */
export function getGalleryService(): GalleryService {
  if (!galleryInstance) {
    galleryInstance = new GalleryService(getGalleryRepository(), getContentService(), SEED_GALLERY_WORKSPACE_ID);
  }
  return galleryInstance;
}

let campaignsInstance: CampaignsService | null = null;

/** Shared CampaignsService — addItem is the handoff bridge. */
export function getCampaignsService(): CampaignsService {
  if (!campaignsInstance) {
    campaignsInstance = new CampaignsService(
      getCampaignsRepository(),
      getGalleryService(),
    );
  }
  return campaignsInstance;
}
