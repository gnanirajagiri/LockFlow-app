/**
 * Job tab — preparation and status of the plan's draft job request. Shows the
 * requested output type and variants, the immutable preview of every resolved
 * pin, and the audit event timeline. Honest wording throughout: no provider is
 * connected, no generation is triggered here, and outputs will appear in
 * Gallery once that system exists.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { useToast } from '../../components/ui/Toast';
import { ContentStudioService } from '../../services/contentService';
import { LibraryService } from '../../services/libraryService';
import { ModelsService } from '../../services/modelsService';
import { EnvironmentsService } from '../../services/environmentsService';
import { getContentRepository } from '../../data/contentFactory';
import { getLibraryRepository } from '../../data/libraryFactory';
import { getModelsRepository } from '../../data';
import { getEnvironmentsRepository } from '../../data/environmentsFactory';
import { SEED_CONTENT_WORKSPACE_ID } from '../../mock/contentSeed';
import type { ContentJobPinRecord } from '../../domain/content';
import { useContentProjectOutletContext } from './tabRoutes';

export function JobTab() {
  const { toast } = useToast();
  const { service, data, basePath } = useContentProjectOutletContext();
  const project = data.project;
  const job = data.draftJob;
  const workspaceId = SEED_CONTENT_WORKSPACE_ID;

  const [pins, setPins] = useState<ContentJobPinRecord[] | null>(null);
  const [preparing, setPreparing] = useState(false);

  const pinService = useMemo(
    () =>
      new ContentStudioService(getContentRepository(), {
        library: new LibraryService(getLibraryRepository()),
        models: new ModelsService(getModelsRepository()),
        environments: new EnvironmentsService(getEnvironmentsRepository()),
      }),
    [],
  );

  const loadPins = useCallback(async () => {
    if (!job) {
      setPins(null);
      return;
    }
    try {
      setPins(await service.listJobPins(job.id, workspaceId));
    } catch {
      setPins([]);
    }
  }, [job, service, workspaceId]);

  useEffect(() => {
    void loadPins();
  }, [loadPins]);

  if (!project) return null;

  async function handlePrepare() {
    if (!project) return;
    setPreparing(true);
    try {
      const target =
        job ??
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
      const problems = await service.validateExecutionReadiness(project.id, workspaceId);
      if (problems.length > 0) {
        toast({
          title: 'Job is not ready',
          description: problems.join(' '),
          tone: 'error',
        });
        return;
      }
      await pinService.createJobPinsFromProject(target.id, project.id, workspaceId);
      toast({
        title: 'Draft job prepared',
        description: 'Exact approved versions recorded. Ready for provider connection.',
        tone: 'success',
      });
      await data.reload();
      await loadPins();
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
          <h3 className="lf-envpanel__heading">Job request</h3>
          {job ? (
            <>
              <div className="lf-envcard__badges">
                <strong>{job.name}</strong>
                <Badge tone="primary">{job.status}</Badge>
                <Badge tone="neutral">{job.requestedOutputType.replace('_', ' ')}</Badge>
                <Badge tone="neutral">{job.requestedVariants} variant{job.requestedVariants === 1 ? '' : 's'}</Badge>
              </div>
              <p className="lf-tile__description">
                Draft job request — no provider call, no queue submission, no outputs. When
                generation is connected, submitted requests become immutable and outputs appear in
                Gallery.
              </p>
            </>
          ) : (
            <p className="lf-tile__description">
              No draft job request yet. Prepare one from the Review tab once every required input
              is a locked version.
            </p>
          )}
          <div className="lf-dialogactions" style={{ justifyContent: 'flex-start' }}>
            <Link className="lf-btn lf-btn--secondary lf-btn--sm" to={`${basePath}/review`}>
              Open review
            </Link>
            <Button
              variant="primary"
              size="sm"
              disabled={preparing || project.status !== 'draft'}
              onClick={() => void handlePrepare()}
            >
              {preparing ? 'Preparing…' : job ? 'Re-prepare with current locked versions' : 'Prepare generation job'}
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <h3 className="lf-envpanel__heading">Resolved pins (immutable preview)</h3>
          {job === null ? (
            <EmptyState
              borderless
              title="No pins yet"
              description="Pins are recorded when the job is prepared. Each pin freezes the exact selected locked version — newer versions are never substituted."
            />
          ) : pins === null ? (
            <Skeleton lines={4} />
          ) : pins.length === 0 ? (
            <p className="lf-tile__description">
              No pins recorded yet — prepare the job to freeze the current locked selections.
            </p>
          ) : (
            <ul className="lf-envref__list">
              {pins.map((pin) => (
                <li key={pin.id} className="lf-envref__item">
                  <strong>
                    {(pin.resolvedDetails as { assetName?: string; modelName?: string; environmentName?: string }).assetName ??
                      (pin.resolvedDetails as { modelName?: string }).modelName ??
                      (pin.resolvedDetails as { environmentName?: string }).environmentName ??
                      pin.sourceRecordId}
                  </strong>
                  <span className="lf-tile__description">
                    {pin.pinType.replace('_', ' ')} · role: {pin.role} · v
                    {(pin.resolvedDetails as { versionNumber?: number }).versionNumber} ·{' '}
                    {(pin.resolvedDetails as { versionStatus?: string }).versionStatus === 'locked' ? 'locked ✓' : 'unlocked'}
                    {(pin.resolvedDetails as { resolvedVia?: string }).resolvedVia === 'look_version'
                      ? ' · resolved via Look'
                      : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <h3 className="lf-envpanel__heading">Event timeline</h3>
          {data.jobEvents.length === 0 ? (
            <p className="lf-tile__description">No events yet.</p>
          ) : (
            <ul className="lf-envref__list">
              {data.jobEvents.map((event) => (
                <li key={event.id} className="lf-envref__item">
                  <strong>{event.eventType.replace(/_/g, ' ')}</strong>
                  <span className="lf-tile__description">
                    {event.message} · {new Date(event.createdAt).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
