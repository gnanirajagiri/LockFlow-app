/**
 * Environment Overview tab — active version + lock summary, protected-anchor
 * summary, continuity explainer, and the required reusability note.
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Card, CardBody } from '../../components/ui/Card';
import { Skeleton } from '../../components/ui/Skeleton';
import { EnvironmentIcon, LibraryIcon, LockIcon } from '../../components/icons';
import { LibraryService } from '../../services/libraryService';
import { getLibraryRepository } from '../../data/libraryFactory';
import { SEED_LIBRARY_WORKSPACE_ID } from '../../mock/librarySeed';
import { jsonToText } from './envDiff';
import { LOCK_LEVEL_HELP } from './envLockReview';
import { useUsageSummary } from '../usage/useUsageSummary';
import type { useEnvironmentData } from './useEnvironmentData';
import type {
  EnvironmentAssetShortcutRecord,
  EnvironmentSpecRecord,
  EnvironmentVersionRecord,
} from '../../domain/environments';
import type { LibraryAssetRecord } from '../../domain/library';

/**
 * Resolves the environment's Library shortcut pointers against the ONE shared
 * Library. Shortcuts are reads only — they never copy assets or write here.
 */
function useEnvironmentShortcuts(environmentId: string | undefined): Array<{
  shortcut: EnvironmentAssetShortcutRecord;
  asset: LibraryAssetRecord | null;
}> | null {
  const [rows, setRows] = useState<Array<{
    shortcut: EnvironmentAssetShortcutRecord;
    asset: LibraryAssetRecord | null;
  }> | null>(null);

  useEffect(() => {
    if (!environmentId) return;
    let cancelled = false;
    (async () => {
      try {
        const { EnvironmentsService } = await import('../../services/environmentsService');
        const { getEnvironmentsRepository } = await import('../../data/environmentsFactory');
        const workspaceId = SEED_LIBRARY_WORKSPACE_ID;
        const envService = new EnvironmentsService(getEnvironmentsRepository());
        const libraryService = new LibraryService(getLibraryRepository());
        const shortcuts = await envService.listAssetShortcuts(environmentId, workspaceId);
        const resolved = await Promise.all(
          shortcuts
            .slice()
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map(async (shortcut) => ({
              shortcut,
              asset: shortcut.libraryAssetId
                ? await libraryService.getAsset(shortcut.libraryAssetId, workspaceId).catch(() => null)
                : null,
            })),
        );
        if (!cancelled) setRows(resolved);
      } catch {
        if (!cancelled) setRows([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [environmentId]);

  return rows;
}

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
  const { environmentId } = useParams();

  const usage = useUsageSummary('environment', environmentId);
  const [spec, setSpec] = useState<EnvironmentSpecRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shortcutRows = useEnvironmentShortcuts(environmentId);

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
            <h3 className="lf-envpanel__heading">Library shortcuts</h3>
            <p className="lf-tile__description">
              Quick-access pointers to reusable products, props and lighting assets in the one
              shared Library. Shortcuts reference canonical records — they never copy them.
            </p>
            {shortcutRows === null ? (
              <Skeleton lines={2} />
            ) : shortcutRows.length === 0 ? (
              <p className="lf-tile__description">No shortcuts yet for this environment.</p>
            ) : (
              <ul className="lf-envref__list">
                {shortcutRows.map(({ shortcut, asset }) => (
                  <li key={shortcut.id} className="lf-envref__item">
                    {asset ? (
                      <Link to={`/library/${asset.id}`}>
                        <strong>{asset.name}</strong>
                      </Link>
                    ) : (
                      <strong>{shortcut.libraryAssetId ?? 'Unlinked shortcut'}</strong>
                    )}
                    <span className="lf-tile__description">
                      Library shortcut · {shortcut.category}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="lf-envpanel__actions">
              <Link className="lf-btn lf-btn--secondary lf-btn--sm" to="/library">
                <span className="lf-btn__icon" aria-hidden="true">
                  <LibraryIcon size={14} />
                </span>
                Open Library
              </Link>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <h3 className="lf-envpanel__heading">Recent generated output</h3>
            {usage === null ? (
              <p className="lf-tile__description">Loading usage…</p>
            ) : usage.outputs.length === 0 ? (
              <p className="lf-tile__description">
                Generated outputs appear in Gallery. This panel shows a lightweight summary
                only — no outputs are created or stored here.
              </p>
            ) : (
              <>
                <p className="lf-tile__description">
                  Pinned by {usage.outputs.length} generated output
                  {usage.outputs.length === 1 ? '' : 's'} (via job provenance, stored in
                  Gallery):
                </p>
                <ul className="lf-envref__list">
                  {usage.outputs.map((output) => (
                    <li key={output.id} className="lf-envref__item">
                      <Link to={output.path}>
                        <strong>{output.title}</strong>
                      </Link>
                      <span className="lf-tile__description">
                        Gallery · {output.status.replace(/_/g, ' ')}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {usage !== null && usage.plans.length > 0 ? (
              <p className="lf-tile__description">
                Selected by:{' '}
                {usage.plans.map((plan, index) => (
                  <span key={plan.path}>
                    {index > 0 ? ', ' : ''}
                    <Link to={plan.path}>
                      <strong>{plan.name}</strong>
                    </Link>
                  </span>
                ))}
              </p>
            ) : null}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
