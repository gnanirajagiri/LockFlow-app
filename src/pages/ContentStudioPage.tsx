/**
 * Content Studio index — the content-plans dashboard. Plans assemble approved
 * reusable inputs; they own nothing and generate nothing: generated work
 * appears in Gallery.
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
import { GridViewIcon, ListViewIcon, SearchIcon, StudioIcon, CameraIcon, VideoIcon, CampaignIcon } from '../components/icons';
import { ContentStudioService } from '../services/contentService';
import { LibraryService } from '../services/libraryService';
import { ModelsService } from '../services/modelsService';
import { EnvironmentsService } from '../services/environmentsService';
import { getContentRepository } from '../data/contentFactory';
import { getLibraryRepository } from '../data/libraryFactory';
import { getModelsRepository } from '../data';
import { getEnvironmentsRepository } from '../data/environmentsFactory';
import { getGalleryRepository } from '../data/galleryFactory';
import { SEED_CONTENT_WORKSPACE_ID } from '../mock/contentSeed';
import { SEED_GALLERY_WORKSPACE_ID } from '../mock/gallerySeed';
import type { GalleryOutputRecord } from '../domain/gallery/types';
import { STUDIO_HELPER_COPY } from '../features/content/contentUi';
import type { ContentProjectStatus } from '../domain/content';
import type { ContentProjectSummary } from '../data/contentRepository';

type LoadState = 'loading' | 'error' | 'ready';
type StatusFilter = 'all' | ContentProjectStatus;
type SortKey = 'updated' | 'name';
type ViewMode = 'grid' | 'list';

const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'ready', label: 'Ready' },
  { value: 'archived', label: 'Archived' },
];

const STATUS_TONE = {
  draft: 'neutral',
  ready: 'success',
  archived: 'warning',
} as const;

/** Gallery output status → badge tone. */
const OUTPUT_TONE: Record<GalleryOutputRecord['status'], 'neutral' | 'info' | 'warning' | 'success' | 'danger'> = {
  draft: 'neutral',
  processing: 'info',
  ready_for_review: 'warning',
  approved: 'success',
  rejected: 'danger',
  archived: 'neutral',
  failed: 'danger',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function ContentStudioPage() {
  const { toast } = useToast();
  const navigate = useNavigate();
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
  const [summaries, setSummaries] = useState<ContentProjectSummary[]>([]);
  const [outputs, setOutputs] = useState<GalleryOutputRecord[]>([]);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sort, setSort] = useState<SortKey>('updated');
  const [view, setView] = useState<ViewMode>('grid');
  const [archiving, setArchiving] = useState<ContentProjectSummary | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const [rows, galleryOutputs] = await Promise.all([
        service.listProjectSummaries(SEED_CONTENT_WORKSPACE_ID),
        getGalleryRepository().listOutputs(SEED_GALLERY_WORKSPACE_ID),
      ]);
      setSummaries(rows);
      setOutputs(
        [...galleryOutputs]
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .slice(0, 5),
      );
      setState('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load Content Studio.');
      setState('error');
    }
  }, [service]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const list = summaries.filter((summary) => {
      if (statusFilter !== 'all' && summary.project.status !== statusFilter) return false;
      if (needle && !summary.project.name.toLowerCase().includes(needle)) return false;
      return true;
    });
    if (sort === 'name') return [...list].sort((a, b) => a.project.name.localeCompare(b.project.name));
    return [...list].sort((a, b) => b.project.updatedAt.localeCompare(a.project.updatedAt));
  }, [search, sort, statusFilter, summaries]);

  async function handleArchive() {
    if (!archiving) return;
    try {
      await service.archiveProject(archiving.project.id, SEED_CONTENT_WORKSPACE_ID);
      toast({ title: 'Plan archived', description: `${archiving.project.name} was archived.`, tone: 'success' });
      setArchiving(null);
      await load();
    } catch (err) {
      toast({
        title: 'Archive failed',
        description: err instanceof Error ? err.message : 'Something went wrong.',
        tone: 'error',
      });
    }
  }

  return (
    <div className="lf-page">
      <PageHeader
        eyebrow="Builder"
        title="Content Studio"
        description="Plan consistent photos, videos and stories with approved reusable inputs."
        actions={
          <Link className="lf-btn lf-btn--primary" to="/content-studio/new">
            New content plan
          </Link>
        }
      />

      <p className="lf-library__note" role="note">{STUDIO_HELPER_COPY}</p>

      <section className="lf-studiohub" aria-label="Start something new">
        <div className="lf-createquick">
          <div className="lf-createquick__item">
            <span className="lf-createquick__icon" aria-hidden="true"><CameraIcon size={18} /></span>
            <div>
              <strong>Create Image</strong>
              <span className="lf-tile__description">High-quality images from your locked model and assets.</span>
            </div>
            <Link className="lf-btn lf-btn--primary lf-btn--sm" to="/content-studio/new">Start</Link>
          </div>
          <div className="lf-createquick__item">
            <span className="lf-createquick__icon" aria-hidden="true"><VideoIcon size={18} /></span>
            <div>
              <strong>Create Video</strong>
              <span className="lf-tile__description">Short-form and long-form video with consistent continuity.</span>
            </div>
            <Link className="lf-btn lf-btn--secondary lf-btn--sm" to="/content-studio/new">Start</Link>
          </div>
          <div className="lf-createquick__item">
            <span className="lf-createquick__icon" aria-hidden="true"><CampaignIcon size={18} /></span>
            <div>
              <strong>Create Content Set</strong>
              <span className="lf-tile__description">Plan a campaign with multiple deliverables at once.</span>
            </div>
            <Link className="lf-btn lf-btn--secondary lf-btn--sm" to="/campaigns/new">Plan</Link>
          </div>
        </div>
      </section>

      {state !== 'error' ? (
      <Card style={{ marginTop: 'var(--lf-space-4)' }}>
        <CardBody>
          <div className="lf-envcard__badges">
            <h3 className="lf-envpanel__heading" style={{ margin: 0 }}>Recent drafts</h3>
            <Link className="lf-btn lf-btn--ghost lf-btn--sm" to="/gallery">View all →</Link>
          </div>
          {state === 'loading' ? (
            <Skeleton lines={2} />
          ) : outputs.length === 0 ? (
            <p className="lf-tile__description">
              Nothing generated yet — set up a plan above and your generated drafts will land here and in Gallery.
            </p>
          ) : (
            <div className="lf-tilegrid">
              {outputs.map((output) => (
                <Card
                  key={output.id}
                  interactive
                  onClick={() => navigate(`/gallery/${output.id}`)}
                >
                  <CardBody>
                    <span className="lf-quicklink__title">{output.title}</span>
                    <span className="lf-tile__meta">
                      <Badge tone={OUTPUT_TONE[output.status]} dot>{output.status.replace('_', ' ')}</Badge>
                      <Badge tone="neutral">{output.outputType}</Badge>
                    </span>
                  </CardBody>
                </Card>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
      ) : null}

      {state === 'ready' ? (
        <h2 className="lf-envpanel__heading" style={{ marginTop: 'var(--lf-space-6)' }}>
          Your content plans
        </h2>
      ) : null}

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
        <>
          <div className="lf-models-toolbar" role="search">
            <div className="lf-models-toolbar__search">
              <span className="lf-models-toolbar__search-icon" aria-hidden="true">
                <SearchIcon size={16} />
              </span>
              <Input
                label="Search content plans"
                hideLabel
                placeholder="Search by name"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                type="search"
              />
            </div>
            <div className="lf-models-toolbar__filter">
              <label className="lf-field__label" htmlFor="studio-status-filter">Status</label>
              <select
                id="studio-status-filter"
                className="lf-input"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
              >
                {STATUS_FILTERS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
            <div className="lf-models-toolbar__filter">
              <label className="lf-field__label" htmlFor="studio-sort">Sort</label>
              <select
                id="studio-sort"
                className="lf-input"
                value={sort}
                onChange={(event) => setSort(event.target.value as SortKey)}
              >
                <option value="updated">Recently updated</option>
                <option value="name">Name A–Z</option>
              </select>
            </div>
            <div className="lf-viewtoggle" role="group" aria-label="Display mode">
              <button
                type="button"
                className={`lf-viewtoggle__btn${view === 'grid' ? ' lf-viewtoggle__btn--active' : ''}`}
                aria-pressed={view === 'grid'}
                onClick={() => setView('grid')}
              >
                <GridViewIcon size={16} />
                <span className="lf-visually-hidden">Grid view</span>
              </button>
              <button
                type="button"
                className={`lf-viewtoggle__btn${view === 'list' ? ' lf-viewtoggle__btn--active' : ''}`}
                aria-pressed={view === 'list'}
                onClick={() => setView('list')}
              >
                <ListViewIcon size={16} />
                <span className="lf-visually-hidden">List view</span>
              </button>
            </div>
          </div>

          {summaries.length === 0 ? (
            <EmptyState
              icon={<StudioIcon size={22} />}
              title="Start your first content plan."
              description="Build a brief, select approved reusable inputs, then prepare a version-pinned generation job."
              actions={
                <Link className="lf-btn lf-btn--primary" to="/content-studio/new">
                  New content plan
                </Link>
              }
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<SearchIcon size={22} />}
              title="No content plans match"
              description="Try a different search term or status filter."
            />
          ) : (
            <div className={view === 'grid' ? 'lf-envgrid' : 'lf-envlist'} role="list">
              {filtered.map((summary) => {
                const { project } = summary;
                return (
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
                            <Badge tone={STATUS_TONE[project.status]} dot>{project.status}</Badge>
                            <Badge tone="neutral">
                              {project.plannedOutputType ? project.plannedOutputType.replace('_', ' ') : 'output TBD'}
                            </Badge>
                            <Badge tone="neutral">
                              {summary.sceneCount} scene{summary.sceneCount === 1 ? '' : 's'}
                            </Badge>
                          </div>
                          <p className="lf-envcard__summary">
                            {project.campaignBrief ?? 'No campaign brief yet.'}
                          </p>
                          <p className="lf-envcard__summary">
                            Model: {summary.modelName ?? '—'} · Environment: {summary.environmentName ?? '—'}
                          </p>
                          <p className="lf-envcard__updated">Updated {formatDate(project.updatedAt)}</p>
                        </div>
                        <div className="lf-envcard__actions">
                          <Link className="lf-btn lf-btn--secondary lf-btn--sm" to={`/content-studio/${project.id}`}>
                            Open
                          </Link>
                          <Button size="sm" variant="ghost" onClick={() => setArchiving(summary)}>
                            Archive
                          </Button>
                        </div>
                      </div>
                    </CardBody>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      ) : null}

      <Modal
        open={archiving !== null}
        onClose={() => setArchiving(null)}
        title={archiving ? `Archive ${archiving.project.name}?` : 'Archive plan'}
        size="sm"
        footer={
          <div className="lf-dialogactions">
            <Button onClick={() => setArchiving(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => void handleArchive()}>
              Archive plan
            </Button>
          </div>
        }
      >
        <p>
          <strong>{archiving?.project.name}</strong> will be marked archived and hidden from the
          default list. This is a soft archive — the plan, its scenes and beats are preserved, and
          nothing is deleted.
        </p>
      </Modal>
    </div>
  );
}
