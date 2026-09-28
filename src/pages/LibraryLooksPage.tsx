/**
 * Saved Looks index — every look-type Library asset in the workspace, with
 * its model association and item count. Looks are canonical Library assets;
 * they change presentation, never protected model identity.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Card, CardBody } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { LibraryIcon, PlusIcon, SparkIcon } from '../components/icons';
import { LibraryService } from '../services/libraryService';
import { getLibraryRepository } from '../data/libraryFactory';
import { SEED_LIBRARY_WORKSPACE_ID } from '../mock/librarySeed';
import { LOOKS_HEADER_COPY, LOOK_IDENTITY_NOTE } from '../features/library/libraryUi';
import type { LookDetailsRecord } from '../domain/library';
import type { ModelRecord } from '../domain/models';

interface LookRow {
  assetId: string;
  name: string;
  slug: string;
  status: string;
  description: string | null;
  modelId: string | null;
  modelName: string | null;
  itemCount: number | null;
}

export function LibraryLooksPage() {
  const service = useMemo(() => new LibraryService(getLibraryRepository()), []);
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<LookRow[]>([]);

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const workspaceId = SEED_LIBRARY_WORKSPACE_ID;
      const looks = await service.listLooks(workspaceId);
      const loaded: LookRow[] = await Promise.all(
        looks.map(async (look) => {
          const details = await service.getLookDetailsForAsset(look.id, workspaceId);
          return {
            assetId: look.id,
            name: look.name,
            slug: look.slug,
            status: look.status,
            description: look.description,
            modelId: details?.modelId ?? null,
            modelName: details ? await resolveModelName(details) : null,
            itemCount: details ? (await service.getLookItems(details.id, workspaceId)).length : null,
          };
        }),
      );
      async function resolveModelName(details: LookDetailsRecord): Promise<string | null> {
        try {
          const { ModelsService } = await import('../services/modelsService');
          const { getModelsRepository } = await import('../data');
          const modelsService = new ModelsService(getModelsRepository());
          const model: ModelRecord = await modelsService.getModel(details.modelId, workspaceId);
          return model.name;
        } catch {
          return details.modelId;
        }
      }
      setRows(loaded);
      setState('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load Looks.');
      setState('error');
    }
  }, [service]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="lf-page">
      <PageHeader
        eyebrow="Library"
        title="Saved Looks"
        description={LOOKS_HEADER_COPY}
        actions={
          <Link className="lf-btn lf-btn--primary" to="/library/looks/new">
            <span className="lf-btn__icon" aria-hidden="true">
              <PlusIcon size={14} />
            </span>
            New Look
          </Link>
        }
      />

      <p className="lf-library__note" role="note">{LOOK_IDENTITY_NOTE}</p>

      {state === 'loading' ? (
        <div className="lf-envgrid" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} variant="rect" height={140} />
          ))}
        </div>
      ) : null}

      {state === 'error' ? (
        <EmptyState
          icon={<SparkIcon size={22} />}
          title="Couldn't load Looks"
          description={error ?? undefined}
          actions={
            <Button variant="primary" onClick={() => void load()}>
              Try again
            </Button>
          }
        />
      ) : null}

      {state === 'ready' ? (
        rows.length === 0 ? (
          <EmptyState
            icon={<SparkIcon size={22} />}
            title="No saved Looks yet"
            description="Create a Look to combine wardrobe, accessories and products from your Library into a reusable styling setup for a model."
            actions={
              <Link className="lf-btn lf-btn--primary" to="/library/looks/new">
                <span className="lf-btn__icon" aria-hidden="true">
                  <PlusIcon size={14} />
                </span>
                New Look
              </Link>
            }
          />
        ) : (
          <div className="lf-library__looklist" role="list">
            {rows.map((row) => (
              <Card key={row.assetId} role="listitem">
                <CardBody>
                  <div className="lf-envcard">
                    <div className="lf-envcard__cover" aria-hidden="true">
                      <SparkIcon size={24} />
                    </div>
                    <div className="lf-envcard__body">
                      <div className="lf-envcard__title">
                        <h2>
                          <Link to={`/library/looks/${row.assetId}`}>{row.name}</Link>
                        </h2>
                        <span className="lf-envcard__slug">/{row.slug}</span>
                      </div>
                      <div className="lf-envcard__badges">
                        <Badge tone={row.status === 'ready' ? 'success' : 'neutral'} dot>{row.status}</Badge>
                        <Badge tone="neutral">Saved Look</Badge>
                        {row.modelName ? <Badge tone="info">Model: {row.modelName}</Badge> : null}
                        {row.itemCount !== null ? (
                          <Badge tone="neutral">
                            {row.itemCount} {row.itemCount === 1 ? 'item' : 'items'}
                          </Badge>
                        ) : null}
                      </div>
                      {row.description ? <p className="lf-envcard__summary">{row.description}</p> : null}
                    </div>
                    <div className="lf-envcard__actions">
                      <Link className="lf-btn lf-btn--secondary lf-btn--sm" to={`/library/looks/${row.assetId}`}>
                        Open
                      </Link>
                      <Link className="lf-btn lf-btn--ghost lf-btn--sm" to={`/library/${row.assetId}`}>
                        <span className="lf-btn__icon" aria-hidden="true">
                          <LibraryIcon size={14} />
                        </span>
                        Asset profile
                      </Link>
                    </div>
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>
        )
      ) : null}
    </div>
  );
}
