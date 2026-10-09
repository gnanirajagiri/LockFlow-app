/**
 * Campaigns home (/campaigns) — the campaign-planning dashboard.
 *
 * Stage-5 fidelity (board S79): status tabs with counts (Active / Draft /
 * Complete / Archived), then hero cards — cover media panel with a category
 * badge, title with an approval progress ring, "N of M approved · channels"
 * meta, and a contextual "Next … →" footer action. Search stays as a compact
 * toolbar row; grid/list toggle is kept for larger workspaces.
 *
 * Campaigns organise approved Gallery content for channels; all publishing
 * controls are explicitly "coming soon".
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../../components/layout/PageHeader';
import { Button } from '../../components/ui/Button';
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
  campaignDateRange,
  campaignStatusLabel,
  formatPlannedDateTime,
} from './campaignsUi';

type LoadState = 'loading' | 'error' | 'ready';
type StatusTab = 'active' | 'draft' | 'completed' | 'archived';
type SortKey = 'updated' | 'start' | 'name';
type ViewMode = 'grid' | 'list';

const STATUS_TABS: Array<{ value: StatusTab; label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'draft', label: 'Draft' },
  { value: 'completed', label: 'Complete' },
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
  /** Cover thumbnails keyed by campaign id — first item output's thumb. */
  const [covers, setCovers] = useState<Record<string, string | null>>({});

  const [search, setSearch] = useState('');
  const [statusTab, setStatusTab] = useState<StatusTab>('active');
  const [sort, setSort] = useState<SortKey>('updated');
  const [view, setView] = useState<ViewMode>('grid');
  const [statusTarget, setStatusTarget] = useState<{ campaign: CampaignRecord; to: CampaignStatus } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const list = await service.listCampaigns(SEED_GALLERY_WORKSPACE_ID);
      setSummaries(list);
      setState('ready');
      // Cover media: first non-removed item's output thumbnail (planning
      // reference only — media is never copied into the campaign).
      const nextCovers: Record<string, string | null> = {};
      await Promise.all(
        list.map(async ({ campaign }) => {
          try {
            const detail = await service.getCampaignDetail(campaign.id, SEED_GALLERY_WORKSPACE_ID);
            const active = detail.items.find((item) => item.status !== 'removed' && !item.removedAt);
            if (!active) {
              nextCovers[campaign.id] = null;
              return;
            }
            const output = await service.resolveItemOutput(active.galleryOutputId, SEED_GALLERY_WORKSPACE_ID);
            nextCovers[campaign.id] = output?.thumbnailStoragePath ?? output?.mediaStoragePath ?? null;
          } catch {
            nextCovers[campaign.id] = null;
          }
        }),
      );
      setCovers(nextCovers);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load campaigns.');
      setState('error');
    }
  }, [service]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(
    () => ({
      active: summaries.filter((s) => s.campaign.status === 'active').length,
      draft: summaries.filter((s) => s.campaign.status === 'draft').length,
      completed: summaries.filter((s) => s.campaign.status === 'completed').length,
      archived: summaries.filter((s) => s.campaign.status === 'archived').length,
    }),
    [summaries],
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const list = summaries.filter(({ campaign }) => {
      if (campaign.status !== statusTab) return false;
      if (needle && !campaign.name.toLowerCase().includes(needle)) return false;
      return true;
    });
    if (sort === 'name') return [...list].sort((a, b) => a.campaign.name.localeCompare(b.campaign.name));
    if (sort === 'start') {
      return [...list].sort(
        (a, b) => (a.campaign.startDate ?? '9999').localeCompare(b.campaign.startDate ?? '9999'),
      );
    }
    return [...list].sort((a, b) => (a.campaign.updatedAt < b.campaign.updatedAt ? 1 : -1));
  }, [summaries, search, statusTab, sort]);

  const nextAction = (campaign: CampaignRecord, approved: number, blocked: number): string | null => {
    if (campaign.status === 'draft') return blocked > 0 ? 'Review blocked items →' : 'Activate campaign →';
    if (campaign.status === 'active') return blocked > 0 ? `Review ${blocked} blocked →` : approved > 0 ? `Publish ${approved} approved →` : 'Add content →';
    if (campaign.status === 'completed') return 'Complete →';
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
        title="Campaigns"
        description="Group content, test variants and publish to your ad and social accounts."
        actions={
          <Link className="lf-btn lf-btn--primary" to="/campaigns/new">
            New campaign
          </Link>
        }
      />

      {state === 'loading' ? (
        <div className="lf-envgrid" aria-hidden="true">
          <Skeleton height={320} />
          <Skeleton height={320} />
          <Skeleton height={320} />
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
      ) : summaries.length === 0 ? (
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
      ) : (
        <>
          <div className="lf-campaigntabs" role="tablist" aria-label="Campaign status">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.value}
                type="button"
                role="tab"
                aria-selected={statusTab === tab.value}
                className={`lf-campaigntabs__tab${statusTab === tab.value ? ' lf-campaigntabs__tab--active' : ''}`}
                onClick={() => setStatusTab(tab.value)}
              >
                {tab.label}
                <span className="lf-campaigntabs__count">{counts[tab.value]}</span>
              </button>
            ))}
          </div>

          <div className="lf-models-toolbar" role="group" aria-label="Campaign filters">
            <div className="lf-models-toolbar__filter lf-models-toolbar__filter--grow">
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

          {filtered.length === 0 ? (
            <EmptyState
              icon={<SearchIcon size={22} />}
              title="No campaigns here"
              description={
                search
                  ? 'Try a different search term.'
                  : `No ${campaignStatusLabel(statusTab).toLowerCase()} campaigns right now.`
              }
            />
          ) : (
            <div className={view === 'grid' ? 'lf-campaigngrid' : 'lf-envlist'} role="list">
              {filtered.map(({ campaign, itemCount, approvedOutputCount, blockedCount, channelCount, nextPlannedAt }) => {
                const channelLabel =
                  channelCount > 0
                    ? `${channelCount} channel${channelCount === 1 ? '' : 's'}`
                    : 'No channels yet';
                const action = nextAction(campaign, approvedOutputCount, blockedCount);
                const cover = covers[campaign.id];
                const pct = itemCount > 0 ? Math.round((approvedOutputCount / itemCount) * 100) : 0;
                return (
                  <article key={campaign.id} className="lf-campaigncard" role="listitem">
                    <Link to={`/campaigns/${campaign.id}/overview`} className="lf-campaigncard__medialink">
                      <div className="lf-campaigncard__media" aria-hidden="true">
                        <span className="lf-campaigncard__mediaph">
                          <CampaignIcon size={26} />
                        </span>
                        {cover ? (
                          <img
                            src={cover}
                            alt=""
                            loading="lazy"
                            onError={(event) => {
                              // Placeholder media is not shipped in demo
                              // mode — fall back to the icon beneath.
                              event.currentTarget.style.display = 'none';
                            }}
                          />
                        ) : null}
                        <span className="lf-campaigncard__catbadge">{campaignStatusLabel(campaign.status)}</span>
                      </div>
                    </Link>
                    <div className="lf-campaigncard__body">
                      <div className="lf-campaigncard__titlerow">
                        <h2>
                          <Link to={`/campaigns/${campaign.id}/overview`}>{campaign.name}</Link>
                        </h2>
                        <ProgressRing pct={pct} />
                      </div>
                      <p className="lf-campaigncard__meta">
                        {approvedOutputCount} of {itemCount} approved · {channelLabel}
                        {blockedCount > 0 ? ` · ${blockedCount} need attention` : ''}
                      </p>
                      <div className="lf-campaigncard__footer">
                        <span className="lf-campaigncard__next">
                          {nextPlannedAt ? `Next ${formatPlannedDateTime(nextPlannedAt)}` : campaignDateRange(campaign) !== '—' ? campaignDateRange(campaign) : 'No plan dates yet'}
                        </span>
                        {action ? (
                          <Link to={`/campaigns/${campaign.id}/overview`} className="lf-campaigncard__nextaction">
                            {action}
                          </Link>
                        ) : null}
                      </div>
                    </div>
                  </article>
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

/** Small SVG ring showing approval progress, as on the S79 cards. */
function ProgressRing({ pct }: { pct: number }) {
  const r = 14;
  const c = 2 * Math.PI * r;
  return (
    <svg
      className="lf-campaigncard__ring"
      width="36"
      height="36"
      viewBox="0 0 36 36"
      role="img"
      aria-label={`${pct}% approved`}
    >
      <circle cx="18" cy="18" r={r} fill="none" stroke="var(--lf-color-border)" strokeWidth="3" />
      <circle
        cx="18"
        cy="18"
        r={r}
        fill="none"
        stroke="var(--lf-color-primary)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={`${(pct / 100) * c} ${c}`}
        transform="rotate(-90 18 18)"
      />
      <text x="18" y="21.5" textAnchor="middle" fontSize="9.5" fill="var(--lf-color-ink)">
        {pct}%
      </text>
    </svg>
  );
}

export { labelForChannel };
