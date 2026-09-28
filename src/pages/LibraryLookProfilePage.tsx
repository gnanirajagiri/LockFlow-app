/**
 * Saved Look profile — model association, presentation notes and the
 * canonical item list (linked asset names route to their asset profiles).
 * The model's Character Sheet is never shown or edited here.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Card, CardBody } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { LibraryIcon, PlusIcon, SparkIcon } from '../components/icons';
import { LibraryService } from '../services/libraryService';
import { ModelsService } from '../services/modelsService';
import { getLibraryRepository } from '../data/libraryFactory';
import { getModelsRepository } from '../data';
import { SEED_LIBRARY_WORKSPACE_ID } from '../mock/librarySeed';
import { LOOK_IDENTITY_NOTE } from '../features/library/libraryUi';
import type {
  LibraryAssetRecord,
  LibraryAssetVersionRecord,
  LookAssetItemRecord,
  LookDetailsRecord,
} from '../domain/library';
import type { ModelRecord } from '../domain/models';

interface ItemRow {
  item: LookAssetItemRecord;
  asset: LibraryAssetRecord | null;
}

export function LibraryLookProfilePage() {
  const { assetId } = useParams();
  const navigate = useNavigate();
  const service = useMemo(() => new LibraryService(getLibraryRepository()), []);
  const modelsService = useMemo(() => new ModelsService(getModelsRepository()), []);

  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [asset, setAsset] = useState<LibraryAssetRecord | null>(null);
  const [version, setVersion] = useState<LibraryAssetVersionRecord | null>(null);
  const [details, setDetails] = useState<LookDetailsRecord | null>(null);
  const [model, setModel] = useState<ModelRecord | null>(null);
  const [itemRows, setItemRows] = useState<ItemRow[] | null>(null);

  const load = useCallback(async () => {
    if (!assetId) return;
    setState('loading');
    setError(null);
    try {
      const workspaceId = SEED_LIBRARY_WORKSPACE_ID;
      const record = await service.getAsset(assetId, workspaceId);
      if (record.assetType !== 'look') {
        // Not a Look — send to the regular asset profile.
        navigate(`/library/${record.id}`, { replace: true });
        return;
      }
      const versions = await service.getVersions(assetId, workspaceId);
      const active =
        versions.find((entry) => entry.status === 'draft') ??
        versions.find((entry) => entry.id === record.activeVersionId) ??
        versions[0] ??
        null;
      const lookDetails = active ? await service.getLookDetails(active.id, workspaceId) : null;
      const modelRecord = lookDetails
        ? await modelsService.getModel(lookDetails.modelId, workspaceId).catch(() => null)
        : null;
      const items = lookDetails ? await service.getLookItems(lookDetails.id, workspaceId) : [];
      const rows: ItemRow[] = await Promise.all(
        items
          .slice()
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map(async (item) => ({
            item,
            asset: await service.getAsset(item.libraryAssetId, workspaceId).catch(() => null),
          })),
      );
      setAsset(record);
      setVersion(active);
      setDetails(lookDetails);
      setModel(modelRecord);
      setItemRows(rows);
      setState('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this Look.');
      setState('error');
    }
  }, [assetId, modelsService, navigate, service]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state === 'loading') {
    return (
      <div className="lf-page" aria-busy="true">
        <Skeleton variant="rect" height={64} />
        <Skeleton variant="title" />
        <Skeleton lines={4} />
      </div>
    );
  }

  if (state === 'error' || !asset) {
    return (
      <div className="lf-page">
        <EmptyState
          icon={<SparkIcon size={22} />}
          title={error?.includes('not found') ? 'Look not found' : "Couldn't load this Look"}
          description={error ?? undefined}
          actions={
            <Link className="lf-btn lf-btn--primary" to="/library/looks">
              Back to Looks
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="lf-page">
      <PageHeader
        eyebrow="Library · Saved Look"
        title={asset.name}
        description={asset.description ?? LOOK_IDENTITY_NOTE}
        actions={
          <>
            <Link className="lf-btn lf-btn--secondary" to="/library/looks">
              Back to Looks
            </Link>
            <Link className="lf-btn lf-btn--secondary" to={`/library/${asset.id}`}>
              <span className="lf-btn__icon" aria-hidden="true">
                <LibraryIcon size={14} />
              </span>
              Asset profile
            </Link>
            {version?.status === 'draft' ? (
              <Button variant="primary" onClick={() => navigate(`/library/${asset.id}/details?version=${version.id}`)}>
                Edit draft
              </Button>
            ) : (
              <Link className="lf-btn lf-btn--primary" to={`/library/${asset.id}/versions`}>
                <span className="lf-btn__icon" aria-hidden="true">
                  <PlusIcon size={14} />
                </span>
                New draft version
              </Link>
            )}
          </>
        }
      />

      <p className="lf-library__note" role="note">{LOOK_IDENTITY_NOTE}</p>

      <div className="lf-statgrid">
        <div className="lf-statcard">
          <span className="lf-statcard__label">Version</span>
          <span className="lf-statcard__value">{version ? `v${version.versionNumber}` : '—'}</span>
          <span className="lf-statcard__hint">{version?.changeSummary || 'No change summary yet.'}</span>
        </div>
        <div className="lf-statcard">
          <span className="lf-statcard__label">Status</span>
          <span className="lf-statcard__value">
            <Badge tone={version?.status === 'locked' ? 'locked' : 'primary'}>
              {version ? version.status : 'no version'}
            </Badge>
          </span>
          <span className="lf-statcard__hint">{version ? `Rights: ${version.rightsStatus}` : ''}</span>
        </div>
        <div className="lf-statcard">
          <span className="lf-statcard__label">Model</span>
          <span className="lf-statcard__value">
            {model ? (
              <Link to={`/models/${model.id}`}>{model.name}</Link>
            ) : (
              details?.modelId ?? '—'
            )}
          </span>
          <span className="lf-statcard__hint">Presentation association only</span>
        </div>
      </div>

      <Card>
        <CardBody>
          <h3 className="lf-envpanel__heading">Presentation notes</h3>
          {details?.presentationNotes ? (
            <p className="lf-tile__description">{details.presentationNotes}</p>
          ) : (
            <p className="lf-tile__description">No presentation notes recorded.</p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <h3 className="lf-envpanel__heading">Items</h3>
          {itemRows === null ? (
            <Skeleton lines={2} />
          ) : itemRows.length === 0 ? (
            <p className="lf-tile__description">
              No items linked yet. Edit the Look's draft version or recreate the Look to add
              canonical Library items.
            </p>
          ) : (
            <ol className="lf-library__lookitems">
              {itemRows.map(({ item, asset: itemAsset }) => (
                <li key={item.id} className="lf-library__lookitem">
                  <span className="lf-library__lookitemnum" aria-hidden="true">{item.sortOrder + 1}</span>
                  <span className="lf-library__lookitembody">
                    {itemAsset ? (
                      <Link to={`/library/${itemAsset.id}`}>
                        <strong>{itemAsset.name}</strong>
                      </Link>
                    ) : (
                      <strong>{item.libraryAssetId}</strong>
                    )}
                    <span className="lf-library__lookitemmeta">
                      role: {item.role}
                      {item.libraryAssetVersionId
                        ? ` · pinned to an exact version`
                        : ' · follows the asset\u2019s active version'}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
