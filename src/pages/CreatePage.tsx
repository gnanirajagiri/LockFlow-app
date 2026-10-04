/**
 * Maya Create overview — the hub above the builders. Mirrors the product
 * mockup: Model Builder and Environment Builder hero cards with live
 * locked-version state, quick create entry into Content Studio, and a
 * recent-drafts strip fed by real Gallery outputs.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/layout/PageHeader';
import { Card, CardBody } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Skeleton } from '../components/ui/Skeleton';
import { EnvironmentIcon, LockIcon, ModelIcon, SparkIcon, StudioIcon } from '../components/icons';
import { ModelsService } from '../services/modelsService';
import { EnvironmentsService } from '../services/environmentsService';
import { getGalleryRepository } from '../data/galleryFactory';
import { getModelsRepository } from '../data';
import { getEnvironmentsRepository } from '../data/environmentsFactory';
import { SEED_GALLERY_WORKSPACE_ID } from '../mock/gallerySeed';
import type { GalleryOutputRecord } from '../domain/gallery/types';

interface BuilderState {
  total: number;
  locked: number;
  loading: boolean;
}

interface DraftState {
  outputs: GalleryOutputRecord[];
  loading: boolean;
}

export function CreatePage() {
  const navigate = useNavigate();
  const [models, setModels] = useState<BuilderState>({ total: 0, locked: 0, loading: true });
  const [environments, setEnvironments] = useState<BuilderState>({ total: 0, locked: 0, loading: true });
  const [drafts, setDrafts] = useState<DraftState>({ outputs: [], loading: true });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const modelsService = new ModelsService(getModelsRepository());
        const environmentsService = new EnvironmentsService(getEnvironmentsRepository());
        const [modelRows, environmentRows] = await Promise.all([
          modelsService.listModels(SEED_GALLERY_WORKSPACE_ID),
          environmentsService.listEnvironments(SEED_GALLERY_WORKSPACE_ID),
        ]);
        if (cancelled) return;
        const lockCount = (statuses: Array<string | null>) =>
          statuses.filter((status) => status === 'locked').length;
        setModels({
          total: modelRows.length,
          locked: lockCount(
            (await Promise.all(modelRows.map((model) => modelsService.getVersions(model.id, SEED_GALLERY_WORKSPACE_ID))))
              .flatMap((versions) => versions.map((version) => version.status)),
          ),
          loading: false,
        });
        setEnvironments({
          total: environmentRows.length,
          locked: lockCount(
            (await Promise.all(
              environmentRows.map((environment) => environmentsService.getVersions(environment.id, SEED_GALLERY_WORKSPACE_ID)),
            )).flatMap((versions) => versions.map((version) => version.status)),
          ),
          loading: false,
        });
      } catch {
        if (!cancelled) {
          setModels((current) => ({ ...current, loading: false }));
          setEnvironments((current) => ({ ...current, loading: false }));
        }
      }
    })();
    void (async () => {
      try {
        const outputs = await getGalleryRepository().listOutputs(SEED_GALLERY_WORKSPACE_ID);
        if (!cancelled) setDrafts({ outputs: outputs.slice(0, 4), loading: false });
      } catch {
        if (!cancelled) setDrafts({ outputs: [], loading: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="lf-page">
      <PageHeader
        title="Create reusable assets"
        description="Models and environments are built separately, locked independently, and combined later in Content Studio."
      />

      <div className="lf-creategrid">
        <Card className="lf-createcard">
          <CardBody>
            <div className="lf-createcard__head">
              <span className="lf-createcard__icon lf-createcard__icon--model" aria-hidden="true">
                <ModelIcon size={22} />
              </span>
              <div>
                <h2 className="lf-createcard__title">Model Builder</h2>
                <p className="lf-tile__description">Create or import your presenter.</p>
              </div>
              <span className="lf-createcard__lockchip">
                <LockIcon size={12} /> {models.loading ? '…' : `${models.locked} locked`}
              </span>
            </div>
            <div className="lf-createcard__media lf-createcard__media--model" aria-hidden="true">
              <ModelIcon size={40} />
            </div>
            <p className="lf-createcard__body">
              Build your reusable presenter with AI or import your own. Lock the model version when it&apos;s ready —
              locked versions are generation-ready assets.
            </p>
            <div className="lf-createcard__actions">
              <span className="lf-createcard__state">
                {models.loading ? <Skeleton lines={1} /> : (
                  <>
                    <Badge tone={models.total > 0 ? 'success' : 'neutral'}>
                      {models.total > 0 ? `${models.total} model${models.total === 1 ? '' : 's'}` : 'No models yet'}
                    </Badge>
                    <Badge tone="neutral">version-safe</Badge>
                  </>
                )}
              </span>
              <button type="button" className="lf-btn lf-btn--primary" onClick={() => navigate('/models')}>
                Open Model Builder <span aria-hidden="true">→</span>
              </button>
            </div>
          </CardBody>
        </Card>

        <Card className="lf-createcard">
          <CardBody>
            <div className="lf-createcard__head">
              <span className="lf-createcard__icon lf-createcard__icon--env" aria-hidden="true">
                <EnvironmentIcon size={22} />
              </span>
              <div>
                <h2 className="lf-createcard__title">Environment Builder</h2>
                <p className="lf-tile__description">Create your reusable setting.</p>
              </div>
              <span className="lf-createcard__lockchip">
                <LockIcon size={12} /> {environments.loading ? '…' : `${environments.locked} locked`}
              </span>
            </div>
            <div className="lf-createcard__media lf-createcard__media--env" aria-hidden="true">
              <EnvironmentIcon size={40} />
            </div>
            <p className="lf-createcard__body">
              Build your reusable environment with consistent lighting, style and atmosphere — a separate system from
              models, with its own locks and versions.
            </p>
            <div className="lf-createcard__actions">
              <span className="lf-createcard__state">
                {environments.loading ? <Skeleton lines={1} /> : (
                  <>
                    <Badge tone={environments.total > 0 ? 'success' : 'neutral'}>
                      {environments.total > 0 ? `${environments.total} environment${environments.total === 1 ? '' : 's'}` : 'No environments yet'}
                    </Badge>
                    <Badge tone="neutral">independent</Badge>
                  </>
                )}
              </span>
              <button type="button" className="lf-btn lf-btn--primary" onClick={() => navigate('/environments')}>
                Open Environment Builder <span aria-hidden="true">→</span>
              </button>
            </div>
          </CardBody>
        </Card>
      </div>

      <Card style={{ marginTop: 'var(--lf-space-4)' }}>
        <CardBody>
          <div className="lf-createquick">
            <div className="lf-createquick__item">
              <span className="lf-createquick__icon" aria-hidden="true"><StudioIcon size={18} /></span>
              <div>
                <strong>Create Image</strong>
                <span className="lf-tile__description">High-quality images from your locked model and assets.</span>
              </div>
              <Link className="lf-btn lf-btn--secondary lf-btn--sm" to="/content-studio">Start</Link>
            </div>
            <div className="lf-createquick__item">
              <span className="lf-createquick__icon" aria-hidden="true"><SparkIcon size={18} /></span>
              <div>
                <strong>Create Video</strong>
                <span className="lf-tile__description">Short-form and long-form video with consistent continuity.</span>
              </div>
              <Link className="lf-btn lf-btn--secondary lf-btn--sm" to="/content-studio">Start</Link>
            </div>
            <div className="lf-createquick__item">
              <span className="lf-createquick__icon" aria-hidden="true"><StudioIcon size={18} /></span>
              <div>
                <strong>Create Content Set</strong>
                <span className="lf-tile__description">Plan a campaign with multiple deliverables at once.</span>
              </div>
              <Link className="lf-btn lf-btn--secondary lf-btn--sm" to="/content-studio">Plan</Link>
            </div>
          </div>
        </CardBody>
      </Card>

      <Card style={{ marginTop: 'var(--lf-space-4)' }}>
        <CardBody>
          <div className="lf-envcard__badges">
            <h3 className="lf-envpanel__heading" style={{ margin: 0 }}>Recent work</h3>
            <Link className="lf-btn lf-btn--ghost lf-btn--sm" to="/gallery">View all →</Link>
          </div>
          {drafts.loading ? (
            <Skeleton lines={2} />
          ) : drafts.outputs.length === 0 ? (
            <p className="lf-tile__description">
              Nothing generated yet — start in Content Studio and your outputs will appear here and in Gallery.
            </p>
          ) : (
            <div className="lf-tilegrid">
              {drafts.outputs.map((output) => (
                <Card key={output.id} interactive onClick={() => navigate('/gallery')}>
                  <CardBody>
                    <span className="lf-quicklink__title">{output.title}</span>
                    <span className="lf-tile__meta">
                      <Badge tone={output.status === 'approved' ? 'success' : output.status === 'rejected' ? 'danger' : 'neutral'}>
                        {output.status.replace('_', ' ')}
                      </Badge>
                      <Badge tone="neutral">{output.outputType}</Badge>
                    </span>
                  </CardBody>
                </Card>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
