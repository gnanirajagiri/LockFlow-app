/**
 * Content Studio index — content plans (draft projects). Content Studio
 * assembles approved reusable inputs; it owns nothing and generates nothing:
 * generated work appears in Gallery.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Card, CardBody } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { Modal } from '../components/ui/Modal';
import { Input } from '../components/ui/Input';
import { useToast } from '../components/ui/Toast';
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
import type { ContentProjectRecord } from '../domain/content';

type LoadState = 'loading' | 'error' | 'ready';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

interface ProjectRow {
  project: ContentProjectRecord;
}

export function ContentStudioPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const service = useMemo(
    () =>
      new ContentStudioService(getContentRepository(), {
        library: new LibraryService(getLibraryRepository()),
        models: new ModelsService(getModelsRepository()),
        environments: new EnvironmentsService(getEnvironmentsRepository()),
      }),
    [],
  );

  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<ProjectRow[]>([]);

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createBrief, setCreateBrief] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const workspaceId = SEED_CONTENT_WORKSPACE_ID;
      const projects = await service.listProjects(workspaceId);
      const loaded: ProjectRow[] = projects.map((project) => ({ project }));
      setRows(loaded);
      setState('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load Content Studio.');
      setState('error');
    }
  }, [service]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate() {
    setCreating(true);
    setCreateError(null);
    try {
      const project = await service.createProject(
        {
          workspaceId: SEED_CONTENT_WORKSPACE_ID,
          name: createName,
          ...(createBrief.trim() ? { campaignBrief: createBrief.trim() } : {}),
        },
        'demo-user',
      );
      toast({
        title: 'Content plan created',
        description: `${project.name} starts as a draft — assemble inputs, scenes and beats next.`,
        tone: 'success',
      });
      setCreateOpen(false);
      setCreateName('');
      setCreateBrief('');
      navigate(`/content-studio/${project.id}`);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Could not create the content plan.');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="lf-page">
      <PageHeader
        eyebrow="Builder"
        title="Content Studio"
        description="Plan consistent photos, videos and stories with approved reusable inputs."
        actions={
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            New content plan
          </Button>
        }
      />

      <p className="lf-library__note" role="note">{STUDIO_HELPER_COPY}</p>

      {state === 'loading' ? (
        <div className="lf-envgrid" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} variant="rect" height={140} />
          ))}
        </div>
      ) : null}

      {state === 'error' ? (
        <EmptyState
          icon={<StudioIcon size={22} />}
          title="Couldn't load Content Studio"
          description={error ?? undefined}
          actions={
            <Button variant="primary" onClick={() => void load()}>
              Try again
            </Button>
          }
        />
      ) : null}

      {state === 'ready' ? (
        rows.length === 0 ? (
          <EmptyState
            icon={<StudioIcon size={22} />}
            title="No content plans yet"
            description="Create a content plan to assemble approved models, environments, assets and Looks into scenes and beats — then prepare a job when everything is locked."
            actions={
              <Button variant="primary" onClick={() => setCreateOpen(true)}>
                New content plan
              </Button>
            }
          />
        ) : (
          <div className="lf-envgrid" role="list">
            {rows.map(({ project }: { project: ContentProjectRecord }) => (
              <Card key={project.id} role="listitem">
                <CardBody>
                  <div className="lf-envcard">
                    <div className="lf-envcard__cover" aria-hidden="true">
                      <StudioIcon size={24} />
                    </div>
                    <div className="lf-envcard__body">
                      <div className="lf-envcard__title">
                        <h2>
                          <Link to={`/content-studio/${project.id}`}>{project.name}</Link>
                        </h2>
                        <span className="lf-envcard__slug">/{project.slug}</span>
                      </div>
                      <div className="lf-envcard__badges">
                        <Badge tone={project.status === 'ready' ? 'success' : project.status === 'archived' ? 'warning' : 'neutral'} dot>
                          {project.status}
                        </Badge>
                        <Badge tone="neutral">Content plan</Badge>
                        <Badge tone="neutral">output type: TBD at job</Badge>
                      </div>
                      {project.objective ? <p className="lf-envcard__summary">{project.objective}</p> : null}
                      <p className="lf-envcard__updated">Updated {formatDate(project.updatedAt)}</p>
                    </div>
                    <div className="lf-envcard__actions">
                      <Link className="lf-btn lf-btn--secondary lf-btn--sm" to={`/content-studio/${project.id}`}>
                        Open
                      </Link>
                    </div>
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>
        )
      ) : null}

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New content plan"
        size="sm"
        footer={
          <div className="lf-dialogactions">
            <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => void handleCreate()} disabled={creating || createName.trim() === ''}>
              {creating ? 'Creating…' : 'Create draft plan'}
            </Button>
          </div>
        }
      >
        <p>
          Start a working brief. You will assemble approved models, environments, assets and
          Looks into scenes and beats, then pin exact versions when preparing a job.
        </p>
        <Input
          label="Project name"
          value={createName}
          onChange={(event) => setCreateName(event.target.value)}
          error={createError ?? undefined}
          required
          hint="e.g. Morning Skincare Routine"
        />
        <label className="lf-field" style={{ marginTop: 'var(--lf-space-3)' }}>
          <span className="lf-field__label">Campaign brief (optional)</span>
          <textarea
            className="lf-input lf-envform__textarea"
            rows={3}
            value={createBrief}
            onChange={(event) => setCreateBrief(event.target.value)}
          />
        </label>
        <p className="lf-tile__description">
          {STUDIO_HELPER_COPY} No generation is configured yet — plans stay drafts until a
          provider is connected.
        </p>
      </Modal>
    </div>
  );
}
