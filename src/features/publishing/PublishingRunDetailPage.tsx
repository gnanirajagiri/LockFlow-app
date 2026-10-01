/**
 * Publish run detail (/campaigns/:campaignId/publishing-review/:campaignItemId?run=…).
 *
 * Read-only run view: lifecycle status, immutable request/validation
 * snapshots and safe fields only. Retries create a NEW run — this page
 * never mutates a failed run.
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../../components/layout/PageHeader';
import { Card, CardBody } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { useToast } from '../../components/ui/Toast';
import { GalleryIcon } from '../../components/icons';
import { SEED_GALLERY_WORKSPACE_ID } from '../../mock/gallerySeed';
import type { PublishRunRecord } from '../../domain/publishingReview';
import { REVIEW_RUN_STATUS_LABELS, REVIEW_RUN_STATUS_TONES } from './publishingReviewUi';
import { usePublishingReviewService } from './usePublishingReviewService';

const USER_ID = 'demo-user';

export function PublishingRunDetailPage() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const [params] = useSearchParams();
  const runId = params.get('run') ?? '';
  const navigate = useNavigate();
  const { toast } = useToast();
  const review = usePublishingReviewService();
  const [run, setRun] = useState<PublishRunRecord | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!runId) {
      setMissing(true);
      return;
    }
    try {
      const status = await review.getPublishRunStatus(runId, SEED_GALLERY_WORKSPACE_ID);
      setRun(status.run);
    } catch {
      setMissing(true);
    }
  }, [review, runId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleRetry() {
    if (!run) return;
    setBusy(true);
    try {
      const retry = await review.retryPublishRun(run.id, SEED_GALLERY_WORKSPACE_ID, USER_ID);
      toast({ title: `Retry created as attempt ${retry.attemptNumber}.`, tone: 'success' });
      navigate(`../publishing-review?item=${run.campaignItemId}&run=${retry.id}`);
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Could not retry.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  if (missing || !run) {
    return (
      <EmptyState
        icon={<GalleryIcon size={22} />}
        title="Publish run not found"
        description="The run id is missing or belongs to another workspace."
        actions={<Button onClick={() => navigate(`/campaigns/${campaignId}/publishing-review`)}>Back to review</Button>}
      />
    );
  }

  return (
    <div>
      <PageHeader
        title={`Publish run #${run.attemptNumber}`}
        description="Snapshots are frozen at creation; retries create a new run."
        actions={
          <Button variant="ghost" onClick={() => navigate(`/campaigns/${campaignId}/publishing-review?item=${run.campaignItemId}`)}>
            Back to review
          </Button>
        }
      />
      <Card>
        <CardBody>
          <Badge tone={REVIEW_RUN_STATUS_TONES[run.status]}>{REVIEW_RUN_STATUS_LABELS[run.status]}</Badge>
          <dl style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: '6px 12px', marginTop: 14, fontSize: 13 }}>
            <dt>Run id</dt><dd style={{ margin: 0 }}><code>{run.id}</code></dd>
            <dt>Placement</dt><dd style={{ margin: 0 }}>{run.placement}</dd>
            <dt>Provider</dt><dd style={{ margin: 0 }}>{run.requestSnapshot.providerKey} (development mock)</dd>
            <dt>Idempotency</dt><dd style={{ margin: 0 }}><code>{run.idempotencyKey}</code></dd>
            <dt>Created</dt><dd style={{ margin: 0 }}>{new Date(run.createdAt).toLocaleString()}</dd>
            {run.startedAt && (<><dt>Started</dt><dd style={{ margin: 0 }}>{new Date(run.startedAt).toLocaleString()}</dd></>)}
            {run.completedAt && (<><dt>Completed</dt><dd style={{ margin: 0 }}>{new Date(run.completedAt).toLocaleString()}</dd></>)}
            {run.publishedUrl && (<><dt>Published URL</dt><dd style={{ margin: 0 }}><code>{run.publishedUrl}</code> (simulated)</dd></>)}
            {run.errorCode && (<><dt>Error code</dt><dd style={{ margin: 0 }}><code>{run.errorCode}</code></dd></>)}
            {run.errorMessageSafe && (<><dt>Error</dt><dd style={{ margin: 0, color: '#b91c1c' }}>{run.errorMessageSafe}</dd></>)}
          </dl>
          {run.validationSnapshot && run.validationSnapshot.blockers.length > 0 && (
            <>
              <h4 style={{ margin: '16px 0 6px', fontSize: 13 }}>Validation snapshot (at creation)</h4>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                {run.validationSnapshot.blockers.map((b, i) => (
                  <li key={i}><code>{b.code}</code> — {b.messageSafe}</li>
                ))}
              </ul>
            </>
          )}
          {run.status === 'failed' && (
            <div style={{ marginTop: 16 }}>
              <Button variant="primary" disabled={busy} onClick={handleRetry}>
                Retry as new attempt
              </Button>
              <p style={{ margin: '8px 0 0', fontSize: 12, color: '#64748b' }}>
                The failed run stays as-is for audit; a retry is a fresh run with a fresh idempotency key.
              </p>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
