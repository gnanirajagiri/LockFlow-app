/**
 * Review tab — full continuity and readiness review. Shows the brief, the
 * scene/beat summary, the version-pinned input table, the continuity summary
 * and validation results. "Prepare generation job" stays disabled until every
 * required input is a locked version — and even then it only creates/updates a
 * draft job request (no provider is connected).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody } from '../../components/ui/Card';
import { Skeleton } from '../../components/ui/Skeleton';
import { useToast } from '../../components/ui/Toast';
import { ModelsService } from '../../services/modelsService';
import { EnvironmentsService } from '../../services/environmentsService';
import { LibraryService } from '../../services/libraryService';
import { getModelsRepository } from '../../data';
import { getEnvironmentsRepository } from '../../data/environmentsFactory';
import { getLibraryRepository } from '../../data/libraryFactory';
import { SEED_CONTENT_WORKSPACE_ID } from '../../mock/contentSeed';
import type { ResolvedProjectInput } from '../../domain/content';
import { useContentProjectOutletContext } from './tabRoutes';

interface Row {
  input: ResolvedProjectInput;
  name: string;
  versionLabel: string;
  status: string;
  details: string;
}

export function ReviewTab() {
  const { toast } = useToast();
  const { service, data, basePath } = useContentProjectOutletContext();
  const project = data.project;
  const workspaceId = SEED_CONTENT_WORKSPACE_ID;

  const modelsService = useMemo(() => new ModelsService(getModelsRepository()), []);
  const environmentsService = useMemo(() => new EnvironmentsService(getEnvironmentsRepository()), []);
  const library = useMemo(() => new LibraryService(getLibraryRepository()), []);

  const [rows, setRows] = useState<Row[] | null>(null);
  const [problems, setProblems] = useState<string[] | null>(null);
  const [preparing, setPreparing] = useState(false);

  const load = useCallback(async () => {
    if (!project) return;
    try {
      const resolved = await service.resolveProjectInputs(project.id, workspaceId);
      const built: Row[] = [];
      for (const entry of resolved) {
        const { input } = entry;
        if (input.inputType === 'model') {
          const model = await modelsService.getModel(input.modelId!, workspaceId).catch(() => null);
          built.push({
            input: entry,
            name: model?.name ?? input.modelId!,
            versionLabel: `v${entry.versionNumber}`,
            status: entry.versionStatus,
            details: 'Character Sheet locked with the version (identity-only traits).',
          });
        } else if (input.inputType === 'environment') {
          const environment = await environmentsService.getEnvironment(input.environmentId!, workspaceId).catch(() => null);
          built.push({
            input: entry,
            name: environment?.name ?? input.environmentId!,
            versionLabel: `v${entry.versionNumber}`,
            status: entry.versionStatus,
            details: 'Environment Spec anchors (room, hero angle, lighting, props, palette).',
          });
        } else if (input.inputType === 'library_asset') {
          const asset = await library.getAsset(input.libraryAssetId!, workspaceId).catch(() => null);
          built.push({
            input: entry,
            name: asset?.name ?? input.libraryAssetId!,
            versionLabel: `v${entry.versionNumber}`,
            status: entry.versionStatus,
            details: `Approved configuration (${asset?.assetType.replace('_', ' ') ?? 'asset'}).`,
          });
        } else {
          const asset = await library.getAsset(input.libraryAssetId!, workspaceId).catch(() => null);
          const items = entry.lookItems ?? [];
          built.push({
            input: entry,
            name: asset?.name ?? input.libraryAssetId!,
            versionLabel: `v${entry.versionNumber}`,
            status: entry.versionStatus,
            details: `Look with ${items.length} linked item${items.length === 1 ? '' : 's'} resolved to exact versions.`,
          });
        }
      }
      setRows(built);
      setProblems(await service.validateExecutionReadiness(project.id, workspaceId));
    } catch (err) {
      setRows([]);
      setProblems([err instanceof Error ? err.message : 'Could not resolve the plan inputs.']);
    }
  }, [environmentsService, library, modelsService, project, service, workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!project) return null;
  const ready = problems !== null && problems.length === 0;
  const isDraft = project.status === 'draft';

  async function handlePrepare() {
    if (!project || !ready) return;
    setPreparing(true);
    try {
      // Draft job request only — no provider, no queue, no outputs.
      const job =
        data.draftJob ??
        (await service.createDraftJobRequest(
          {
            workspaceId,
            contentProjectId: project.id,
            name: `${project.name} — Generation job`,
            requestedOutputType: project.plannedOutputType ?? 'photo',
            requestedVariants: project.requestedVariants,
          },
          'demo-user',
          workspaceId,
        ));
      await service.createJobPinsFromProject(job.id, project.id, workspaceId);
      toast({
        title: 'Draft job prepared',
        description: 'Exact approved versions recorded. Ready for provider connection.',
        tone: 'success',
      });
      await data.reload();
    } catch (err) {
      toast({
        title: 'Could not prepare the job',
        description: err instanceof Error ? err.message : 'Something went wrong.',
        tone: 'error',
      });
    } finally {
      setPreparing(false);
    }
  }

  return (
    <div className="lf-section" style={{ gap: 'var(--lf-space-4)' }}>
      <Card>
        <CardBody>
          <h3 className="lf-envpanel__heading">Brief and output plan</h3>
          <p className="lf-tile__description">
            {project.campaignBrief ?? 'No campaign brief recorded.'}
            {project.objective ? ` Objective: ${project.objective}` : ''}
          </p>
          <div className="lf-envcard__badges">
            <Badge tone="neutral">
              {project.plannedOutputType ? project.plannedOutputType.replace('_', ' ') : 'no output type'}
            </Badge>
            <Badge tone="neutral">{project.requestedVariants} variant{project.requestedVariants === 1 ? '' : 's'}</Badge>
            <Badge tone="neutral">{data.scenes.length} scenes</Badge>
            <Badge tone="neutral">
              {Object.values(data.beatsByScene).reduce((sum, beats) => sum + beats.length, 0)} beats
            </Badge>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <h3 className="lf-envpanel__heading">Version-pinned inputs</h3>
          {rows === null ? (
            <Skeleton lines={4} />
          ) : rows.length === 0 ? (
            <p className="lf-tile__description">No inputs selected yet — visit the Inputs tab.</p>
          ) : (
            <table className="lf-table">
              <thead>
                <tr>
                  <th scope="col">Role</th>
                  <th scope="col">Item</th>
                  <th scope="col">Version</th>
                  <th scope="col">Lock status</th>
                  <th scope="col">Key protected details</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.input.input.id}>
                    <td>{row.input.input.role.replace('_', ' ')}</td>
                    <td>{row.name}</td>
                    <td>{row.versionLabel}</td>
                    <td>{row.status === 'locked' ? <Badge tone="locked">locked</Badge> : <Badge tone="warning">{row.status}</Badge>}</td>
                    <td className="lf-tile__description">{row.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <h3 className="lf-envpanel__heading">Validation results</h3>
          {problems === null ? (
            <Skeleton lines={2} />
          ) : ready ? (
            <p className="lf-library__note" role="status">
              Ready: all selected inputs are locked. Preparing a job records the exact approved
              versions. Generation providers are not connected yet.
            </p>
          ) : (
            <div className="lf-alertbox" role="alert">
              <strong>Blocking issues</strong>
              <ul>
                {problems.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </div>
          )}
        </CardBody>
      </Card>

      <div className="lf-dialogactions">
        <Link className="lf-btn lf-btn--secondary" to={`${basePath}/inputs`}>
          Back to edit inputs
        </Link>
        <Link className="lf-btn lf-btn--secondary" to={`${basePath}/storyboard`}>
          Back to storyboard
        </Link>
        <Button
          variant="primary"
          disabled={!ready || !isDraft || preparing || !data.draftJob && rows === null}
          onClick={() => void handlePrepare()}
        >
          {preparing ? 'Preparing…' : 'Prepare generation job'}
        </Button>
      </div>
      <p className="lf-tile__description">
        Preparing a job records the exact approved versions. Generation providers are not
        connected yet — the prepared request stays a draft until a provider exists.
      </p>
    </div>
  );
}
