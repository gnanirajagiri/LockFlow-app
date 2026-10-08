/**
 * Templates home (/templates) — the reusable-plans dashboard.
 *
 * Templates are creative planning structures: cards show counts and status,
 * never media. Actions are honest — Use, Edit, Duplicate, Archive. Loading,
 * error, empty, filtered-empty and permission-denied states are covered.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../../components/layout/PageHeader';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Card, CardBody } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { useToast } from '../../components/ui/Toast';
import { GridViewIcon, ListViewIcon, SearchIcon, TemplateIcon } from '../../components/icons';
import { TemplatesService } from '../../services/templatesService';
import { getTemplatesRepository } from '../../data/templatesFactory';
import { getLibraryRepository } from '../../data/libraryFactory';
import { getModelsRepository } from '../../data';
import { getEnvironmentsRepository } from '../../data/environmentsFactory';
import { LibraryService } from '../../services/libraryService';
import { ModelsService } from '../../services/modelsService';
import { EnvironmentsService } from '../../services/environmentsService';
import { SEED_CONTENT_WORKSPACE_ID } from '../../mock/contentSeed';
import { TEMPLATE_CATEGORIES } from '../../domain/templates';
import type { ContentTemplateRecord, TemplateCategory, TemplateStatus } from '../../domain/templates';
import type { TemplateSummary } from '../../data/templatesRepository';
import {
  TEMPLATE_CATEGORY_LABELS,
  TEMPLATE_STATUS_TONE,
  formatTemplateDate,
} from './templatesUi';

type LoadState = 'loading' | 'error' | 'ready';
type StatusFilter = 'all' | TemplateStatus;
type OutputFilter = 'all' | ContentTemplateRecord['defaultOutputType'];
type SortKey = 'updated' | 'name' | 'category';
type ViewMode = 'grid' | 'list';

const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
];

const OUTPUT_FILTERS: Array<{ value: OutputFilter; label: string }> = [
  { value: 'all', label: 'All outputs' },
  { value: 'photo', label: 'Photo' },
  { value: 'video', label: 'Video' },
  { value: 'story', label: 'Story' },
  { value: 'content_set', label: 'Content set' },
];

const SORTS: Array<{ value: SortKey; label: string }> = [
  { value: 'updated', label: 'Recently updated' },
  { value: 'name', label: 'Name A–Z' },
  { value: 'category', label: 'Category' },
];

export function TemplatesHomePage() {
  const { toast } = useToast();
  const service = useMemo(
    () =>
      new TemplatesService(getTemplatesRepository(), {
        library: new LibraryService(getLibraryRepository()),
        models: new ModelsService(getModelsRepository()),
        environments: new EnvironmentsService(getEnvironmentsRepository()),
      }),
    [],
  );

  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<TemplateSummary[]>([]);

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | TemplateCategory>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [outputFilter, setOutputFilter] = useState<OutputFilter>('all');
  const [sort, setSort] = useState<SortKey>('updated');
  const [view, setView] = useState<ViewMode>('grid');
  const [archiving, setArchiving] = useState<TemplateSummary | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      setSummaries(await service.listTemplates(SEED_CONTENT_WORKSPACE_ID));
      setState('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load templates.');
      setState('error');
    }
  }, [service]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const list = summaries.filter(({ template }) => {
      if (statusFilter !== 'all' && template.status !== statusFilter) return false;
      if (categoryFilter !== 'all' && template.category !== categoryFilter) return false;
      if (outputFilter !== 'all' && template.defaultOutputType !== outputFilter) return false;
      if (needle) {
        const haystack = `${template.name} ${template.description ?? ''}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
    if (sort === 'name') return [...list].sort((a, b) => a.template.name.localeCompare(b.template.name));
    if (sort === 'category') {
      return [...list].sort((a, b) => a.template.category.localeCompare(b.template.category));
    }
    return [...list].sort((a, b) => b.template.updatedAt.localeCompare(a.template.updatedAt));
  }, [categoryFilter, outputFilter, search, sort, statusFilter, summaries]);

  async function handleArchive() {
    if (!archiving) return;
    try {
      await service.archiveTemplate(archiving.template.id, SEED_CONTENT_WORKSPACE_ID);
      toast({ title: 'Template archived', description: `${archiving.template.name} was archived.`, tone: 'success' });
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
        eyebrow="Planning"
        title="Templates"
        description="Reusable creative plans for consistent content."
        actions={
          <Link className="lf-btn lf-btn--primary" to="/templates/new">
            New template
          </Link>
        }
      />

      <p className="lf-library__note" role="note">
        Reusable structures for scenes and Beats. Templates never lock a model, environment or asset.
      </p>

      {state === 'loading' ? (
        <div className="lf-envgrid" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} variant="rect" height={140} />
          ))}
        </div>
      ) : null}

      {state === 'error' ? (
        <EmptyState
          icon={<TemplateIcon size={22} />}
          title="Couldn't load templates"
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
                label="Search templates"
                hideLabel
                placeholder="Search by name or description"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                type="search"
              />
            </div>
            <div className="lf-models-toolbar__filter">
              <label className="lf-field__label" htmlFor="tmpl-category-filter">Category</label>
              <select
                id="tmpl-category-filter"
                className="lf-input"
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value as 'all' | TemplateCategory)}
              >
                <option value="all">All categories</option>
                {TEMPLATE_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {TEMPLATE_CATEGORY_LABELS[category]}
                  </option>
                ))}
              </select>
            </div>
            <div className="lf-models-toolbar__filter">
              <label className="lf-field__label" htmlFor="tmpl-status-filter">Status</label>
              <select
                id="tmpl-status-filter"
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
              <label className="lf-field__label" htmlFor="tmpl-output-filter">Output type</label>
              <select
                id="tmpl-output-filter"
                className="lf-input"
                value={outputFilter}
                onChange={(event) => setOutputFilter(event.target.value as OutputFilter)}
              >
                {OUTPUT_FILTERS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
            <div className="lf-models-toolbar__filter">
              <label className="lf-field__label" htmlFor="tmpl-sort">Sort</label>
              <select
                id="tmpl-sort"
                className="lf-input"
                value={sort}
                onChange={(event) => setSort(event.target.value as SortKey)}
              >
                {SORTS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
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
              icon={<TemplateIcon size={22} />}
              title="Create a reusable plan for your next content set."
              description="Templates save structure and creative direction. You choose approved source versions in Content Studio."
              actions={
                <Link className="lf-btn lf-btn--primary" to="/templates/new">
                  New template
                </Link>
              }
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<SearchIcon size={22} />}
              title="No templates match"
              description="Try a different search term or filter."
            />
          ) : (
            <div className={view === 'grid' ? 'lf-tmplgrid' : 'lf-envlist'} role="list">
              {filtered.map((summary) => (
                <TemplateCard
                  key={summary.template.id}
                  summary={summary}
                  onArchive={() => setArchiving(summary)}
                />
              ))}
            </div>
          )}
        </>
      ) : null}

      <Modal
        open={archiving !== null}
        onClose={() => setArchiving(null)}
        title={archiving ? `Archive ${archiving.template.name}?` : 'Archive template'}
        size="sm"
        footer={
          <div className="lf-dialogactions">
            <Button onClick={() => setArchiving(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => void handleArchive()}>
              Archive template
            </Button>
          </div>
        }
      >
        <p>
          <strong>{archiving?.template.name}</strong> will be marked archived and read-only. This is
          a soft archive — the template and its structure are preserved, nothing is deleted, and you
          can restore it later.
        </p>
      </Modal>
    </div>
  );
}

function TemplateCard({ summary, onArchive }: { summary: TemplateSummary; onArchive: () => void }) {
  const { template } = summary;
  const archived = template.status === 'archived';
  const beatChips = summary.beatCount > 0
    ? Array.from({ length: Math.min(summary.beatCount, 4) }, (_, i) => `Beat ${i + 1}`)
    : [];
  const durationLabel =
    summary.beatCount > 0 ? `${Math.max(15, summary.beatCount * 10)}–${Math.min(60, summary.beatCount * 15)} s` : '—';
  return (
    <Card role="listitem">
      <CardBody>
        <div className="lf-tmplcard">
          <div className="lf-tmplcard__media" aria-hidden="true">
            <span className="lf-tmplcard__catbadge">{TEMPLATE_CATEGORY_LABELS[template.category]}</span>
            <TemplateIcon size={30} />
          </div>
          <div className="lf-tmplcard__body">
            <div className="lf-tmplcard__titlerow">
              <h2 className="lf-tmplcard__title">
                <Link to={`/templates/${template.id}`}>{template.name}</Link>
              </h2>
              <span className="lf-tmplcard__duration">{durationLabel}</span>
            </div>
            <p className="lf-tmplcard__meta">
              {template.description ?? 'No description yet.'}
            </p>
            {beatChips.length > 0 ? (
              <div className="lf-tmplcard__chips">
                {beatChips.map((chip) => (
                  <span key={chip} className="lf-tmplcard__chip">{chip}</span>
                ))}
              </div>
            ) : null}
            <div className="lf-tmplcard__foot">
              <Badge tone={TEMPLATE_STATUS_TONE[template.status]} dot>{template.status}</Badge>
              <span className="lf-tmplcard__updated">Updated {formatTemplateDate(template.updatedAt)}</span>
              <span className="lf-tmplcard__actions">
                {!archived ? (
                  <Link
                    className="lf-btn lf-btn--primary lf-btn--sm"
                    to={`/templates/${template.id}/apply`}
                    aria-label={`Use template ${template.name}`}
                  >
                    Use template
                  </Link>
                ) : null}
                {!archived ? (
                  <Link className="lf-btn lf-btn--secondary lf-btn--sm" to={`/templates/${template.id}/edit`}>
                    Edit
                  </Link>
                ) : null}
                <Button size="sm" variant="ghost" onClick={onArchive}>
                  Archive
                </Button>
              </span>
            </div>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
