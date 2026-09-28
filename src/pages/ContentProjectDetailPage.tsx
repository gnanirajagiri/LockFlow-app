/**
 * Content project detail — a lightweight placeholder that shows the plan's
 * brief, selected inputs (canonical, workspace-checked), and its scenes and
 * beats. Full editing UI arrives with the functional Content Studio milestone.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageHeader } from '../components/layout/PageHeader';
import { Badge } from '../components/ui/Badge';
import { Card, CardBody } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { StudioIcon } from '../components/icons';
import { ContentStudioService } from '../services/contentService';
import { LibraryService } from '../services/libraryService';
import { ModelsService } from '../services/modelsService';
import { EnvironmentsService } from '../services/environmentsService';
import { getContentRepository } from '../data/contentFactory';
import { getLibraryRepository } from '../data/libraryFactory';
import { getModelsRepository } from '../data';
import { getEnvironmentsRepository } from '../data/environmentsFactory';
import { SEED_CONTENT_WORKSPACE_ID } from '../mock/contentSeed';
import { STUDIO_HELPER_COPY } from '../features/content/contentUi';
import type {
  ContentBeatRecord,
  ContentProjectInputRecord,
  ContentProjectRecord,
  ContentSceneRecord,
} from '../domain/content';

interface DetailState {
  project: ContentProjectRecord;
  inputs: ContentProjectInputRecord[];
  scenes: ContentSceneRecord[];
  beats: Record<string, ContentBeatRecord[]>;
  modelNames: Record<string, string>;
  environmentNames: Record<string, string>;
  assetNames: Record<string, string>;
}

export function ContentProjectDetailPage() {
  const { projectId } = useParams();
  const service = useMemo(
    () =>
      new ContentStudioService(getContentRepository(), {
        library: new LibraryService(getLibraryRepository()),
        models: new ModelsService(getModelsRepository()),
        environments: new EnvironmentsService(getEnvironmentsRepository()),
      }),
    [],
  );
  const modelsService = useMemo(() => new ModelsService(getModelsRepository()), []);
  const environmentsService = useMemo(() => new EnvironmentsService(getEnvironmentsRepository()), []);
  const libraryService = useMemo(() => new LibraryService(getLibraryRepository()), []);

  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailState | null>(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    setState('loading');
    setError(null);
    try {
      const workspaceId = SEED_CONTENT_WORKSPACE_ID;
      const project = await service.getProject(projectId, workspaceId);
      const [inputs, scenes] = await Promise.all([
        service.listProjectInputs(projectId, workspaceId),
        service.listScenes(projectId, workspaceId),
      ]);
      const beats: Record<string, ContentBeatRecord[]> = {};
      for (const scene of scenes) {
        beats[scene.id] = await service.listBeats(scene.id, workspaceId).catch(() => []);
      }
      const modelNames: Record<string, string> = {};
      const environmentNames: Record<string, string> = {};
      const assetNames: Record<string, string> = {};
      for (const input of inputs) {
        if (input.inputType === 'model' && !modelNames[input.modelId!]) {
          const model = await modelsService.getModel(input.modelId!, workspaceId).catch(() => null);
          modelNames[input.modelId!] = model?.name ?? input.modelId!;
        }
        if (input.inputType === 'environment' && !environmentNames[input.environmentId!]) {
          const environment = await environmentsService
            .getEnvironment(input.environmentId!, workspaceId)
            .catch(() => null);
          environmentNames[input.environmentId!] = environment?.name ?? input.environmentId!;
        }
        if (
          (input.inputType === 'library_asset' || input.inputType === 'look') &&
          input.libraryAssetId &&
          !assetNames[input.libraryAssetId]
        ) {
          const asset = await libraryService
            .getAsset(input.libraryAssetId, workspaceId)
            .catch(() => null);
          assetNames[input.libraryAssetId] = asset?.name ?? input.libraryAssetId;
        }
      }
      setDetail({ project, inputs, scenes, beats, modelNames, environmentNames, assetNames });
      setState('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this content plan.');
      setState('error');
    }
  }, [environmentsService, libraryService, modelsService, projectId, service]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state === 'loading') {
    return (
      <div className="lf-page" aria-busy="true">
        <Skeleton variant="rect" height={64} />
        <Skeleton variant="title" />
        <Skeleton lines={4} />
      </div>
    );
  }

  if (state === 'error' || !detail) {
    return (
      <div className="lf-page">
        <EmptyState
          icon={<StudioIcon size={22} />}
          title={error?.includes('not found') ? 'Content plan not found' : "Couldn't load this content plan"}
          description={error ?? undefined}
          actions={
            <Link className="lf-btn lf-btn--primary" to="/content-studio">
              Back to Content Studio
            </Link>
          }
        />
      </div>
    );
  }

  const { project, inputs, scenes, beats, modelNames, environmentNames, assetNames } = detail;

  return (
    <div className="lf-page">
      <PageHeader
        eyebrow="Content Studio"
        title={project.name}
        description={project.objective ?? STUDIO_HELPER_COPY}
        actions={
          <Link className="lf-btn lf-btn--secondary" to="/content-studio">
            Back to Content Studio
          </Link>
        }
      />

      <p className="lf-library__note" role="note">{STUDIO_HELPER_COPY}</p>

      <div className="lf-statgrid">
        <div className="lf-statcard">
          <span className="lf-statcard__label">Status</span>
          <span className="lf-statcard__value">
            <Badge tone={project.status === 'ready' ? 'success' : project.status === 'archived' ? 'warning' : 'neutral'} dot>
              {project.status}
            </Badge>
          </span>
          <span className="lf-statcard__hint">
            {project.status === 'draft'
              ? 'Draft plans remain editable.'
              : 'Non-draft plans preserve their historic structure.'}
          </span>
        </div>
        <div className="lf-statcard">
          <span className="lf-statcard__label">Audience</span>
          <span className="lf-statcard__value">{project.audience ?? '—'}</span>
          <span className="lf-statcard__hint">{project.brandVoice ? `Voice: ${project.brandVoice}` : ''}</span>
        </div>
      </div>

      <Card>
        <CardBody>
          <h3 className="lf-envpanel__heading">Campaign brief</h3>
          {project.campaignBrief ? (
            <p className="lf-tile__description">{project.campaignBrief}</p>
          ) : (
            <p className="lf-tile__description">No campaign brief recorded.</p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <h3 className="lf-envpanel__heading">Planned inputs</h3>
          <p className="lf-tile__description">
            Canonical records from Models, Environments and the one shared Library — never copies.
            Exact versions are recorded now and pinned (locked-only) when a job is prepared.
          </p>
          {inputs.length === 0 ? (
            <p className="lf-tile__description">No inputs selected yet.</p>
          ) : (
            <ul className="lf-envref__list">
              {inputs.map((input) => (
                <li key={input.id} className="lf-envref__item">
                  <strong>
                    {input.inputType === 'model' && input.modelId
                      ? modelNames[input.modelId] ?? input.modelId
                      : input.inputType === 'environment' && input.environmentId
                        ? environmentNames[input.environmentId] ?? input.environmentId
                        : input.libraryAssetId
                          ? assetNames[input.libraryAssetId] ?? input.libraryAssetId
                          : input.inputType}
                  </strong>
                  <span className="lf-tile__description">
                    {input.inputType} · role: {input.role} · version{' '}
                    {input.modelVersionId ?? input.environmentVersionId ?? input.libraryAssetVersionId}
                    {input.notes ? ` — ${input.notes}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <h3 className="lf-envpanel__heading">Scenes &amp; beats</h3>
          {scenes.length === 0 ? (
            <p className="lf-tile__description">No scenes yet.</p>
          ) : (
            <ol className="lf-library__lookitems">
              {scenes.map((scene) => (
                <li key={scene.id} className="lf-library__lookitem" style={{ display: 'block' }}>
                  <strong>
                    {scene.sceneOrder + 1}. {scene.title}
                  </strong>
                  {scene.purpose ? (
                    <span className="lf-library__lookitemmeta">{scene.purpose}</span>
                  ) : null}
                  {(beats[scene.id] ?? []).length > 0 ? (
                    <ol className="lf-library__lookitems" style={{ marginTop: 'var(--lf-space-2)' }}>
                      {(beats[scene.id] ?? []).map((beat) => (
                        <li key={beat.id} className="lf-library__lookitem">
                          <span className="lf-library__lookitemnum" aria-hidden="true">
                            {beat.beatOrder + 1}
                          </span>
                          <span className="lf-library__lookitembody">
                            <strong>{beat.title}</strong>
                            {beat.actionDescription ? (
                              <span className="lf-library__lookitemmeta">{beat.actionDescription}</span>
                            ) : null}
                            {beat.dialogueOrOverlay ? (
                              <span className="lf-library__lookitemmeta">{beat.dialogueOrOverlay}</span>
                            ) : null}
                          </span>
                          {beat.durationSeconds != null ? (
                            <span className="lf-library__lookitemmeta">{beat.durationSeconds}s</span>
                          ) : null}
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <span className="lf-library__lookitemmeta">No beats yet.</span>
                  )}
                </li>
              ))}
            </ol>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
