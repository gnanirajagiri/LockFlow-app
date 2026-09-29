/**
 * Campaigns home (/campaigns) — the campaign-planning dashboard.
 *
 * Summary cards, search/filter/sort, grid/list toggle and guarded status
 * actions. Campaigns organise approved Gallery content for channels; all
 * publishing controls are explicitly "coming soon".
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
import { CampaignIcon, GridViewIcon, ListViewIcon, SearchIcon } from '../../components/icons';
import { CampaignsService, labelForChannel } from '../../services/campaignsService';
import { getCampaignsRepository } from '../../data/campaignsFactory';
import { getGalleryRepository } from '../../data/galleryFactory';
import { getContentRepository } from '../../data/contentFactory';
import { getLibraryRepository } from '../../data/libraryFactory';
import { getModelsRepository } from '../../data';
import { getEnvironmentsRepository } from '../../data/environmentsFactory';
import { GalleryService } from '../../services/galleryService';
import { ContentStudioService } from '../../services/contentService';
import { LibraryService } from '../../services/libraryService';
import { ModelsService } from '../../services/modelsService';
import { EnvironmentsService } from '../../services/environmentsService';
import { SEED_GALLERY_WORKSPACE_ID } from '../../mock/gallerySeed';
import type { CampaignRecord, CampaignStatus } from '../../domain/campaigns';
import type { CampaignSummary } from '../../data/campaignsRepository';
import {
  CAMPAIGN_CHANNEL_LABELS,
  CAMPAIGN_STATUS_TONE,
  campaignDateRange,
  campaignStatusLabel,
  formatPlannedDateTime,
} from './campaignsUi';

type LoadState = 'loading' | 'error' | 'ready';
type StatusFilter = 'all' | CampaignStatus;
type ChannelFilter = 'all' | string;
type DateFilter = 'all' | 'week' | 'month' | 'custom';
type SortKey = 'updated' | 'start' | 'name';
type ViewMode = 'grid' | 'list';

const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
  { value: 'archived', label: 'Archived' },
];

const SORTS: Array<{ value: SortKey; label: string }> = [
  { value: 'updated', label: 'Recently updated' },
  { value: 'start', label: 'Start date' },
  { value: 'name', label: 'Name A–Z' },
];

export function CampaignsHomePage() {
  const { toast } = useToast();
  const service = useMemo(() => {
    const content = new ContentStudioService(getContentRepository(), {
      library: new LibraryService(getLibraryRepository()),
      models: new ModelsService(getModelsRepository()),
      environments: new EnvironmentsService(getEnvironmentsRepository()),
    });
    return new CampaignsService(
      getCampaignsRepository(),
      new GalleryService(getGalleryRepository(), content, SEED_GALLERY_WORKSPACE_ID),
    );
  }, []);

  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<CampaignSummary[]>([]);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>('all');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [sort, setSort] = useState<SortKey>('updated');
  const [view, setView] = useState<ViewMode>('grid');
  const [statusTarget, setStatusTarget] = useState<{ campaign: CampaignRecord; to: CampaignStatus } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      setSummaries(await service.listCampaigns(SEED_GALLERY_WORKSPACE_ID));
      setState('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load campaigns.');
      setState('error');
    }
  }, [service]);

  useEffect(() => {
    void load();
  }, [load]);

  const channelOptions = useMemo(() => {
    const keys = new Set<string>();
    for (const { campaign, channelCount } of summaries) {
      if (channelCount > 0) keys.add(campaign.id);
    }
    void keys;
    return Object.keys(CAMPAIGN_CHANNEL_LABELS);
  }, [summaries]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const nowMs = Date.now();
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const monthMs = 30 * 24 * 60 * 60 * 1000;
    const list = summaries.filter(({ campaign, itemCount, blockedCount }) => {
      if (statusFilter !== 'all' && campaign.status !== statusFilter) return false;
      if (needle && !campaign.name.toLowerCase().includes(needle)) return false;
      if (dateFilter === 'week' && !(campaign.updatedAt && nowMs - Date.parse(campaign.updatedAt) <= weekMs)) return false;
      if (dateFilter === 'month' && !(campaign.updatedAt && nowMs - Date.parse(campaign.updatedAt) <= monthMs)) return false;
      if (dateFilter === 'custom' && customFrom && campaign.startDate && campaign.startDate < customFrom) return false;
      if (dateFilter === 'custom' && customTo && campaign.startDate && campaign.startDate > customTo) return false;
      if (channelFilter !== 'all' && itemCount === 0 && blockedCount === 0) return false;
      return true;
    });
    if (sort === 'name') return [...list].sort((a, b) => a.campaign.name.localeCompare(b.campaign.name));
    if (sort === 'start') {
      return [...list].sort(
        (a, b) => (a.campaign.startDate ?? '9999').localeCompare(b.campaign.startDate ?? '9999'),
      );
    }
    return [...list].sort((a, b) => (a.campaign.updatedAt < b.campaign.updatedAt ? 1 : -1));
  }, [summaries, search, statusFilter, channelFilter, dateFilter, customFrom, customTo, sort]);

  const stats = useMemo(
    () => ({
      draft: summaries.filter((s) => s.campaign.status === 'draft').length,
      active: summaries.filter((s) => s.campaign.status === 'active').length,
      plannedThisWeek: summaries.reduce((acc, s) => acc + s.plannedItemCountThisWeek, 0),
      attention: summaries.reduce((acc, s) => acc + s.blockedCount, 0),
    }),
    [summaries],
  );

  const nextAction = (campaign: CampaignRecord): { to: CampaignStatus; label: string; danger?: boolean } | null => {
    if (campaign.status === 'draft') return { to: 'active', label: 'Activate campaign' };
    if (campaign.status === 'active') return { to: 'completed', label: 'Complete campaign' };
    if (campaign.status === 'completed') return { to: 'active', label: 'Reactivate campaign' };
    return null;
  };

  async function handleStatusChange() {
    if (!statusTarget) return;
    setBusy(true);
    try {
      const { campaign, to } = statusTarget;
      await service.changeCampaignStatus(campaign.id, to, SEED_GALLERY_WORKSPACE_ID);
      toast({
        title: to === 'archived' ? 'Campaign archived. It is read-only until restored.' : `Campaign ${to}.`,
        tone: 'success',
      });
      setStatusTarget(null);
      await load();
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : 'Could not update the campaign.',
        tone: 'error',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Campaigns"
        title="Campaigns"
        description="Organise approved content into channel-ready campaign plans."
        actions={
          <Link className="lf-btn lf-btn--primary" to="/campaigns/new">
            New campaign
          </Link>
        }
      />

      {state === 'loading' ? (
        <div className="lf-envgrid" aria-hidden="true">
          <Skeleton height={140} />
          <Skeleton height={140} />
          <Skeleton height={140} />
        </div>
      ) : state === 'error' ? (
        <EmptyState
          icon={<CampaignIcon size={22} />}
          title="Could not load campaigns"
          description={error ?? 'Something went wrong.'}
          actions={
            <Button onClick={() => void load()}>Try again</Button>
          }
        />
      ) : (
        <>
          <div className="lf-campaign-summary">
            <Card><CardBody><strong>{stats.draft}</strong> Draft campaigns</CardBody></Card>
            <Card><CardBody><strong>{stats.active}</strong> Active campaigns</CardBody></Card>
            <Card><CardBody><strong>{stats.plannedThisWeek}</strong> Planned items this week</CardBody></Card>
            <Card><CardBody><strong>{stats.attention}</strong> Items needing attention</CardBody></Card>
          </div>

          <div className="lf-models-toolbar" role="group" aria-label="Campaign filters">
            <div className="lf-models-toolbar__filter lf-models-toolbar__filter--grow">
              <label className="lf-field__label" htmlFor="campaign-search">Search</label>
              <Input
                id="campaign-search"
                label="Search"
                hideLabel
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by campaign name"
              />
            </div>
            <div className="lf-models-toolbar__filter">
              <label className="lf-field__label" htmlFor="campaign-status-filter">Status</label>
              <select
                id="campaign-status-filter"
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
              <label className="lf-field__label" htmlFor="campaign-channel-filter">Channel</label>
              <select
                id="campaign-channel-filter"
                className="lf-input"
                value={channelFilter}
                onChange={(event) => setChannelFilter(event.target.value)}
              >
                <option value="all">All channels</option>
                {channelOptions.map((key) => (
                  <option key={key} value={key}>{CAMPAIGN_CHANNEL_LABELS[key] ?? key}</option>
                ))}
              </select>
            </div>
            <div className="lf-models-toolbar__filter">
              <label className="lf-field__label" htmlFor="campaign-date-filter">Date</label>
              <select
                id="campaign-date-filter"
                className="lf-input"
                value={dateFilter}
                onChange={(event) => setDateFilter(event.target.value as DateFilter)}
              >
                <option value="all">All time</option>
                <option value="week">This week</option>
                <option value="month">This month</option>
                <option value="custom">Custom</option>
              </select>
            </div>
            {dateFilter === 'custom' ? (
              <>
                <div className="lf-models-toolbar__filter">
                  <Input id="campaign-from" label="From" type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
                </div>
                <div className="lf-models-toolbar__filter">
                  <Input id="campaign-to" label="To" type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
                </div>
              </>
            ) : null}
            <div className="lf-models-toolbar__filter">
              <label className="lf-field__label" htmlFor="campaign-sort">Sort</label>
              <select
                id="campaign-sort"
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
              icon={<CampaignIcon size={22} />}
              title="Plan your first campaign."
              description="Use approved Gallery outputs to organise content for each channel. Publishing connections come next."
              actions={
                <Link className="lf-btn lf-btn--primary" to="/campaigns/new">
                  New campaign
                </Link>
              }
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<SearchIcon size={22} />}
              title="No campaigns match"
              description="Try a different search term or filter combination."
            />
          ) : (
            <div className={view === 'grid' ? 'lf-envgrid' : 'lf-envlist'} role="list">
              {filtered.map(({ campaign, itemCount, approvedOutputCount, blockedCount, channelCount, nextPlannedAt }) => {
                const action = nextAction(campaign);
                return (
                  <Card key={campaign.id} role="listitem">
                    <CardBody>
                      <div className="lf-envcard lf-campaign-card">
                        <Link to={`/campaigns/${campaign.id}/overview`} className="lf-library__rowlink">
                          <div className="lf-envcard__body">
                            <div className="lf-envcard__title">
                              <h2>{campaign.name}</h2>
                              <Badge tone={CAMPAIGN_STATUS_TONE[campaign.status]} dot>
                                {campaignStatusLabel(campaign.status)}
                              </Badge>
                            </div>
                            <p className="lf-envcard__summary">{campaign.objective ?? 'No objective set.'}</p>
                            <p className="lf-envcard__summary">{campaignDateRange(campaign)}</p>
                            <p className="lf-tile__description">
                              {approvedOutputCount}/{itemCount} approved outputs · {channelCount} channels
                              {nextPlannedAt ? ` · next ${formatPlannedDateTime(nextPlannedAt)}` : ''}
                            </p>
                            {blockedCount > 0 ? (
                              <p><Badge tone="warning" dot>{blockedCount} item{blockedCount === 1 ? '' : 's'} need attention</Badge></p>
                            ) : null}
                          </div>
                        </Link>
                        <div className="lf-library__rowmenu">
                          <Link className="lf-btn lf-btn--secondary lf-btn--sm" to={`/campaigns/${campaign.id}/overview`}>
                            Open
                          </Link>
                          {action ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setStatusTarget({ campaign, to: action.to })}
                            >
                              {action.label}
                            </Button>
                          ) : null}
                          {campaign.status !== 'archived' ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setStatusTarget({ campaign, to: 'archived' })}
                            >
                              Archive
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </CardBody>
                  </Card>
                );
              })}
            </div>
          )}

          <p className="lf-tile__description" style={{ marginTop: 'var(--lf-space-4)' }}>
            Campaigns organise approved Gallery content for planning. Publishing connections,
            ad accounts and scheduled external posts are not part of LockFlow yet — dates here are
            internal planning dates.
          </p>
        </>
      )}

      <Modal
        open={statusTarget !== null}
        onClose={() => setStatusTarget(null)}
        title={
          statusTarget
            ? `${statusTarget.to === 'archived' ? 'Archive' : campaignStatusLabel(statusTarget.to)} ${statusTarget.campaign.name}?`
            : 'Change campaign status'
        }
        size="sm"
        footer={
          <div className="lf-dialogactions">
            <Button onClick={() => setStatusTarget(null)}>Cancel</Button>
            <Button variant={statusTarget?.to === 'archived' ? 'danger' : 'primary'} disabled={busy} onClick={() => void handleStatusChange()}>
              Confirm
            </Button>
          </div>
        }
      >
        {statusTarget ? (
          statusTarget.to === 'archived' ? (
            <p>
              <strong>{statusTarget.campaign.name}</strong> will be archived and become read-only
              until restored. Content items and history are preserved.
            </p>
          ) : (
            <p>
              This will move <strong>{statusTarget.campaign.name}</strong> from{' '}
              {campaignStatusLabel(statusTarget.campaign.status)} to {campaignStatusLabel(statusTarget.to)}.
              Planned items and channels are kept exactly as they are.
            </p>
          )
        ) : null}
      </Modal>
    </>
  );
}

export { labelForChannel };
