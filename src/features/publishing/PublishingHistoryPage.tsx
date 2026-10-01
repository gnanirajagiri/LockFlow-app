/**
 * Publishing History (/campaigns/:campaignId/publishing-history).
 *
 * Paginated/filterable table of publish runs with safe actions. Mock/dev
 * outcomes are clearly labelled; live results are distinguished by the
 * provider's devOnly flag. Raw provider data never appears here.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../../components/layout/PageHeader';
import { Card, CardBody } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { useToast } from '../../components/ui/Toast';
import { GalleryIcon } from '../../components/icons';
import type { CampaignContextValue } from '../campaigns/CampaignLayout';
import { SEED_GALLERY_WORKSPACE_ID } from '../../mock/gallerySeed';
import type { PublishRunRecord, PublishingReviewRunStatus } from '../../domain/publishingReview';
import type { CalendarPublishingState, PublishFailureCategory } from '../../domain/publishingOps';
import { FAILURE_LABELS, OPS_STATE_LABELS, OPS_STATE_TONES, formatDateTime } from './opsUi';
import { usePublishingOpsService } from './usePublishingOpsService';
import { getPublishingReviewRepository } from '../../data/publishingReviewFactory';

/** Maps a run status onto the unified display state. */
function runState(run: PublishRunRecord): CalendarPublishingState {
  switch (run.status) {
    case 'pending':
    case 'validated':
      return 'queued';
    case 'submitted':
      return 'submitting';
    case 'accepted':
      return 'submitted';
    case 'published':
      return 'published';
    case 'failed':
      return run.isRetryable ? 'retry_required' : 'failed';
    case 'cancelled':
      return 'cancelled';
  }
}

const USER_ID = 'demo-user';
const PAGE_SIZE = 20;

const RUN_STATE_FILTERS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'All states' },
  { value: 'pending', label: 'Queued' },
  { value: 'validated', label: 'Validated' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'published', label: 'Published' },
  { value: 'failed', label: 'Failed' },
  { value: 'cancelled', label: 'Cancelled' },
];

export function PublishingHistoryPage() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const { campaign } = useOutletContext<CampaignContextValue>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [params] = useSearchParams();
  const ops = usePublishingOpsService();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState<PublishRunRecord[]>([]);
  const [itemTitles, setItemTitles] = useState<Record<string, string>>({});
  const [stateFilter, setStateFilter] = useState(params.get('state') ?? 'all');
  const [failureFilter, setFailureFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [busyRunId, setBusyRunId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!campaignId) return;
    setLoading(true);
    setError(null);
    try {
      const rows = await getPublishingReviewRepository().listPublishRuns(SEED_GALLERY_WORKSPACE_ID, { campaignId });
      setRuns(rows);
      const timeline = await ops.getCampaignPublishingTimeline(SEED_GALLERY_WORKSPACE_ID, campaignId);
      const titles: Record<string, string> = {};
      for (const e of timeline.entries) titles[e.campaignItemId] = e.title;
      setItemTitles(titles);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load publishing history.');
    } finally {
      setLoading(false);
    }
  }, [ops, campaignId]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    let rows = runs;
    if (stateFilter !== 'all') rows = rows.filter((r) => r.status === (stateFilter as PublishingReviewRunStatus));
    if (failureFilter !== 'all') rows = rows.filter((r) => (r.failureCategory ?? '') === failureFilter);
    return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }, [runs, stateFilter, failureFilter]);

  const failureCategories = useMemo(
    () => [...new Set(runs.map((r) => r.failureCategory).filter(Boolean))] as PublishFailureCategory[],
    [runs],
  );

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  async function handleRefresh(runId: string) {
    setBusyRunId(runId);
    try {
      const result = await ops.refreshPublishRunStatus(SEED_GALLERY_WORKSPACE_ID, runId, { actorId: USER_ID, force: true });
      toast({
        title: result.reason === 'reauth_required'
          ? result.safeMessage
          : result.changed
            ? result.safeMessage
            : `No change: ${result.safeMessage}`,
        tone: result.reason === 'reauth_required' ? 'warning' : result.changed ? 'success' : 'info',
      });
      await load();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Could not refresh.', tone: 'error' });
    } finally {
      setBusyRunId(null);
    }
  }

  async function handleRetry(run: PublishRunRecord) {
    setBusyRunId(run.id);
    try {
      const options = await ops.getRetryOptions(SEED_GALLERY_WORKSPACE_ID, run.id);
      if (!options.allowed) {
        toast({ title: options.reason ?? 'Retry is not allowed for this run.', tone: 'warning' });
        return;
      }
      if (options.requiresReconnect) {
        toast({ title: 'Reconnect the account first, then retry.', tone: 'warning' });
        navigate('/settings/connections');
        return;
      }
      toast({ title: `Retry will create attempt #${options.nextAttemptNumber} as a NEW run.`, tone: 'info' });
      navigate(`/campaigns/${campaignId}/publishing-review?item=${run.campaignItemId}`);
    } finally {
      setBusyRunId(null);
    }
  }

  if (loading) {
    return (
      <div>
        <PageHeader title="Publishing history" description="Every publish run for this campaign." />
        <Skeleton height={280} />
      </div>
    );
  }
  if (error) {
    return (
      <EmptyState icon={<GalleryIcon size={22} />} title="Could not load history" description={error} actions={<Button onClick={() => void load()}>Try again</Button>} />
    );
  }

  return (
    <div>
      <PageHeader
        title="Publishing history"
        description={`Every publish run for ${campaign.name}. Retries appear as separate attempts.`}
        actions={
          <Button variant="ghost" onClick={() => navigate(`/campaigns/${campaignId}/status`)}>
            Status overview
          </Button>
        }
      />

      <Card>
        <CardBody>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select className="lf-input" value={stateFilter} onChange={(e) => { setStateFilter(e.target.value); setPage(0); }} aria-label="Filter by state" style={{ maxWidth: 160 }}>
              {RUN_STATE_FILTERS.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
            <select className="lf-input" value={failureFilter} onChange={(e) => { setFailureFilter(e.target.value); setPage(0); }} aria-label="Filter by failure category" style={{ maxWidth: 220 }}>
              <option value="all">All failure categories</option>
              {failureCategories.map((c) => (
                <option key={c} value={c}>{FAILURE_LABELS[c] ?? c}</option>
              ))}
            </select>
            <span style={{ fontSize: 12, color: '#64748b', alignSelf: 'center' }}>
              {filtered.length} run{filtered.length === 1 ? '' : 's'}
            </span>
          </div>
        </CardBody>
      </Card>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<GalleryIcon size={22} />}
          title="No publish runs yet"
          description="Runs appear here after a review is confirmed and submitted."
          actions={<Button onClick={() => navigate(`/campaigns/${campaignId}/publishing-review`)}>Open publishing review</Button>}
        />
      ) : (
        <Card style={{ marginTop: 16 }}>
          <CardBody>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: '#64748b' }}>
                    <th style={{ padding: '6px 8px' }}>Item</th>
                    <th style={{ padding: '6px 8px' }}>Account</th>
                    <th style={{ padding: '6px 8px' }}>Placement</th>
                    <th style={{ padding: '6px 8px' }}>Attempt</th>
                    <th style={{ padding: '6px 8px' }}>Created</th>
                    <th style={{ padding: '6px 8px' }}>Status</th>
                    <th style={{ padding: '6px 8px' }}>Last checked</th>
                    <th style={{ padding: '6px 8px' }}>Outcome</th>
                    <th style={{ padding: '6px 8px' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((run) => {
                    const state = runState(run);
                    return (
                      <tr key={run.id} style={{ borderTop: '1px solid #e2e8f0' }}>
                        <td style={{ padding: '8px' }}>{itemTitles[run.campaignItemId] ?? run.campaignItemId}</td>
                        <td style={{ padding: '8px' }}>{run.requestSnapshot.providerKey}{run.requestSnapshot.providerKey === 'dev_fake' ? ' (mock)' : ''}</td>
                        <td style={{ padding: '8px' }}>{run.placement}</td>
                        <td style={{ padding: '8px' }}>#{run.attemptNumber}</td>
                        <td style={{ padding: '8px' }}>{formatDateTime(run.createdAt)}</td>
                        <td style={{ padding: '8px' }}>
                          <Badge tone={OPS_STATE_TONES[state]} dot>{OPS_STATE_LABELS[state]}</Badge>
                        </td>
                        <td style={{ padding: '8px' }}>{formatDateTime(run.lastStatusCheckedAt)}</td>
                        <td style={{ padding: '8px' }}>
                          {run.status === 'failed'
                            ? FAILURE_LABELS[(run.failureCategory as PublishFailureCategory) ?? 'UNKNOWN_FINAL'] ?? run.errorCode
                            : run.status === 'published'
                              ? 'Published — provider confirmed'
                              : '—'}
                        </td>
                        <td style={{ padding: '8px' }}>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            <Button size="sm" variant="ghost" onClick={() => navigate(`/campaigns/${campaignId}/publish-runs/${run.id}`)}>
                              Details
                            </Button>
                            {(run.status === 'submitted' || run.status === 'accepted') && (
                              <Button size="sm" disabled={busyRunId === run.id} onClick={() => void handleRefresh(run.id)}>
                                Refresh status
                              </Button>
                            )}
                            {run.status === 'failed' && (
                              <Button size="sm" disabled={busyRunId === run.id} onClick={() => void handleRetry(run)}>
                                Retry
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {pageCount > 1 && (
              <div className="lf-dialogactions" style={{ justifyContent: 'space-between', marginTop: 12 }}>
                <Button size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>← Newer</Button>
                <span style={{ fontSize: 12, color: '#64748b' }}>Page {page + 1} of {pageCount}</span>
                <Button size="sm" disabled={page >= pageCount - 1} onClick={() => setPage((p) => p + 1)}>Older →</Button>
              </div>
            )}
            <p style={{ margin: '12px 0 0', fontSize: 12, color: '#64748b' }}>
              Runs from the development fake provider are simulations and are labelled as such — they are never live posts.
            </p>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
