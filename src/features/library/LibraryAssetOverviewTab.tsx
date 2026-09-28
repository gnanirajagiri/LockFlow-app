/**
 * Library asset Overview tab — summary, tags, rights, version/lock summary,
 * the "Used in" placeholder, and Model/Environment shortcut summaries when
 * links exist. No Gallery outputs here.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Card, CardBody } from '../../components/ui/Card';
import { Skeleton } from '../../components/ui/Skeleton';
import { LibraryIcon, LockIcon } from '../../components/icons';
import { ModelsService } from '../../services/modelsService';
import { EnvironmentsService } from '../../services/environmentsService';
import { getModelsRepository } from '../../data';
import { getEnvironmentsRepository } from '../../data/environmentsFactory';
import { LibraryService } from '../../services/libraryService';
import { SEED_LIBRARY_WORKSPACE_ID } from '../../mock/librarySeed';
import { RIGHTS_LABELS } from './libraryUi';
import { useLibraryOutletContext } from './tabRoutes';
import type { EnvironmentAssetShortcutRecord } from '../../domain/environments';
import type { ModelAssetShortcutRecord } from '../../domain/models';

const USAGE_PANEL_COPY = 'Usage tracking will appear when Content Studio is available.';

function useShortcutSummary(
  libraryService: LibraryService,
  activeWorkspaceId: string,
): {
  byAsset: Record<string, Array<{ owner: string; ownerPath: string; kind: 'Model' | 'Environment'; category: string }>>;
} {
  const [byAsset, setByAsset] = useState<Record<string, Array<{ owner: string; ownerPath: string; kind: 'Model' | 'Environment'; category: string }>>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const modelsService = new ModelsService(getModelsRepository());
      const envService = new EnvironmentsService(getEnvironmentsRepository());
      const result: typeof byAsset = {};
      try {
        const models = await modelsService.listModels(activeWorkspaceId);
        for (const model of models) {
          const shortcuts: ModelAssetShortcutRecord[] = await modelsService.listAssetShortcuts(model.id, activeWorkspaceId);
          for (const shortcut of shortcuts) {
            if (!shortcut.libraryAssetId) continue;
            (result[shortcut.libraryAssetId] ??= []).push({
              owner: model.name,
              ownerPath: `/models/${model.id}/closet-props`,
              kind: 'Model',
              category: shortcut.category,
            });
          }
        }
        const environments = await envService.listEnvironments(activeWorkspaceId);
        for (const environment of environments) {
          const shortcuts: EnvironmentAssetShortcutRecord[] = await envService.listAssetShortcuts(environment.id, activeWorkspaceId);
          for (const shortcut of shortcuts) {
            if (!shortcut.libraryAssetId) continue;
            (result[shortcut.libraryAssetId] ??= []).push({
              owner: environment.name,
              ownerPath: `/environments/${environment.id}`,
              kind: 'Environment',
              category: shortcut.category,
            });
          }
        }
        if (!cancelled) setByAsset(result);
      } catch {
        if (!cancelled) setByAsset({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [libraryService, activeWorkspaceId]);

  return { byAsset };
}

export function LibraryAssetOverviewTab() {
  const { service, data, basePath } = useLibraryOutletContext();
  const asset = data.asset;
  const activeVersion = data.activeVersion;
  const { byAsset } = useShortcutSummary(service, SEED_LIBRARY_WORKSPACE_ID);

  const [usedByLooks, setUsedByLooks] = useState<string[] | null>(null);

  useEffect(() => {
    if (!asset) return;
    let cancelled = false;
    (async () => {
      try {
        const looks = await service.listLooks(SEED_LIBRARY_WORKSPACE_ID);
        const referencing: string[] = [];
        for (const look of looks) {
          const details = await service.getLookDetailsForAsset(look.id, SEED_LIBRARY_WORKSPACE_ID);
          if (!details) continue;
          const items = await service.getLookItems(details.id, SEED_LIBRARY_WORKSPACE_ID);
          if (items.some((item) => item.libraryAssetId === asset.id)) {
            referencing.push(look.name);
          }
        }
        if (!cancelled) setUsedByLooks(referencing);
      } catch {
        if (!cancelled) setUsedByLooks([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [service, asset?.id]);

  if (!asset) return null;
  const shortcuts = byAsset[asset.id] ?? [];
  const locked = activeVersion?.status === 'locked';

  return (
    <div className="lf-section" style={{ gap: 'var(--lf-space-4)' }}>
      <div className="lf-envprofile__preview" aria-hidden="true">
        <LibraryIcon size={40} />
        <span>Cover placeholder</span>
      </div>

      <div className="lf-statgrid">
        <div className="lf-statcard">
          <span className="lf-statcard__label">Active version</span>
          <span className="lf-statcard__value">
            {activeVersion ? `v${activeVersion.versionNumber}` : '—'}
          </span>
          <span className="lf-statcard__hint">{activeVersion?.changeSummary || 'No change summary yet.'}</span>
        </div>
        <div className="lf-statcard">
          <span className="lf-statcard__label">Lock status</span>
          <span className="lf-statcard__value">
            {locked ? <Badge tone="locked"><LockIcon size={12} /> Locked</Badge> : <Badge tone="primary">Draft — editable</Badge>}
          </span>
          <span className="lf-statcard__hint">
            {activeVersion ? RIGHTS_LABELS[activeVersion.rightsStatus] : ''}
          </span>
        </div>
      </div>

      {data.tags.length > 0 ? (
        <Card>
          <CardBody>
            <h3 className="lf-envpanel__heading">Tags</h3>
            <p className="lf-library__tags">
              {data.tags.map((tag) => (
                <span key={tag.id} className="lf-library__tag">{tag.name}</span>
              ))}
            </p>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardBody>
          <h3 className="lf-envpanel__heading">Used in</h3>
          <p className="lf-tile__description">{USAGE_PANEL_COPY}</p>
          {usedByLooks === null ? (
            <Skeleton lines={1} />
          ) : usedByLooks.length > 0 ? (
            <p className="lf-tile__description">
              In Looks:{' '}
              {usedByLooks.map((name, index) => (
                <span key={name}>
                  {index > 0 ? ', ' : ''}
                  <strong>{name}</strong>
                </span>
              ))}
            </p>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <h3 className="lf-envpanel__heading">Shortcuts</h3>
          {shortcuts.length === 0 ? (
            <p className="lf-tile__description">
              No model or environment shortcuts point at this asset yet. Shortcuts always
              reference this canonical record — they never copy it.
            </p>
          ) : (
            <ul className="lf-envref__list">
              {shortcuts.map((shortcut, index) => (
                <li key={`${shortcut.owner}-${index}`} className="lf-envref__item">
                  <Link to={shortcut.ownerPath}>
                    <strong>{shortcut.owner}</strong>
                  </Link>
                  <span className="lf-tile__description">
                    {shortcut.kind} shortcut · {shortcut.category}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <p className="lf-envpanel__note">
            This asset is reusable across models, environments, campaigns and future content
            jobs. It lives once in the Library; shortcuts and Look items reference it. Generated
            outputs appear in Gallery — never here.
          </p>
        </CardBody>
      </Card>

      <p className="lf-tile__description">
        <Link to={`${basePath}/versions`}>View version history</Link>
      </p>
    </div>
  );
}
