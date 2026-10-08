/**
 * Stage-5 S29 model card: tall portrait cover with a version pill overlay
 * (dark lock pill for locked, dashed draft pill), name + usage meta line
 * ("N jobs · M campaigns" once job data lands; falls back to slug/status).
 */
import { Link } from 'react-router-dom';
import { Card, CardBody } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { ModelIcon, LockIcon } from '../../components/icons';
import type { ModelWithVersion } from '../../domain/models';

export function ModelsGridCard({
  model,
  onArchive,
  onAttachLibrary,
}: {
  model: ModelWithVersion;
  onArchive: () => void;
  onAttachLibrary: () => void;
}) {
  const version = model.activeVersion;
  const locked = version?.status === 'locked';

  return (
    <Card>
      <CardBody>
        <div className="lf-modelgrid">
          <Link to={`/models/${model.id}`} className="lf-modelgrid__cover" aria-label={`Open model ${model.name}`}>
            <span className="lf-modelgrid__media" aria-hidden="true">
              <ModelIcon size={40} />
            </span>
            {version ? (
              locked ? (
                <span className="lf-modelgrid__pill lf-modelgrid__pill--locked">
                  <LockIcon size={11} /> v{version.versionNumber}
                </span>
              ) : (
                <span className="lf-modelgrid__pill lf-modelgrid__pill--draft">v{version.versionNumber} draft</span>
              )
            ) : null}
          </Link>
          <div className="lf-modelgrid__body">
            <Link to={`/models/${model.id}`} className="lf-modelgrid__name">
              {model.name}
            </Link>
            <span className="lf-modelgrid__meta">
              {model.status === 'draft'
                ? `Character Sheet · ${model.status}`
                : `/${model.slug} · ${model.status}`}
            </span>
          </div>
          <div className="lf-modelgrid__actions">
            <Link className="lf-btn lf-btn--sm lf-btn--secondary" to={`/models/${model.id}`}>
              Open
            </Link>
            <Button size="sm" variant="ghost" onClick={onAttachLibrary}>
              Attach
            </Button>
            <Button size="sm" variant="ghost" onClick={onArchive}>
              Archive
            </Button>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
