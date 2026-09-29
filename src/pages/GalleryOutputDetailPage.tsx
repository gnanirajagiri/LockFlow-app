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
import { getQualityServices } from '../quality/factory';
import { qualitySummaryLabel } from '../features/quality/qualityUi';
import type { QualityReviewRecord } from '../quality/types';
import { getGalleryRepository } from '../data/galleryFactory';
import { getContentRepository } from '../data/contentFactory';
import { getLibraryRepository } from '../data/libraryFactory';
import { getModelsRepository } from '../data';
import { getEnvironmentsRepository } from '../data/environmentsFactory';
import { SEED_GALLERY_WORKSPACE_ID } from '../mock/gallerySeed';
import { isGalleryOutputEligibleForCampaign } from '../domain/campaigns';
import { CampaignsService } from '../services/campaignsService';
import { getCampaignsRepository } from '../data/campaignsFactory';
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
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [qualityReviews, setQualityReviews] = useState<QualityReviewRecord[]>([]);
  const [campaignDialog, setCampaignDialog] = useState(false);
  const [campaigns, setCampaigns] = useState<Array<{ id: string; name: string; status: string }> | null>(null);
  const [selectedCampaign, setSelectedCampaign] = useState('');

  const qualityServices = useMemo(() => getQualityServices(), []);
  const campaignsService = useMemo(
    () => new CampaignsService(getCampaignsRepository(), service),
    [service],
  );

  const load = useCallback(async () => {
    if (!outputId) return;
    setState('loading');
    setError(null);
    try {
      const workspaceId = SEED_GALLERY_WORKSPACE_ID;
      const record = await service.getOutput(outputId, workspaceId);
      const [prov, reviewRows, eventRows, tagRows, qualityReviewRows] = await Promise.all([
        service.resolveProvenance(outputId, workspaceId).catch(() => null),
        service.listReviews(outputId, workspaceId).catch(() => []),
        service.listEvents(outputId, workspaceId).catch(() => []),
        service.listTagsForOutput(outputId, workspaceId).catch(() => []),
        qualityServices.reviews
          .listReviewsForOutput(outputId, workspaceId)
          .catch(() => [] as QualityReviewRecord[]),
      ]);
      setOutput(record);
      setProvenance(prov);
      setReviews(reviewRows);
      setEvents(eventRows);
      setTags(tagRows);
      setQualityReviews(qualityReviewRows);
      // Generated outputs: fetch a short-lived signed preview URL (never a
      // permanent public URL, never persisted). Placeholders keep their frame.
      const isGenerated = Boolean((record.metadata as { provider_generated?: boolean } | null)?.provider_generated)
        && Boolean(record.mediaStoragePath);
      if (isGenerated) {
        const { getSupabase } = await import('../lib/supabase');
        const client = getSupabase();
        if (client) {
          const { data, error: signError } = await client.storage
            .from('lockflow-gallery-media')
            .createSignedUrl(record.mediaStoragePath as string, 600);
          setPreviewUrl(signError ? null : (data?.signedUrl ?? null));
        } else {
          setPreviewUrl(null);
        }
      } else {
        setPreviewUrl(null);
      }
      setState('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this output.');
      setState('error');
    }
  }, [outputId, service, qualityServices]);

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
  // Quality actions: reviewable once the output exists with provenance;
  // continuity review additionally makes sense for reviewable decisions.
  const canReviewContinuity = ['ready_for_review', 'approved', 'rejected'].includes(status);
  const hasProvenance = (provenance?.pins.length ?? 0) > 0;
  // Campaign attachment: only eligible APPROVED outputs offer the action.
  // The verdict comes from the single domain rule — never re-implemented here.
  const campaignEligible = isGalleryOutputEligibleForCampaign(
    {
      id: output.id,
      workspaceId: output.workspaceId,
      title: output.title,
      outputType: output.outputType,
      status: output.status,
      contentJobRequestId: output.contentJobRequestId,
      mediaAvailable: output.mediaStoragePath !== null || output.thumbnailStoragePath !== null,
    },
    SEED_GALLERY_WORKSPACE_ID,
  );
  const qualitySummary = qualitySummaryLabel(
    qualityReviews.map((review) => ({ status: review.status, overallResult: review.overallResult })),
  );

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
            {canReviewContinuity ? (
              <Link className="lf-btn lf-btn--secondary" to={`/gallery/${output.id}/quality`}>
                Review continuity
              </Link>
            ) : null}
            {hasProvenance ? (
              <Link className="lf-btn lf-btn--secondary" to={`/gallery/${output.id}/corrections`}>
                Create correction
              </Link>
            ) : null}
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
            {campaignEligible ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setCampaignDialog(true);
                  setCampaigns(null);
                  setSelectedCampaign('');
                  campaignsService
                    .listCampaigns(SEED_GALLERY_WORKSPACE_ID)
                    .then((rows) =>
                      setCampaigns(
                        rows
                          .filter((row) => row.campaign.status !== 'archived')
                          .map((row) => ({
                            id: row.campaign.id,
                            name: row.campaign.name,
                            status: row.campaign.status,
                          })),
                      ),
                    )
                    .catch(() => setCampaigns([]));
                }}
              >
                Add to campaign
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
        {(output.metadata as { provider_generated?: boolean } | null)?.provider_generated
          ? 'Generated media — private to this workspace, previewed through a short-lived signed URL. Generated work appears in Gallery, never in the Library.'
          : 'Placeholder preview — this is development placeholder metadata, not a real generated image or video. Generated work appears in Gallery, never in the Library.'}
      </div>

      <div className="lf-envlock__layout">
        <div style={{ display: 'grid', gap: 'var(--lf-space-4)', minWidth: 0 }}>
          {/* Preview + metadata ─────────────────────────────────────────── */}
          <Card>
            <CardBody>
              {previewUrl ? (
                <img
                  className="lf-refcard__image"
                  style={{ maxWidth: '100%', borderRadius: 'var(--lf-radius-md)' }}
                  src={previewUrl}
                  alt={output.title}
                />
              ) : (
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
              )}
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

          {/* Continuity quality summary — additive, never approval state ── */}
          <Card>
            <CardBody>
              <div className="lf-envref__row" style={{ justifyContent: 'space-between' }}>
                <h3 className="lf-envpanel__heading" style={{ margin: 0 }}>Continuity quality</h3>
                <Badge
                  tone={
                    qualitySummary === 'Passed'
                      ? 'success'
                      : qualitySummary === 'Warnings'
                        ? 'warning'
                        : qualitySummary === 'Issues found'
                          ? 'danger'
                          : 'neutral'
                  }
                  dot
                >
                  {qualitySummary}
                </Badge>
              </div>
              <p className="lf-tile__description" style={{ marginTop: 'var(--lf-space-2)' }}>
                {qualityReviews.length === 0
                  ? 'Not reviewed yet — a continuity review checks this output against the exact approved versions used to create it.'
                  : `${qualityReviews.filter((review) => review.status === 'completed').length} completed review(s). Reviews never change this output's approval status.`}
              </p>
              <div className="lf-sheet__toolbar" style={{ marginTop: 'var(--lf-space-2)' }}>
                {canReviewContinuity ? (
                  <Link className="lf-btn lf-btn--secondary" to={`/gallery/${output.id}/quality`}>
                    Review continuity
                  </Link>
                ) : null}
                {hasProvenance ? (
                  <Link className="lf-btn lf-btn--secondary" to={`/gallery/${output.id}/corrections`}>
                    Create correction
                  </Link>
                ) : null}
                <Link className="lf-btn lf-btn--secondary" to="/corrections">
                  All corrections
                </Link>
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
              {(output.metadata as { generation_kind?: string } | null)?.generation_kind === 'video' ? (
                <div className="lf-library__note">
                  <strong>Clip source.</strong> Scene and Beat snapshots are frozen from the storyboard
                  at submission time — later storyboard edits never change a submitted clip. Overlay
                  text is guidance only; no speech, audio or lip sync is generated.
                </div>
              ) : null}
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

      {/* Add-to-campaign: only offered for eligible approved outputs. Creates
          a campaign ITEM (reference) — never a media copy or Gallery change. */}
      <Modal
        open={campaignDialog}
        onClose={() => setCampaignDialog(false)}
        title="Add to campaign"
        description="Adds this approved output to a campaign as planned content. The Gallery output itself is not changed."
        size="sm"
        footer={
          <div className="lf-dialogactions">
            <Button onClick={() => setCampaignDialog(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!selectedCampaign || busy}
              onClick={async () => {
                if (!selectedCampaign || !output) return;
                setBusy(true);
                try {
                  await campaignsService.addItem(
                    { campaignId: selectedCampaign, galleryOutputId: output.id },
                    'demo-user',
                    SEED_GALLERY_WORKSPACE_ID,
                  );
                  toast({ title: 'Added to campaign as planned content.', tone: 'success' });
                  setCampaignDialog(false);
                } catch (err) {
                  toast({
                    title: err instanceof Error ? err.message : 'Could not add to the campaign.',
                    tone: 'error',
                  });
                } finally {
                  setBusy(false);
                }
              }}
            >
              Add to campaign
            </Button>
          </div>
        }
      >
        {campaigns === null ? (
          <p className="lf-tile__description">Loading campaigns…</p>
        ) : campaigns.length === 0 ? (
          <p className="lf-tile__description">
            No active campaigns in this workspace yet. Create one under Campaigns first.
          </p>
        ) : (
          <div className="lf-field">
            <label className="lf-field__label" htmlFor="campaign-picker">Campaign</label>
            <select
              id="campaign-picker"
              className="lf-input"
              value={selectedCampaign}
              onChange={(event) => setSelectedCampaign(event.target.value)}
            >
              <option value="">Choose a campaign…</option>
              {campaigns.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.name} ({campaign.status})
                </option>
              ))}
            </select>
          </div>
        )}
      </Modal>
    </div>
  );
}
