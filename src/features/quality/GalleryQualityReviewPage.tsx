/**
 * Gallery output quality review page (/gallery/:outputId/quality).
 *
 * Continuity review against the EXACT pinned inputs used to create the
 * output: prominent historical provenance, sectioned manual checklist with
 * expected-from-pins rows, save draft, complete review. Completed reviews
 * are visibly read-only. Never touches the approve/reject flow.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageHeader } from '../../components/layout/PageHeader';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Card, CardBody } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { Input } from '../../components/ui/Input';
import { useToast } from '../../components/ui/Toast';
import { GalleryIcon } from '../../components/icons';
import { getQualityServices } from '../../quality/factory';
import type {
  CorrectionRequestRecord,
  QualityFindingRecord,
  QualityFindingCategory,
  QualityResult,
  QualityReviewRecord,
  QualitySeverity,
} from '../../quality/types';
import { QUALITY_RESULTS, QUALITY_SEVERITIES } from '../../quality/types';
import {
  RESULT_TONE,
  REVIEW_STATUS_TONE,
  SECTION_CATEGORIES,
  SECTION_TITLES,
  expectedSummary,
  formatDate,
  qualitySummaryLabel,
  statusLabel,
} from './qualityUi';

type LoadState = 'loading' | 'error' | 'ready';

interface PageData {
  output: { id: string; title: string; outputType: string; status: string; metadata: Record<string, unknown>; mediaStoragePath: string | null };
  provenance: {
    jobName: string;
    projectName: string | null;
    pins: Array<{ id: string; pinType: string; label: string; role: string | null; resolvedVia: string | null }>;
    sceneSnapshot: Record<string, unknown> | null;
    beatSnapshot: Record<string, unknown> | null;
  };
  reviews: QualityReviewRecord[];
  findingsByReview: Record<string, QualityFindingRecord[]>;
  corrections: CorrectionRequestRecord[];
}

/** Draft checklist row state (per category). */
interface RowState {
  category: QualityFindingCategory;
  result: QualityResult;
  severity: QualitySeverity;
  observedNote: string;
  correctionNote: string;
  findingId?: string;
}

const ALL_CATEGORY_ROWS: QualityFindingCategory[] = [
  'model_identity', 'face', 'hairstyle', 'skin_tone', 'body_proportions',
  'wardrobe', 'accessory',
  'product', 'prop', 'palette_material',
  'environment_layout', 'furniture_anchor', 'lighting',
  'camera', 'composition', 'text_overlay',
  'motion', 'continuity',
];

export function GalleryQualityReviewPage() {
  const { outputId } = useParams<{ outputId: string }>();
  const { toast } = useToast();

  const services = useMemo(() => getQualityServices(), []);

  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PageData | null>(null);
  const [review, setReview] = useState<QualityReviewRecord | null>(null);
  const [rows, setRows] = useState<RowState[]>([]);
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!outputId) return;
    setState('loading');
    setError(null);
    try {
      const { reviews: reviewService, corrections: correctionService } = services;
      const output = await reviewService.getOutputForQuality(outputId);
      const provenance = await reviewService.getProvenanceForQuality(outputId);
      const reviews = await reviewService.listReviewsForOutput(outputId, output.workspaceId);
      const findingsByReview: Record<string, QualityFindingRecord[]> = {};
      for (const entry of reviews) {
        findingsByReview[entry.id] = await reviewService.listFindings(entry.id, output.workspaceId);
      }
      const corrections = await correctionService.listCorrectionRequests(output.workspaceId, {
        search: outputId,
      });

      const activeDraft = reviews.find((entry) => entry.status === 'draft') ?? null;
      setReview(activeDraft);
      setSummary(activeDraft?.summary ?? '');
      if (activeDraft) {
        const existing = findingsByReview[activeDraft.id] ?? [];
        setRows(
          ALL_CATEGORY_ROWS.map((category) => {
            const finding = existing.find((entry) => entry.category === category);
            return {
              category,
              result: finding?.result ?? 'not_checked',
              severity: finding?.severity ?? 'low',
              observedNote: finding?.observedNote ?? '',
              correctionNote: finding?.correctionNote ?? '',
              findingId: finding?.id,
            };
          }),
        );
      } else {
        setRows([]);
      }

      setData({
        output: {
          id: output.id,
          title: output.title,
          outputType: output.outputType,
          status: output.status,
          metadata: output.metadata,
          mediaStoragePath: output.mediaStoragePath,
        },
        provenance: {
          jobName: provenance.job.name,
          projectName: provenance.project?.name ?? null,
          pins: provenance.pins.map((pin) => {
            const details = pin.resolvedDetails as Record<string, unknown>;
            const name =
              (details.modelName as string | undefined) ??
              (details.environmentName as string | undefined) ??
              (details.assetName as string | undefined) ??
              pin.sourceRecordId;
            const versionNumber = details.versionNumber as number | undefined;
            return {
              id: pin.id,
              pinType: pin.pinType,
              label: `${name}${versionNumber != null ? ` v${versionNumber}` : ''}`,
              role: pin.role ?? null,
              resolvedVia: (details.resolvedVia as string | undefined) ?? null,
            };
          }),
          sceneSnapshot: (output.metadata.scene_snapshot as Record<string, unknown> | undefined) ?? null,
          beatSnapshot: (output.metadata.beat_snapshot as Record<string, unknown> | undefined) ?? null,
        },
        reviews,
        findingsByReview,
        corrections,
      });

      // Short-lived signed preview for generated media (same pattern as the
      // Gallery detail page — never persisted, never a permanent URL).
      const isGenerated = Boolean((output.metadata as { provider_generated?: boolean }).provider_generated)
        && Boolean(output.mediaStoragePath);
      if (isGenerated) {
        const { getSupabase } = await import('../../lib/supabase');
        const client = getSupabase();
        if (client) {
          const { data: signed, error: signError } = await client.storage
            .from('lockflow-gallery-media')
            .createSignedUrl(output.mediaStoragePath as string, 600);
          setPreviewUrl(signError ? null : (signed?.signedUrl ?? null));
        } else {
          setPreviewUrl(null);
        }
      } else {
        setPreviewUrl(null);
      }
      setState('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this review.');
      setState('error');
    }
  }, [outputId, services]);

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

  async function startDraft() {
    if (!outputId) return;
    await run(async () => {
      await services.reviews.createDraftReview(outputId, await services.reviews.workspaceForOutput(outputId));
    }, 'Draft review started');
  }

  async function saveDraft() {
    if (!outputId || !review) return;
    const workspaceId = await services.reviews.workspaceForOutput(outputId);
    await run(async () => {
      // Diff rows against existing findings: create/update as needed.
      const existing = await services.reviews.listFindings(review.id, workspaceId);
      for (const row of rows) {
        if (row.result === 'not_checked' && !row.findingId && row.observedNote.trim() === '') continue;
        if (row.findingId) {
          await services.reviews.updateFinding(
            row.findingId,
            { result: row.result, severity: row.severity, observedNote: row.observedNote, correctionNote: row.correctionNote },
            workspaceId,
          );
        } else if (row.result !== 'not_checked') {
          const created = await services.reviews.addFinding(
            review.id,
            {
              category: row.category,
              result: row.result,
              severity: row.severity,
              observedNote: row.observedNote,
              correctionNote: row.correctionNote,
            },
            workspaceId,
          );
          row.findingId = created.id;
        }
      }
      const stale = existing.filter(
        (finding) => !rows.some((row) => row.findingId === finding.id),
      );
      for (const finding of stale) {
        await services.reviews.deleteFinding(finding.id, workspaceId);
      }
      await services.reviews.updateSummary(review.id, summary.trim() === '' ? null : summary.trim(), workspaceId);
    }, 'Draft saved');
  }

  async function completeReview() {
    if (!outputId || !review) return;
    const workspaceId = await services.reviews.workspaceForOutput(outputId);
    await run(async () => {
      await saveDraftQuiet(workspaceId);
      await services.reviews.completeReview(review.id, workspaceId, {
        summary: summary.trim() === '' ? undefined : summary.trim(),
      });
    }, 'Review completed');
  }

  async function saveDraftQuiet(workspaceId: string) {
    if (!review) return;
    const existing = await services.reviews.listFindings(review.id, workspaceId);
    for (const row of rows) {
      if (row.result === 'not_checked' && !row.findingId && row.observedNote.trim() === '') continue;
      if (row.findingId) {
        await services.reviews.updateFinding(
          row.findingId,
          { result: row.result, severity: row.severity, observedNote: row.observedNote, correctionNote: row.correctionNote },
          workspaceId,
        );
      } else if (row.result !== 'not_checked') {
        const created = await services.reviews.addFinding(
          review.id,
          { category: row.category, result: row.result, severity: row.severity, observedNote: row.observedNote, correctionNote: row.correctionNote },
          workspaceId,
        );
        row.findingId = created.id;
      }
    }
    const stale = existing.filter((finding) => !rows.some((row) => row.findingId === finding.id));
    for (const finding of stale) {
      await services.reviews.deleteFinding(finding.id, workspaceId);
    }
    await services.reviews.updateSummary(review.id, summary.trim() === '' ? null : summary.trim(), workspaceId);
  }

  if (!outputId || state === 'loading') {
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
          title="Couldn't load this review"
          description={error ?? 'It may not exist in this workspace.'}
          actions={<Link className="lf-btn lf-btn--secondary" to={`/gallery/${outputId}`}>Back to output</Link>}
        />
      </div>
    );
  }

  const isDraft = review?.status === 'draft';
  const summaryLabel = qualitySummaryLabel(data.reviews);
  const isVideo = data.output.outputType === 'video' || data.output.outputType === 'story';
  const completedReviews = data.reviews.filter((entry) => entry.status !== 'draft');

  return (
    <div className="lf-page">
      <nav className="lf-library__filterreset" aria-label="Breadcrumb">
        <Link to="/gallery">Gallery</Link> / <Link to={`/gallery/${outputId}`}>{data.output.title}</Link> /{' '}
        <span aria-current="page">Continuity review</span>
      </nav>

      <PageHeader
        eyebrow="Continuity review"
        title={data.output.title}
        description="Check this output against the exact approved versions used to create it."
        actions={
          <div className="lf-envprofile__actions-row">
            <Badge tone={REVIEW_STATUS_TONE[review?.status ?? 'completed']} dot>
              {review ? statusLabel(review.status) : 'Not started'}
            </Badge>
            {isDraft ? (
              <>
                <Button variant="secondary" disabled={busy} onClick={() => void saveDraft()}>
                  Save draft
                </Button>
                <Button variant="primary" disabled={busy} onClick={() => void completeReview()}>
                  Complete review
                </Button>
              </>
            ) : null}
            {!review ? (
              <Button variant="primary" disabled={busy} onClick={() => void startDraft()}>
                Start review
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="lf-library__note" role="status">
        Automated continuity analysis is not enabled yet. Reviews are human and manual — findings
        are review records and never edit sources, pins or media.
      </div>

      <div className="lf-envlock__layout">
        <div style={{ display: 'grid', gap: 'var(--lf-space-4)', minWidth: 0 }}>
          {/* Preview ─────────────────────────────────────────────────────── */}
          <Card>
            <CardBody>
              {previewUrl ? (
                <img
                  className="lf-refcard__image"
                  style={{ maxWidth: '100%', borderRadius: 'var(--lf-radius-md)' }}
                  src={previewUrl}
                  alt={data.output.title}
                />
              ) : (
                <div className="lf-envprofile__preview lf-envprofile__preview--lg" aria-hidden="true">
                  <GalleryIcon size={28} />
                  <span>
                    {data.output.outputType === 'image'
                      ? 'Image placeholder'
                      : data.output.outputType === 'video'
                        ? 'Video placeholder'
                        : 'Story placeholder'}
                  </span>
                </div>
              )}
              <div className="lf-envcard__badges" style={{ marginTop: 'var(--lf-space-3)' }}>
                <Badge tone="neutral">{data.output.outputType}</Badge>
                <Badge tone="neutral">{statusLabel(data.output.status)}</Badge>
                <Badge
                  tone={summaryLabel === 'Passed' ? 'success' : summaryLabel === 'Warnings' ? 'warning' : summaryLabel === 'Issues found' ? 'danger' : 'neutral'}
                  dot
                >
                  {summaryLabel}
                </Badge>
              </div>
            </CardBody>
          </Card>

          {/* Historical provenance — "Version used in this output" ───────── */}
          <Card>
            <CardBody>
              <h3 className="lf-envpanel__heading">Version used in this output</h3>
              <p className="lf-tile__description">
                “{data.provenance.projectName ?? data.provenance.jobName}” — historical record. Later
                source updates never change this review's context.
              </p>
              <ul className="lf-envref__list">
                {data.provenance.pins.map((pin) => (
                  <li key={pin.id} className="lf-envref__item">
                    <span className="lf-refcard__type">{pin.pinType.replace(/_/g, ' ')}</span>
                    <span className="lf-envref__row">
                      <strong>{pin.resolvedVia ? 'Resolved via Look: ' : ''}{pin.label}</strong>
                      <Badge tone="locked">Version used in this output</Badge>
                    </span>
                    {pin.role ? <span className="lf-tile__meta">role: {pin.role.replace(/_/g, ' ')}</span> : null}
                  </li>
                ))}
              </ul>
              {isVideo && (data.provenance.sceneSnapshot || data.provenance.beatSnapshot) ? (
                <div className="lf-library__note">
                  <strong>Clip source.</strong>{' '}
                  {data.provenance.sceneSnapshot
                    ? `Scene: ${String((data.provenance.sceneSnapshot as { title?: string }).title ?? '—')}. `
                    : ''}
                  {data.provenance.beatSnapshot
                    ? `Beat: ${String((data.provenance.beatSnapshot as { title?: string }).title ?? '—')}.`
                    : ''}
                  {' '}Frozen from the storyboard at submission time.
                </div>
              ) : null}
              <p className="lf-lockedbanner__copy">
                These are the exact approved inputs recorded for this output. Review rows below read
                their expected details from this record only.
              </p>
            </CardBody>
          </Card>

          {/* Checklist ───────────────────────────────────────────────────── */}
          {isDraft ? (
            <Card>
              <CardBody>
                <h3 className="lf-envpanel__heading">Review checklist</h3>
                {Object.entries(SECTION_CATEGORIES)
                  .filter(([section]) => section !== 'other' && (isVideo || section !== 'motion_continuity'))
                  .map(([section, categories]) => (
                    <section key={section} style={{ marginTop: 'var(--lf-space-4)' }}>
                      <h4 className="lf-field__label">{SECTION_TITLES[section]}</h4>
                      <div style={{ display: 'grid', gap: 'var(--lf-space-3)' }}>
                        {rows
                          .filter((row) => categories.includes(row.category))
                          .map((row) => (
                            <div key={row.category} className="lf-envref__item" style={{ borderTop: '1px solid var(--lf-border, #ddd)', paddingTop: 'var(--lf-space-2)' }}>
                              <div className="lf-envref__row">
                                <strong>{row.category.replace(/_/g, ' ')}</strong>
                                <span className="lf-tile__meta">expected: {expectedSummary(
                                  // Expected context is rebuilt from the provenance card's pins.
                                  { pinned_versions: data.provenance.pins
                                      .filter((pin) => expectedPinApplies(row.category, pin.pinType))
                                      .map((pin) => ({ label: pin.label, resolved_via: pin.resolvedVia, source_version_id: pin.id })) },
                                )}</span>
                              </div>
                              <div className="lf-sheet__toolbar" style={{ marginTop: 'var(--lf-space-2)' }}>
                                <label>
                                  <span className="lf-field__label">Result</span>
                                  <select
                                    className="lf-input"
                                    aria-label={`Result for ${row.category.replace(/_/g, ' ')}`}
                                    value={row.result}
                                    onChange={(event) =>
                                      setRows((prev) =>
                                        prev.map((entry) =>
                                          entry.category === row.category
                                            ? { ...entry, result: event.target.value as QualityResult }
                                            : entry,
                                        ),
                                      )
                                    }
                                  >
                                    {QUALITY_RESULTS.map((result) => (
                                      <option key={result} value={result}>{statusLabel(result)}</option>
                                    ))}
                                  </select>
                                </label>
                                {row.result === 'warning' || row.result === 'fail' ? (
                                  <label>
                                    <span className="lf-field__label">Severity</span>
                                    <select
                                      className="lf-input"
                                      aria-label={`Severity for ${row.category.replace(/_/g, ' ')}`}
                                      value={row.severity}
                                      onChange={(event) =>
                                        setRows((prev) =>
                                          prev.map((entry) =>
                                            entry.category === row.category
                                              ? { ...entry, severity: event.target.value as QualitySeverity }
                                              : entry,
                                          ),
                                        )
                                      }
                                    >
                                      {QUALITY_SEVERITIES.map((severity) => (
                                        <option key={severity} value={severity}>{statusLabel(severity)}</option>
                                      ))}
                                    </select>
                                  </label>
                                ) : null}
                              </div>
                              {row.result === 'warning' || row.result === 'fail' ? (
                                <div className="lf-sheet__toolbar" style={{ marginTop: 'var(--lf-space-2)' }}>
                                  <Input
                                    label="Observed note"
                                    hideLabel
                                    placeholder="Observed note (what differs from the pinned input)…"
                                    value={row.observedNote}
                                    onChange={(event) =>
                                      setRows((prev) =>
                                        prev.map((entry) =>
                                          entry.category === row.category ? { ...entry, observedNote: event.target.value } : entry,
                                        ),
                                      )
                                    }
                                  />
                                  <Input
                                    label="Suggested correction note"
                                    hideLabel
                                    placeholder="Suggested correction note…"
                                    value={row.correctionNote}
                                    onChange={(event) =>
                                      setRows((prev) =>
                                        prev.map((entry) =>
                                          entry.category === row.category ? { ...entry, correctionNote: event.target.value } : entry,
                                        ),
                                      )
                                    }
                                  />
                                </div>
                              ) : null}
                            </div>
                          ))}
                      </div>
                    </section>
                  ))}
                <div style={{ marginTop: 'var(--lf-space-4)' }}>
                  <Input
                    label="Overall summary"
                    placeholder="Overall summary (optional)…"
                    value={summary}
                    onChange={(event) => setSummary(event.target.value)}
                  />
                </div>
              </CardBody>
            </Card>
          ) : (
            /* Completed read-only view ─────────────────────────────────── */
            <Card>
              <CardBody>
                <h3 className="lf-envpanel__heading">Completed review</h3>
                {completedReviews.length === 0 ? (
                  <p className="lf-tile__description">No completed reviews yet.</p>
                ) : (
                  completedReviews.map((entry) => (
                    <div key={entry.id} style={{ marginBottom: 'var(--lf-space-4)' }}>
                      <div className="lf-envref__row">
                        <Badge tone={RESULT_TONE[entry.overallResult]} dot>{statusLabel(entry.overallResult)}</Badge>
                        <span className="lf-tile__meta">reviewed {formatDate(entry.reviewedAt)}</span>
                      </div>
                      {entry.summary ? <p className="lf-tile__description">{entry.summary}</p> : null}
                      <ul className="lf-envref__list" style={{ marginTop: 'var(--lf-space-2)' }}>
                        {(data.findingsByReview[entry.id] ?? []).map((finding) => (
                          <li key={finding.id} className="lf-envref__item">
                            <span className="lf-envref__row">
                              <strong>{finding.category.replace(/_/g, ' ')}</strong>
                              <span>
                                <Badge tone={RESULT_TONE[finding.result]} dot>{statusLabel(finding.result)}</Badge>
                                {finding.result === 'warning' || finding.result === 'fail' ? (
                                  <Badge tone="neutral">{statusLabel(finding.severity)}</Badge>
                                ) : null}
                              </span>
                            </span>
                            {finding.observedNote ? (
                              <span className="lf-tile__meta">observed: {finding.observedNote}</span>
                            ) : null}
                            {finding.correctionNote ? (
                              <span className="lf-tile__meta">correction: {finding.correctionNote}</span>
                            ) : null}
                            <span className="lf-tile__meta">expected: {expectedSummary(finding.expectedContext)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))
                )}
                <p className="lf-lockedbanner__copy">
                  Completed reviews are read-only. To record new observations, start a new review
                  after the output is regenerated or corrected.
                </p>
              </CardBody>
            </Card>
          )}
        </div>

        {/* Side panel: corrections for this output ──────────────────────── */}
        <aside className="lf-envlock__missingnote" style={{ display: 'grid', gap: 'var(--lf-space-4)' }}>
          <Card>
            <CardBody>
              <h3 className="lf-envpanel__heading">Corrections from this output</h3>
              {data.corrections.length === 0 ? (
                <p className="lf-tile__description">
                  No correction requests yet. Corrections improve an output without changing its
                  original approved inputs.
                </p>
              ) : (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--lf-space-2)' }}>
                  {data.corrections.map((correction) => (
                    <li key={correction.id} className="lf-envref__row">
                      <Link to={`/corrections/${correction.id}`}>{correction.title}</Link>
                      <Badge tone="neutral" dot>{statusLabel(correction.status)}</Badge>
                    </li>
                  ))}
                </ul>
              )}
              <div style={{ marginTop: 'var(--lf-space-3)' }}>
                <Link className="lf-btn lf-btn--secondary" to={`/gallery/${outputId}/corrections`}>
                  Create correction
                </Link>
              </div>
            </CardBody>
          </Card>
        </aside>
      </div>
    </div>
  );
}

/** Mirrors the snapshot builder's category scoping for display-only summaries. */
function expectedPinApplies(category: QualityFindingCategory, pinType: string): boolean {
  switch (category) {
    case 'model_identity':
    case 'face':
    case 'hairstyle':
    case 'skin_tone':
    case 'body_proportions':
      return pinType === 'model_version';
    case 'environment_layout':
    case 'furniture_anchor':
    case 'lighting':
      return pinType === 'environment_version';
    case 'wardrobe':
    case 'accessory':
    case 'product':
    case 'prop':
    case 'palette_material':
      return pinType === 'library_asset_version' || pinType === 'look_version';
    default:
      return false;
  }
}
