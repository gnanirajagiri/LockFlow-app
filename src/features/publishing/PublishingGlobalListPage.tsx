/**
 * Global publishing list (/publishing) — workspace-level drafts across all
 * campaigns with search, filters and sort.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PageHeader } from '../../components/layout/PageHeader';
import { Card, CardBody } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { Input } from '../../components/ui/Input';
import { GalleryIcon } from '../../components/icons';
import { SEED_GALLERY_WORKSPACE_ID } from '../../mock/gallerySeed';
import type { SafePublishingDraftView } from '../../domain/publishing';
import {
  PUBLISHING_STATUS_FILTERS,
  PUBLISHING_STATUS_LABELS,
  PUBLISHING_STATUS_TONES,
  PUBLISHING_PLACEMENT_LABELS,
} from './publishingUi';
import { usePublishingService } from './usePublishingService';

type SortKey = 'updated' | 'published' | 'status';

export function PublishingGlobalListPage() {
  const navigate = useNavigate();
  const publishing = usePublishingService();
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<SafePublishingDraftView[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [providerFilter, setProviderFilter] = useState('all');
  const [placementFilter, setPlacementFilter] = useState('all');
  const [sort, setSort] = useState<SortKey>('updated');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setDrafts(await publishing.listDrafts(SEED_GALLERY_WORKSPACE_ID));
    } finally {
      setLoading(false);
    }
  }, [publishing]);

  useEffect(() => {
    void load();
  }, [load]);

  const providers = useMemo(
    () => [...new Set(drafts.map((d) => d.providerKey))].sort(),
    [drafts],
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const rows = drafts.filter((d) => {
      if (statusFilter !== 'all' && d.status !== statusFilter) return false;
      if (providerFilter !== 'all' && d.providerKey !== providerFilter) return false;
      if (placementFilter !== 'all' && d.placement !== placementFilter) return false;
      if (needle && !`${d.sourceTitle}`.toLowerCase().includes(needle)) return false;
      return true;
    });
    return rows.sort((a, b) => {
      if (sort === 'status') return a.status.localeCompare(b.status);
      if (sort === 'published') return (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '');
      return a.updatedAt < b.updatedAt ? 1 : -1;
    });
  }, [drafts, search, statusFilter, providerFilter, placementFilter, sort]);

  return (
    <div className="lf-page">
      <PageHeader
        title="Publishing"
        description="Prepared publishing drafts across your workspace campaigns."
      />

      <div className="lf-models-toolbar" role="group" aria-label="Publishing filters">
        <div className="lf-models-toolbar__filter lf-models-toolbar__filter--grow">
          <Input
            id="publishing-search"
            label="Search"
            hideLabel
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by source output name"
          />
        </div>
        <div className="lf-models-toolbar__filter">
          <label className="lf-field__label" htmlFor="pub-status">Status</label>
          <select id="pub-status" className="lf-input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            {PUBLISHING_STATUS_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
        </div>
        <div className="lf-models-toolbar__filter">
          <label className="lf-field__label" htmlFor="pub-provider">Provider</label>
          <select id="pub-provider" className="lf-input" value={providerFilter} onChange={(e) => setProviderFilter(e.target.value)}>
            <option value="all">All providers</option>
            {providers.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
        <div className="lf-models-toolbar__filter">
          <label className="lf-field__label" htmlFor="pub-placement">Placement</label>
          <select id="pub-placement" className="lf-input" value={placementFilter} onChange={(e) => setPlacementFilter(e.target.value)}>
            <option value="all">All placements</option>
            {Object.entries(PUBLISHING_PLACEMENT_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
        <div className="lf-models-toolbar__filter">
          <label className="lf-field__label" htmlFor="pub-sort">Sort</label>
          <select id="pub-sort" className="lf-input" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="updated">Recently updated</option>
            <option value="published">Published date</option>
            <option value="status">Status</option>
          </select>
        </div>
      </div>

      {loading ? (
        <Skeleton height={200} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<GalleryIcon size={22} />}
          title="No publishing drafts yet."
          description="Prepare approved Campaign content for a connected account when you are ready."
          actions={<Link className="lf-btn lf-btn--primary" to="/campaigns">Browse campaigns</Link>}
        />
      ) : (
        <div role="list">
          {filtered.map((draft) => (
            <Card key={draft.id} role="listitem">
              <CardBody>
                <div className="lf-campaign-item">
                  <div className="lf-campaign-item__preview" aria-hidden="true"><GalleryIcon size={20} /></div>
                  <div className="lf-campaign-item__body">
                    <div className="lf-envcard__title">
                      <strong>{draft.sourceTitle}</strong>
                      <Badge tone={PUBLISHING_STATUS_TONES[draft.status]} dot>
                        {PUBLISHING_STATUS_LABELS[draft.status]}
                      </Badge>
                    </div>
                    <p className="lf-tile__description">
                      {draft.externalAccount.accountLabel ?? draft.externalAccount.connectionLocalName}
                      {' · '}
                      {PUBLISHING_PLACEMENT_LABELS[draft.placement]}
                      {' · '}
                      {draft.publishedAt ? `Published ${new Date(draft.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : 'Planned campaign date applies (internal only)'}
                    </p>
                  </div>
                  <div className="lf-campaign-item__actions">
                    <Button size="sm" onClick={() => navigate(`/publishing/${draft.id}`)}>Open</Button>
                  </div>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
