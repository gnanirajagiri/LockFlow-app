/**
 * Campaign overview tab — the at-a-glance summary.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useOutletContext } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Card, CardBody } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { CampaignIcon } from '../../components/icons';
import type { CampaignContextValue } from './CampaignLayout';
import { SEED_GALLERY_WORKSPACE_ID } from '../../mock/gallerySeed';
import type { CampaignItemRecord } from '../../domain/campaigns';
import {
  CAMPAIGN_CHANNEL_LABELS,
  CAMPAIGN_INTENT_LABELS,
  CAMPAIGN_ITEM_STATUS_LABELS,
  CAMPAIGN_ITEM_STATUS_TONE,
  formatPlannedDateTime,
} from './campaignsUi';

export function CampaignOverviewTab() {
  const { service, campaign } = useOutletContext<CampaignContextValue>();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<CampaignItemRecord[]>([]);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [channels, setChannels] = useState<Array<{ id: string; channel: string; intent: string }>>([]);
  const [events, setEvents] = useState<Array<{ id: string; message: string; createdAt: string }>>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await service.getCampaignDetail(campaign.id, SEED_GALLERY_WORKSPACE_ID);
      setItems(d.items.filter((i) => i.status !== 'removed' && !i.removedAt));
      const titleMap: Record<string, string> = {};
      for (const w of d.itemsWithOutputs) {
        if (w.output) titleMap[w.item.id] = w.output.title;
      }
      setTitles(titleMap);
      setChannels(d.channels.map((ch) => ({ id: ch.id, channel: ch.channel, intent: ch.intent })));
      setEvents(d.events.slice(0, 5).map((e) => ({ id: e.id, message: e.message, createdAt: e.createdAt })));
    } finally {
      setLoading(false);
    }
  }, [service, campaign.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const blocked = useMemo(() => items.filter((i) => i.status === 'blocked').length, [items]);
  const upcoming = useMemo(
    () =>
      [...items]
        .filter((i) => i.plannedPublishAt !== null)
        .sort((a, b) => Date.parse(a.plannedPublishAt as string) - Date.parse(b.plannedPublishAt as string))
        .slice(0, 5),
    [items],
  );

  if (loading) return <Skeleton height={280} />;

  return (
    <div className="lf-campaign-overview">
      <div className="lf-formgrid">
        <Card>
          <CardBody>
            <h2>Campaign brief</h2>
            <p className="lf-tile__description"><strong>Objective:</strong> {campaign.objective ?? 'Not set.'}</p>
            <p className="lf-tile__description"><strong>Audience:</strong> {campaign.audience ?? 'Not set.'}</p>
            <p className="lf-tile__description"><strong>Key message:</strong> {campaign.keyMessage ?? 'Not set.'}</p>
            {campaign.description ? <p className="lf-tile__description">{campaign.description}</p> : null}
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <h2>Channel plan</h2>
            {channels.length === 0 ? (
              <p className="lf-tile__description">No channels yet. Add them on the Channels tab.</p>
            ) : (
              <ul>
                {channels.map((ch) => (
                  <li key={ch.id}>
                    {CAMPAIGN_CHANNEL_LABELS[ch.channel] ?? ch.channel} — {CAMPAIGN_INTENT_LABELS[ch.intent]}
                  </li>
                ))}
              </ul>
            )}
            <p className="lf-tile__description">Connection status: Not connected (publishing coming later).</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <h2>Content progress</h2>
            <p className="lf-tile__description">
              {items.length} planned item{items.length === 1 ? '' : 's'} · {blocked} blocked
            </p>
            <p className="lf-tile__description">
              All attached outputs are approved Gallery outputs with read-only provenance links.
            </p>
            <Link className="lf-btn lf-btn--secondary lf-btn--sm" to={`/campaigns/${campaign.id}/content`}>
              Manage campaign content
            </Link>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <h2>Upcoming planned items</h2>
            {upcoming.length === 0 ? (
              <p className="lf-tile__description">Nothing planned yet. Add dates from the Content tab.</p>
            ) : (
              <ul role="list">
                {upcoming.map((item) => (
                  <li key={item.id} className="lf-campaign-agendarow">
                    <strong>{titles[item.id] ?? 'Gallery output'}</strong>
                    <span>Planned for {formatPlannedDateTime(item.plannedPublishAt)}</span>
                    <Badge tone={CAMPAIGN_ITEM_STATUS_TONE[item.status]} dot>
                      {CAMPAIGN_ITEM_STATUS_LABELS[item.status]}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardBody>
          <h2>Recent campaign activity</h2>
          {events.length === 0 ? (
            <EmptyState
              icon={<CampaignIcon size={20} />}
              title="No activity yet"
              description="Campaign changes will appear here."
            />
          ) : (
            <ul role="list">
              {events.map((event) => (
                <li key={event.id} className="lf-campaign-agendarow">
                  <span>{event.message}</span>
                  <span className="lf-tile__description">
                    {new Date(event.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
