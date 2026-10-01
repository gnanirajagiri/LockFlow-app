/**
 * Publishing Review (/campaigns/:campaignId/publishing-review).
 *
 * Server-side eligibility for every item, structured blockers, an explicit
 * confirm step, and the honest run timeline. No auto-publish: submission
 * happens only when the user confirms — dates on the calendar never do.
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { PageHeader } from '../../components/layout/PageHeader';
import { Card, CardBody } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { useToast } from '../../components/ui/Toast';
import { GalleryIcon } from '../../components/icons';
import type { CampaignContextValue } from '../campaigns/CampaignLayout';
import { SEED_GALLERY_WORKSPACE_ID } from '../../mock/gallerySeed';
import type {
  PublishRunRecord,
  PublishingReviewBlocker,
  PublishingReviewReport,
} from '../../domain/publishingReview';
import {
  REVIEW_BLOCKER_LABELS,
  REVIEW_RUN_STATUS_LABELS,
  REVIEW_RUN_STATUS_TONES,
} from './publishingReviewUi';
import { usePublishingReviewService } from './usePublishingReviewService';

const USER_ID = 'demo-user';

type LoadState = 'loading' | 'error' | 'ready';

export function PublishingReviewPage() {
  const { campaignItemId } = useParams<{ campaignItemId: string }>();
  const { campaign } = useOutletContext<CampaignContextValue>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const review = usePublishingReviewService();

  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<PublishingReviewReport | null>(null);
  const [runs, setRuns] = useState<PublishRunRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [createdRunId, setCreatedRunId] = useState<string | null>(null);
  const [lastOutcome, setLastOutcome] = useState<string | null>(null);

  const runReview = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const detail = await review.listRunsForItem(campaignItemId ?? '', SEED_GALLERY_WORKSPACE_ID);
      setRuns(detail);
      // The review target item comes from the route (?item= fallback first item).
      const params = new URLSearchParams(window.location.search);
      const itemId = params.get('item');
      if (!itemId) {
        setState('ready');
        setReport(null);
        return;
      }
      const itemRuns = await review.listAuditEvents(SEED_GALLERY_WORKSPACE_ID, { campaignItemId: itemId });
      void itemRuns;
      const itemReport = await review.createPublishingReview(
        {
          campaignId: campaign.id,
          items: [{ campaignItemId: itemId, placement: defaultPlacementFor(itemId), acknowledgement: true }],
        },
        SEED_GALLERY_WORKSPACE_ID,
        USER_ID,
      );
      setReport(itemReport);
      setState('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not run the publishing review.');
      setState('error');
    }
  }, [campaign.id, campaignItemId, review]);

  useEffect(() => {
    void runReview();
  }, [runReview]);

  const item = report?.items[0] ?? null;

  async function handleConfirm() {
    if (!item) return;
    setBusy(true);
    try {
      const run = await review.createPublishSubmission(
        {
          campaignId: campaign.id,
          campaignItemId: item.campaignItemId,
          placement: item.eligibility.inputs.placement ?? defaultPlacementFor(item.campaignItemId),
          acknowledgement: true,
        },
        SEED_GALLERY_WORKSPACE_ID,
        USER_ID,
      );
      setCreatedRunId(run.id);
      setConfirmed(true);
      toast({ title: 'Review confirmed — publish run created.', tone: 'success' });
      setRuns(await review.listRunsForItem(item.campaignItemId, SEED_GALLERY_WORKSPACE_ID));
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Could not confirm the review.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit() {
    if (!createdRunId) return;
    setBusy(true);
    try {
      const result = await review.submitPublishRun(
        createdRunId,
        { capabilities: { placements: ['image_post', 'video_post'] } },
        SEED_GALLERY_WORKSPACE_ID,
        USER_ID,
      );
      setLastOutcome(result.outcome);
      toast({
        title:
          result.outcome === 'failed'
            ? result.errorMessageSafe ?? 'The submission failed.'
            : result.outcome === 'published'
              ? 'Published — provider confirmed (mock provider).'
              : 'Submission accepted by the provider (mock provider).',
        tone: result.outcome === 'failed' ? 'error' : 'success',
      });
      setRuns(await review.listRunsForItem(item?.campaignItemId ?? '', SEED_GALLERY_WORKSPACE_ID));
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Could not submit.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function handleRetry(runId: string) {
    setBusy(true);
    try {
      const retry = await review.retryPublishRun(runId, SEED_GALLERY_WORKSPACE_ID, USER_ID);
      setCreatedRunId(retry.id);
      setLastOutcome(null);
      toast({ title: `Retry created as attempt ${retry.attemptNumber}.`, tone: 'success' });
      setRuns(await review.listRunsForItem(item?.campaignItemId ?? '', SEED_GALLERY_WORKSPACE_ID));
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Could not retry.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  if (state === 'loading') {
    return <EmptyState icon={<GalleryIcon size={22} />} title="Running publishing review…" description="One moment." />;
  }
  if (state === 'error') {
    return (
      <EmptyState
        icon={<GalleryIcon size={22} />}
        title="Could not run the review"
        description={error ?? undefined}
        actions={<Button onClick={() => void runReview()}>Try again</Button>}
      />
    );
  }
  if (!report || !item) {
    return (
      <EmptyState
        icon={<GalleryIcon size={22} />}
        title="Pick an item to review"
        description="Open this page from a campaign content item, e.g. ?item=citem_serum_video."
        actions={<Button onClick={() => navigate(`/campaigns/${campaign.id}/content`)}>Open content</Button>}
      />
    );
  }

  const eligible = item.eligibility.eligible;

  return (
    <div>
      <PageHeader
        title="Publishing review"
        description="Server-checked eligibility for this campaign item. Nothing publishes until you confirm and submit."
        actions={
          <Button variant="ghost" onClick={() => navigate(`/campaigns/${campaign.id}/content`)}>
            Back to content
          </Button>
        }
      />

      <Card>
        <CardBody>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
            <div>
              <Badge tone={eligible ? 'success' : 'warning'}>
                {eligible ? 'Eligible for publishing' : 'Blocked'}
              </Badge>
              <p style={{ margin: '8px 0 0', fontSize: 13, color: '#64748b' }}>
                Item <code>{item.campaignItemId}</code> · checked {new Date(item.eligibility.checkedAt).toLocaleTimeString()}
              </p>
            </div>
            <Button variant="primary" disabled={!eligible || busy} onClick={handleConfirm}>
              {confirmed ? 'Review confirmed' : 'Confirm review'}
            </Button>
          </div>

          {item.eligibility.blockers.length > 0 && (
            <ul style={{ margin: '14px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 8 }}>
              {item.eligibility.blockers.map((b: PublishingReviewBlocker, idx: number) => (
                <li key={`${b.code}-${idx}`} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                  <Badge tone="warning">{REVIEW_BLOCKER_LABELS[b.code]}</Badge>
                  <span style={{ fontSize: 13 }}>{b.messageSafe}</span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {runs.length > 0 && (
        <Card style={{ marginTop: 16 }}>
          <CardBody>
            <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>Publish runs</h3>
            <div style={{ display: 'grid', gap: 10 }}>
              {runs.map((run) => (
                <div key={run.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', borderTop: '1px solid #e2e8f0', paddingTop: 10 }}>
                  <div>
                    <Badge tone={REVIEW_RUN_STATUS_TONES[run.status]}>
                      Attempt {run.attemptNumber} · {REVIEW_RUN_STATUS_LABELS[run.status]}
                    </Badge>
                    <p style={{ margin: '6px 0 0', fontSize: 12, color: '#64748b' }}>
                      {run.placement} · {run.requestSnapshot.providerKey} (mock) · {new Date(run.createdAt).toLocaleTimeString()}
                    </p>
                    {run.errorMessageSafe && (
                      <p style={{ margin: '6px 0 0', fontSize: 13, color: '#b91c1c' }}>{run.errorMessageSafe}</p>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {(run.status === 'pending' || run.status === 'validated') && run.id === createdRunId && (
                      <Button variant="primary" disabled={busy} onClick={handleSubmit}>
                        Submit now
                      </Button>
                    )}
                    {run.status === 'failed' && (
                      <Button disabled={busy} onClick={() => void handleRetry(run.id)}>
                        Retry (new attempt)
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {lastOutcome && (
              <p style={{ margin: '10px 0 0', fontSize: 12, color: '#64748b' }}>
                Last outcome: <strong>{lastOutcome}</strong> — dev fake provider results are simulations, never live posts.
              </p>
            )}
          </CardBody>
        </Card>
      )}

      <AuditTimeline campaignItemId={item.campaignItemId} refreshKey={runs.length} review={review} />
    </div>
  );
}

function AuditTimeline(props: {
  campaignItemId: string;
  refreshKey: number;
  review: ReturnType<typeof usePublishingReviewService>;
}) {
  const { campaignItemId, refreshKey, review } = props;
  const [events, setEvents] = useState<Array<{ id: string; eventType: string; message: string; createdAt: string }>>([]);
  useEffect(() => {
    let alive = true;
    review.listAuditEvents(SEED_GALLERY_WORKSPACE_ID, { campaignItemId }).then((rows) => {
      if (alive) setEvents(rows.slice(0, 12));
    }).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [campaignItemId, refreshKey, review]);
  if (!events.length) return null;
  return (
    <Card style={{ marginTop: 16 }}>
      <CardBody>
        <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>Audit trail</h3>
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
          {events.map((e) => (
            <li key={e.id} style={{ fontSize: 13 }}>
              <code style={{ fontSize: 11 }}>{e.eventType}</code> — {e.message}
              <span style={{ color: '#94a3b8', fontSize: 11 }}> · {new Date(e.createdAt).toLocaleTimeString()}</span>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

function defaultPlacementFor(campaignItemId: string): 'image_post' | 'video_post' {
  return campaignItemId.includes('video') ? 'video_post' : 'image_post';
}
