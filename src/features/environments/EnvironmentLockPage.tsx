/**
 * Lock and save — the final review page for a DRAFT environment version.
 *
 * Two gates must pass before the primary action enables:
 *   1. Required defining anchors are complete (pure `anchorChecks`).
 *   2. The rights confirmation checkbox is ticked.
 * The action also requires the explicit confirm dialog, then calls the
 * existing lock service; on success the version locks, the environment's
 * active version updates (existing domain rule), and we redirect to the
 * profile with a confirmation toast.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Input } from '../../components/ui/Input';
import { Skeleton } from '../../components/ui/Skeleton';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';
import { EnvironmentIcon, LockIcon } from '../../components/icons';
import { EnvironmentsService } from '../../services/environmentsService';
import type { EnvironmentSpecRecord } from '../../domain/environments';
import { getEnvironmentsRepository } from '../../data/environmentsFactory';
import { SEED_ENVIRONMENT_WORKSPACE_ID } from '../../mock/environmentsSeed';
import {
  LOCK_LEVEL_HELP,
  LOCK_REVIEW_COPY,
  RIGHTS_CONFIRMATION_COPY,
  VERSION_RULES_COPY,
  anchorChecks,
  assertEnvironmentLockAllowed,
  incompleteAnchors,
} from './envLockReview';
import { jsonToText } from './envDiff';
import { findDraftEnvironmentVersion, useEnvironmentData } from './useEnvironmentData';

const USAGE_TAG_SUGGESTIONS = ['UGC', 'Product demo', 'Skincare'];

export function EnvironmentLockPage() {
  const { environmentId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const service = useMemo(() => new EnvironmentsService(getEnvironmentsRepository()), []);
  const data = useEnvironmentData(service, environmentId, SEED_ENVIRONMENT_WORKSPACE_ID);

  const [spec, setSpec] = useState<EnvironmentSpecRecord | null>(null);
  const [specError, setSpecError] = useState<string | null>(null);
  const [rightsAcknowledged, setRightsAcknowledged] = useState(false);
  const [usageTags, setUsageTags] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [locking, setLocking] = useState(false);

  const requested = searchParams.get('version');
  const draft = useMemo(() => findDraftEnvironmentVersion(data.versions), [data.versions]);
  const targetVersion = useMemo(() => {
    if (requested) {
      const match = data.versions.find((version) => version.id === requested);
      if (match) return match;
    }
    return draft ?? null;
  }, [requested, data.versions, draft]);

  useEffect(() => {
    if (!targetVersion) return;
    let cancelled = false;
    service
      .getSpec(targetVersion.id, SEED_ENVIRONMENT_WORKSPACE_ID)
      .then((record) => {
        if (!cancelled) {
          setSpec(record);
          setSpecError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setSpecError(err instanceof Error ? err.message : 'Failed to load the spec.');
      });
    return () => {
      cancelled = true;
    };
  }, [service, targetVersion?.id]);

  if (data.state === 'loading') {
    return (
      <div className="lf-page" aria-busy="true">
        <Skeleton variant="title" />
        <Skeleton lines={5} />
      </div>
    );
  }

  if (data.state === 'error' || !data.environment) {
    return (
      <div className="lf-page">
        <EmptyState
          icon={<EnvironmentIcon size={22} />}
          title="Couldn't load this environment"
          description={data.error ?? undefined}
          actions={<Link className="lf-btn lf-btn--primary" to="/environments">Back to Environments</Link>}
        />
      </div>
    );
  }

  if (!targetVersion) {
    return (
      <div className="lf-page">
        <EmptyState
          icon={<LockIcon size={22} />}
          title="Nothing to lock"
          description="This environment has no draft version to review. Locked versions are already protected."
          actions={<Link className="lf-btn lf-btn--primary" to={`/environments/${environmentId}/versions`}>View versions</Link>}
        />
      </div>
    );
  }

  if (targetVersion.status !== 'draft') {
    return (
      <div className="lf-page">
        <EmptyState
          icon={<LockIcon size={22} />}
          title={`v${targetVersion.versionNumber} is already ${targetVersion.status}`}
          description="Only draft versions can be locked. Create a new draft version to change the environment."
          actions={<Link className="lf-btn lf-btn--primary" to={`/environments/${environmentId}/versions`}>View versions</Link>}
        />
      </div>
    );
  }

  const checks = spec ? anchorChecks(spec) : [];
  const missing = spec ? incompleteAnchors(spec) : [];
  const lockReady = spec !== null && missing.length === 0 && rightsAcknowledged;

  async function handleLockConfirmed() {
    if (!spec || !targetVersion) return;
    setLocking(true);
    try {
      // Pure gate first (draft + confirmed + rights + complete anchors) —
      // the service lock guard then runs on the actual call.
      assertEnvironmentLockAllowed(targetVersion, spec, {
        confirmed: true,
        rightsAcknowledged,
      });
      await service.lockVersion(targetVersion.id, SEED_ENVIRONMENT_WORKSPACE_ID);
      toast({
        title: `Environment v${targetVersion.versionNumber} locked`,
        description: 'The defining anchors are now protected. Future changes create a new version.',
        tone: 'success',
      });
      setConfirmOpen(false);
      await data.reload();
      navigate(`/environments/${environmentId}`);
    } catch (err) {
      toast({
        title: 'Lock failed',
        description: err instanceof Error ? err.message : 'Something went wrong.',
        tone: 'error',
      });
      setConfirmOpen(false);
    } finally {
      setLocking(false);
    }
  }

  return (
    <div className="lf-page">
      <header className="lf-pageheader">
        <div>
          <div className="lf-pageheader__eyebrow">REVIEW</div>
          <h1 className="lf-pageheader__title">Lock and save your environment</h1>
          <p className="lf-pageheader__description">{LOCK_REVIEW_COPY}</p>
        </div>
        <div className="lf-pageheader__actions">
          <Link className="lf-btn lf-btn--secondary" to={`/environments/${environmentId}/edit?version=${targetVersion.id}`}>
            Back to edit
          </Link>
        </div>
      </header>

      {specError ? <div className="lf-alertbox" role="alert">{specError}</div> : null}

      <div className="lf-envlock__layout">
        <div className="lf-section" style={{ gap: 'var(--lf-space-4)' }}>
          <div className="lf-envprofile__preview lf-envprofile__preview--lg" aria-hidden="true">
            <EnvironmentIcon size={48} />
            <span>Room preview placeholder</span>
          </div>

          <Card>
            <CardBody>
              <div className="lf-models-toolbar">
                <Badge tone="primary" dot>Reviewing draft</Badge>
                <strong>v{targetVersion.versionNumber}</strong>
                <span className="lf-tile__description">
                  {targetVersion.changeSummary || 'No change summary yet.'}
                </span>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardBody>
              <h3 className="lf-envpanel__heading">Lock summary checklist</h3>
              {spec === null && !specError ? (
                <Skeleton lines={5} />
              ) : spec ? (
                <ul className="lf-envlock__checklist">
                  {checks.map((check) => (
                    <li key={check.key} className={check.complete ? 'lf-envlock__check' : 'lf-envlock__check lf-envlock__check--missing'}>
                      <span aria-hidden="true">{check.complete ? '✓' : check.required ? '✕' : '–'}</span>
                      <div>
                        <strong>{check.label}</strong>
                        <span className="lf-tile__description">
                          {check.key === 'productZone'
                            ? jsonToText(spec.productZone)
                            : check.key === 'furnitureAnchors'
                              ? jsonToText(spec.furnitureAnchors)
                              : check.key === 'signatureProps'
                                ? jsonToText(spec.signatureProps)
                                : check.key === 'paletteMaterials'
                                  ? jsonToText(spec.paletteMaterials)
                                  : check.key === 'roomType'
                                    ? `${spec.roomType} — ${spec.layoutFeel}`
                                    : check.key === 'heroAngle'
                                      ? spec.heroAngle
                                      : spec.lightingStyle}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}
              {missing.length > 0 ? (
                <p className="lf-envlock__missingnote" role="status">
                  Complete the required anchors in the editor before locking:{' '}
                  {missing.map((check) => check.label).join(', ')}.
                </p>
              ) : null}
            </CardBody>
          </Card>
        </div>

        <div className="lf-section" style={{ gap: 'var(--lf-space-4)' }}>
          <Card>
            <CardBody>
              <h3 className="lf-envpanel__heading">Lock level</h3>
              <p className="lf-tile__description">
                <strong>{targetVersion.lockLevel}</strong> — {LOCK_LEVEL_HELP[targetVersion.lockLevel]} Change it
                from the editor while the version is still a draft.
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardBody>
              <h3 className="lf-envpanel__heading">Version rules</h3>
              <p className="lf-envpanel__note">{VERSION_RULES_COPY}</p>
            </CardBody>
          </Card>

          <Card>
            <CardBody>
              <h3 className="lf-envpanel__heading">Before you lock</h3>
              <label className="lf-envlock__rights">
                <input
                  type="checkbox"
                  checked={rightsAcknowledged}
                  onChange={(event) => setRightsAcknowledged(event.target.checked)}
                />
                <span>{RIGHTS_CONFIRMATION_COPY}</span>
              </label>
              <Input
                label="Usage tags (optional)"
                value={usageTags}
                onChange={(event) => setUsageTags(event.target.value)}
                placeholder={USAGE_TAG_SUGGESTIONS.join(', ')}
                hint="Comma-separated, e.g. UGC, Product demo, Skincare. Stored on this draft's summary."
              />
            </CardBody>
          </Card>

          <div className="lf-dialogactions">
            <Link className="lf-btn lf-btn--secondary" to={`/environments/${environmentId}/edit?version=${targetVersion.id}`}>
              Back to edit
            </Link>
            <Button
              onClick={() =>
                toast({
                  title: 'Draft already saved',
                  description: 'Every editor change is saved as a draft — this review page makes no further edits.',
                  tone: 'info',
                })
              }
              disabled={locking}
            >
              Save as draft
            </Button>
            <Button
              variant="primary"
              leftIcon={<LockIcon size={14} />}
              disabled={!lockReady || locking}
              title={lockReady ? undefined : 'Tick the rights confirmation and complete all required anchors'}
              onClick={() => setConfirmOpen(true)}
            >
              {locking ? 'Locking…' : `Lock environment v${targetVersion.versionNumber}`}
            </Button>
          </div>
        </div>
      </div>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={`Lock environment v${targetVersion.versionNumber}?`}
        size="sm"
        footer={
          <div className="lf-dialogactions">
            <Button onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => void handleLockConfirmed()} disabled={locking}>
              Lock environment
            </Button>
          </div>
        }
      >
        <p>
          Locking protects this environment version. It cannot be edited afterward. Future changes
          create a new version and never overwrite this one.
        </p>
        <p className="lf-tile__description">
          {targetVersion.lockLevel} lock — {LOCK_LEVEL_HELP[targetVersion.lockLevel]}
        </p>
      </Modal>
    </div>
  );
}
