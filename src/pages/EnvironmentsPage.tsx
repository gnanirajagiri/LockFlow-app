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
import { LibraryAttachDrawer } from '../features/library/LibraryAttachDrawer';
import { useLibraryOpsService } from '../features/library/useLibraryOpsService';
import { SEED_LIBRARY_WORKSPACE_ID } from '../mock/librarySeed';
import type { LibraryAttachmentRecord } from '../domain/library';
import {
  ArchiveIcon,
  EnvironmentIcon,
  GridViewIcon,
  ListViewIcon,
  LockIcon,
  SearchIcon,
} from '../components/icons';
import { EnvironmentsService } from '../services/environmentsService';
import { getEnvironmentsRepository } from '../data/environmentsFactory';
import { validateCreateEnvironment } from '../domain/environments';
import { ENVIRONMENT_PRESETS } from '../environments/environmentPresets';
import type { EnvironmentPreset } from '../environments/environmentPresets';
import { useAuth } from '../auth/AuthProvider';
import { SEED_ENVIRONMENT_WORKSPACE_ID } from '../mock/environmentsSeed';
import type { EnvironmentStatus, EnvironmentWithVersion } from '../domain/environments';

type LoadState = 'loading' | 'error' | 'ready';
type StatusFilter = 'all' | EnvironmentStatus;
type ViewMode = 'grid' | 'list';

const STATUS_TONE = {
  draft: 'neutral',
  ready: 'success',
  archived: 'warning',
} as const;

const LOCK_LEVEL_TONE = {
  flexible: 'neutral',
  balanced: 'info',
  strict: 'warning',
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

/**
 * Environments index — the reusable-places library page. The guided
 * Environment Builder is a later milestone; creating an environment here
 * makes a protected spec record with its first draft version.
 */
export function EnvironmentsPage() {
  const service = useMemo(() => new EnvironmentsService(getEnvironmentsRepository()), []);
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  // Prompt 22: the unified Library attach drawer (references, never copies).
  const [attachEnv, setAttachEnv] = useState<EnvironmentWithVersion | null>(null);
  const [envAttachmentCount, setEnvAttachmentCount] = useState<Record<string, number>>({});
  const libraryOps = useLibraryOpsService();

  const [state, setState] = useState<LoadState>('loading');
  const [environments, setEnvironments] = useState<EnvironmentWithVersion[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [view, setView] = useState<ViewMode>('grid');

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  /** Maya stepper: "Choose a base environment" — null = create from scratch. */
  const [selectedPreset, setSelectedPreset] = useState<EnvironmentPreset | null>(null);
  const [archiving, setArchiving] = useState<EnvironmentWithVersion | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      // Workspace switching arrives with the Workspace features; until then
      // both demo and configured mode read the seed workspace.
      const workspaceId = SEED_ENVIRONMENT_WORKSPACE_ID;
      const list = await service.listEnvironments(workspaceId);
      const enriched = await Promise.all(
        list.map(async (environment) => ({
          ...environment,
          activeVersion: environment.activeVersionId
            ? await service.getVersion(environment.activeVersionId, workspaceId)
            : null,
        })),
      );
      setEnvironments(enriched);
      setState('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load environments.');
      setState('error');
    }
  }, [service]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return environments.filter((environment) => {
      if (statusFilter !== 'all' && environment.status !== statusFilter) return false;
      if (needle && !environment.name.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [environments, search, statusFilter]);

  async function handleCreate() {
    setCreating(true);
    setCreateError(null);
    try {
      const result = validateCreateEnvironment({
        workspaceId: SEED_ENVIRONMENT_WORKSPACE_ID,
        name: createName,
      });
      if (!result.ok) {
        setCreateError(result.errors.join('; '));
        return;
      }
      const environment = await service.createEnvironment(
        result.value,
        user?.id ?? 'demo-user',
      );

      // Maya "choose a base": seed the fresh v1 draft's spec anchors and lock
      // level from the chosen preset so the creator edits rather than invents.
      let presetNote: string | null = null;
      if (selectedPreset) {
        try {
          const versions = await service.getVersions(environment.id, SEED_ENVIRONMENT_WORKSPACE_ID);
          const draft = versions.find((version) => version.status === 'draft') ?? versions[0];
          if (draft) {
            await service.updateSpec(draft.id, selectedPreset.spec, SEED_ENVIRONMENT_WORKSPACE_ID);
            await service.updateVersionDraft(draft.id, { lockLevel: selectedPreset.lockLevel }, SEED_ENVIRONMENT_WORKSPACE_ID);
            presetNote = ` Seeded from the “${selectedPreset.name}” base.`;
          }
        } catch {
          presetNote = ' Base preset could not be applied — starting blank.';
        }
      }

      toast({
        title: 'Environment created',
        description: `${environment.name} starts with a draft version — define its anchors, then lock.${presetNote ?? ''}`,
        tone: 'success',
      });
      setCreateOpen(false);
      setCreateName('');
      setSelectedPreset(null);
      navigate(`/environments/${environment.id}/edit`);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Could not create the environment.');
    } finally {
      setCreating(false);
    }
  }

  async function handleArchive() {
    if (!archiving) return;
    try {
      await service.archiveEnvironment(archiving.id, SEED_ENVIRONMENT_WORKSPACE_ID);
      toast({ title: 'Environment archived', description: `${archiving.name} was archived.`, tone: 'success' });
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

  const cardBadge = (environment: EnvironmentWithVersion) => {
    const active = environment.activeVersion;
    return (
      <>
        <Badge tone={STATUS_TONE[environment.status]} dot>
          {environment.status}
        </Badge>
        {active ? (
          <Badge tone={active.status === 'locked' ? 'locked' : 'primary'}>
            {active.status === 'locked' ? <LockIcon size={12} /> : null}
            {`v${active.versionNumber} ${active.status === 'locked' ? 'Locked' : 'Draft'}`}
          </Badge>
        ) : (
          <Badge tone="neutral">no version yet</Badge>
        )}
        {active ? <Badge tone={LOCK_LEVEL_TONE[active.lockLevel]}>{active.lockLevel} lock</Badge> : null}
      </>
    );
  };

  return (
    <div className="lf-page">
      <PageHeader
        eyebrow="Builder"
        title="Environments"
        description="Create, protect and reuse consistent settings for every content job."
        actions={
          <Button variant="primary" leftIcon={<EnvironmentIcon size={16} />} onClick={() => setCreateOpen(true)}>
            New environment
          </Button>
        }
      />

      {state === 'loading' ? (
        <div className="lf-envgrid" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <Card key={i}>
              <CardBody>
                <div style={{ display: 'grid', gap: 'var(--lf-space-3)' }}>
                  <Skeleton variant="rect" height={64} />
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
          icon={<EnvironmentIcon size={22} />}
          title="Couldn't load environments"
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
                label="Search environments"
                hideLabel
                placeholder="Search by name"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                type="search"
              />
            </div>
            <div className="lf-models-toolbar__filter">
              <label className="lf-field__label" htmlFor="env-status-filter">Status</label>
              <select
                id="env-status-filter"
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

          {environments.length === 0 ? (
            <EmptyState
              icon={<EnvironmentIcon size={22} />}
              title="Create your first environment"
              description="Environments are reusable places — define their continuity anchors, review them, then lock the approved setup for every future content job."
              actions={
                <Button variant="primary" leftIcon={<EnvironmentIcon size={16} />} onClick={() => setCreateOpen(true)}>
                  New environment
                </Button>
              }
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<SearchIcon size={22} />}
              title="No environments match"
              description="Try a different search term or status filter."
              actions={
                <Button
                  onClick={() => {
                    setSearch('');
                    setStatusFilter('all');
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          ) : (
            <div className={view === 'grid' ? 'lf-envgrid' : 'lf-envlist'} role="list">
              {filtered.map((environment) => (
                <Card key={environment.id} role="listitem">
                  <CardBody>
                    {view === 'grid' ? (
                      <div className="lf-envcard">
                        <div className="lf-envcard__cover" aria-hidden="true">
                          <EnvironmentIcon size={26} />
                        </div>
                        <div className="lf-envcard__body">
                          <div className="lf-envcard__title">
                            <h2>{environment.name}</h2>
                            <span className="lf-envcard__slug">/{environment.slug}</span>
                          </div>
                          <div className="lf-envcard__badges">{cardBadge(environment)}</div>
                          {environment.activeVersion?.changeSummary ? (
                            <p className="lf-envcard__summary">{environment.activeVersion.changeSummary}</p>
                          ) : null}
                          <p className="lf-envcard__updated">Updated {formatDate(environment.updatedAt)}</p>
                          <div className="lf-modelcard__actions">
                            <Link className="lf-btn lf-btn--secondary lf-btn--sm" to={`/environments/${environment.id}`}>
                              Open
                            </Link>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setAttachEnv(environment)}
                            >
                              Attach{(envAttachmentCount[environment.id] ?? 0) > 0 ? ` (${envAttachmentCount[environment.id]})` : ''}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              leftIcon={<ArchiveIcon size={14} />}
                              onClick={() => setArchiving(environment)}
                            >
                              Archive
                            </Button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="lf-envrow">
                        <div className="lf-envrow__cover" aria-hidden="true">
                          <EnvironmentIcon size={20} />
                        </div>
                        <div className="lf-envrow__main">
                          <Link className="lf-envrow__name" to={`/environments/${environment.id}`}>
                            {environment.name}
                          </Link>
                          <span className="lf-envcard__slug">/{environment.slug}</span>
                        </div>
                        <div className="lf-envrow__badges">{cardBadge(environment)}</div>
                        <span className="lf-envcard__updated">Updated {formatDate(environment.updatedAt)}</span>
                        <div className="lf-modelcard__actions">
                          <Link className="lf-btn lf-btn--secondary lf-btn--sm" to={`/environments/${environment.id}`}>
                            Open
                          </Link>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setAttachEnv(environment)}
                          >
                            Attach{(envAttachmentCount[environment.id] ?? 0) > 0 ? ` (${envAttachmentCount[environment.id]})` : ''}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            leftIcon={<ArchiveIcon size={14} />}
                            onClick={() => setArchiving(environment)}
                          >
                            Archive
                          </Button>
                        </div>
                      </div>
                    )}
                  </CardBody>
                </Card>
              ))}
            </div>
          )}
        </>
      ) : null}

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New environment — choose a base"
        size="lg"
        footer={
          <div className="lf-dialogactions">
            <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => void handleCreate()} disabled={creating || createName.trim() === ''}>
              {creating ? 'Creating…' : 'Create environment'}
            </Button>
          </div>
        }
      >
        <p className="lf-tile__description" style={{ marginTop: 0 }}>
          <strong>1 · Choose a base</strong> — presets seed the draft's anchors and default lock
          level. Everything stays editable before you lock. Or skip a base and create from scratch.
        </p>
        <div className="lf-epresetgrid" role="radiogroup" aria-label="Base environment">
          {ENVIRONMENT_PRESETS.map((preset) => (
            <button
              key={preset.key}
              type="button"
              role="radio"
              aria-checked={selectedPreset?.key === preset.key}
              className={`lf-epreset${selectedPreset?.key === preset.key ? ' lf-epreset--selected' : ''}`}
              onClick={() => setSelectedPreset(selectedPreset?.key === preset.key ? null : preset)}
            >
              <span className={`lf-epreset__media ${preset.mediaClass}`} aria-hidden="true" />
              <span className="lf-epreset__name">{preset.name}</span>
              <span className="lf-epreset__desc">{preset.description}</span>
              <span className="lf-epreset__meta">{preset.roomType} · {preset.lockLevel} lock</span>
            </button>
          ))}
        </div>
        <div className="lf-field" style={{ marginTop: 'var(--lf-space-4)' }}>
          <label className="lf-field__label" htmlFor="env-create-name">Environment name</label>
          <input
            id="env-create-name"
            className="lf-input"
            value={createName}
            onChange={(event) => setCreateName(event.target.value)}
            placeholder="e.g. Warm Bedroom Studio, Glass Loft Kitchen"
          />
          {createError ? <p className="lf-field__error" role="alert">{createError}</p> : null}
        </div>
        <p className="lf-tile__description">
          Next: edit the environment's anchors, then lock-and-save when it's ready — no generation
          or image analysis happens here.
        </p>
      </Modal>

      {attachEnv && (
        <LibraryAttachDrawer
          open
          onClose={() => setAttachEnv(null)}
          service={libraryOps}
          workspaceId={SEED_LIBRARY_WORKSPACE_ID}
          targetType="environment"
          targetId={attachEnv.id}
          targetLabel={`environment “${attachEnv.name}”`}
          roleOrSlot="set"
          multiSelect
          onAttached={async (records: LibraryAttachmentRecord[]) => {
            setEnvAttachmentCount((current) => ({
              ...current,
              [attachEnv.id]: (current[attachEnv.id] ?? 0) + records.length,
            }));
            toast({ title: 'Attached from the Library', tone: 'success' });
          }}
          onInlineAdd={() => navigate('/library/add?context=picker&return=%2Fenvironments')}
        />
      )}

      <Modal
        open={archiving !== null}
        onClose={() => setArchiving(null)}
        title={archiving ? `Archive ${archiving.name}?` : 'Archive environment'}
        size="sm"
        footer={
          <div className="lf-dialogactions">
            <Button onClick={() => setArchiving(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => void handleArchive()}>
              Archive environment
            </Button>
          </div>
        }
      >
        <p>
          <strong>{archiving?.name}</strong> will be marked archived and hidden from the default
          list. This is a soft archive — the environment, its versions and specs are preserved,
          and nothing is deleted.
        </p>
      </Modal>
    </div>
  );
}
