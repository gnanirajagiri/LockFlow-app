/**
 * Campaign overview tab — the workspace view.
 *
 * Stage-5 fidelity (board S81): a content kanban (Draft / In review /
 * Approved / Published columns built from item statuses) with per-item
 * output thumbnails, then an Assets panel (attached Library assets with an
 * Open Library link) and a Publishing panel (recent channel events with
 * success/schedule/warning states). Campaign brief info stays above the
 * board as a compact strip.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useOutletContext } from 'react-router-dom';
import { Card, CardBody } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { AlertIcon, CheckIcon, InfoIcon } from '../../components/icons';
import type { CampaignContextValue } from './CampaignLayout';
import { SEED_GALLERY_WORKSPACE_ID } from '../../mock/gallerySeed';
import type { CampaignItemRecord } from '../../domain/campaigns';
import {
  CAMPAIGN_CHANNEL_LABELS,
  CAMPAIGN_ITEM_STATUS_LABELS,
  formatPlannedDateTime,
} from './campaignsUi';

type BoardColumn = {
  key: string;
  label: string;
  /** Item statuses (incl. effective status) that land in this column. */
  statuses: string[];
};

const BOARD_COLUMNS: BoardColumn[] = [
  { key: 'draft', label: 'Draft', statuses: ['draft'] },
  { key: 'review', label: 'In review', statuses: ['ready'] },
  { key: 'approved', label: 'Approved', statuses: ['approved'] },
  { key: 'published', label: 'Published', statuses: ['planned'] },
];

export function CampaignOverviewTab() {
  const { service, campaign } = useOutletContext<CampaignContextValue>();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<CampaignItemRecord[]>([]);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [thumbs, setThumbs] = useState<Record<string, string | null>>({});
  const [channels, setChannels] = useState<Array<{ id: string; channel: string; intent: string }>>([]);
  const [events, setEvents] = useState<Array<{ id: string; eventType: string; message: string; createdAt: string }>>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await service.getCampaignDetail(campaign.id, SEED_GALLERY_WORKSPACE_ID);
      const active = d.items.filter((i) => i.status !== 'removed' && !i.removedAt);
      setItems(active);
      const titleMap: Record<string, string> = {};
      const thumbMap: Record<string, string | null> = {};
      for (const w of d.itemsWithOutputs) {
        if (w.output) titleMap[w.item.id] = w.output.title;
        // Cover thumbnails come straight from Gallery via the read-only
        // output lookup — the campaign never copies media.
        const output = await service.resolveItemOutput(w.item.galleryOutputId, SEED_GALLERY_WORKSPACE_ID);
        thumbMap[w.item.id] = output?.thumbnailStoragePath ?? output?.mediaStoragePath ?? null;
      }
      setTitles(titleMap);
      setThumbs(thumbMap);
      setChannels(d.channels.map((ch) => ({ id: ch.id, channel: ch.channel, intent: ch.intent })));
      setEvents(d.events.slice(0, 5).map((e) => ({ id: e.id, eventType: e.eventType, message: e.message, createdAt: e.createdAt })));
    } finally {
      setLoading(false);
    }
  }, [service, campaign.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const board = useMemo(
    () =>
      BOARD_COLUMNS.map((column) => {
        const columnItems = items.filter((item) => column.statuses.includes(item.status));
        return { column, items: columnItems, extra: Math.max(0, columnItems.length - 4) };
      }),
    [items],
  );

  if (loading) return <Skeleton height={320} />;

  return (
    <div className="lf-campaign-overview lf-campaign-ws">
      <Card>
        <CardBody>
          <div className="lf-campaign-ws__head">
            <div>
              <h2 style={{ margin: 0 }}>{campaign.name}</h2>
              <p className="lf-tile__description" style={{ margin: 0 }}>
                {campaign.objective ?? 'No objective set.'}
                {campaign.audience ? ` · ${campaign.audience}` : ''}
                {campaign.keyMessage ? ` · ${campaign.keyMessage}` : ''}
              </p>
            </div>
            {channels.length > 0 ? (
              <div className="lf-campaign-ws__channelchips">
                {channels.slice(0, 3).map((ch) => (
                  <span key={ch.id} className="lf-campaign-ws__chip">
                    {CAMPAIGN_CHANNEL_LABELS[ch.channel] ?? ch.channel}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </CardBody>
      </Card>

      <div className="lf-campaign-ws__board" role="list" aria-label="Content board">
        {board.map(({ column, items: columnItems, extra }) => (
          <section key={column.key} className="lf-campaign-ws__col" role="listitem" aria-label={`${column.label} column`}>
            <header className="lf-campaign-ws__colhead">
              <h3>{column.label}</h3>
              <span className="lf-campaign-ws__colcount">{columnItems.length}</span>
            </header>
            {columnItems.length === 0 ? (
              <p className="lf-campaign-ws__empty">Nothing here yet</p>
            ) : (
              <>
                {columnItems.slice(0, 4).map((item) => (
                  <Link
                    key={item.id}
                    to={`/campaigns/${campaign.id}/content`}
                    className="lf-campaign-ws__card"
                  >
                    <ItemThumb src={thumbs[item.id]} title={titles[item.id]} />
                    <span className="lf-campaign-ws__cardtext">
                      <strong>{titles[item.id] ?? 'Gallery output'}</strong>
                      <span className="lf-campaign-ws__cardmeta">
                        {item.plannedPublishAt
                          ? formatPlannedDateTime(item.plannedPublishAt)
                          : CAMPAIGN_ITEM_STATUS_LABELS[item.status]}
                      </span>
                    </span>
                  </Link>
                ))}
                {extra > 0 ? (
                  <p className="lf-campaign-ws__more">+ {extra} more</p>
                ) : null}
              </>
            )}
          </section>
        ))}
      </div>

      <div className="lf-campaign-ws__panels">
        <Card>
          <CardBody>
            <div className="lf-campaign-ws__panelhead">
              <h2>Assets</h2>
              <Link to="/library" className="lf-campaign-ws__panelaction">
                Open Library →
              </Link>
            </div>
            <p className="lf-tile__description">
              Attached Library assets shared with this campaign's content jobs.
            </p>
            <Link className="lf-btn lf-btn--secondary lf-btn--sm" to="/library">
              Browse Library
            </Link>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <h2>Publishing</h2>
            {events.length === 0 ? (
              <EmptyState
                icon={<InfoIcon size={20} />}
                title="No publishing activity yet"
                description="Planned dates and channel events will appear here."
              />
            ) : (
              <ul role="list" className="lf-campaign-ws__publist">
                {events.slice(0, 4).map((event) => (
                  <li key={event.id} className="lf-campaign-ws__pubrow">
                    <span
                      className={`lf-campaign-ws__pubicon lf-campaign-ws__pubicon--${event.eventType.includes('status') ? 'ok' : 'wait'}`}
                      aria-hidden="true"
                    >
                      {event.eventType.includes('status') ? <CheckIcon size={13} /> : <AlertIcon size={13} />}
                    </span>
                    <span className="lf-campaign-ws__pubtext">
                      <strong>{event.message}</strong>
                      <span className="lf-tile__description">
                        {new Date(event.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

/**
 * 48px thumbnail with initials fallback; broken/missing demo media hides
 * itself and falls back to the icon beneath (same pattern as home cards).
 */
function ItemThumb({ src, title }: { src: string | null; title?: string }) {
  return (
    <span className="lf-campaign-ws__thumb">
      <span className="lf-campaign-ws__thumbph" aria-hidden="true">
        {(title ?? 'G').charAt(0).toUpperCase()}
      </span>
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          onError={(event) => {
            event.currentTarget.style.display = 'none';
          }}
        />
      ) : null}
    </span>
  );
}
