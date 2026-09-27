import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Card, CardBody } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { Modal } from '../components/ui/Modal';
import { Input } from '../components/ui/Input';
import {
  GridViewIcon,
  LibraryIcon,
  ListViewIcon,
  LockIcon,
  SearchIcon,
} from '../components/icons';
import { LibraryService } from '../services/libraryService';
import { getLibraryRepository } from '../data/libraryFactory';
import { SEED_LIBRARY_WORKSPACE_ID } from '../mock/librarySeed';
import type {
  LibraryAssetStatus,
  LibraryAssetType,
  LibraryAssetWithVersion,
} from '../domain/library';

type LoadState = 'loading' | 'error' | 'ready';
type TypeFilter = 'all' | LibraryAssetType;
type StatusFilter = 'all' | LibraryAssetStatus;
type ViewMode = 'grid' | 'list';

const STATUS_TONE = {
  draft: 'neutral',
  ready: 'success',
  archived: 'warning',
} as const;

const TYPE_FILTERS: Array<{ value: TypeFilter; label: string }> = [
  { value: 'all', label: 'All types' },
  { value: 'product', label: 'Products' },
  { value: 'prop', label: 'Props' },
  { value: 'wardrobe', label: 'Wardrobe' },
  { value: 'accessory', label: 'Accessories' },
  { value: 'creator_tool', label: 'Creator tools' },
  { value: 'scene', label: 'Scenes' },
  { value: 'look', label: 'Saved Looks' },
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

/**
 * Library index — the ONE unified reusable-asset system. This milestone ships
 * the data foundation + lightweight listing; uploads, scanning and AI
 * descriptions arrive later. Generated content lives in Gallery, never here.
 */
export function LibraryPage() {
  const service = useMemo(() => new LibraryService(getLibraryRepository()), []);

  const [state, setState] = useState<LoadState>('loading');
  const [assets, setAssets] = useState<LibraryAssetWithVersion[]>([]);
  const [assetTags, setAssetTags] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [view, setView] = useState<ViewMode>('grid');
  const [addOpen, setAddOpen] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      // Workspace switching arrives with the Workspace features; until then
      // both demo and configured mode read the seed workspace.
      const workspaceId = SEED_LIBRARY_WORKSPACE_ID;
      const list = await service.listAssets(workspaceId);
      const enriched = await Promise.all(
        list.map(async (asset) => ({
          ...asset,
          activeVersion: asset.activeVersionId
            ? await service.getVersion(asset.activeVersionId, workspaceId)
            : null,
        })),
      );
      const tags: Record<string, string[]> = {};
      await Promise.all(
        list.map(async (asset) => {
          tags[asset.id] = (await service.getTagsForAsset(asset.id, workspaceId)).map((tag) => tag.name);
        }),
      );
      setAssets(enriched);
      setAssetTags(tags);
      setState('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the Library.');
      setState('error');
    }
  }, [service]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return assets.filter((asset) => {
      if (typeFilter !== 'all' && asset.assetType !== typeFilter) return false;
      if (statusFilter !== 'all' && asset.status !== statusFilter) return false;
      if (needle && !asset.name.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [assets, search, typeFilter, statusFilter]);

  const typeLabel = (asset: LibraryAssetWithVersion): string =>
    asset.assetType === 'look' ? 'Saved Look' : asset.assetType.replace('_', ' ');

  return (
    <div className="lf-page">
      <PageHeader
        eyebrow="Builder"
        title="Library"
        description="Reusable assets for every model, scene and campaign."
        actions={
          <Button variant="primary" leftIcon={<LibraryIcon size={16} />} onClick={() => setAddOpen(true)}>
            Add asset
          </Button>
        }
      />

      <p className="lf-library__note" role="note">
        Library stores reusable inputs. Generated content lives in Gallery.
      </p>

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
              <label className="lf-field__label" htmlFor="library-type-filter">Type</label>
              <select
                id="library-type-filter"
                className="lf-input"
                value={typeFilter}
                onChange={(event) => setTypeFilter(event.target.value as TypeFilter)}
              >
                {TYPE_FILTERS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
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

          {assets.length === 0 ? (
            <EmptyState
              icon={<LibraryIcon size={22} />}
              title="Build your Library"
              description="Add products, props, wardrobe, accessories, creator tools, scenes and saved Looks once — then reuse them across every model, environment and campaign."
              actions={
                <Button variant="primary" leftIcon={<LibraryIcon size={16} />} onClick={() => setAddOpen(true)}>
                  Add asset
                </Button>
              }
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<SearchIcon size={22} />}
              title="No assets match"
              description="Try a different search term or filter combination."
              actions={
                <Button
                  onClick={() => {
                    setSearch('');
                    setTypeFilter('all');
                    setStatusFilter('all');
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          ) : (
            <div className={view === 'grid' ? 'lf-envgrid' : 'lf-envlist'} role="list">
              {filtered.map((asset) => {
                const active = asset.activeVersion;
                const locked = active?.status === 'locked';
                return (
                  <Card key={asset.id} role="listitem">
                    <CardBody>
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
                            <Badge tone={STATUS_TONE[asset.status]} dot>
                              {asset.status}
                            </Badge>
                            <Badge tone="neutral">{typeLabel(asset)}</Badge>
                            {active ? (
                              <Badge tone={locked ? 'locked' : 'primary'}>
                                {locked ? <LockIcon size={12} /> : null}
                                {`v${active.versionNumber} ${locked ? 'Locked' : 'Draft'}`}
                              </Badge>
                            ) : (
                              <Badge tone="neutral">no version yet</Badge>
                            )}
                            {active ? <Badge tone="neutral">{active.rightsStatus} rights</Badge> : null}
                          </div>
                          {assetTags[asset.id]?.length ? (
                            <p className="lf-library__tags">
                              {assetTags[asset.id].map((tag) => (
                                <span key={tag} className="lf-library__tag">{tag}</span>
                              ))}
                            </p>
                          ) : null}
                          {asset.description ? (
                            <p className="lf-envcard__summary">{asset.description}</p>
                          ) : null}
                          <p className="lf-envcard__updated">Updated {formatDate(asset.updatedAt)}</p>
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
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add asset"
        size="sm"
        footer={
          <div className="lf-dialogactions">
            <Button onClick={() => setAddOpen(false)}>Close</Button>
          </div>
        }
      >
        <p>
          The guided asset flow will be added next: define a reusable product, prop, wardrobe
          piece, accessory or saved Look, add reference metadata, then version and lock the
          approved configuration.
        </p>
        <p className="lf-tile__description">
          This milestone ships the Library data foundation only — no uploads, scanning or AI
          descriptions are implemented yet.
        </p>
      </Modal>
    </div>
  );
}
