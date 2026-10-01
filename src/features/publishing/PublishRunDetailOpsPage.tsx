/**
 * Publish Run Detail (/campaigns/:campaignId/publish-runs/:publishRunId).
 *
 * The full lifecycle view of one publish run: status timeline, immutable
 * request/validation snapshot summaries (no secrets), safe failure
 * explanation, retry guidance and the audit trail. Snapshots are read-only
 * by contract; retries link to separate runs.
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '../../components/layout/PageHeader';
import { Card, CardBody } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { useToast } from '../../components/ui/Toast';
import { GalleryIcon } from '../../components/icons';
import { SEED_GALLERY_WORKSPACE_ID } from '../../mock/gallerySeed';
import type { PublishRunDetail } from '../../domain/publishingOps';
import type { PublishFailureCategory } from '../../domain/publishingOps';
import { FAILURE_LABELS, formatDateTime } from './opsUi';
import { usePublishingOpsService } from './usePublishingOpsService';

const USER_ID = 'demo-user';

const TIMELINE_STEPS: Array<{ key: string; label: string }> = [
  { key: 'created', label: 'Created' },
  { key: 'validated', label: 'Validated' },
  { key: 'queued', label: 'Queued' },
  { key: 'submitted', label: 'Submitted' },
  { key: 'provider', label: 'Provider update' },
  { key: 'terminal', label: 'Final result' },
];

export function PublishRunDetailOpsPage() {
  const { campaignId, publishRunId } = useParams<{ campaignId: string; publishRunId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const ops = usePublishingOpsService();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<PublishRunDetail | null>(null);
  const [retryOptions, setRetryOptions] = useState<Awaited<ReturnType<typeof ops.getRetryOptions>> | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!publishRunId) return;
    setLoading(true);
    setError(null);
    try {
      const d = await ops.getPublishRunDetail(SEED_GALLERY_WORKSPACE_ID, publishRunId);
      setDetail(d);
      setRetryOptions(await ops.getRetryOptions(SEED_GALLERY_WORKSPACE_ID, publishRunId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this publish run.');
    } finally {
      setLoading(false);
    }
  }, [ops, publishRunId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleRefresh() {
    if (!publishRunId) return;
    setBusy(true);
    try {
      const result = await ops.refreshPublishRunStatus(SEED_GALLERY_WORKSPACE_ID, publishRunId, { actorId: USER_ID, force: true });
      toast({
        title: result.reason === 'reauth_required' ? result.safeMessage : result.changed ? result.safeMessage : `No change: ${result.safeMessage}`,
        tone: result.reason === 'reauth_required' ? 'warning' : result.changed ? 'success' : 'info',
      });
      await load();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Could not refresh.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  function handleRetryNav() {
    if (!detail) return;
    navigate(`/campaigns/${campaignId}/publishing-review?item=${detail.run.campaignItemId}`);
  }

  if (loading) {
    return (
      <div>
        <PageHeader title="Publish run" description="Loading run detail…" />
        <Skeleton height={280} />
      </div>
    );
  }
  if (error || !detail) {
    return (
      <EmptyState
        icon={<GalleryIcon size={22} />}
        title="Publish run not available"
        description={error ?? 'The run id is missing or belongs to another workspace.'}
        actions={<Button onClick={() => navigate(`/campaigns/${campaignId}/publishing-history`)}>Back to history</Button>}
      />
    );
  }

  const { run } = detail;
  const reached = new Set<string>(['created']);
  if (run.validationSnapshot) reached.add('validated');
  if (['validated', 'submitted', 'accepted', 'published', 'failed'].includes(run.status)) reached.add('queued');
  if (['submitted', 'accepted', 'published', 'failed'].includes(run.status)) reached.add('submitted');
  if (['accepted', 'published', 'failed'].includes(run.status)) reached.add('provider');
  if (['published', 'failed'].includes(run.status)) reached.add('terminal');

  return (
    <div>
      <PageHeader
        title={`Publish run — attempt #${run.attemptNumber}`}
        description="Snapshots are frozen at creation. Retry always creates a new, separate attempt."
        actions={
          <Button variant="ghost" onClick={() => navigate(`/campaigns/${campaignId}/publishing-history`)}>
            Back to history
          </Button>
        }
      />

      <Card>
        <CardBody>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Badge tone={run.status === 'published' ? 'success' : run.status === 'failed' ? 'danger' : 'info'} dot>
              {run.status}
            </Badge>
            {detail.mockProvider && <Badge tone="warning">Mock provider — simulated</Badge>}
            {detail.failureCategory && <Badge tone="danger">{FAILURE_LABELS[detail.failureCategory as PublishFailureCategory]}</Badge>}
            {detail.connectionStatus === 'needs_reauth' && <Badge tone="warning">Account needs reconnection</Badge>}
          </div>

          {/* Status timeline */}
          <ol style={{ display: 'flex', gap: 6, flexWrap: 'wrap', listStyle: 'none', padding: 0, marginTop: 14, fontSize: 12 }}>
            {TIMELINE_STEPS.map((step) => (
              <li
                key={step.key}
                style={{
                  padding: '4px 10px',
                  borderRadius: 999,
                  border: `1px solid ${reached.has(step.key) ? '#2563eb' : '#e2e8f0'}`,
                  color: reached.has(step.key) ? '#2563eb' : '#94a3b8',
                }}
              >
                {step.label}
              </li>
            ))}
          </ol>

          <dl style={{ display: 'grid', gridTemplateColumns: '170px 1fr', gap: '6px 12px', marginTop: 14, fontSize: 13 }}>
            <dt>Run id</dt><dd style={{ margin: 0 }}><code>{run.id}</code></dd>
            <dt>Idempotency key</dt><dd style={{ margin: 0 }}><code>{run.idempotencyKey}</code></dd>
            <dt>Provider / account</dt><dd style={{ margin: 0 }}>{run.requestSnapshot.providerKey}{detail.mockProvider ? ' (development mock)' : ''} · {run.placement}</dd>
            <dt>Copy (frozen)</dt>
            <dd style={{ margin: 0 }}>
              {typeof run.requestSnapshot.copy?.caption === 'string' && run.requestSnapshot.copy.caption
                ? `${String(run.requestSnapshot.copy.caption).slice(0, 140)}${String(run.requestSnapshot.copy.caption).length > 140 ? '…' : ''}`
                : '—'}
            </dd>
            <dt>Created</dt><dd style={{ margin: 0 }}>{formatDateTime(run.createdAt)}</dd>
            <dt>Started / completed</dt><dd style={{ margin: 0 }}>{formatDateTime(run.startedAt)} → {formatDateTime(run.completedAt)}</dd>
            {run.providerPublishId && (<><dt>Provider publish id</dt><dd style={{ margin: 0 }}><code>{run.providerPublishId}</code></dd></>)}
            {detail.publishedUrl && (<><dt>Permalink</dt><dd style={{ margin: 0 }}><code>{detail.publishedUrl}</code>{detail.mockProvider ? ' (simulated)' : ''}</dd></>)}
            <dt>Last status check</dt><dd style={{ margin: 0 }}>{formatDateTime(run.lastStatusCheckedAt)}</dd>
          </dl>

          {detail.failureCategory && (
            <div style={{ marginTop: 12, padding: 12, background: '#fef2f2', borderRadius: 8 }}>
              <strong style={{ fontSize: 13 }}>What happened</strong>
              <p style={{ margin: '6px 0 0', fontSize: 13 }}>{detail.failureExplanation}</p>
              {run.errorMessageSafe && <p style={{ margin: '6px 0 0', fontSize: 12, color: '#7f1d1d' }}>{run.errorMessageSafe}</p>}
            </div>
          )}

          {run.validationSnapshot && run.validationSnapshot.blockers.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <strong style={{ fontSize: 13 }}>Validation snapshot (at creation)</strong>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 13 }}>
                {run.validationSnapshot.blockers.map((b, i) => (
                  <li key={i}><code>{b.code}</code> — {b.messageSafe}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Retry guidance */}
          <div style={{ marginTop: 16, borderTop: '1px solid #e2e8f0', paddingTop: 12 }}>
            {retryOptions?.allowed ? (
              <>
                <p style={{ margin: '0 0 8px', fontSize: 13 }}>
                  Retry will create <strong>attempt #{retryOptions.nextAttemptNumber}</strong> as a NEW publish run with a new
                  idempotency key. This run stays as-is for the audit record.
                </p>
                {retryOptions.requiresReconnect && (
                  <p style={{ margin: '0 0 8px', fontSize: 13, color: '#b45309' }}>
                    Reconnect the account first — the retry will then be allowed.
                  </p>
                )}
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button variant="primary" disabled={busy} onClick={handleRetryNav}>Start retry from review</Button>
                  {(run.status === 'submitted' || run.status === 'accepted') && (
                    <Button disabled={busy} onClick={() => void handleRefresh()}>Refresh status</Button>
                  )}
                  {detail.retryRunId && (
                    <Button variant="ghost" onClick={() => navigate(`/campaigns/${campaignId}/publish-runs/${detail.retryRunId}`)}>
                      Open retry run →
                    </Button>
                  )}
                  {detail.originalRunId && (
                    <Button variant="ghost" onClick={() => navigate(`/campaigns/${campaignId}/publish-runs/${detail.originalRunId}`)}>
                      ← Original run
                    </Button>
                  )}
                </div>
              </>
            ) : (
              <p style={{ margin: 0, fontSize: 13 }}>{retryOptions?.reason ?? 'Retry options are unavailable for this run.'}</p>
            )}
          </div>
        </CardBody>
      </Card>

      {/* Audit trail */}
      <Card style={{ marginTop: 16 }}>
        <CardBody>
          <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>Audit trail</h3>
          {detail.auditEvents.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>No events recorded for this run yet.</p>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
              {detail.auditEvents.map((e) => (
                <li key={e.id} style={{ fontSize: 13 }}>
                  <code style={{ fontSize: 11 }}>{e.eventType}</code> — {e.message}
                  <span style={{ color: '#94a3b8', fontSize: 11 }}> · {formatDateTime(e.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
