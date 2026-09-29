/**
 * Shared Publishing service construction for UI routes. Mirrors the other
 * feature wiring: services are composed from factory-scoped repositories.
 */
import { useMemo } from 'react';
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
import { getSocialConnectionsRepository } from '../../data/socialConnectionsFactory';
import { getCampaignsRepository } from '../../data/campaignsFactory';
import { getGalleryRepository } from '../../data/galleryFactory';
import { getContentRepository } from '../../data/contentFactory';
import { getLibraryRepository } from '../../data/libraryFactory';
import { getModelsRepository } from '../../data';
import { getEnvironmentsRepository } from '../../data/environmentsFactory';

export function usePublishingService(): PublishingDraftService {
  return useMemo(() => {
    const content = new ContentStudioService(getContentRepository(), {
      library: new LibraryService(getLibraryRepository()),
      models: new ModelsService(getModelsRepository()),
      environments: new EnvironmentsService(getEnvironmentsRepository()),
    });
    const gallery = new GalleryService(getGalleryRepository(), content, 'ws_demo');
    const campaigns = new CampaignsService(getCampaignsRepository(), gallery);
    const connections = new SocialConnectionsService(
      getSocialConnectionsRepository(),
      createDefaultProviderRegistry(),
      new SocialConnectionEncryptionService(),
    );
    return new PublishingDraftService(
      getPublishingRepository(),
      createDefaultPublishingRegistry(),
      connections,
      gallery,
      campaigns,
    );
  }, []);
}
