/**
 * Shared Library Operations service construction. Bridges inject the
 * same-workspace validators for model/item/environment links AND for
 * Prompt 22 attachment targets (scenes, studio jobs, campaigns) —
 * cross-workspace links and attachments are rejected server-side.
 */
import { useMemo } from 'react';
import { LibraryOpsService } from '../../services/libraryOpsService';
import { LibraryService } from '../../services/libraryService';
import { ModelsService } from '../../services/modelsService';
import { ContentStudioService } from '../../services/contentService';
import { EnvironmentsService } from '../../services/environmentsService';
import { CampaignsService } from '../../services/campaignsService';
import { GalleryService } from '../../services/galleryService';
import { getLibraryRepository } from '../../data/libraryFactory';
import { getModelsRepository } from '../../data';
import { getContentRepository } from '../../data/contentFactory';
import { getEnvironmentsRepository } from '../../data/environmentsFactory';
import { getCampaignsRepository } from '../../data/campaignsFactory';
import { getGalleryRepository } from '../../data/galleryFactory';

export function useLibraryOpsService(): LibraryOpsService {
  return useMemo(() => {
    const library = new LibraryService(getLibraryRepository());
    const models = new ModelsService(getModelsRepository());
    const environments = new EnvironmentsService(getEnvironmentsRepository());
    const content = new ContentStudioService(getContentRepository(), {
      library,
      models,
      environments,
    });
    const gallery = new GalleryService(getGalleryRepository(), content, 'ws_demo');
    const campaigns = new CampaignsService(getCampaignsRepository(), gallery);
    return new LibraryOpsService(getLibraryRepository(), {
      models: { getModel: (id, ws) => models.getModel(id, ws) },
      content: {
        getScene: (id, ws) => content.getScene(id, ws),
        getJobRequest: (id, ws) => content.getJobRequest(id, ws),
      },
      environments: { getEnvironment: (id, ws) => environments.getEnvironment(id, ws) },
      campaigns: { getCampaign: (id, ws) => campaigns.getCampaign(id, ws) },
    });
  }, []);
}
