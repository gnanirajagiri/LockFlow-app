/**
 * Content Studio index — the content-plans dashboard. Plans assemble approved
 * reusable inputs; they own nothing and generate nothing: generated work
 * appears in Gallery.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Card, CardBody } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { Modal } from '../components/ui/Modal';
import { Input } from '../components/ui/Input';
import { useToast } from '../components/ui/Toast';
import { GridViewIcon, ListViewIcon, SearchIcon, StudioIcon } from '../components/icons';
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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function ContentStudioPage() {
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
  const [summaries, setSummaries] = useState<ContentProjectSummary[]>([]);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sort, setSort] = useState<SortKey>('updated');
  const [view, setView] = useState<ViewMode>('grid');
  const [archiving, setArchiving] = useState<ContentProjectSummary | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      setSummaries(await service.listProjectSummaries(SEED_CONTENT_WORKSPACE_ID));
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
