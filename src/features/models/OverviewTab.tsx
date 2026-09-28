/**
 * Overview tab — the model's high-level panel.
 *
 * Shows active version + lock status, the identity-protection summary and
 * stat placeholders. Environments, props and wardrobe are separate reusable
 * assets (attached at job time); generated work lives in Gallery, never here.
 */
import { Link } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Card, CardBody } from '../../components/ui/Card';
import { LockIcon, ModelIcon } from '../../components/icons';
import { useUsageSummary } from '../usage/useUsageSummary';
import type { ModelVersionRecord } from '../../domain/models';

interface OverviewTabProps {
  modelId: string;
  modelName: string;
  activeVersion: ModelVersionRecord | null;
  basePath: string;
}

export function OverviewTab({ modelId, modelName, activeVersion, basePath }: OverviewTabProps) {
  const locked = activeVersion?.status === 'locked';
  const usage = useUsageSummary('model', modelId);

  return (
    <div className="lf-section" style={{ gap: 'var(--lf-space-4)' }}>
      <Card>
        <CardBody>
          <div className="lf-modelprofile__hero">
            <div
              className="lf-modelcard__cover"
              style={{ height: 140, flex: '0 1 260px' }}
              aria-hidden="true"
            >
              <span className="lf-quicklink__icon">
                <ModelIcon size={26} />
              </span>
            </div>
            <div className="lf-sheet__section" style={{ flex: 1, minWidth: 240 }}>
              <h2 style={{ fontSize: 'var(--lf-text-lg)' }}>Active version</h2>
              {activeVersion ? (
                <>
                  <div className="lf-modelprofile__badges">
                    <Badge tone={locked ? 'locked' : 'primary'}>
                      {locked ? <LockIcon size={12} /> : null}
                      v{activeVersion.versionNumber} {locked ? 'Locked' : 'Draft'}
                    </Badge>
                    <Badge tone={locked ? 'locked' : 'primary'}>{locked ? 'Identity protected' : 'Draft — editable'}</Badge>
                  </div>
                  <p className="lf-tile__description">
                    v{activeVersion.versionNumber} — {activeVersion.changeSummary || 'No change summary yet.'}
                    {activeVersion.lockedAt
                      ? ` Locked ${new Date(activeVersion.lockedAt).toLocaleDateString()}.`
                      : ' Not locked yet.'}
                  </p>
                  <div className="lf-modelprofile__actions-row" style={{ justifyContent: 'flex-start' }}>
                    <Link className="lf-btn lf-btn--secondary lf-btn--sm" to={`${basePath}/character-sheet`}>
                      View Character Sheet
                    </Link>
                    <Link className="lf-btn lf-btn--ghost lf-btn--sm" to={`${basePath}/versions`}>
                      View version history
                    </Link>
                  </div>
                </>
              ) : (
                <p className="lf-tile__description">
                  This model has no active version yet. Create and lock a Character Sheet to make
                  it ready for content jobs.
                </p>
              )}
            </div>
          </div>
        </CardBody>
      </Card>

      <div className="lf-statgrid">
        <StatCard label="Saved looks" value="—" note="Looks arrive with the shared Library" />
        <StatCard label="Shortcut assets" value="—" note="Managed in the shared Library" />
        <StatCard label="Linked environments" value="—" note="Environments are separate reusable assets" />
        <StatCard
          label="Generated outputs"
          value={usage === null ? '…' : String(usage.outputs.length)}
          note="Pinned via job provenance in Gallery"
        />
      </div>

      <Card>
        <CardBody>
          <div className="lf-sheet__section">
            <h3>Identity protection</h3>
            <p className="lf-tile__description">
              {locked
                ? `The active Character Sheet of ${modelName} is locked — its face, hair, complexion, body and distinctive details are permanently read-only. Any change starts a new draft version.`
                : `The active Character Sheet of ${modelName} is a draft. Edit it freely, then lock it to protect the identity before content jobs reference it.`}
            </p>
            <p className="lf-tile__description">
              Environments, props and wardrobe are <strong>separate reusable assets</strong> —
              they attach from the one shared Library at job time and are never part of a
              model's identity.
            </p>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <div className="lf-sheet__section">
            <h3>Recent generated output</h3>
            {usage === null ? null : usage.outputs.length === 0 ? (
              <p className="lf-tile__description" data-testid="gallery-placeholder">
                Generated work appears in Gallery.
              </p>
            ) : (
              <>
                <p className="lf-tile__description">
                  Pinned by {usage.outputs.length} generated output
                  {usage.outputs.length === 1 ? '' : 's'} (via job provenance, stored in Gallery):
                </p>
                <ul className="lf-envref__list">
                  {usage.outputs.map((output) => (
                    <li key={output.id} className="lf-envref__item">
                      <Link to={output.path}>
                        <strong>{output.title}</strong>
                      </Link>
                      <span className="lf-tile__description">Gallery · {output.status.replace(/_/g, ' ')}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {usage && usage.plans.length > 0 ? (
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
            <span className="lf-versionrow__dates">
              This area shows a lightweight historical summary only — no outputs are created or
              stored here.
            </span>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function StatCard({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <Card className="lf-statcard">
      <span className="lf-statcard__label">{label}</span>
      <span className="lf-statcard__value">{value}</span>
      <span className="lf-statcard__note">{note}</span>
    </Card>
  );
}
