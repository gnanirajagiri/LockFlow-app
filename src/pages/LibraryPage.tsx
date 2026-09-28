/**
 * Library index — the ONE unified reusable-asset system. Lists canonical
 * assets with type tabs, sort control and per-row overflow actions
 * (Open / Create new draft version / Archive with confirm). Generated
 * content lives in Gallery, never here.
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
import {
  GridViewIcon,
  LibraryIcon,
  ListViewIcon,
  LockIcon,
  PlusIcon,
  SearchIcon,
} from '../components/icons';
import { LibraryService } from '../services/libraryService';
import { getLibraryRepository } from '../data/libraryFactory';
import { SEED_LIBRARY_WORKSPACE_ID } from '../mock/librarySeed';
import { LIBRARY_HELPER_COPY } from '../features/library/libraryUi';
import type {
  LibraryAssetRecord,
  LibraryAssetStatus,
  LibraryAssetType,
  LibraryAssetVersionRecord,
} from '../domain/library';

type LoadState = 'loading' | 'error' | 'ready';
type TypeTab = 'all' | 'physical' | LibraryAssetType;
type SortKey = 'updated' | 'name';
type StatusFilter = 'all' | LibraryAssetStatus;

interface Row {
  asset: LibraryAssetRecord;
  activeVersion: LibraryAssetVersionRecord | null;
  hasDraft: boolean;
}

const STATUS_TONE = {
  draft: 'neutral',
  ready: 'success',
  archived: 'warning',
} as const;

const TYPE_TABS: Array<{ value: TypeTab; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'product', label: 'Products' },
  { value: 'prop', label: 'Props' },
  { value: 'wardrobe', label: 'Wardrobe' },
  { value: 'accessory', label: 'Accessories' },
  { value: 'personal_item', label: 'Personal items' },
  { value: 'creator_tool', label: 'Creator tools' },
  { value: 'scene', label: 'Scenes' },
  { value: 'other', label: 'Other' },
];

const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'All statuses' },
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

function typeLabel(asset: LibraryAssetRecord): string {
  return asset.assetType === 'look' ? 'Saved Look' : asset.assetType.replace('_', ' ');
}

export function LibraryPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const service = useMemo(() => new LibraryService(getLibraryRepository()), []);

  const [state, setState] = useState<LoadState>('loading');
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [typeTab, setTypeTab] = useState<TypeTab>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sort, setSort] = useState<SortKey>('updated');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [archiveRow, setArchiveRow] = useState<Row | null>(null);
  const [draftBusy, setDraftBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      // Workspace switching arrives with the Workspace features; until then
      // both demo and configured mode read the seed workspace.
      const workspaceId = SEED_LIBRARY_WORKSPACE_ID;
      const list = (await service.listAssets(workspaceId)).filter(
        (asset) => asset.assetType !== 'look', // Looks have their own area.
      );
      const loaded: Row[] = await Promise.all(
        list.map(async (asset) => {
          const versions = await service.getVersions(asset.id, workspaceId);
          const activeVersion =
            asset.activeVersionId != null
              ? versions.find((version) => version.id === asset.activeVersionId) ?? null
              : null;
          return { asset, activeVersion, hasDraft: versions.some((version) => version.status === 'draft') };
        }),
      );
      setRows(loaded);
      setState('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the Library.');
      setState('error');
    }
  }, [service]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtersActive =
    search.trim() !== '' || typeTab !== 'all' || statusFilter !== 'all';

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const list = rows.filter(({ asset }) => {
      if (typeTab === 'physical') {
        if (!['product', 'prop', 'wardrobe', 'accessory', 'personal_item', 'creator_tool'].includes(asset.assetType)) return false;
      } else if (typeTab !== 'all' && asset.assetType !== typeTab) {
        return false;
      }
      if (statusFilter !== 'all' && asset.status !== statusFilter) return false;
      if (needle && !asset.name.toLowerCase().includes(needle)) return false;
      return true;
    });
    if (sort === 'name') return [...list].sort((a, b) => a.asset.name.localeCompare(b.asset.name));
    return [...list].sort((a, b) => b.asset.updatedAt.localeCompare(a.asset.updatedAt));
  }, [rows, search, typeTab, statusFilter, sort]);

  function resetFilters() {
    setSearch('');
    setTypeTab('all');
    setStatusFilter('all');
  }

  async function handleCreateDraft(row: Row) {
    if (!row.activeVersion || draftBusy) return;
    setMenuFor(null);
    setDraftBusy(row.asset.id);
    try {
      const version = await service.createVersion(
        {
          libraryAssetId: row.asset.id,
          sourceVersionId: row.activeVersion.id,
          changeSummary: `Revision based on v${row.activeVersion.versionNumber}`,
        },
        'demo-user',
        SEED_LIBRARY_WORKSPACE_ID,
      );
      toast({
        title: `Draft v${version.versionNumber} created`,
        description: `${row.asset.name} — edit the details, then lock when approved.`,
        tone: 'success',
      });
      navigate(`/library/${row.asset.id}/details?version=${version.id}`);
    } catch (err) {
      toast({
        title: 'Could not create a draft version',
        description: err instanceof Error ? err.message : 'Something went wrong.',
        tone: 'error',
      });
    } finally {
      setDraftBusy(null);
    }
  }

  async function handleArchive() {
    if (!archiveRow) return;
    try {
      await service.archiveAsset(archiveRow.asset.id, SEED_LIBRARY_WORKSPACE_ID);
      toast({ title: 'Asset archived', description: `${archiveRow.asset.name} was archived.`, tone: 'success' });
      setArchiveRow(null);
      await load();
    } catch (err) {
      toast({
        title: 'Archive failed',
        description: err instanceof Error ? err.message : 'Something went wrong.',
        tone: 'error',
      });
    }
  }

  const emptyCopy = (
    <>
      <p>Your Library is ready for reusable assets.</p>
      <p>
        Add products, props, wardrobe and references to use them across LockFlow —
        then reuse them in every model, environment and campaign.
      </p>
    </>
  );

  return (
    <div className="lf-page">
      <PageHeader
        eyebrow="Builder"
        title="Library"
        description="Reusable assets for every model, scene and campaign."
        actions={
          <Link className="lf-btn lf-btn--primary" to="/library/new">
            <span className="lf-btn__icon" aria-hidden="true">
              <PlusIcon size={14} />
            </span>
            Add asset
          </Link>
        }
      />

      <p className="lf-library__note" role="note">{LIBRARY_HELPER_COPY}</p>

      {state === 'loading' ? (
        <div className="lf-envgrid" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} variant="rect" height={140} />
          ))}
        </div>
      ) : null}

      {state === 'error' ? (
        <EmptyState
          icon={<LibraryIcon size={22} />}
          title="Couldn't load the Library"
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
                label="Search library"
                hideLabel
                placeholder="Search by name"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                type="search"
              />
            </div>
            <div className="lf-models-toolbar__filter">
              <label className="lf-field__label" htmlFor="library-status-filter">Status</label>
              <select
                id="library-status-filter"
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
              <label className="lf-field__label" htmlFor="library-sort">Sort</label>
              <select
                id="library-sort"
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

          <div className="lf-library__typetabs" role="tablist" aria-label="Asset types">
            {TYPE_TABS.map((tab) => (
              <button
                key={tab.value}
                type="button"
                role="tab"
                aria-selected={typeTab === tab.value}
                className={`lf-library__typetab${typeTab === tab.value ? ' lf-library__typetab--active' : ''}`}
                onClick={() => setTypeTab(tab.value)}
              >
                {tab.label}
              </button>
            ))}
            <Link className="lf-library__typetab lf-library__typetab--link" to="/library/looks">
              Saved Looks
            </Link>
          </div>

          {rows.length === 0 ? (
            <EmptyState
              icon={<LibraryIcon size={22} />}
              title="Build your Library"
              description={emptyCopy}
              actions={
                <Link className="lf-btn lf-btn--primary" to="/library/new">
                  <span className="lf-btn__icon" aria-hidden="true">
                    <PlusIcon size={14} />
                  </span>
                  Add asset
                </Link>
              }
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<SearchIcon size={22} />}
              title="No assets match"
              description="Try a different search term or filter combination."
              actions={
                <button
                  type="button"
                  className="lf-btn lf-btn--secondary"
                  onClick={resetFilters}
                  disabled={!filtersActive}
                >
                  Clear filters
                </button>
              }
            />
          ) : (
            <div className={view === 'grid' ? 'lf-envgrid' : 'lf-envlist'} role="list">
              {filtered.map((row) => {
                const { asset } = row;
                return (
                  <div key={asset.id} className="lf-library__rowwrap" role="listitem">
                    <AssetRowCard row={row} />
                    <div className="lf-library__rowmenu">
                      <button
                        type="button"
                        className="lf-iconbtn"
                        aria-haspopup="menu"
                        aria-expanded={menuFor === asset.id}
                        aria-label={`Actions for ${asset.name}`}
                        onClick={() => setMenuFor(menuFor === asset.id ? null : asset.id)}
                      >
                        ⋯
                      </button>
                      {menuFor === asset.id ? (
                        <div className="lf-library__menu" role="menu" aria-label={`${asset.name} actions`}>
                          <button
                            type="button"
                            role="menuitem"
                            className="lf-library__menuitem"
                            onClick={() => {
                              setMenuFor(null);
                              navigate(`/library/${asset.id}`);
                            }}
                          >
                            Open
                          </button>
                          {row.hasDraft ? (
                            <button
                              type="button"
                              role="menuitem"
                              className="lf-library__menuitem lf-library__menuitem--disabled"
                              disabled
                            >
                              Create new draft version
                              <span className="lf-library__menuhint">Draft already open</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              role="menuitem"
                              className="lf-library__menuitem"
                              disabled={!row.activeVersion || draftBusy === asset.id}
                              onClick={() => void handleCreateDraft(row)}
                            >
                              {draftBusy === asset.id ? 'Creating…' : 'Create new draft version'}
                              <span className="lf-library__menuhint">
                                {row.activeVersion
                                  ? `From v${row.activeVersion.versionNumber} — locked version is never edited`
                                  : 'No version to copy yet'}
                              </span>
                            </button>
                          )}
                          <button
                            type="button"
                            role="menuitem"
                            className="lf-library__menuitem lf-library__menuitem--danger"
                            onClick={() => {
                              setMenuFor(null);
                              setArchiveRow(row);
                            }}
                          >
                            Archive
                            <span className="lf-library__menuhint">Soft archive — nothing is deleted</span>
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {state === 'ready' && filtersActive && filtered.length > 0 ? (
            <p className="lf-library__filterreset">
              {filtered.length} of {rows.length} assets shown.{' '}
              <button type="button" className="lf-library__resetlink" onClick={resetFilters}>
                Reset filters
              </button>
            </p>
          ) : null}
        </>
      ) : null}

      <Modal
        open={archiveRow !== null}
        onClose={() => setArchiveRow(null)}
        title={archiveRow ? `Archive ${archiveRow.asset.name}?` : 'Archive asset'}
        size="sm"
        footer={
          <div className="lf-dialogactions">
            <Button onClick={() => setArchiveRow(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => void handleArchive()}>
              Archive asset
            </Button>
          </div>
        }
      >
        <p>
          <strong>{archiveRow?.asset.name}</strong> will be marked archived and hidden from the
          default list. This is a soft archive — the asset, its versions and references are
          preserved, and nothing is deleted.
        </p>
      </Modal>
    </div>
  );

  function AssetRowCard({ row }: { row: Row }) {
    const { asset, activeVersion } = row;
    const locked = activeVersion?.status === 'locked';
    const superseded = activeVersion?.status === 'superseded';
    return (
      <Card>
        <CardBody>
          <Link to={`/library/${asset.id}`} className="lf-library__rowlink">
            <div className="lf-envcard">
              <div className="lf-envcard__cover" aria-hidden="true">
                <LibraryIcon size={24} />
              </div>
              <div className="lf-envcard__body">
                <div className="lf-envcard__title">
                  <h2>{asset.name}</h2>
                  <span className="lf-envcard__slug">/{asset.slug}</span>
                </div>
                <div className="lf-envcard__badges">
                  <Badge tone={STATUS_TONE[asset.status]} dot>{asset.status}</Badge>
                  <Badge tone="neutral">{typeLabel(asset)}</Badge>
                  {activeVersion ? (
                    <Badge tone={locked ? 'locked' : superseded ? 'neutral' : 'primary'}>
                      {locked ? <LockIcon size={12} /> : null}
                      {`v${activeVersion.versionNumber} ${activeVersion.status}`}
                    </Badge>
                  ) : (
                    <Badge tone="neutral">no version yet</Badge>
                  )}
                  {row.hasDraft ? <Badge tone="info">draft open</Badge> : null}
                </div>
                {asset.description ? <p className="lf-envcard__summary">{asset.description}</p> : null}
                <p className="lf-envcard__updated">Updated {formatDate(asset.updatedAt)}</p>
              </div>
            </div>
          </Link>
        </CardBody>
      </Card>
    );
  }
}
