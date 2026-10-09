/**
 * Shared Create-area data hook — models, environments (with versions) and
 * content plans for the demo workspace. Used by the S08 overview and the
 * S09 Saved drafts & review page so both stay consistent.
 */
import { useEffect, useState } from 'react';
import { ModelsService } from '../../services/modelsService';
import { EnvironmentsService } from '../../services/environmentsService';
import { ContentStudioService } from '../../services/contentService';
import { LibraryService } from '../../services/libraryService';
import { getModelsRepository } from '../../data';
import { getEnvironmentsRepository } from '../../data/environmentsFactory';
import { getContentRepository } from '../../data/contentFactory';
import { getLibraryRepository } from '../../data/libraryFactory';
import { SEED_GALLERY_WORKSPACE_ID } from '../../mock/gallerySeed';
import { SEED_CONTENT_WORKSPACE_ID } from '../../mock/contentSeed';
import type { ModelRecord, ModelVersionRecord } from '../../domain/models';
import type { EnvironmentRecord, EnvironmentVersionRecord } from '../../domain/environments';
import type { ContentProjectSummary } from '../../data/contentRepository';

export function useCreateOverviewData() {
  const [loading, setLoading] = useState(true);
  const [models, setModels] = useState<ModelRecord[]>([]);
  const [modelVersions, setModelVersions] = useState<Record<string, ModelVersionRecord[]>>({});
  const [environments, setEnvironments] = useState<EnvironmentRecord[]>([]);
  const [environmentVersions, setEnvironmentVersions] = useState<Record<string, EnvironmentVersionRecord[]>>({});
  const [projects, setProjects] = useState<ContentProjectSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const modelsService = new ModelsService(getModelsRepository());
        const environmentsService = new EnvironmentsService(getEnvironmentsRepository());
        const content = new ContentStudioService(getContentRepository(), {
          library: new LibraryService(getLibraryRepository()),
          models: modelsService,
          environments: environmentsService,
        });
        const [modelRows, environmentRows, projectRows] = await Promise.all([
          modelsService.listModels(SEED_GALLERY_WORKSPACE_ID),
          environmentsService.listEnvironments(SEED_GALLERY_WORKSPACE_ID),
          content.listProjectSummaries(SEED_CONTENT_WORKSPACE_ID),
        ]);
        const versionMap: Record<string, ModelVersionRecord[]> = {};
        for (const model of modelRows) {
          versionMap[model.id] = await modelsService.getVersions(model.id, SEED_GALLERY_WORKSPACE_ID);
        }
        const envVersionMap: Record<string, EnvironmentVersionRecord[]> = {};
        for (const environment of environmentRows) {
          envVersionMap[environment.id] = await environmentsService.getVersions(
            environment.id,
            SEED_GALLERY_WORKSPACE_ID,
          );
        }
        if (cancelled) return;
        setModels(modelRows);
        setModelVersions(versionMap);
        setEnvironments(environmentRows);
        setEnvironmentVersions(envVersionMap);
        setProjects(projectRows);
        setLoading(false);
      } catch {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { loading, models, modelVersions, environments, environmentVersions, projects };
}
