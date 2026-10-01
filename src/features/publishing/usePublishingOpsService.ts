/**
 * Shared Publishing Operations service construction for UI routes.
 * Mirrors the other publishing wiring: factory-scoped repositories only.
 */
import { useMemo } from 'react';
import { PublishingOpsService } from '../../services/publishingOpsService';
import { PublishingDraftService } from '../../services/publishingService';
import { createDefaultPublishingRegistry } from '../../services/publishingProviders';
import { SocialConnectionsService } from '../../services/socialConnectionsService';
import { SocialConnectionEncryptionService } from '../../services/socialConnectionEncryption';
import { createDefaultProviderRegistry } from '../../services/socialProviders';
import { CampaignsService } from '../../services/campaignsService';
import { GalleryService } from '../../services/galleryService';
import { ContentStudioService } from '../../services/contentService';
import { LibraryService } from '../../services/libraryService';
import { ModelsService } from '../../services/modelsService';
import { EnvironmentsService } from '../../services/environmentsService';
import { getPublishingRepository } from '../../data/publishingFactory';
import { getPublishingReviewRepository } from '../../data/publishingReviewFactory';
import { getSocialConnectionsRepository } from '../../data/socialConnectionsFactory';
import { getCampaignsRepository } from '../../data/campaignsFactory';
import { getGalleryRepository } from '../../data/galleryFactory';
import { getContentRepository } from '../../data/contentFactory';
import { getLibraryRepository } from '../../data/libraryFactory';
import { getModelsRepository } from '../../data';
import { getEnvironmentsRepository } from '../../data/environmentsFactory';
import { SEED_GALLERY_WORKSPACE_ID } from '../../mock/gallerySeed';

export function usePublishingOpsService(): PublishingOpsService {
  return useMemo(() => {
    const content = new ContentStudioService(getContentRepository(), {
      library: new LibraryService(getLibraryRepository()),
      models: new ModelsService(getModelsRepository()),
      environments: new EnvironmentsService(getEnvironmentsRepository()),
    });
    const gallery = new GalleryService(getGalleryRepository(), content, SEED_GALLERY_WORKSPACE_ID);
    const campaigns = new CampaignsService(getCampaignsRepository(), gallery);
    const connections = new SocialConnectionsService(
      getSocialConnectionsRepository(),
      createDefaultProviderRegistry(),
      new SocialConnectionEncryptionService(),
    );
    const drafts = new PublishingDraftService(
      getPublishingRepository(),
      createDefaultPublishingRegistry(),
      connections,
      gallery,
      campaigns,
    );
    return new PublishingOpsService({
      reviewRepo: getPublishingReviewRepository(),
      campaignsRepo: getCampaignsRepository(),
      connections,
      gallery,
      registry: createDefaultPublishingRegistry(),
      drafts,
    });
  }, []);
}
