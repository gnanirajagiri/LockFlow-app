/**
 * Campaign Status Overview (/campaigns/:campaignId/status).
 *
 * Lightweight operational summary — readiness and delivery state, not
 * enterprise analytics. Counts, channel-level delivery, upcoming planning
 * dates, a needs-attention section and one primary next action.
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { PageHeader } from '../../components/layout/PageHeader';
import { Card, CardBody } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { GalleryIcon } from '../../components/icons';
import type { CampaignContextValue } from '../campaigns/CampaignLayout';
import { SEED_GALLERY_WORKSPACE_ID } from '../../mock/gallerySeed';
import type { CampaignStatusOverview } from '../../domain/publishingOps';
import { OPS_STATE_LABELS, OPS_STATE_TONES, formatDateTime } from './opsUi';
import { usePublishingOpsService } from './usePublishingOpsService';

export function CampaignStatusOverviewPage() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const { campaign } = useOutletContext<CampaignContextValue>();
  const navigate = useNavigate();
  const ops = usePublishingOpsService();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overview, setOverview] = useState<CampaignStatusOverview | null>(null);

  const load = useCallback(async () => {
    if (!campaignId) return;
    setLoading(true);
    setError(null);
    try {
      setOverview(await ops.getCampaignStatusOverview(SEED_GALLERY_WORKSPACE_ID, campaignId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the campaign status.');
    } finally {
      setLoading(false);
    }
  }, [ops, campaignId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div>
        <PageHeader title="Status" description="Loading operational summary…" />
        <Skeleton height={280} />
      </div>
    );
  }
  if (error || !overview) {
    return (
      <EmptyState
        icon={<GalleryIcon size={22} />}
        title="Could not load the status overview"
        description={error ?? undefined}
        actions={<Button onClick={() => void load()}>Try again</Button>}
      />
    );
  }

  const countCards: Array<{ key: string; label: string; value: number; tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger' }> = [
    { key: 'planned', label: 'Planned', value: overview.counts.planned, tone: 'neutral' },
    { key: 'ready', label: 'Ready', value: overview.counts.ready, tone: 'info' },
    { key: 'blocked', label: 'Blocked', value: overview.counts.blocked, tone: 'warning' },
    { key: 'inflight', label: 'Queued/Submitting', value: overview.counts.queuedOrSubmitting, tone: 'info' },
    { key: 'submitted', label: 'Submitted', value: overview.counts.submitted, tone: 'info' },
    { key: 'published', label: 'Published', value: overview.counts.published, tone: 'success' },
    { key: 'failed', label: 'Failed', value: overview.counts.failed, tone: 'danger' },
    { key: 'retry', label: 'Retry required', value: overview.counts.retryRequired, tone: 'warning' },
  ];

  return (
    <div>
      <PageHeader
        title="Status overview"
        description={`Operational publishing state for ${campaign.name}. Planning data never triggers publishing.`}
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="ghost" onClick={() => navigate(`/campaigns/${campaignId}/calendar`)}>Calendar</Button>
            <Button variant="ghost" onClick={() => navigate(`/campaigns/${campaignId}/publishing-history`)}>History</Button>
          </div>
        }
      />

      {overview.primaryNextAction && (
        <Card style={{ marginBottom: 16 }}>
          <CardBody>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <div>
                <strong style={{ fontSize: 14 }}>Next step</strong>
                <p style={{ margin: '4px 0 0', fontSize: 13, color: '#475569' }}>
                  The most useful action for this campaign right now.
                </p>
              </div>
              <Button variant="primary" onClick={() => navigate(overview.primaryNextAction!.targetRoute)}>
                {overview.primaryNextAction.label}
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardBody>
          <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>Delivery counts</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 10 }}>
            {countCards.map((c) => (
              <div key={c.key} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ fontSize: 22, fontWeight: 600 }}>{c.value}</div>
                <Badge tone={c.tone}>{c.label}</Badge>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginTop: 16 }}>
        <Card>
          <CardBody>
            <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>Channel delivery</h3>
            {overview.channels.length === 0 ? (
              <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>No channel activity yet.</p>
            ) : (
              <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ color: '#64748b', textAlign: 'left' }}>
                    <th style={{ padding: '4px 6px' }}>Channel</th>
                    <th style={{ padding: '4px 6px' }}>Total</th>
                    <th style={{ padding: '4px 6px' }}>Published</th>
                    <th style={{ padding: '4px 6px' }}>Failed</th>
                    <th style={{ padding: '4px 6px' }}>Pending</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.channels.map((c) => (
                    <tr key={c.channel} style={{ borderTop: '1px solid #e2e8f0' }}>
                      <td style={{ padding: '6px' }}>{c.channel}</td>
                      <td style={{ padding: '6px' }}>{c.total}</td>
                      <td style={{ padding: '6px' }}>{c.published}</td>
                      <td style={{ padding: '6px' }}>{c.failed}</td>
                      <td style={{ padding: '6px' }}>{c.pending}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>Upcoming planning dates</h3>
            {overview.upcoming.length === 0 ? (
              <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>Nothing planned ahead.</p>
            ) : (
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 8 }}>
                {overview.upcoming.map((u) => (
                  <li key={u.campaignItemId} style={{ fontSize: 13, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <strong>{u.title}</strong>
                    <span style={{ color: '#64748b' }}>{formatDateTime(u.plannedPublishAt)}</span>
                    <Badge tone={OPS_STATE_TONES[u.publishingState]} dot>{OPS_STATE_LABELS[u.publishingState]}</Badge>
                  </li>
                ))}
              </ul>
            )}
            <p style={{ margin: '10px 0 0', fontSize: 11, color: '#94a3b8' }}>
              Planning dates only — no automatic publishing exists.
            </p>
          </CardBody>
        </Card>
      </div>

      <Card style={{ marginTop: 16 }}>
        <CardBody>
          <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>Needs attention</h3>
          {overview.needsAttention.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>Nothing needs attention right now.</p>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 8 }}>
              {overview.needsAttention.map((n, i) => (
                <li key={`${n.kind}-${i}`} style={{ fontSize: 13, display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>
                    <Badge tone={n.kind === 'connection_needs_reauth' ? 'warning' : n.kind === 'retryable_run' ? 'warning' : 'danger'}>
                      {n.kind.replaceAll('_', ' ')}
                    </Badge>{' '}
                    {n.label}
                  </span>
                  {n.publishRunId && (
                    <Button size="sm" variant="ghost" onClick={() => navigate(`/campaigns/${campaignId}/publish-runs/${n.publishRunId}`)}>
                      Inspect
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card style={{ marginTop: 16 }}>
        <CardBody>
          <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>Recent publications</h3>
          {overview.recentPublications.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#64748b' }}>
              <GalleryIcon size={16} /> Nothing published yet — provider-confirmed posts will appear here.
            </div>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 8 }}>
              {overview.recentPublications.map((p) => (
                <li key={p.campaignItemId} style={{ fontSize: 13 }}>
                  <strong>{p.title}</strong> <Badge tone="success" dot>Published</Badge>{' '}
                  <span style={{ color: '#64748b' }}>{p.channel ?? ''}</span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
