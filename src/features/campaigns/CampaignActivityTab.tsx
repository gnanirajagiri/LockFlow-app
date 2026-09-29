/**
 * Campaign activity tab — append-only audit timeline, human-readable.
 */
import { useCallback, useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { CampaignIcon } from '../../components/icons';
import type { CampaignContextValue } from './CampaignLayout';
import { SEED_GALLERY_WORKSPACE_ID } from '../../mock/gallerySeed';
import type { CampaignEventRecord } from '../../domain/campaigns';

export function CampaignActivityTab() {
  const { service, campaign } = useOutletContext<CampaignContextValue>();
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<CampaignEventRecord[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setEvents(await service.listEvents(campaign.id, SEED_GALLERY_WORKSPACE_ID));
    } finally {
      setLoading(false);
    }
  }, [service, campaign.id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <Skeleton height={200} />;

  if (events.length === 0) {
    return (
      <EmptyState
        icon={<CampaignIcon size={22} />}
        title="No activity yet"
        description="Campaign changes are recorded here as an append-only timeline."
      />
    );
  }

  return (
    <div role="list" aria-label="Campaign activity timeline">
      {events.map((event) => (
        <div key={event.id} className="lf-campaign-agendarow" role="listitem">
          <div>
            <strong>{event.message}</strong>
            <p className="lf-tile__description">
              {new Date(event.createdAt).toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })}
              {' · '}
              {event.eventType.replace(/_/g, ' ')}
            </p>
          </div>
        </div>
      ))}
      <p className="lf-tile__description">
        This timeline is append-only. Entries never contain provider secrets, signed URLs or raw media.
      </p>
    </div>
  );
}
