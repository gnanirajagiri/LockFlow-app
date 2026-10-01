/**
 * Shared Library Operations service construction. Bridges inject the
 * same-workspace validators for model/item/environment links (server-side
 * relationship validation; cross-workspace links are rejected).
 */
import { useMemo } from 'react';
import { LibraryOpsService } from '../../services/libraryOpsService';
import { LibraryService } from '../../services/libraryService';
import { ModelsService } from '../../services/modelsService';
import { ContentStudioService } from '../../services/contentService';
import { EnvironmentsService } from '../../services/environmentsService';
import { getLibraryRepository } from '../../data/libraryFactory';
import { getModelsRepository } from '../../data';
import { getContentRepository } from '../../data/contentFactory';
import { getEnvironmentsRepository } from '../../data/environmentsFactory';

export function useLibraryOpsService(): LibraryOpsService {
  return useMemo(() => {
    const library = new LibraryService(getLibraryRepository());
    const models = new ModelsService(getModelsRepository());
    const content = new ContentStudioService(getContentRepository(), {
      library,
      models,
      environments: new EnvironmentsService(getEnvironmentsRepository()),
    });
    const environments = new EnvironmentsService(getEnvironmentsRepository());
    return new LibraryOpsService(getLibraryRepository(), {
      models: { getModel: (id, ws) => models.getModel(id, ws) },
      content: { getScene: (id, ws) => content.getScene(id, ws) },
      environments: { getEnvironment: (id, ws) => environments.getEnvironment(id, ws) },
    });
  }, []);
}
