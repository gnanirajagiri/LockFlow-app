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
import {
  ArchiveIcon,
  GridViewIcon,
  ListViewIcon,
  LockIcon,
  ModelIcon,
  SearchIcon,
} from '../components/icons';
import { ModelsService } from '../services/modelsService';
import { getModelsRepository } from '../data';
import { validateCreateModel } from '../domain/models';
import { useAuth } from '../auth/AuthProvider';
import { SEED_WORKSPACE_ID } from '../mock/modelsSeed';
import type { ModelStatus, ModelWithVersion } from '../domain/models';

type LoadState = 'loading' | 'error' | 'ready';
type StatusFilter = 'all' | ModelStatus;
type ViewMode = 'grid' | 'list';

const STATUS_TONE = {
  draft: 'neutral',
  ready: 'success',
  archived: 'warning',
} as const;

const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'ready', label: 'Ready' },
  { value: 'archived', label: 'Archived' },
];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function ModelsPage() {
  const service = useMemo(() => new ModelsService(getModelsRepository()), []);
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [state, setState] = useState<LoadState>('loading');
  const [models, setModels] = useState<ModelWithVersion[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [view, setView] = useState<ViewMode>('grid');

  const [createOpen, setCreateOpen] = useState(false);
  const [archiving, setArchiving] = useState<ModelWithVersion | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      // Workspace switching arrives with the Workspace features; until then
      // both demo and configured mode read the seed workspace.
      const workspaceId = SEED_WORKSPACE_ID;
      const list = await service.listModels(workspaceId);
      const enriched = await Promise.all(
        list.map(async (model) => ({
          ...model,
          activeVersion:
            model.activeVersionId != null
              ? await service.getVersion(model.activeVersionId, workspaceId).catch(() => null)
              : null,
        })),
      );
      setModels(enriched);
      setState('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load models.');
      setState('error');
    }
  }, [service]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return models.filter((model) => {
      if (statusFilter !== 'all' && model.status !== statusFilter) return false;
      if (query && !model.name.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [models, search, statusFilter]);

  const hasFilters = search.trim() !== '' || statusFilter !== 'all';

  async function handleArchiveConfirm() {
    if (!archiving) return;
    try {
      // Soft-archive only: status change, never a delete.
      await service.archiveModel(archiving.id, SEED_WORKSPACE_ID);
      toast({ title: 'Model archived', description: `${archiving.name} was archived. Its history is preserved.`, tone: 'success' });
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

  function handleCreated(modelId: string) {
    setCreateOpen(false);
    // Redirect straight to the new model's profile.
    navigate(`/models/${modelId}`);
  }

  return (
    <div className="lf-page">
      <PageHeader
        eyebrow="Builder"
        title="Models"
        description="Create and manage the reusable people who appear in your content."
        actions={
          <Button variant="primary" leftIcon={<ModelIcon size={16} />} onClick={() => setCreateOpen(true)}>
            New model
          </Button>
        }
      />

      {state === 'loading' ? (
        <div className="lf-tilegrid" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <Card key={i}>
              <CardBody>
                <div style={{ display: 'grid', gap: 'var(--lf-space-3)' }}>
                  <Skeleton variant="rect" height={92} />
                  <Skeleton variant="title" />
                  <Skeleton lines={2} />
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      ) : null}

      {state === 'error' ? (
        <EmptyState
          icon={<ModelIcon size={22} />}
          title="Couldn't load models"
          description={error}
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
                label="Search models"
                hideLabel
                placeholder="Search by name"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                type="search"
              />
            </div>
            <div className="lf-models-toolbar__filter">
              <label className="lf-field__label" htmlFor="models-status-filter">
                Status
              </label>
              <select
                id="models-status-filter"
                className="lf-input"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
              >
                {STATUS_FILTERS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="lf-models-toolbar__group" role="group" aria-label="Display mode">
              <div className="lf-viewtoggle">
                <button
                  type="button"
                  className="lf-viewtoggle__btn"
                  aria-pressed={view === 'grid'}
                  aria-label="Grid view"
                  onClick={() => setView('grid')}
                >
                  <GridViewIcon size={16} />
                </button>
                <button
                  type="button"
                  className="lf-viewtoggle__btn"
                  aria-pressed={view === 'list'}
                  aria-label="List view"
                  onClick={() => setView('list')}
                >
                  <ListViewIcon size={16} />
                </button>
              </div>
            </div>
          </div>

          {state === 'ready' && models.length === 0 ? (
            <EmptyState
              icon={<ModelIcon size={22} />}
              title="Create your first model"
              description="Define a Character Sheet — face, hair, complexion, body and distinctive details — then version it and lock it before content jobs reference it."
              actions={
                <Button variant="primary" onClick={() => setCreateOpen(true)}>
                  New model
                </Button>
              }
            />
          ) : null}

          {state === 'ready' && models.length > 0 && filtered.length === 0 ? (
            <EmptyState
              icon={<SearchIcon size={22} />}
              title="No models match"
              description="No models match your search or filter. Adjust them to see more."
              actions={
                hasFilters ? (
                  <Button
                    onClick={() => {
                      setSearch('');
                      setStatusFilter('all');
                    }}
                  >
                    Clear filters
                  </Button>
                ) : undefined
              }
            />
          ) : null}

          {filtered.length > 0 && view === 'grid' ? (
            <div className="lf-tilegrid">
              {filtered.map((model) => (
                <ModelCard
                  key={model.id}
                  model={model}
                  onArchive={() => setArchiving(model)}
                />
              ))}
            </div>
          ) : null}

          {filtered.length > 0 && view === 'list' ? (
            <ul className="lf-modellist" aria-label="Models">
              {filtered.map((model) => (
                <li key={model.id} className="lf-modellist__row">
                  <span className="lf-modellist__cover" aria-hidden="true">
                    <ModelIcon size={20} />
                  </span>
                  <div className="lf-modellist__name">
                    <div className="lf-tile__title">{model.name}</div>
                    <div className="lf-modelcard__slug">/{model.slug}</div>
                  </div>
                  <Badge tone={STATUS_TONE[model.status]} dot>
                    {model.status}
                  </Badge>
                  <VersionBadge model={model} />
                  <span className="lf-versionrow__dates">Updated {formatDate(model.updatedAt)}</span>
                  <div className="lf-modelcard__actions">
                    <Link className="lf-btn lf-btn--sm lf-btn--secondary" to={`/models/${model.id}`}>
                      Open
                    </Link>
                    <Button
                      size="sm"
                      variant="ghost"
                      leftIcon={<ArchiveIcon size={14} />}
                      onClick={() => setArchiving(model)}
                    >
                      Archive
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}

      <CreateModelModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={handleCreated}
        service={service}
        createdBy={user?.id ?? 'demo-user'}
      />

      <Modal
        open={archiving !== null}
        onClose={() => setArchiving(null)}
        title={archiving ? `Archive ${archiving.name}?` : 'Archive model'}
        size="sm"
        footer={
          <div className="lf-dialogactions">
            <Button onClick={() => setArchiving(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => void handleArchiveConfirm()}>
              Archive model
            </Button>
          </div>
        }
      >
        <p>
          {archiving ? (
            <>
              <strong>{archiving.name}</strong> will be marked archived and hidden from the
              default list. This is a soft archive — the model, its versions and its Character
              Sheets are preserved, and nothing is deleted.
            </>
          ) : null}
        </p>
      </Modal>
    </div>
  );
}

function VersionBadge({ model }: { model: ModelWithVersion }) {
  if (!model.activeVersion) return <Badge tone="neutral">no active version</Badge>;
  const { versionNumber, status } = model.activeVersion;
  const label = status === 'locked' ? `v${versionNumber} Locked` : `v${versionNumber} ${status}`;
  return (
    <Badge tone={status === 'locked' ? 'locked' : 'primary'}>
      {status === 'locked' ? <LockIcon size={12} /> : null}
      {label}
    </Badge>
  );
}

function ModelCard({ model, onArchive }: { model: ModelWithVersion; onArchive: () => void }) {
  return (
    <Card>
      <CardBody>
        <div className="lf-modelcard">
          <Link to={`/models/${model.id}`} aria-label={`Open model ${model.name}`} className="lf-modelcard__cover">
            <span className="lf-quicklink__icon" aria-hidden="true">
              <ModelIcon size={22} />
            </span>
          </Link>

          <div className="lf-modelcard__header">
            <div>
              <div className="lf-tile__title">
                <Link to={`/models/${model.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                  {model.name}
                </Link>
              </div>
              <div className="lf-modelcard__slug">/{model.slug}</div>
            </div>
          </div>

          <div className="lf-modelcard__meta">
            <Badge tone={STATUS_TONE[model.status]} dot>
              {model.status}
            </Badge>
            <VersionBadge model={model} />
          </div>

          {model.activeVersion?.changeSummary ? (
            <p className="lf-tile__description">{model.activeVersion.changeSummary}</p>
          ) : null}

          <div className="lf-modelcard__footer lf-modelcard__actions">
            <span style={{ flex: 1 }}>Updated {formatDate(model.updatedAt)}</span>
            <Link className="lf-btn lf-btn--sm lf-btn--secondary" to={`/models/${model.id}`}>
              Open
            </Link>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Archive ${model.name}`}
              leftIcon={<ArchiveIcon size={14} />}
              onClick={onArchive}
            >
              Archive
            </Button>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

interface CreateModelModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (modelId: string) => void;
  service: ModelsService;
  createdBy: string;
}

function CreateModelModal({ open, onClose, onCreated, service, createdBy }: CreateModelModalProps) {
  const [name, setName] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName('');
      setErrors([]);
      setSubmitError(null);
      setSubmitting(false);
    }
  }, [open]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitError(null);

    const result = validateCreateModel({ workspaceId: SEED_WORKSPACE_ID, name });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors([]);
    setSubmitting(true);
    try {
      // Creates the model AND its first draft version via the service layer.
      const model = await service.createModel(result.value, createdBy);
      onCreated(model.id);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not create the model.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create a model"
      description="The guided Model Builder will be added next. For now, create a protected identity record to begin."
      size="sm"
      footer={
        <div className="lf-dialogactions">
          <Button onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="lf-create-model-form" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create model'}
          </Button>
        </div>
      }
    >
      <form id="lf-create-model-form" className="lf-formstack" onSubmit={(event) => void handleSubmit(event)}>
        <Input
          label="Model name"
          placeholder="e.g. Aisha"
          value={name}
          onChange={(event) => setName(event.target.value)}
          error={errors.length ? errors[0] : undefined}
          hint="A versioned Character Sheet (v1 draft) is created with the model."
          autoFocus
        />
        <p className="lf-card__description">
          No AI generation or reference processing happens here yet — this creates the identity
          record you will edit in the Character Sheet.
        </p>
        {submitError ? (
          <div className="lf-alertbox" role="alert">
            {submitError}
          </div>
        ) : null}
      </form>
    </Modal>
  );
}
