/**
 * Gallery dashboard — generated work only (never Library assets). Placeholder
 * media is clearly identified: provider generation and secure media storage
 * are not connected yet.
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
import { GalleryIcon, GridViewIcon, ListViewIcon, SearchIcon } from '../components/icons';
import { GalleryService } from '../services/galleryService';
import { ContentStudioService } from '../services/contentService';
import { LibraryService } from '../services/libraryService';
import { ModelsService } from '../services/modelsService';
import { EnvironmentsService } from '../services/environmentsService';
import { getGalleryRepository } from '../data/galleryFactory';
import { getContentRepository } from '../data/contentFactory';
import { getLibraryRepository } from '../data/libraryFactory';
import { getModelsRepository } from '../data';
import { getEnvironmentsRepository } from '../data/environmentsFactory';
import { SEED_GALLERY_WORKSPACE_ID } from '../mock/gallerySeed';
import type { ContentProjectRecord } from '../domain/content';
import type { GalleryOutputRecord, GalleryOutputStatus, GalleryOutputType } from '../domain/gallery';

type LoadState = 'loading' | 'error' | 'ready';
type StatusFilter = 'all' | GalleryOutputStatus;
type TypeFilter = 'all' | GalleryOutputType;
type SortKey = 'created' | 'updated' | 'status' | 'title';
type ViewMode = 'grid' | 'list';

const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'All outputs' },
  { value: 'draft', label: 'Draft' },
  { value: 'processing', label: 'Processing' },
  { value: 'ready_for_review', label: 'Ready for review' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'archived', label: 'Archived' },
];

const STATUS_TONE: Record<GalleryOutputStatus, 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'locked' | 'primary'> = {
  draft: 'neutral',
  processing: 'info',
  ready_for_review: 'primary',
  approved: 'success',
  rejected: 'danger',
  archived: 'warning',
  failed: 'danger',
};

function statusLabel(status: GalleryOutputStatus): string {
  return status.replace(/_/g, ' ');
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function GalleryPage() {
  const { toast } = useToast();
  const service = useMemo(() => {
    const content = new ContentStudioService(getContentRepository(), {
      library: new LibraryService(getLibraryRepository()),
      models: new ModelsService(getModelsRepository()),
      environments: new EnvironmentsService(getEnvironmentsRepository()),
    });
    return new GalleryService(getGalleryRepository(), content, SEED_GALLERY_WORKSPACE_ID);
  }, []);

  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [outputs, setOutputs] = useState<GalleryOutputRecord[]>([]);
  const [projects, setProjects] = useState<ContentProjectRecord[]>([]);
  const [outputTags, setOutputTags] = useState<Record<string, string[]>>({});
  const [projectNames, setProjectNames] = useState<Record<string, string>>({});
  const [jobProjectMap, setJobProjectMap] = useState<Record<string, string>>({});

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [sort, setSort] = useState<SortKey>('created');
  const [view, setView] = useState<ViewMode>('grid');
  const [archiving, setArchiving] = useState<GalleryOutputRecord | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const workspaceId = SEED_GALLERY_WORKSPACE_ID;
      const list = await service.listOutputs(workspaceId);
      const tagMap: Record<string, string[]> = {};
      for (const output of list) {
        const tags = await service.listTagsForOutput(output.id, workspaceId).catch(() => []);
        tagMap[output.id] = tags.map((tag) => tag.name);
      }
      const { projects: projectList, jobProjectMap: jobProject } = await resolveProjectContext(service, list);
      setOutputs(list);
      setOutputTags(tagMap);
      setProjects(projectList);
      setJobProjectMap(jobProject);
      const nameMap: Record<string, string> = {};
      for (const project of projectList) nameMap[project.id] = project.name;
      setProjectNames(nameMap);
      setState('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the Gallery.');
      setState('error');
    }
  }, [service]);

  /**
   * Resolves project context via each output's read-only job provenance:
   * the distinct project list for filtering plus a job → project id map.
   */
  async function resolveProjectContext(
    galleryService: GalleryService,
    list: GalleryOutputRecord[],
  ): Promise<{ projects: ContentProjectRecord[]; jobProjectMap: Record<string, string> }> {
    const seen = new Map<string, ContentProjectRecord>();
    const jobProjectMap: Record<string, string> = {};
    for (const output of list) {
      const provenance = await galleryService.resolveProvenance(output.id, SEED_GALLERY_WORKSPACE_ID);
      jobProjectMap[output.contentJobRequestId] = provenance.project?.id ?? '';
      if (provenance.project && !seen.has(provenance.project.id)) {
        seen.set(provenance.project.id, provenance.project);
      }
    }
    return { projects: [...seen.values()], jobProjectMap };
  }

  useEffect(() => {
    void load();
  }, [load]);

  const filtersActive =
    search.trim() !== '' || typeFilter !== 'all' || statusFilter !== 'all' || projectFilter !== 'all';

  const filtered = useMemo(() => {
    let list = outputs;
    if (typeFilter !== 'all') list = list.filter((output) => output.outputType === typeFilter);
    if (statusFilter !== 'all') list = list.filter((output) => output.status === statusFilter);
    if (projectFilter !== 'all') {
      list = list.filter((output) => jobProjectMap[output.contentJobRequestId] === projectFilter);
    }
    if (search.trim() !== '') {
      const needle = search.trim().toLowerCase();
      list = list.filter((output) => output.title.toLowerCase().includes(needle));
    }
    return [...list].sort((a, b) => {
      switch (sort) {
        case 'title':
          return a.title.localeCompare(b.title);
        case 'status':
          return a.status.localeCompare(b.status);
        case 'updated':
          return b.updatedAt.localeCompare(a.updatedAt);
        default:
          return b.createdAt.localeCompare(a.createdAt);
      }
    });
  }, [outputs, jobProjectMap, projectFilter, search, sort, statusFilter, typeFilter]);

  const counts = useMemo(
    () => ({
      ready: outputs.filter((output) => output.status === 'ready_for_review').length,
      approved: outputs.filter((output) => output.status === 'approved').length,
      draftInProgress: outputs.filter((output) => output.status === 'draft' || output.status === 'processing').length,
      failed: outputs.filter((output) => output.status === 'failed').length,
    }),
    [outputs],
  );

  function resetFilters() {
    setSearch('');
    setTypeFilter('all');
    setStatusFilter('all');
    setProjectFilter('all');
  }

  async function handleArchive() {
    if (!archiving) return;
    try {
      await service.archiveOutput(archiving.id, SEED_GALLERY_WORKSPACE_ID);
      toast({ title: 'Output archived', description: `${archiving.title} was archived.`, tone: 'success' });
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

  function OutputCard({ output }: { output: GalleryOutputRecord }) {
    const jobId = output.contentJobRequestId;
    const projectId = jobProjectMap[jobId];
    return (
      <>
        <Link to={`/gallery/${output.id}`} className="lf-library__rowlink">
          <div className="lf-envcard">
            <div className="lf-envcard__cover" aria-hidden="true">
              <GalleryIcon size={24} />
            </div>
            <div className="lf-envcard__body">
              <div className="lf-envcard__title">
                <h2>{output.title}</h2>
                <span className="lf-envcard__slug">#{output.outputIndex}</span>
              </div>
              <div className="lf-envcard__badges">
                <Badge tone="neutral">{output.outputType}</Badge>
                <Badge tone={STATUS_TONE[output.status]} dot>{statusLabel(output.status)}</Badge>
                {output.durationSeconds != null ? <Badge tone="neutral">{output.durationSeconds}s</Badge> : null}
                {output.parentGalleryOutputId ? <Badge tone="info">variant</Badge> : null}
              </div>
              <p className="lf-envcard__summary">
                {projectId ? projectNames[projectId] ?? '—' : '—'} · {formatDate(output.createdAt)}
              </p>
              {(outputTags[output.id] ?? []).length > 0 ? (
                <p className="lf-library__tags">
                  {(outputTags[output.id] ?? []).map((tag) => (
                    <span key={tag} className="lf-library__tag">{tag}</span>
                  ))}
                </p>
              ) : null}
            </div>
          </div>
        </Link>
        <div className="lf-library__rowmenu">
          <Link className="lf-btn lf-btn--ghost lf-btn--sm" to={`/gallery/${output.id}`}>
            Open
          </Link>
          <Button size="sm" variant="ghost" onClick={() => setArchiving(output)}>
            Archive
          </Button>
        </div>
      </>
    );
  }

  return (
    <div className="lf-page">
      <PageHeader
        eyebrow="Work"
        title="Gallery"
        description="Review, organise and export your generated work."
        actions={
          <div className="lf-envprofile__actions-row">
            <Link className="lf-btn lf-btn--secondary" to="/corrections">
              Correction requests
            </Link>
            <Link className="lf-btn lf-btn--primary" to="/content-studio">
              Open Content Studio
            </Link>
          </div>
        }
      />

      {state === 'loading' ? (
        <div className="lf-envgrid" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} variant="rect" height={150} />
          ))}
        </div>
      ) : null}

      {state === 'error' ? (
        <EmptyState
          icon={<GalleryIcon size={22} />}
          title="Couldn't load the Gallery"
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
          <div className="lf-statgrid">
            <div className="lf-statcard">
              <span className="lf-statcard__label">Ready for review</span>
              <span className="lf-statcard__value">{counts.ready}</span>
            </div>
            <div className="lf-statcard">
              <span className="lf-statcard__label">Approved</span>
              <span className="lf-statcard__value">{counts.approved}</span>
            </div>
            <div className="lf-statcard">
              <span className="lf-statcard__label">Draft / in progress</span>
              <span className="lf-statcard__value">{counts.draftInProgress}</span>
            </div>
            <div className="lf-statcard">
              <span className="lf-statcard__label">Failed</span>
              <span className="lf-statcard__value">{counts.failed}</span>
            </div>
          </div>

          <div className="lf-models-toolbar" role="search">
            <div className="lf-models-toolbar__search">
              <span className="lf-models-toolbar__search-icon" aria-hidden="true">
                <SearchIcon size={16} />
              </span>
              <Input
                label="Search outputs"
                hideLabel
                placeholder="Search by title"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                type="search"
              />
            </div>
            <div className="lf-models-toolbar__filter">
              <label className="lf-field__label" htmlFor="gallery-type-filter">Type</label>
              <select
                id="gallery-type-filter"
                className="lf-input"
                value={typeFilter}
                onChange={(event) => setTypeFilter(event.target.value as TypeFilter)}
              >
                <option value="all">All types</option>
                <option value="image">Images</option>
                <option value="video">Videos</option>
                <option value="story">Stories</option>
              </select>
            </div>
            <div className="lf-models-toolbar__filter">
              <label className="lf-field__label" htmlFor="gallery-status-filter">Status</label>
              <select
                id="gallery-status-filter"
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
              <label className="lf-field__label" htmlFor="gallery-project-filter">Project</label>
              <select
                id="gallery-project-filter"
                className="lf-input"
                value={projectFilter}
                onChange={(event) => setProjectFilter(event.target.value)}
              >
                <option value="all">All projects</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>{project.name}</option>
                ))}
              </select>
            </div>
            <div className="lf-models-toolbar__filter">
              <label className="lf-field__label" htmlFor="gallery-sort">Sort</label>
              <select
                id="gallery-sort"
                className="lf-input"
                value={sort}
                onChange={(event) => setSort(event.target.value as SortKey)}
              >
                <option value="created">Recently created</option>
                <option value="updated">Recently updated</option>
                <option value="status">Status</option>
                <option value="title">Title</option>
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

          {filtersActive && filtered.length > 0 ? (
            <p className="lf-library__filterreset">
              {filtered.length} of {outputs.length} outputs shown.{' '}
              <button type="button" className="lf-library__resetlink" onClick={resetFilters}>
                Reset filters
              </button>
            </p>
          ) : null}

          <div className="lf-dialogactions" style={{ justifyContent: 'flex-start' }}>
            <Link className="lf-btn lf-btn--secondary lf-btn--sm" to="/gallery/collections">
              Collections
            </Link>
          </div>

          {outputs.length === 0 ? (
            <EmptyState
              icon={<GalleryIcon size={22} />}
              title="Your generated work will appear here."
              description="Create a version-pinned plan in Content Studio when provider generation is connected."
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<SearchIcon size={22} />}
              title="No outputs match"
              description="Try a different search term or filter combination."
              actions={
                <button type="button" className="lf-btn lf-btn--secondary" onClick={resetFilters}>
                  Clear filters
                </button>
              }
            />
          ) : (
            <div className={view === 'grid' ? 'lf-envgrid' : 'lf-envlist'} role="list">
              {filtered.map((output) => (
                <Card key={output.id} role="listitem">
                  <CardBody>
                    <OutputCard output={output} />
                  </CardBody>
                </Card>
              ))}
            </div>
          )}

          <p className="lf-tile__description" style={{ marginTop: 'var(--lf-space-4)' }}>
            Placeholder previews — provider generation and secure media storage are not connected
            yet. Generated work appears in Gallery, never in the Library.
          </p>
        </>
      ) : null}

      <Modal
        open={archiving !== null}
        onClose={() => setArchiving(null)}
        title={archiving ? `Archive ${archiving.title}?` : 'Archive output'}
        size="sm"
        footer={
          <div className="lf-dialogactions">
            <Button onClick={() => setArchiving(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => void handleArchive()}>
              Archive output
            </Button>
          </div>
        }
      >
        <p>
          <strong>{archiving?.title}</strong> will be marked archived and hidden from the default
          list. This is a soft archive — the output, its provenance and reviews are preserved, and
          it can be restored later.
        </p>
      </Modal>
    </div>
  );
}
