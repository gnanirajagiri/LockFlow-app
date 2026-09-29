/**
 * Campaign channels tab — planning targets with honest connection status.
 *
 * Channels are internal planning records (no account data is stored on them).
 * The status line reflects real workspace social connections where they exist
 * (Connected / Needs re-auth) and stays "Not connected" otherwise. No
 * publishing, preference selection or account data happens here yet.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Modal } from '../../components/ui/Modal';
import { Skeleton } from '../../components/ui/Skeleton';
import { useToast } from '../../components/ui/Toast';
import type { CampaignContextValue } from './CampaignLayout';
import { SEED_GALLERY_WORKSPACE_ID } from '../../mock/gallerySeed';
import { CAMPAIGN_CHANNEL_KEYS } from '../../domain/campaigns';
import type { CampaignChannelRecord } from '../../domain/campaigns';
import { CAMPAIGN_CHANNEL_LABELS, CAMPAIGN_INTENT_LABELS } from './campaignsUi';
import { SocialConnectionsService } from '../../services/socialConnectionsService';
import { SocialConnectionEncryptionService } from '../../services/socialConnectionEncryption';
import { createDefaultProviderRegistry } from '../../services/socialProviders';
import { getSocialConnectionsRepository } from '../../data/socialConnectionsFactory';
import type { SocialConnectionRecord } from '../../domain/social';
import { CONNECTION_STATUS_LABELS } from '../social/connectionsUi';

/** Campaign channel → social provider key (planning-target mapping only). */
const CHANNEL_PROVIDER_KEYS: Record<string, string> = {
  instagram: 'meta',
  tiktok: 'tiktok',
  youtube: 'youtube',
  facebook: 'meta',
  linkedin: 'linkedin',
  x: 'x',
  pinterest: 'pinterest',
};

const INTENTS = ['organic', 'paid', 'both'] as const;

export function CampaignChannelsTab() {
  const { service, campaign, reload } = useOutletContext<CampaignContextValue>();
  const { toast } = useToast();
  const readOnly = campaign.status === 'archived';

  const [loading, setLoading] = useState(true);
  const [channels, setChannels] = useState<CampaignChannelRecord[]>([]);
  const [channelCounts, setChannelCounts] = useState<Record<string, { count: number; next: string | null; formats: string[] }>>({});
  const [adding, setAdding] = useState(false);
  const [newChannel, setNewChannel] = useState('');
  const [newIntent, setNewIntent] = useState<(typeof INTENTS)[number]>('organic');
  const [newNotes, setNewNotes] = useState('');
  const [removing, setRemoving] = useState<CampaignChannelRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [connections, setConnections] = useState<SocialConnectionRecord[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rows, detail] = await Promise.all([
        service.listChannels(campaign.id, SEED_GALLERY_WORKSPACE_ID),
        service.getCampaignDetail(campaign.id, SEED_GALLERY_WORKSPACE_ID),
      ]);
      setChannels(rows);
      const counts: Record<string, { count: number; next: string | null; formats: string[] }> = {};
      for (const ch of rows) {
        const channelItems = detail.items.filter(
          (i) => i.status !== 'removed' && !i.removedAt && i.plannedChannel === ch.channel,
        );
        const next = channelItems
          .map((i) => i.plannedPublishAt)
          .filter((v): v is string => v !== null)
          .sort()[0] ?? null;
        counts[ch.id] = {
          count: channelItems.length,
          next,
          formats: [
            ...new Set(
              channelItems
                .map((i) => i.plannedFormat)
                .filter((f): f is NonNullable<typeof f> => f !== null)
                .map((f) => String(f)),
            ),
          ],
        };
      }
      setChannelCounts(counts);
      // Honest connection status from the workspace's social connections.
      try {
        const social = new SocialConnectionsService(
          getSocialConnectionsRepository(),
          createDefaultProviderRegistry(),
          new SocialConnectionEncryptionService(),
        );
        setConnections(await social.listConnections(SEED_GALLERY_WORKSPACE_ID));
      } catch {
        setConnections([]);
      }
    } finally {
      setLoading(false);
    }
  }, [service, campaign.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const taken = useMemo(() => new Set(channels.map((ch) => ch.channel)), [channels]);

  /** Best active connection for a campaign channel's provider, if any. */
  const connectionForChannel = useCallback(
    (channelKey: string): SocialConnectionRecord | null => {
      const providerKey = CHANNEL_PROVIDER_KEYS[channelKey];
      if (!providerKey) return null;
      return (
        connections.find(
          (c) =>
            c.providerKey === providerKey &&
            (c.status === 'connected' || c.status === 'needs_reauth' || c.status === 'pending'),
        ) ?? null
      );
    },
    [connections],
  );

  async function handleAdd() {
    setBusy(true);
    try {
      await service.addChannel(
        { campaignId: campaign.id, channel: newChannel, intent: newIntent, ...(newNotes.trim() ? { notes: newNotes.trim() } : {}) },
        SEED_GALLERY_WORKSPACE_ID,
      );
      toast({ title: 'Channel added to the plan.', tone: 'success' });
      setAdding(false);
      setNewChannel('');
      setNewIntent('organic');
      setNewNotes('');
      await load();
      await reload();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Could not add the channel.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function move(channel: CampaignChannelRecord, direction: -1 | 1) {
    const index = channels.findIndex((ch) => ch.id === channel.id);
    const target = index + direction;
    if (target < 0 || target >= channels.length) return;
    const ordered = [...channels];
    const [moved] = ordered.splice(index, 1);
    ordered.splice(target, 0, moved);
    try {
      await service.reorderChannels(campaign.id, ordered.map((ch) => ch.id), SEED_GALLERY_WORKSPACE_ID);
      await load();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Could not reorder channels.', tone: 'error' });
    }
  }

  async function handleRemove() {
    if (!removing) return;
    setBusy(true);
    try {
      await service.removeChannel(removing.id, campaign.id, SEED_GALLERY_WORKSPACE_ID);
      toast({ title: 'Channel removed from the plan.', tone: 'success' });
      setRemoving(null);
      await load();
      await reload();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Could not remove the channel.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="lf-dialogactions" style={{ justifyContent: 'space-between' }}>
        <p className="lf-tile__description" style={{ margin: 0 }}>
          Channels are planning targets only — no accounts are connected and nothing publishes from LockFlow yet.
        </p>
        <Button variant="primary" disabled={readOnly} onClick={() => setAdding(true)}>
          Add channel
        </Button>
      </div>

      {loading ? (
        <Skeleton height={140} />
      ) : channels.length === 0 ? (
        <EmptyState
          icon={<Badge tone="neutral">···</Badge>}
          title="No channels planned yet"
          description="Add the channels this campaign targets. Channel records are planning metadata — no social account data is stored."
          actions={
            <Button variant="primary" disabled={readOnly} onClick={() => setAdding(true)}>
              Add channel
            </Button>
          }
        />
      ) : (
        <div role="list">
          {channels.map((channel, index) => {
            const stats = channelCounts[channel.id];
            return (
              <Card key={channel.id} role="listitem">
                <CardBody>
                  <div className="lf-campaign-item">
                    <div className="lf-campaign-item__body">
                      <div className="lf-envcard__title">
                        <strong>{CAMPAIGN_CHANNEL_LABELS[channel.channel] ?? channel.channel}</strong>
                        <Badge tone="neutral">{CAMPAIGN_INTENT_LABELS[channel.intent]}</Badge>
                      </div>
                      <p className="lf-tile__description">
                        {stats?.count ?? 0} planned item{(stats?.count ?? 0) === 1 ? '' : 's'}
                        {stats?.formats.length ? ` · format mix: ${stats.formats.join(', ')}` : ''}
                        {stats?.next ? ` · next planned ${new Date(stats.next).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}
                      </p>
                      {channel.notes ? <p className="lf-tile__description">{channel.notes}</p> : null}
                      <p className="lf-tile__description">
                        {(() => {
                          const connection = connectionForChannel(channel.channel);
                          if (!connection) {
                            return (
                              <>
                                Connection status: <strong>Not connected</strong> — publishing
                                integrations are not part of LockFlow yet.
                              </>
                            );
                          }
                          return (
                            <>
                              Connection status:{' '}
                              <strong>{CONNECTION_STATUS_LABELS[connection.status]}</strong>
                              {' · '}
                              {connection.localName}
                              {connection.status === 'needs_reauth' &&
                              connection.lastErrorMessageSafe
                                ? ` — ${connection.lastErrorMessageSafe}`
                                : ''}
                            </>
                          );
                        })()}
                      </p>
                    </div>
                    <div className="lf-campaign-item__actions">
                      <Button size="sm" variant="ghost" disabled={index === 0 || readOnly} onClick={() => void move(channel, -1)}>
                        ↑ <span className="lf-visually-hidden">Move {channel.channel} up</span>
                      </Button>
                      <Button size="sm" variant="ghost" disabled={index === channels.length - 1 || readOnly} onClick={() => void move(channel, 1)}>
                        ↓ <span className="lf-visually-hidden">Move {channel.channel} down</span>
                      </Button>
                      <Button size="sm" disabled title="Publishing will be enabled after post/ad preparation is added.">
                        {connectionForChannel(channel.channel)
                          ? 'Publishing — coming next'
                          : 'Connect account — coming soon'}
                      </Button>
                      <Button size="sm" variant="ghost" disabled={readOnly} onClick={() => setRemoving(channel)}>
                        Remove
                      </Button>
                    </div>
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        title="Add channel"
        description="Planning target only. No social account, OAuth or publishing connection is created."
        footer={
          <div className="lf-dialogactions">
            <Button onClick={() => setAdding(false)}>Cancel</Button>
            <Button variant="primary" disabled={busy || !newChannel} onClick={() => void handleAdd()}>
              Add channel
            </Button>
          </div>
        }
      >
        <div className="lf-formgrid">
          <div className="lf-field">
            <label className="lf-field__label" htmlFor="channel-select">Channel</label>
            <select id="channel-select" className="lf-input" value={newChannel} onChange={(e) => setNewChannel(e.target.value)}>
              <option value="">Choose a channel…</option>
              {CAMPAIGN_CHANNEL_KEYS.filter((key) => !taken.has(key)).map((key) => (
                <option key={key} value={key}>{CAMPAIGN_CHANNEL_LABELS[key] ?? key}</option>
              ))}
            </select>
          </div>
          <div className="lf-field">
            <label className="lf-field__label" htmlFor="intent-select">Intent</label>
            <select
              id="intent-select"
              className="lf-input"
              value={newIntent}
              onChange={(e) => setNewIntent(e.target.value as (typeof INTENTS)[number])}
            >
              {INTENTS.map((intent) => (
                <option key={intent} value={intent}>{CAMPAIGN_INTENT_LABELS[intent]}</option>
              ))}
            </select>
          </div>
          <div className="lf-field lf-field--full">
            <label className="lf-field__label" htmlFor="channel-notes">Notes</label>
            <input id="channel-notes" className="lf-input" maxLength={400} value={newNotes} onChange={(e) => setNewNotes(e.target.value)} />
          </div>
        </div>
      </Modal>

      <Modal
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title="Remove channel"
        size="sm"
        footer={
          <div className="lf-dialogactions">
            <Button onClick={() => setRemoving(null)}>Cancel</Button>
            <Button variant="danger" disabled={busy} onClick={() => void handleRemove()}>
              Remove channel
            </Button>
          </div>
        }
      >
        <p>
          {removing ? CAMPAIGN_CHANNEL_LABELS[removing.channel] ?? removing.channel : 'This channel'} will be
          removed from the campaign plan. Items already planned for it stay but lose their channel
          reference check — history is preserved.
        </p>
      </Modal>
    </div>
  );
}
