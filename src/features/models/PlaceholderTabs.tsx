/**
 * Model profile panels — Closet & Props, Looks and Usage history.
 *
 * Closet & Props resolves the model's Library shortcut pointers live against
 * the ONE shared Library (canonical assets, never copies). Looks lists the
 * Saved Looks associated with this model from the Library. Usage history is a
 * lightweight read model over Content Studio plans + Gallery provenance pins.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardBody } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { LibraryIcon, GalleryIcon, PlusIcon, SparkIcon } from '../../components/icons';
import { LibraryService } from '../../services/libraryService';
import { getLibraryRepository } from '../../data/libraryFactory';
import { SEED_LIBRARY_WORKSPACE_ID } from '../../mock/librarySeed';
import { LOOK_IDENTITY_NOTE } from '../library/libraryUi';
import { useUsageSummary, usageSentence } from '../usage/useUsageSummary';
import { useModelOutletContext } from './tabRoutes';
import type { ModelAssetShortcutRecord } from '../../domain/models';
import type { LibraryAssetRecord } from '../../domain/library';

interface ShortcutRow {
  shortcut: ModelAssetShortcutRecord;
  asset: LibraryAssetRecord | null;
}

/** Resolves shortcut pointers to canonical Library assets (workspace-checked). */
function useModelShortcuts(modelId: string | undefined): ShortcutRow[] | null {
  const [rows, setRows] = useState<ShortcutRow[] | null>(null);

  useEffect(() => {
    if (!modelId) return;
    let cancelled = false;
    (async () => {
      try {
        const { ModelsService } = await import('../../services/modelsService');
        const { getModelsRepository } = await import('../../data');
        const workspaceId = SEED_LIBRARY_WORKSPACE_ID;
        const modelsService = new ModelsService(getModelsRepository());
        const libraryService = new LibraryService(getLibraryRepository());
        const shortcuts: ModelAssetShortcutRecord[] = await modelsService.listAssetShortcuts(
          modelId,
          workspaceId,
        );
        const resolved: ShortcutRow[] = await Promise.all(
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
  }, [modelId]);

  return rows;
}

export function ClosetPropsTab() {
  const { data } = useModelOutletContext();
  const modelId = data.model?.id;
  const rows = useModelShortcuts(modelId);

  return (
    <div className="lf-section">
      <Card>
        <CardBody>
          <div className="lf-sheet__section">
            <h3>Closet &amp; Props</h3>
            <p className="lf-tile__description">
              Quick-access shortcuts to reusable items in the one shared Library — wardrobe
              pieces, accessories, props and products. Shortcuts point at Library assets; they
              never duplicate them into a separate model library.
            </p>
            <div className="lf-modelprofile__actions-row" style={{ justifyContent: 'flex-start' }}>
              <Link className="lf-btn lf-btn--secondary lf-btn--sm" to="/library">
                <span className="lf-btn__icon" aria-hidden="true">
                  <LibraryIcon size={14} />
                </span>
                Open Library
              </Link>
              <Link className="lf-btn lf-btn--ghost lf-btn--sm" to="/library/new">
                <span className="lf-btn__icon" aria-hidden="true">
                  <PlusIcon size={14} />
                </span>
                Add asset in Library
              </Link>
            </div>
          </div>
        </CardBody>
      </Card>

      {rows === null ? (
        <Skeleton lines={3} />
      ) : rows.length === 0 ? (
        <EmptyState
          borderless
          icon={<LibraryIcon size={22} />}
          title="No shortcuts yet"
          description="Shortcuts added to this model will appear here, resolved against the shared Library. Nothing is stored on the model itself."
        />
      ) : (
        <ul className="lf-envref__list">
          {rows.map(({ shortcut, asset }) => (
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
                {asset && asset.assetType.replace('_', ' ') !== shortcut.category
                  ? ` · ${asset.assetType.replace('_', ' ')}`
                  : ''}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="lf-tile__description" style={{ marginTop: 'var(--lf-space-3)' }}>
        Each shortcut opens the canonical asset profile under <Link to="/library">/library</Link>,
        where versions, details, references and lock history live.
      </p>
    </div>
  );
}

export function LooksTab() {
  const { data } = useModelOutletContext();
  const modelId = data.model?.id;
  const [looks, setLooks] = useState<Array<{ id: string; name: string; status: string }> | null>(null);

  useEffect(() => {
    if (!modelId) return;
    let cancelled = false;
    (async () => {
      try {
        const libraryService = new LibraryService(getLibraryRepository());
        const workspaceId = SEED_LIBRARY_WORKSPACE_ID;
        const all = await libraryService.listLooks(workspaceId);
        const mine: Array<{ id: string; name: string; status: string }> = [];
        for (const look of all) {
          const details = await libraryService.getLookDetailsForAsset(look.id, workspaceId);
          if (details?.modelId === modelId) mine.push({ id: look.id, name: look.name, status: look.status });
        }
        if (!cancelled) setLooks(mine);
      } catch {
        if (!cancelled) setLooks([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [modelId]);

  return (
    <div className="lf-section">
      <Card>
        <CardBody>
          <div className="lf-sheet__section">
            <h3>Looks</h3>
            <p className="lf-tile__description">
              Reusable combinations of wardrobe and accessories — quick, consistent styling
              layers for this model. {LOOK_IDENTITY_NOTE}
            </p>
            <div className="lf-modelprofile__actions-row" style={{ justifyContent: 'flex-start' }}>
              <Link className="lf-btn lf-btn--secondary lf-btn--sm" to="/library/looks">
                <span className="lf-btn__icon" aria-hidden="true">
                  <SparkIcon size={14} />
                </span>
                All Saved Looks
              </Link>
              <Link className="lf-btn lf-btn--ghost lf-btn--sm" to="/library/looks/new">
                <span className="lf-btn__icon" aria-hidden="true">
                  <PlusIcon size={14} />
                </span>
                New Look in Library
              </Link>
            </div>
          </div>
        </CardBody>
      </Card>

      {looks === null ? (
        <Skeleton lines={2} />
      ) : looks.length === 0 ? (
        <EmptyState
          borderless
          icon={<SparkIcon size={22} />}
          title="No saved Looks for this model yet"
          description="Looks created in the Library for this model will appear here. No asset records are created in this view."
        />
      ) : (
        <ul className="lf-envref__list">
          {looks.map((look) => (
            <li key={look.id} className="lf-envref__item">
              <Link to={`/library/looks/${look.id}`}>
                <strong>{look.name}</strong>
              </Link>
              <span className="lf-tile__description">Saved Look · {look.status}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Usage history tab — where this model's identity has been used.
 *
 * Read-only summary over Content Studio plan selections and Gallery output
 * provenance pins. Nothing is created or stored here; outputs stay in Gallery
 * and are linked, never copied.
 */
export function UsageHistoryTab() {
  const { data } = useModelOutletContext();
  const usage = useUsageSummary('model', data.model?.id);
  return (
    <div className="lf-section">
      <Card>
        <CardBody>
          <div className="lf-sheet__section">
            <h3>Usage history</h3>
            {usage === null ? (
              <p className="lf-tile__description">Loading usage…</p>
            ) : (
              <p className="lf-tile__description">{usageSentence(usage, 'model')}</p>
            )}
          </div>
        </CardBody>
      </Card>
      {usage !== null && usage.outputs.length > 0 ? (
        <Card>
          <CardBody>
            <div className="lf-sheet__section">
              <h3>Generated outputs using this model</h3>
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
            </div>
          </CardBody>
        </Card>
      ) : null}
      {usage !== null && usage.plans.length > 0 ? (
        <Card>
          <CardBody>
            <div className="lf-sheet__section">
              <h3>Content plans selecting this model</h3>
              <ul className="lf-envref__list">
                {usage.plans.map((plan) => (
                  <li key={plan.path} className="lf-envref__item">
                    <Link to={plan.path}>
                      <strong>{plan.name}</strong>
                    </Link>
                    <span className="lf-tile__description">Content Studio plan</span>
                  </li>
                ))}
              </ul>
            </div>
          </CardBody>
        </Card>
      ) : null}
      <EmptyState
        borderless
        icon={<GalleryIcon size={22} />}
        title="No usage recorded yet"
        description="Once content plans select this model and jobs pin it, a summary of generated outputs will appear here."
        actions={
          <Link className="lf-btn lf-btn--secondary lf-btn--sm" to="/gallery">
            <span className="lf-btn__icon" aria-hidden="true">
              <GalleryIcon size={14} />
            </span>
            Open Gallery
          </Link>
        }
      />
    </div>
  );
}
