/**
 * Environment Overview tab — active version + lock summary, protected-anchor
 * summary, continuity explainer, and the required reusability note.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Card, CardBody } from '../../components/ui/Card';
import { Skeleton } from '../../components/ui/Skeleton';
import { EnvironmentIcon, LockIcon } from '../../components/icons';
import { jsonToText } from './envDiff';
import { LOCK_LEVEL_HELP } from './envLockReview';
import type { useEnvironmentData } from './useEnvironmentData';
import type { EnvironmentSpecRecord, EnvironmentVersionRecord } from '../../domain/environments';

const REUSABILITY_NOTE =
  'This environment is reusable across models and campaigns. Selecting a model later does not change the environment.';

interface OverviewTabProps {
  environmentName: string;
  activeVersion: EnvironmentVersionRecord | null;
  service: import('../../services/environmentsService').EnvironmentsService;
  data: ReturnType<typeof useEnvironmentData>;
  basePath: string;
  activeWorkspaceId: string;
}

function AnchorRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="lf-sheet__section">
      <h4>{label}</h4>
      <div className={value.trim() === '' ? 'lf-readonly lf-readonly--empty' : 'lf-readonly'}>
        {value.trim() === '' ? 'Not recorded yet' : value}
      </div>
    </div>
  );
}

export function EnvironmentOverviewTab({
  environmentName,
  activeVersion,
  service,
  basePath,
  activeWorkspaceId,
}: OverviewTabProps) {
  void environmentName; // shown in the page header; kept for panel copy later
  const [spec, setSpec] = useState<EnvironmentSpecRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeVersion) return;
    let cancelled = false;
    service
      .getSpec(activeVersion.id, activeWorkspaceId)
      .then((record) => {
        if (!cancelled) {
          setSpec(record);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load the spec.');
      });
    return () => {
      cancelled = true;
    };
  }, [service, activeVersion?.id, activeWorkspaceId]);

  const locked = activeVersion?.status === 'locked';

  return (
    <div className="lf-envprofile__layout">
      <div className="lf-section" style={{ gap: 'var(--lf-space-4)' }}>
        <div className="lf-envprofile__preview" aria-hidden="true">
          <EnvironmentIcon size={40} />
          <span>Room preview placeholder</span>
        </div>

        {error ? <div className="lf-alertbox" role="alert">{error}</div> : null}

        <div className="lf-statgrid">
          <div className="lf-statcard">
            <span className="lf-statcard__label">Active version</span>
            <span className="lf-statcard__value">
              {activeVersion ? `v${activeVersion.versionNumber}` : '—'}
            </span>
            <span className="lf-statcard__hint">
              {activeVersion?.changeSummary || 'No change summary yet.'}
            </span>
          </div>
          <div className="lf-statcard">
            <span className="lf-statcard__label">Lock status</span>
            <span className="lf-statcard__value">
              {locked ? <Badge tone="locked"><LockIcon size={12} /> Locked</Badge> : <Badge tone="primary">Draft — editable</Badge>}
            </span>
            <span className="lf-statcard__hint">
              {activeVersion ? `${activeVersion.lockLevel} — ${LOCK_LEVEL_HELP[activeVersion.lockLevel]}` : ''}
            </span>
          </div>
        </div>

        <Card>
          <CardBody>
            <h3 className="lf-envpanel__heading">Protected anchors</h3>
            {spec === null && !error ? (
              <Skeleton lines={4} />
            ) : spec ? (
              <>
                <AnchorRow label="Room type and layout feel" value={`${spec.roomType} — ${spec.layoutFeel}`} />
                <AnchorRow label="Hero angle" value={spec.heroAngle} />
                <AnchorRow label="Lighting style" value={spec.lightingStyle} />
                <AnchorRow label="Key furniture anchors" value={jsonToText(spec.furnitureAnchors)} />
                <AnchorRow label="Signature props" value={jsonToText(spec.signatureProps)} />
                <AnchorRow label="Palette and material direction" value={jsonToText(spec.paletteMaterials)} />
                <AnchorRow label="Product zone (optional)" value={jsonToText(spec.productZone)} />
              </>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <h3 className="lf-envpanel__heading">How continuity works</h3>
            <p className="lf-tile__description">
              Locking freezes this version's defining anchors — room type and layout feel, hero
              angle, lighting style, furniture anchors, signature props and palette/materials.
              Content jobs reference the locked version, so the setting stays consistent. Any
              change after locking creates a new draft version; the locked one is preserved
              forever. Props and products attach from the one shared Library at job time.
            </p>
            <div className="lf-envpanel__actions">
              <Link className="lf-btn lf-btn--secondary" to={`${basePath}/edit`}>
                View specs
              </Link>
              <Link className="lf-btn lf-btn--secondary" to={`${basePath}/versions`}>
                View version history
              </Link>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <p className="lf-envpanel__note">{REUSABILITY_NOTE}</p>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <h3 className="lf-envpanel__heading">Recent generated output</h3>
            <p className="lf-tile__description">
              Generated outputs appear in Gallery. This panel shows a lightweight summary only —
              no outputs are created or stored here.
            </p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
