/**
 * Gallery output detail — review, metadata and provenance.
 *
 * The provenance panel is a HISTORICAL read-only record: it shows the exact
 * versions pinned when the output's job was prepared. Later source changes
 * never alter it, and nothing here edits job pins or source assets. Media is
 * a labelled placeholder — provider generation and secure storage are not
 * connected yet.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Card, CardBody } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { Modal } from '../components/ui/Modal';
import { Input } from '../components/ui/Input';
import { useToast } from '../components/ui/Toast';
import { GalleryIcon } from '../components/icons';
import { GalleryService } from '../services/galleryService';
import { ContentStudioService } from '../services/contentService';
import { LibraryService } from '../services/libraryService';
import { ModelsService } from '../services/modelsService';
import { EnvironmentsService } from '../services/environmentsService';
import { getGalleryRepository } from '../data/galleryFactory';
import { getContentRepository } from '../data/contentFactory';
import { getLibraryRepository } from '../data/libraryFactory';
import { getModelsRepository } from '../data';
import { getEnvironmentsRepository } from '../data/environmentsFactory';
import { SEED_GALLERY_WORKSPACE_ID } from '../mock/gallerySeed';
import type {
  GalleryOutputEventRecord,
  GalleryOutputRecord,
  GalleryOutputReviewRecord,
  GalleryOutputTagRecord,
} from '../domain/gallery';
import type { GalleryProvenance } from '../services/galleryService';
import type { ContentJobPinRecord } from '../domain/content';

type LoadState = 'loading' | 'error' | 'ready';
type DialogKind = 'approve' | 'changes' | 'reject' | 'archive' | 'restore' | null;

const STATUS_TONE: Record<
  GalleryOutputRecord['status'],
  'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'locked' | 'primary'
> = {
  draft: 'neutral',
  processing: 'info',
  ready_for_review: 'primary',
  approved: 'success',
  rejected: 'danger',
  archived: 'warning',
  failed: 'danger',
};

const PIN_LABEL: Record<ContentJobPinRecord['pinType'], string> = {
  model_version: 'Model',
  environment_version: 'Environment',
  library_asset_version: 'Library asset',
  look_version: 'Look',
};

function statusLabel(status: string): string {
  return status.replace(/_/g, ' ');
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Human-readable title for an immutable pin from its resolved snapshot. */
function pinTitle(pin: ContentJobPinRecord): string {
  const details = pin.resolvedDetails as Record<string, unknown>;
  const name =
    (details.modelName as string | undefined) ??
    (details.environmentName as string | undefined) ??
    (details.assetName as string | undefined) ??
    pin.sourceRecordId;
  const versionNumber = details.versionNumber as number | undefined;
  return `${name}${versionNumber != null ? ` v${versionNumber}` : ''}`;
}

export function GalleryOutputDetailPage() {
  const { outputId } = useParams<{ outputId: string }>();
  const { toast } = useToast();

  const service = useMemo(() => {
    const content = new ContentStudioService(getContentRepository(), {
      library: new LibraryService(getLibraryRepository()),
      models: new ModelsService(getModelsRepository()),
      environments: new EnvironmentsService(getEnvironmentsRepository()),
    });
    return new GalleryService(getGalleryRepository(), content, SEED_GALLERY_WORKSPACE_ID);
  }, []);

  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<GalleryOutputRecord | null>(null);
  const [provenance, setProvenance] = useState<GalleryProvenance | null>(null);
  const [reviews, setReviews] = useState<GalleryOutputReviewRecord[]>([]);
  const [events, setEvents] = useState<GalleryOutputEventRecord[]>([]);
  const [tags, setTags] = useState<GalleryOutputTagRecord[]>([]);
  const [newTag, setNewTag] = useState('');
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!outputId) return;
    setState('loading');
    setError(null);
    try {
      const workspaceId = SEED_GALLERY_WORKSPACE_ID;
      const record = await service.getOutput(outputId, workspaceId);
      const [prov, reviewRows, eventRows, tagRows] = await Promise.all([
        service.resolveProvenance(outputId, workspaceId).catch(() => null),
        service.listReviews(outputId, workspaceId).catch(() => []),
        service.listEvents(outputId, workspaceId).catch(() => []),
        service.listTagsForOutput(outputId, workspaceId).catch(() => []),
      ]);
      setOutput(record);
      setProvenance(prov);
      setReviews(reviewRows);
      setEvents(eventRows);
      setTags(tagRows);
      setState('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this output.');
      setState('error');
    }
  }, [outputId, service]);

  useEffect(() => {
    void load();
  }, [load]);

  const latestFeedback = useMemo(() => {
    const rejected = [...reviews].reverse().find((review) => review.decision === 'rejected');
    return rejected?.feedback ?? null;
  }, [reviews]);

  if (!outputId || state === 'loading') {
    return (
      <div className="lf-page" aria-busy="true">
        <Skeleton variant="rect" height={56} />
        <Skeleton variant="rect" height={300} />
      </div>
    );
  }

  if (state === 'error' || !output) {
    return (
      <div className="lf-page">
        <EmptyState
          icon={<GalleryIcon size={22} />}
          title="Couldn't load this output"
          description={error ?? 'It may not exist in this workspace.'}
          actions={
            <Link className="lf-btn lf-btn--secondary" to="/gallery">
              Back to Gallery
            </Link>
          }
        />
      </div>
    );
  }

  const status = output.status;
  const canReview = status === 'ready_for_review';

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await action();
      toast({ title: success, tone: 'success' });
      setDialog(null);
      setFeedback('');
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

  async function submitDecision(decision: 'approved' | 'rejected' | 'changes_requested') {
    if (!output) return;
    if (decision !== 'approved' && feedback.trim() === '') return;
    await run(
      () =>
        service.submitReview(
          {
            galleryOutputId: output.id,
            reviewerId: 'demo-user',
            decision,
            feedback: feedback.trim() === '' ? undefined : feedback.trim(),
          },
          SEED_GALLERY_WORKSPACE_ID,
        ),
      decision === 'approved'
        ? 'Output approved'
        : decision === 'rejected'
          ? 'Output rejected'
          : 'Changes requested',
    );
  }

  async function addTag() {
    if (!output || newTag.trim() === '') return;
    const name = newTag.trim();
    setNewTag('');
    await run(() => service.addTagToOutput(output.id, name, SEED_GALLERY_WORKSPACE_ID), `Tag “${name}” added`);
  }

  const dialogCopy: Record<Exclude<DialogKind, null>, { title: string; body: string; confirmLabel: string; danger?: boolean }> = {
    approve: {
      title: 'Approve this output?',
      body: 'Approval records a review decision on this output only. The original job, its pins and source assets are never rewritten.',
      confirmLabel: 'Approve output',
    },
    changes: {
      title: 'Request changes',
      body: 'Changes-requested returns the output for another pass. Feedback is stored with the review history.',
      confirmLabel: 'Request changes',
    },
    reject: {
      title: 'Reject this output?',
      body: 'Rejection stores feedback for a future variant or correction workflow. The job and its pins stay untouched.',
      confirmLabel: 'Reject output',
      danger: true,
    },
    archive: {
      title: 'Archive this output?',
      body: 'This is a soft archive — the output, its provenance and reviews are preserved, and it can be restored later.',
      confirmLabel: 'Archive output',
    },
    restore: {
      title: 'Restore this output?',
      body: 'The output returns to its prior reviewable status. No data was deleted while it was archived.',
      confirmLabel: 'Restore output',
    },
  };

  return (
    <div className="lf-page">
      <nav className="lf-library__filterreset" aria-label="Breadcrumb">
        <Link to="/gallery">Gallery</Link> / <span aria-current="page">{output.title}</span>
      </nav>

      <PageHeader
        eyebrow={`Output #${output.outputIndex}`}
        title={output.title}
        description="Placeholder preview — provider generation and secure media storage are not connected yet."
        actions={
          <div className="lf-envprofile__actions-row">
            {canReview ? (
              <>
                <Button variant="primary" onClick={() => setDialog('approve')}>
                  Approve
                </Button>
                <Button variant="secondary" onClick={() => setDialog('changes')}>
                  Request changes
                </Button>
                <Button variant="danger" onClick={() => setDialog('reject')}>
                  Reject
                </Button>
              </>
            ) : null}
            {status === 'approved' ? (
              <Button variant="secondary" onClick={() => setDialog('archive')}>
                Archive
              </Button>
            ) : null}
            {status === 'rejected' ? (
              <Button
                variant="secondary"
                onClick={() =>
                  void run(
                    () => service.transitionOutput(output.id, 'ready_for_review', SEED_GALLERY_WORKSPACE_ID),
                    'Output marked ready for review',
                  )
                }
              >
                Mark ready for review
              </Button>
            ) : null}
            {status === 'archived' ? (
              <Button variant="primary" onClick={() => setDialog('restore')}>
                Restore
              </Button>
            ) : null}
            {status === 'failed' ? (
              <Button variant="secondary" onClick={() => setDialog('archive')}>
                Archive
              </Button>
            ) : null}
            {status === 'draft' || status === 'processing' ? (
              <span className="lf-library__comingnext">
                {status === 'draft'
                  ? 'Draft — no provider is connected, so this output cannot be processed yet.'
                  : 'Processing requires a provider integration, which is not connected yet.'}
              </span>
            ) : null}
          </div>
        }
      />

      <div className="lf-library__note" role="status">
        Placeholder preview — this is development placeholder metadata, not a real generated image
        or video. Generated work appears in Gallery, never in the Library.
      </div>

      <div className="lf-envlock__layout">
        <div style={{ display: 'grid', gap: 'var(--lf-space-4)', minWidth: 0 }}>
          {/* Preview + metadata ─────────────────────────────────────────── */}
          <Card>
            <CardBody>
              <div className="lf-envprofile__preview lf-envprofile__preview--lg" aria-hidden="true">
                <GalleryIcon size={28} />
                <span>
                  {output.outputType === 'image'
                    ? 'Image placeholder'
                    : output.outputType === 'video'
                      ? `Video placeholder${output.durationSeconds != null ? ` · ${output.durationSeconds}s` : ''}`
                      : 'Story placeholder'}
                </span>
              </div>
              <div className="lf-envcard__badges" style={{ marginTop: 'var(--lf-space-3)' }}>
                <Badge tone="neutral">{output.outputType}</Badge>
                <Badge tone={STATUS_TONE[status]} dot>
                  {statusLabel(status)}
                </Badge>
                {output.parentGalleryOutputId ? <Badge tone="info">variant</Badge> : null}
              </div>
              {output.metadata?.variantNote ? (
                <p className="lf-tile__description">{String(output.metadata.variantNote)}</p>
              ) : null}
              <dl className="lf-compare__table" style={{ marginTop: 'var(--lf-space-3)' }}>
                {[
                  ['Type', output.outputType],
                  [
                    'Dimensions / duration',
                    [
                      output.width != null && output.height != null ? `${output.width}×${output.height}` : null,
                      output.durationSeconds != null ? `${output.durationSeconds}s` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ') || '—',
                  ],
                  ['File', [output.mimeType, output.fileSizeBytes != null ? `${output.fileSizeBytes} bytes` : null].filter(Boolean).join(' · ') || '—'],
                  ['Job', provenance?.job.name ?? '—'],
                  ['Content project', provenance?.project?.name ?? '—'],
                  ['Created', formatDate(output.createdAt)],
                ].map(([label, value]) => (
                  <div key={label} className="lf-compare__row">
                    <dt className="lf-compare__field">{label}</dt>
                    <dd style={{ margin: 0 }}>{value}</dd>
                  </div>
                ))}
              </dl>

              {/* Tags ─────────────────────────────────────────────────── */}
              <div className="lf-field" style={{ marginTop: 'var(--lf-space-4)' }}>
                <span className="lf-field__label" id="gallery-tags-label">Tags</span>
                <div className="lf-library__tags" aria-labelledby="gallery-tags-label">
                  {tags.map((tag) => (
                    <span key={tag.id} className="lf-library__tag">
                      {tag.name}{' '}
                      <button
                        type="button"
                        className="lf-library__resetlink"
                        aria-label={`Remove tag ${tag.name}`}
                        onClick={() =>
                          void run(
                            () => service.removeTagFromOutput(output.id, tag.id, SEED_GALLERY_WORKSPACE_ID),
                            'Tag removed',
                          )
                        }
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  {tags.length === 0 ? <span className="lf-tile__description">No tags yet.</span> : null}
                </div>
                <div className="lf-sheet__toolbar" style={{ marginTop: 'var(--lf-space-2)' }}>
                  <Input
                    label="Add a tag"
                    hideLabel
                    placeholder="Add a tag…"
                    value={newTag}
                    onChange={(event) => setNewTag(event.target.value)}
                  />
                  <Button size="sm" variant="secondary" onClick={() => void addTag()} disabled={newTag.trim() === ''}>
                    Add tag
                  </Button>
                </div>
              </div>
            </CardBody>
          </Card>

          {/* Provenance — historical, read-only ────────────────────────── */}
          <Card>
            <CardBody>
              <h3 className="lf-envpanel__heading">Provenance — version used in this output</h3>
              <p className="lf-tile__description">
                “{provenance?.project?.name ?? provenance?.job.name}” · job status:{' '}
                {statusLabel(provenance?.job.status ?? 'draft')} · requested output:{' '}
                {provenance?.job.requestedOutputType.replace(/_/g, ' ')}
              </p>
              {provenance && provenance.pins.length > 0 ? (
                <ul className="lf-envref__list">
                  {provenance.pins.map((pin) => (
                    <li key={pin.id} className="lf-envref__item">
                      <span className="lf-refcard__type">{PIN_LABEL[pin.pinType]}</span>
                      <span className="lf-envref__row">
                        <strong>
                          {pin.resolvedDetails.resolvedVia === 'look_version' ? 'Resolved via Look: ' : ''}
                          {pinTitle(pin)}
                        </strong>
                        <Badge tone="locked">Version used in this output</Badge>
                      </span>
                      {pin.role ? <span className="lf-tile__meta">role: {pin.role.replace(/_/g, ' ')}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="lf-tile__description">
                  This draft job has no prepared pins yet. Provenance appears once exact versions are
                  recorded in Content Studio.
                </p>
              )}
              {provenance?.job.briefSnapshot &&
              Object.keys(provenance.job.briefSnapshot).length > 0 ? (
                <div className="lf-library__note">
                  <strong>Brief snapshot.</strong>{' '}
                  {Object.entries(provenance.job.briefSnapshot)
                    .filter(([, value]) => typeof value === 'string' && value !== '')
                    .map(([key, value]) => `${key}: ${value}`)
                    .join(' · ') || 'Recorded at job creation.'}
                </div>
              ) : null}
              <p className="lf-lockedbanner__copy">
                These are the exact approved inputs recorded for this output. Later source changes do
                not alter this record.
              </p>
            </CardBody>
          </Card>

          {/* Job timeline ──────────────────────────────────────────────── */}
          <Card>
            <CardBody>
              <h3 className="lf-envpanel__heading">Job timeline</h3>
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

        {/* Review panel ──────────────────────────────────────────────── */}
        <aside className="lf-envlock__missingnote" style={{ display: 'grid', gap: 'var(--lf-space-4)' }}>
          <Card>
            <CardBody>
              <h3 className="lf-envpanel__heading">Review history</h3>
              {status === 'rejected' && latestFeedback ? (
                <div className="lf-library__warning" role="status">
                  <strong>Latest feedback.</strong> {latestFeedback}
                </div>
              ) : null}
              {reviews.length === 0 ? (
                <p className="lf-tile__description">No reviews yet.</p>
              ) : (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--lf-space-3)' }}>
                  {reviews.map((review) => (
                    <li key={review.id}>
                      <Badge tone={review.decision === 'approved' ? 'success' : review.decision === 'rejected' ? 'danger' : 'warning'} dot>
                        {statusLabel(review.decision)}
                      </Badge>
                      <p style={{ margin: 'var(--lf-space-1) 0 0' }}>
                        {review.feedback ?? <span className="lf-tile__description">No feedback recorded.</span>}
                      </p>
                      <span className="lf-tile__meta">
                        {review.reviewerId} · {formatDate(review.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </aside>
      </div>

      {/* Review / archive / restore dialogs ────────────────────────────── */}
      <Modal
        open={dialog !== null}
        onClose={() => {
          setDialog(null);
          setFeedback('');
        }}
        title={dialog ? dialogCopy[dialog].title : ''}
        size="sm"
        footer={
          <div className="lf-dialogactions">
            <Button
              onClick={() => {
                setDialog(null);
                setFeedback('');
              }}
            >
              Cancel
            </Button>
            <Button
              variant={dialogCopy[dialog ?? 'approve'].danger ? 'danger' : 'primary'}
              disabled={busy || ((dialog === 'changes' || dialog === 'reject') && feedback.trim() === '')}
              onClick={() => {
                if (dialog === 'approve') void submitDecision('approved');
                else if (dialog === 'changes') void submitDecision('changes_requested');
                else if (dialog === 'reject') void submitDecision('rejected');
                else if (dialog === 'archive')
                  void run(
                    () => service.archiveOutput(output.id, SEED_GALLERY_WORKSPACE_ID),
                    'Output archived',
                  );
                else if (dialog === 'restore')
                  void run(
                    () => service.restoreOutput(output.id, SEED_GALLERY_WORKSPACE_ID),
                    'Output restored',
                  );
              }}
            >
              {dialog ? dialogCopy[dialog].confirmLabel : 'Confirm'}
            </Button>
          </div>
        }
      >
        {dialog ? (
          <div style={{ display: 'grid', gap: 'var(--lf-space-3)' }}>
            <p style={{ margin: 0 }}>{dialogCopy[dialog].body}</p>
            {dialog === 'changes' || dialog === 'reject' ? (
              <Input
                label="Feedback (required)"
                placeholder="What should change in the next pass?"
                value={feedback}
                onChange={(event) => setFeedback(event.target.value)}
              />
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
