import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Card, CardBody } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { Modal } from '../components/ui/Modal';
import { ModelIcon, LockIcon } from '../components/icons';
import { ModelsService } from '../services/modelsService';
import { getModelsRepository } from '../data';
import { isDemoMode } from '../lib/env';
import { SEED_WORKSPACE_ID } from '../mock/modelsSeed';
import type { ModelWithVersion } from '../domain/models';

type LoadState = 'loading' | 'error' | 'ready';

const STATUS_TONE = {
  draft: 'neutral',
  ready: 'success',
  archived: 'warning',
} as const;

export function ModelsPage() {
  const service = useMemo(() => new ModelsService(getModelsRepository()), []);

  const [state, setState] = useState<LoadState>('loading');
  const [models, setModels] = useState<ModelWithVersion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newModalOpen, setNewModalOpen] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      // Workspace switching arrives with the Workspace features; until then
      // both demo and configured mode read the seed workspace.
      const workspaceId = SEED_WORKSPACE_ID;
      const list = await service.listModels(workspaceId);
      const enriched = await Promise.all(
        list.map(async (model) => ({
          ...model,
          activeVersion:
            model.activeVersionId != null
              ? await service.getVersion(model.activeVersionId, workspaceId).catch(() => null)
              : null,
        })),
      );
      setModels(enriched);
      setState('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load models.');
      setState('error');
    }
  }, [service]);

  useEffect(() => {
    void load();
  }, [load]);

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  return (
    <div className="lf-page">
      <PageHeader
        eyebrow="Builder"
        title="Models"
        description="Reusable models with versioned, lockable Character Sheets. Identity traits only — wardrobe, props and environments attach from the shared Library at job time."
        actions={
          <Button variant="primary" onClick={() => setNewModalOpen(true)}>
            New model
          </Button>
        }
      />

      {state === 'loading' ? (
        <div className="lf-tilegrid" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <Card key={i}>
              <CardBody>
                <div style={{ display: 'grid', gap: 'var(--lf-space-3)' }}>
                  <Skeleton variant="title" />
                  <Skeleton lines={2} />
                  <Skeleton variant="rect" height={56} />
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      ) : null}

      {state === 'error' ? (
        <EmptyState
          icon={<ModelIcon size={22} />}
          title="Couldn't load models"
          description={error}
          actions={
            <Button variant="primary" onClick={() => void load()}>
              Try again
            </Button>
          }
        />
      ) : null}

      {state === 'ready' && models.length === 0 ? (
        <EmptyState
          icon={<ModelIcon size={22} />}
          title="Create your first model"
          description="Define a Character Sheet — face, hair, complexion, body and distinctive details — then version it and lock it before content jobs reference it."
          actions={
            <Button variant="primary" onClick={() => setNewModalOpen(true)}>
              New model
            </Button>
          }
        />
      ) : null}

      {state === 'ready' && models.length > 0 ? (
        <div className="lf-tilegrid">
          {models.map((model) => (
            <Card key={model.id} interactive tabIndex={0} role="button" aria-label={`Open model ${model.name}`}>
              <CardBody>
                <div className="lf-modelcard">
                  <div className="lf-modelcard__header">
                    <span className="lf-quicklink__icon" aria-hidden="true">
                      <ModelIcon size={20} />
                    </span>
                    <div>
                      <div className="lf-tile__title">{model.name}</div>
                      <div className="lf-modelcard__slug">/{model.slug}</div>
                    </div>
                  </div>

                  <div className="lf-modelcard__meta">
                    <Badge tone={STATUS_TONE[model.status]} dot>
                      {model.status}
                    </Badge>
                    {model.activeVersion ? (
                      <Badge tone="locked">
                        <LockIcon size={12} /> v{model.activeVersion.versionNumber} active
                      </Badge>
                    ) : (
                      <Badge tone="neutral">no active version</Badge>
                    )}
                  </div>

                  {model.activeVersion?.changeSummary ? (
                    <p className="lf-tile__description">
                      {model.activeVersion.changeSummary}
                    </p>
                  ) : null}

                  <div className="lf-modelcard__footer">
                    Updated {formatDate(model.updatedAt)}
                  </div>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      ) : null}

      <NewModelPlaceholderModal open={newModalOpen} onClose={() => setNewModalOpen(false)} />
    </div>
  );
}

function NewModelPlaceholderModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New model"
      description="Model creation arrives with the Model Builder workflow."
      size="sm"
      footer={
        <Button variant="primary" onClick={onClose}>
          Got it
        </Button>
      }
    >
      <p>
        This milestone ships the Models data foundation: versioned Character
        Sheets, locking rules and workspace security. Creating a real model —
        naming, Character Sheet editing and version management — arrives with
        the Model Builder workflow.
      </p>
      {isDemoMode ? (
        <p style={{ marginTop: 'var(--lf-space-3)' }}>
          <strong>Demo mode:</strong> the seeded model “Aisha” demonstrates the
          locked v1 → draft v2 flow. Try the data layer in{' '}
          <code>src/domain/models</code> and <code>src/services</code>.
        </p>
      ) : null}
    </Modal>
  );
}
