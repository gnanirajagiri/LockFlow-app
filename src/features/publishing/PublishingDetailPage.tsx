/**
 * Publishing draft detail (/publishing/:publishingDraftId).
 *
 * Publish-now exists ONLY here (ready + validated + acknowledged), behind
 * the mandated confirmation dialog. Submitting/processing drafts are
 * view-only; published drafts are immutable with a duplicate action.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '../../components/layout/PageHeader';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { useToast } from '../../components/ui/Toast';
import { GalleryIcon } from '../../components/icons';
import { SEED_GALLERY_WORKSPACE_ID } from '../../mock/gallerySeed';
import type { SafePublishingDraftView } from '../../domain/publishing';
import type { PublishingDraftEventRecord } from '../../domain/publishing';
import {
  PUBLISHING_STATUS_LABELS,
  PUBLISHING_STATUS_TONES,
  PUBLISHING_PLACEMENT_LABELS,
  formatPublishedAt,
  isDraftEditable,
} from './publishingUi';
import { usePublishingService } from './usePublishingService';

type LoadState = 'loading' | 'error' | 'ready';

export function PublishingDetailPage() {
  const { publishingDraftId = '' } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const publishing = usePublishingService();

  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<SafePublishingDraftView | null>(null);
  const [events, setEvents] = useState<PublishingDraftEventRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editCaption, setEditCaption] = useState('');
  const [editAlt, setEditAlt] = useState('');

  const load = useCallback(async () => {
    setState('loading');
    try {
      const [view, eventRows] = await Promise.all([
        publishing.getDraftView(publishingDraftId, SEED_GALLERY_WORKSPACE_ID),
        publishing.listEvents(publishingDraftId, SEED_GALLERY_WORKSPACE_ID),
      ]);
      setDraft(view);
      setEvents(eventRows);
      setState('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the draft.');
      setState('error');
    }
  }, [publishing, publishingDraftId]);

  useEffect(() => {
    void load();
  }, [load]);

  const editable = draft ? isDraftEditable(draft.status) : false;

  async function run(action: () => Promise<unknown>, successMessage: string) {
    setBusy(true);
    try {
      await action();
      toast({ title: successMessage, tone: 'success' });
      await load();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Action failed.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  if (state === 'loading') {
    return <div className="lf-page"><Skeleton height={260} /></div>;
  }
  if (state === 'error' || !draft) {
    return (
      <div className="lf-page">
        <EmptyState
          icon={<GalleryIcon size={22} />}
          title="Could not load the publishing draft"
          description={error ?? 'It may have been archived or may belong to another workspace.'}
          actions={<Button onClick={() => navigate('/publishing')}>Back to Publishing</Button>}
        />
      </div>
    );
  }

  const accountLabel = draft.externalAccount.accountLabel ?? draft.externalAccount.connectionLocalName;

  return (
    <div className="lf-page">
      <PageHeader
        eyebrow="Publishing"
        title={draft.sourceTitle}
        description={`${accountLabel} · ${PUBLISHING_PLACEMENT_LABELS[draft.placement]}`}
        actions={
          <div className="lf-dialogactions">
            {draft.status === 'draft' ? (
              <Button variant="primary" disabled={busy} onClick={() => void run(() => publishing.validateDraft(draft.id, SEED_GALLERY_WORKSPACE_ID, 'demo-user'), 'Draft validated.')}>
                Validate draft
              </Button>
            ) : null}
            {draft.status === 'ready' ? (
              <Button variant="primary" onClick={() => setConfirming(true)}>
                Publish now
              </Button>
            ) : null}
            {draft.status === 'failed' ? (
              <Button variant="primary" disabled={busy} onClick={() => void run(() => publishing.retryDraft(draft.id, SEED_GALLERY_WORKSPACE_ID, 'demo-user'), 'Draft returned to ready for retry.')}>
                Retry publish
              </Button>
            ) : null}
            {draft.status === 'processing' ? (
              <Button disabled={busy} onClick={() => void run(() => publishing.reconcileDraft(draft.id, SEED_GALLERY_WORKSPACE_ID, 'demo-user'), 'Status checked with the provider.')}>
                Refresh status
              </Button>
            ) : null}
            {draft.status === 'published' ? (
              <a className="lf-btn lf-btn--primary" href={draft.publishedUrl ?? '#'} target="_blank" rel="noreferrer">
                View published post
              </a>
            ) : null}
            {editable ? (
              <Button onClick={() => { setEditing(true); setEditCaption(draft.copy.caption ?? ''); setEditAlt(draft.copy.altText ?? ''); }}>
                Edit
              </Button>
            ) : null}
            {['draft', 'ready', 'failed'].includes(draft.status) ? (
              <Button variant="ghost" onClick={() => setCancelling(true)}>Cancel</Button>
            ) : null}
          </div>
        }
      />

      <p className="lf-tile__description">
        <Badge tone={PUBLISHING_STATUS_TONES[draft.status]} dot>
          {PUBLISHING_STATUS_LABELS[draft.status]}
        </Badge>{' '}
        · internal draft status. External status appears only after provider confirmation.
      </p>

      <div className="lf-campaign-overview">
        <Card>
          <CardHeader title="Source media" description="This source media will not be changed." />
          <CardBody>
            <div className="lf-campaign-item">
              <div className="lf-campaign-item__preview" aria-hidden="true"><GalleryIcon size={20} /></div>
              <div className="lf-campaign-item__body">
                <strong>{draft.sourceTitle}</strong>
                <p className="lf-tile__description">
                  {draft.mediaType} · approved
                  {draft.mediaSummary?.width ? ` · ${draft.mediaSummary.width}×${draft.mediaSummary.height}` : ''}
                  {draft.mediaSummary?.durationSeconds ? ` · ${draft.mediaSummary.durationSeconds}s` : ''}
                </p>
                <p className="lf-tile__description">
                  <Link to={`/gallery/${draft.galleryOutputId}`}>Open the Gallery output (provenance read-only)</Link>
                </p>
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Destination" />
          <CardBody>
            <p className="lf-tile__description">
              {accountLabel} · provider <strong>{draft.providerKey}</strong>
            </p>
            <p className="lf-tile__description">
              Placement: {PUBLISHING_PLACEMENT_LABELS[draft.placement]} ·{' '}
              <Link to="/settings/connections">Connections settings</Link>
            </p>
            {draft.status === 'needs_reauth' ? (
              <p className="lf-tile__description">
                <Badge tone="warning" dot>Reconnect account.</Badge> Submission is blocked until the
                account is verified again.
              </p>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Post details" />
          <CardBody>
            <p className="lf-tile__description"><strong>Caption:</strong> {draft.copy.caption || '—'}</p>
            <p className="lf-tile__description"><strong>CTA:</strong> {draft.copy.callToAction || '—'}</p>
            <p className="lf-tile__description"><strong>Alt text:</strong> {draft.copy.altText || '—'}</p>
            <p className="lf-tile__description"><strong>Internal notes:</strong> {draft.copy.internalNotes || '—'}</p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Validation"
            description={draft.validationResult?.validatedAt ? `Last validated ${formatPublishedAt(draft.validationResult.validatedAt)}` : 'Not validated yet'}
          />
          <CardBody>
            {!draft.validationResult ? (
              <p className="lf-tile__description">Run “Validate draft” to check this draft against the provider’s constraints.</p>
            ) : draft.validationResult.valid ? (
              <p className="lf-tile__description">
                <Badge tone="success" dot>Validation passed.</Badge>
                {draft.validationResult.warnings.map((w) => ` Warning: ${w.messageSafe}`)}
              </p>
            ) : (
              <div>
                {draft.validationResult.errors.map((e, i) => (
                  <p key={i} className="lf-tile__description"><Badge tone="danger" dot>{e.messageSafe}</Badge></p>
                ))}
              </div>
            )}
            {draft.failureMessageSafe && draft.status === 'failed' ? (
              <p className="lf-tile__description"><Badge tone="warning" dot>{draft.failureMessageSafe}</Badge></p>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Activity" description="Append-only draft history — no technical payloads." />
          <CardBody>
            <ul>
              {events.map((event) => (
                <li key={event.id} className="lf-campaign-agendarow">
                  {event.message}{' '}
                  <span className="lf-tile__description">
                    {new Date(event.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · {event.eventType.replace(/_/g, ' ')}
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>

      {/* Publish confirmation — explicit, per draft, never bulk. */}
      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Publish this post?"
        size="sm"
        footer={
          <div className="lf-dialogactions">
            <Button onClick={() => setConfirming(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => {
                void run(
                  () => publishing.submitDraft(draft.id, SEED_GALLERY_WORKSPACE_ID, 'demo-user'),
                  'Submission started.',
                );
                setConfirming(false);
              }}
            >
              Publish now
            </Button>
          </div>
        }
      >
        <p>
          This will send the approved Gallery output and this post copy to{' '}
          <strong>{accountLabel}</strong> on <strong>{draft.providerKey}</strong>. LockFlow cannot
          guarantee how quickly the platform makes it visible.
        </p>
        <p className="lf-tile__description">
          {draft.sourceTitle} · {PUBLISHING_PLACEMENT_LABELS[draft.placement]} · one post, one
          submission intent (protected against duplicates).
        </p>
        <p className="lf-tile__description">
          You are responsible for ensuring this content and copy comply with the selected
          platform’s policies and applicable law.
        </p>
      </Modal>

      <Modal
        open={cancelling}
        onClose={() => setCancelling(false)}
        title="Cancel this draft?"
        size="sm"
        footer={
          <div className="lf-dialogactions">
            <Button onClick={() => setCancelling(false)}>Keep draft</Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => {
                void run(() => publishing.cancelDraft(draft.id, SEED_GALLERY_WORKSPACE_ID, 'demo-user'), 'Draft cancelled.');
                setCancelling(false);
              }}
            >
              Cancel draft
            </Button>
          </div>
        }
      >
        <p>Cancelled drafts keep their history and can be archived. Nothing was sent to the provider.</p>
      </Modal>

      <Modal
        open={editing}
        onClose={() => setEditing(false)}
        title="Edit draft copy"
        footer={
          <div className="lf-dialogactions">
            <Button onClick={() => setEditing(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => {
                void run(
                  () =>
                    publishing.updateDraftCopy(
                      draft.id,
                      {
                        ...draft.copy,
                        ...(editCaption.trim() ? { caption: editCaption.trim() } : {}),
                        ...(editAlt.trim() ? { altText: editAlt.trim() } : {}),
                      },
                      SEED_GALLERY_WORKSPACE_ID,
                      'demo-user',
                    ),
                  'Draft copy updated.',
                );
                setEditing(false);
              }}
            >
              Save copy
            </Button>
          </div>
        }
      >
        <div className="lf-formgrid">
          <div className="lf-field lf-field--full">
            <label className="lf-field__label" htmlFor="edit-caption">Caption</label>
            <textarea id="edit-caption" className="lf-input" rows={4} value={editCaption} onChange={(e) => setEditCaption(e.target.value)} />
          </div>
          <div className="lf-field lf-field--full">
            <Input label="Alt text" value={editAlt} onChange={(e) => setEditAlt(e.target.value)} />
          </div>
        </div>
        <p className="lf-tile__description">Validation resets after edits — validate again before publishing.</p>
      </Modal>
    </div>
  );
}
