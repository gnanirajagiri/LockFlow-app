/**
 * Correction request detail (/corrections/:correctionRequestId).
 *
 * Status badge + append-only event timeline, parent output link, requested
 * change/scope, linked findings, immutable pinned-input summary, advisory
 * escalation recommendation and per-status actions. Submission stays
 * unavailable in this milestone (honest copy) — the Generation boundary is
 * intentionally unwired until a provider supports corrections.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageHeader } from '../../components/layout/PageHeader';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Card, CardBody } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { useToast } from '../../components/ui/Toast';
import { GalleryIcon } from '../../components/icons';
import { getQualityServices } from '../../quality/factory';
import type {
  CorrectionRequestEventRecord,
  CorrectionRequestRecord,
  QualityFindingRecord,
} from '../../quality/types';
import { CORRECTION_SUBMISSION_UNAVAILABLE } from '../../quality/correctionRequestService';
import { CORRECTION_STATUS_TONE, formatDate, statusLabel } from './qualityUi';

type LoadState = 'loading' | 'error' | 'ready';

interface DetailData {
  request: CorrectionRequestRecord;
  events: CorrectionRequestEventRecord[];
  findings: QualityFindingRecord[];
  escalation: { level: string; recommendation: string; occurrenceCount: number } | null;
}

export function CorrectionDetailPage() {
  const { correctionRequestId } = useParams<{ correctionRequestId: string }>();
  const { toast } = useToast();

  const services = useMemo(() => getQualityServices(), []);

  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DetailData | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!correctionRequestId) return;
    setState('loading');
    setError(null);
    try {
      const request = await services.corrections.getCorrectionRequest(correctionRequestId, 'ws_demo');
      const [events, findings, escalation] = await Promise.all([
        services.corrections.listEvents(correctionRequestId, 'ws_demo'),
        services.corrections.listLinkedFindings(correctionRequestId, 'ws_demo'),
        services.corrections.escalationFor(correctionRequestId, 'ws_demo').catch(() => null),
      ]);
      setData({ request, events, findings, escalation });
      setState('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this correction request.');
      setState('error');
    }
  }, [correctionRequestId, services]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await action();
      toast({ title: success, tone: 'success' });
      await load();
    } catch (err) {
      toast({
        title: 'Action failed',
        description: err instanceof Error ? err.message : 'Something went wrong.',
        tone: 'error',
      });
    } finally {
      setBusy(false);
    }
  }

  if (!correctionRequestId || state === 'loading') {
    return (
      <div className="lf-page" aria-busy="true">
        <Skeleton variant="rect" height={56} />
        <Skeleton variant="rect" height={300} />
      </div>
    );
  }

  if (state === 'error' || !data) {
    return (
      <div className="lf-page">
        <EmptyState
          icon={<GalleryIcon size={22} />}
          title="Couldn't load this correction request"
          description={error ?? 'It may not exist in this workspace.'}
          actions={<Link className="lf-btn lf-btn--secondary" to="/corrections">Back to corrections</Link>}
        />
      </div>
    );
  }

  const { request, events, findings, escalation } = data;
  const pins = (request.pinSnapshot.pins ?? []) as Array<Record<string, unknown>>;
  const isActive = request.status === 'submitted' || request.status === 'processing';
  const isEditable = request.status === 'draft';

  return (
    <div className="lf-page">
      <nav className="lf-library__filterreset" aria-label="Breadcrumb">
        <Link to="/corrections">Corrections</Link> / <span aria-current="page">{request.title}</span>
      </nav>

      <PageHeader
        eyebrow="Correction request"
        title={request.title}
        description={`From output ${request.sourceGalleryOutputId} · created ${formatDate(request.createdAt)}`}
        actions={
          <div className="lf-envprofile__actions-row">
            <Badge tone={CORRECTION_STATUS_TONE[request.status]} dot>
              {statusLabel(request.status)}
            </Badge>
            {isEditable ? (
              <>
                <Button
                  variant="primary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const result = await services.corrections.markReady(correctionRequestId, 'ws_demo');
                      if ('blocked' in result && result.blocked) {
                        throw new Error(result.classification.explanation);
                      }
                    }, 'Correction marked ready — snapshots are now immutable')
                  }
                >
                  Mark ready
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void run(() => services.corrections.archive(correctionRequestId, 'ws_demo'), 'Correction archived')}
                >
                  Archive
                </Button>
              </>
            ) : null}
            {request.status === 'ready' ? (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const submitted = await services.corrections.submitCorrection(correctionRequestId, 'ws_demo');
                    if (submitted.status === 'unavailable') {
                      throw new Error(submitted.message);
                    }
                  }, 'Correction submitted')
                }
              >
                Submit correction
              </Button>
            ) : null}
            {request.status === 'archived' ? (
              <Button
                variant="primary"
                disabled={busy}
                onClick={() => void run(() => services.corrections.restore(correctionRequestId, 'ws_demo'), 'Correction restored')}
              >
                Restore
              </Button>
            ) : null}
            {request.status === 'ready' || request.status === 'draft' ? (
              <Button
                variant="danger"
                disabled={busy}
                onClick={() => void run(() => services.corrections.cancel(correctionRequestId, 'ws_demo'), 'Correction cancelled')}
              >
                Cancel
              </Button>
            ) : null}
          </div>
        }
      />

      {request.status === 'ready' ? (
        <div className="lf-library__note" role="status">
          {CORRECTION_SUBMISSION_UNAVAILABLE} Everything else is prepared: the pinned sources and
          snapshots are frozen and will be reused exactly if a provider becomes available.
        </div>
      ) : null}
      {isActive ? (
        <div className="lf-library__note" role="status">
          This correction is with the generation workflow. Status changes appear in the timeline
          below; the request is read-only while active.
        </div>
      ) : null}
      {request.status === 'failed' ? (
        <div className="lf-library__warning" role="alert">
          <strong>Submission failed.</strong> See the timeline for the safe error summary. Retry
          eligibility is evaluated by the existing generation service — no provider details are
          shown here.
        </div>
      ) : null}

      <div className="lf-envlock__layout">
        <div style={{ display: 'grid', gap: 'var(--lf-space-4)', minWidth: 0 }}>
          {/* Request summary ─────────────────────────────────────────────── */}
          <Card>
            <CardBody>
              <h3 className="lf-envpanel__heading">Requested change</h3>
              <p style={{ whiteSpace: 'pre-wrap' }}>{request.requestedChange}</p>
              <dl className="lf-compare__table" style={{ marginTop: 'var(--lf-space-3)' }}>
                {[
                  ['Scope', statusLabel(request.scope)],
                  ['Status', statusLabel(request.status)],
                  ['Parent output', request.sourceGalleryOutputId],
                  ['Source job', request.sourceContentJobRequestId],
                  ['Submitted', formatDate(request.submittedAt)],
                  ['Completed', formatDate(request.completedAt)],
                ].map(([label, value]) => (
                  <div key={label} className="lf-compare__row">
                    <dt className="lf-compare__field">{label}</dt>
                    <dd style={{ margin: 0 }}>
                      {label === 'Parent output' ? (
                        <Link to={`/gallery/${request.sourceGalleryOutputId}`}>{value}</Link>
                      ) : (
                        value
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </CardBody>
          </Card>

          {/* Linked findings ─────────────────────────────────────────────── */}
          <Card>
            <CardBody>
              <h3 className="lf-envpanel__heading">Linked quality findings</h3>
              {findings.length === 0 ? (
                <p className="lf-tile__description">No findings linked to this correction.</p>
              ) : (
                <ul className="lf-envref__list">
                  {findings.map((finding) => (
                    <li key={finding.id} className="lf-envref__item">
                      <span className="lf-envref__row">
                        <strong>{finding.category.replace(/_/g, ' ')}</strong>
                        <Badge tone={finding.result === 'fail' ? 'danger' : 'warning'} dot>
                          {statusLabel(finding.result)}
                        </Badge>
                      </span>
                      {finding.observedNote ? (
                        <span className="lf-tile__meta">observed: {finding.observedNote}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          {/* Event timeline (append-only) ────────────────────────────────── */}
          <Card>
            <CardBody>
              <h3 className="lf-envpanel__heading">Event timeline</h3>
              {events.length === 0 ? (
                <p className="lf-tile__description">No events recorded yet.</p>
              ) : (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--lf-space-2)' }}>
                  {events.map((event) => (
                    <li key={event.id} className="lf-envref__row">
                      <span className="lf-refcard__type">{event.eventType.replace(/_/g, ' ')}</span>
                      <span>
                        {event.message}
                        <span className="lf-tile__meta"> · {formatDate(event.createdAt)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        {/* Immutable inputs + escalation ────────────────────────────────── */}
        <aside className="lf-envlock__missingnote" style={{ display: 'grid', gap: 'var(--lf-space-4)' }}>
          <Card>
            <CardBody>
              <h3 className="lf-envpanel__heading">Immutable pinned inputs</h3>
              <p className="lf-tile__description">
                Frozen when the request left draft — later source changes never alter it. No newer
                versions can be substituted.
              </p>
              <ul className="lf-envref__list">
                {pins.map((pin, index) => (
                  <li key={`${pin.source_version_id ?? index}`} className="lf-envref__item">
                    <span className="lf-refcard__type">{String(pin.pin_type ?? 'pin').replace(/_/g, ' ')}</span>
                    <span className="lf-envref__row">
                      <strong>{String(pin.label ?? pin.source_version_id)}</strong>
                      <Badge tone="locked">Exact version</Badge>
                    </span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>

          {escalation ? (
            <Card>
              <CardBody>
                <h3 className="lf-envpanel__heading">Recurring-issue recommendation</h3>
                <p className="lf-tile__description">
                  {escalation.recommendation}
                  <span className="lf-tile__meta"> · seen {escalation.occurrenceCount}× in this workspace context</span>
                </p>
                <p className="lf-lockedbanner__copy">
                  Recommendations are advisory only — nothing changes providers, prompts or source
                  versions automatically.
                </p>
              </CardBody>
            </Card>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
