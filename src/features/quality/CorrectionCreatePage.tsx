/**
 * Create correction flow (/gallery/:outputId/corrections).
 *
 * Drafts a controlled derivative job from the output's immutable provenance:
 * title, requested change, scope and optional linked findings. Shows what
 * LockFlow preserves and a source-change warning when the classifier detects
 * a prohibited change. No asset/version selectors exist by design.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
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
import { CORRECTION_SCOPES } from '../../quality/types';
import type { CorrectionScope, QualityFindingRecord, QualityReviewRecord } from '../../quality/types';
import { classifyCorrectionRequest } from '../../quality/classifier';
import { SECTION_CATEGORIES } from './qualityUi';
import { statusLabel } from './qualityUi';

type LoadState = 'loading' | 'error' | 'ready';

interface ProvenanceView {
  jobName: string;
  projectName: string | null;
  pins: Array<{ id: string; pinType: string; label: string; role: string | null; resolvedVia: string | null; sourceRecordId: string }>;
}

export function CorrectionCreatePage() {
  const { outputId } = useParams<{ outputId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const services = useMemo(() => getQualityServices(), []);

  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [outputTitle, setOutputTitle] = useState('');
  const [provenance, setProvenance] = useState<ProvenanceView | null>(null);
  const [availableFindings, setAvailableFindings] = useState<Array<{ finding: QualityFindingRecord; review: QualityReviewRecord }>>([]);
  const [title, setTitle] = useState('');
  const [requestedChange, setRequestedChange] = useState('');
  const [scope, setScope] = useState<CorrectionScope>('composition');
  const [selectedFindingIds, setSelectedFindingIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!outputId) return;
    setState('loading');
    setError(null);
    try {
      const output = await services.reviews.getOutputForQuality(outputId);
      const provenanceData = await services.reviews.getProvenanceForQuality(outputId);
      const reviews = await services.reviews.listReviewsForOutput(outputId, output.workspaceId);
      const findings: Array<{ finding: QualityFindingRecord; review: QualityReviewRecord }> = [];
      for (const review of reviews) {
        for (const finding of await services.reviews.listFindings(review.id, output.workspaceId)) {
          findings.push({ finding, review });
        }
      }
      setOutputTitle(output.title);
      setProvenance({
        jobName: provenanceData.job.name,
        projectName: provenanceData.project?.name ?? null,
        pins: provenanceData.pins.map((pin) => {
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
            sourceRecordId: pin.sourceRecordId,
          };
        }),
      });
      setAvailableFindings(findings.filter((entry) => entry.finding.result === 'warning' || entry.finding.result === 'fail'));
      setState('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this output.');
      setState('error');
    }
  }, [outputId, services]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Client-side preview of the classifier using the same transparent rules
   * (the service re-classifies server-side on mark-ready).
   */
  const classification = useMemo(() => {
    if (!provenance) return null;
    const linkedCategories = availableFindings
      .filter((entry) => selectedFindingIds.includes(entry.finding.id))
      .map((entry) => entry.finding.category);
    return classifyCorrectionRequest({
      requestedChange,
      scope,
      findingCategories: linkedCategories,
      pins: provenance.pins.map((pin) => ({
        pinType: pin.pinType as never,
        sourceRecordId: pin.sourceRecordId,
        sourceVersionId: pin.sourceRecordId,
        label: pin.label,
        versionNumber: null,
        role: pin.role,
        resolvedVia: pin.resolvedVia,
      })),
    });
  }, [availableFindings, provenance, requestedChange, scope, selectedFindingIds]);

  async function saveDraft() {
    if (!outputId) return;
    setBusy(true);
    try {
      const workspaceId = await services.reviews.workspaceForOutput(outputId);
      const created = await services.corrections.createDraftCorrection(
        {
          workspaceId,
          sourceGalleryOutputId: outputId,
          title: title.trim(),
          requestedChange: requestedChange.trim(),
          scope,
        },
        workspaceId,
      );
      for (const findingId of selectedFindingIds) {
        await services.corrections.linkFinding(created.id, findingId, workspaceId);
      }
      toast({ title: 'Correction draft saved', tone: 'success' });
      void navigate(`/corrections/${created.id}`);
    } catch (err) {
      toast({
        title: 'Could not save the correction draft',
        description: err instanceof Error ? err.message : 'Something went wrong.',
        tone: 'error',
      });
    } finally {
      setBusy(false);
    }
  }

  if (!outputId || state === 'loading') {
    return (
      <div className="lf-page" aria-busy="true">
        <Skeleton variant="rect" height={56} />
        <Skeleton variant="rect" height={300} />
      </div>
    );
  }

  if (state === 'error' || !provenance) {
    return (
      <div className="lf-page">
        <EmptyState
          icon={<GalleryIcon size={22} />}
          title="Couldn't start a correction here"
          description={error ?? 'The output or its provenance may not exist in this workspace.'}
          actions={<Link className="lf-btn lf-btn--secondary" to={`/gallery/${outputId}`}>Back to output</Link>}
        />
      </div>
    );
  }

  const canSave = title.trim() !== '' && requestedChange.trim() !== '';

  return (
    <div className="lf-page">
      <nav className="lf-library__filterreset" aria-label="Breadcrumb">
        <Link to="/gallery">Gallery</Link> / <Link to={`/gallery/${outputId}`}>{outputTitle}</Link> /{' '}
        <span aria-current="page">Create correction</span>
      </nav>

      <PageHeader
        eyebrow="Correction request"
        title="Create a correction"
        description="Request a controlled improvement without changing the output's original approved inputs."
        actions={null}
      />

      <div className="lf-envlock__layout">
        <div style={{ display: 'grid', gap: 'var(--lf-space-4)', minWidth: 0 }}>
          <Card>
            <CardBody>
              <h3 className="lf-envpanel__heading">What should change?</h3>
              <div style={{ display: 'grid', gap: 'var(--lf-space-3)', marginTop: 'var(--lf-space-2)' }}>
                <Input
                  label="Title (required)"
                  placeholder="Short title, e.g. “Shift product left”"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
                <div>
                  <label className="lf-field__label" htmlFor="lf-cor-scope">Scope</label>
                  <select
                    id="lf-cor-scope"
                    className="lf-input"
                    value={scope}
                    onChange={(event) => setScope(event.target.value as CorrectionScope)}
                  >
                    {CORRECTION_SCOPES.map((entry) => (
                      <option key={entry} value={entry}>{statusLabel(entry)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="lf-field__label" htmlFor="lf-cor-change">Requested change (required)</label>
                  <textarea
                    id="lf-cor-change"
                    className="lf-input lf-envform__textarea"
                    rows={4}
                    placeholder="Describe the generation direction, framing, camera, composition or lighting-mood change…"
                    value={requestedChange}
                    onChange={(event) => setRequestedChange(event.target.value)}
                  />
                </div>
              </div>

              {availableFindings.length > 0 ? (
                <fieldset style={{ marginTop: 'var(--lf-space-4)', border: 'none', padding: 0, margin: 0 }}>
                  <legend className="lf-field__label">Link quality findings (optional)</legend>
                  <div style={{ display: 'grid', gap: 'var(--lf-space-2)', marginTop: 'var(--lf-space-2)' }}>
                    {availableFindings.map(({ finding, review }) => (
                      <label key={finding.id} className="lf-envref__row">
                        <input
                          type="checkbox"
                          checked={selectedFindingIds.includes(finding.id)}
                          onChange={(event) =>
                            setSelectedFindingIds((prev) =>
                              event.target.checked ? [...prev, finding.id] : prev.filter((id) => id !== finding.id),
                            )
                          }
                        />
                        <span>
                          {finding.category.replace(/_/g, ' ')} · {statusLabel(finding.result)}
                          <span className="lf-tile__meta"> · from review completed {review.reviewedAt ? new Date(review.reviewedAt).toLocaleDateString() : '—'}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              ) : null}
            </CardBody>
          </Card>

          {/* Source-change warning ───────────────────────────────────────── */}
          {classification?.sourceChangeRequired ? (
            <div className="lf-library__warning" role="alert">
              <strong>Source change required.</strong> {classification.explanation}
              <ul style={{ margin: 'var(--lf-space-2) 0 0', paddingLeft: '1.2rem' }}>
                {classification.targets.flatMap((target) =>
                  target.links.map((link) => (
                    <li key={`${target.target}:${link.href}`}>
                      <Link to={link.href}>{target.label}: {link.label}</Link>
                    </li>
                  )),
                )}
              </ul>
              <p style={{ margin: 'var(--lf-space-2) 0 0' }}>
                This requires a new draft version in the relevant source module, then a new
                version-pinned content plan. Locked sources are never edited from this screen.
              </p>
            </div>
          ) : null}
        </div>

        {/* Read-only provenance + preservation ──────────────────────────── */}
        <aside className="lf-envlock__missingnote" style={{ display: 'grid', gap: 'var(--lf-space-4)' }}>
          <Card>
            <CardBody>
              <h3 className="lf-envpanel__heading">Original output (read-only)</h3>
              <p className="lf-tile__description">{outputTitle} — the parent output is never overwritten.</p>
              <h4 className="lf-field__label" style={{ marginTop: 'var(--lf-space-3)' }}>
                Historical inputs — version used in this output
              </h4>
              <ul className="lf-envref__list">
                {provenance.pins.map((pin) => (
                  <li key={pin.id} className="lf-envref__item">
                    <span className="lf-refcard__type">{pin.pinType.replace(/_/g, ' ')}</span>
                    <span className="lf-envref__row">
                      <strong>{pin.resolvedVia ? 'Resolved via Look: ' : ''}{pin.label}</strong>
                      <Badge tone="locked">Exact version</Badge>
                    </span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>

          <Card>
            <CardBody>
              <h3 className="lf-envpanel__heading">What LockFlow will preserve</h3>
              <ul className="lf-tile__description" style={{ paddingLeft: '1.2rem' }}>
                <li>Exact model / environment / Look / asset version pins</li>
                <li>Source job, project and scene/beat context</li>
                <li>The parent output and all of its history</li>
              </ul>
              <p className="lf-lockedbanner__copy">
                If submitted to a provider later, the correction creates a NEW run and a NEW
                Gallery output linked to this one — it never replaces the original.
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardBody>
              <div style={{ display: 'grid', gap: 'var(--lf-space-2)' }}>
                <Button variant="primary" disabled={!canSave || busy} onClick={() => void saveDraft()}>
                  Save correction draft
                </Button>
                <Link className="lf-btn lf-btn--secondary" to={`/gallery/${outputId}`}>
                  Cancel
                </Link>
              </div>
              <p className="lf-tile__description" style={{ marginTop: 'var(--lf-space-2)' }}>
                Sections group findings: {Object.values(SECTION_CATEGORIES).flat().length} tracked categories.
              </p>
            </CardBody>
          </Card>
        </aside>
      </div>
    </div>
  );
}
