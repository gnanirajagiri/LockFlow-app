import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Card, CardBody } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { Modal } from '../components/ui/Modal';
import { StudioIcon, EnvironmentIcon, LockIcon } from '../components/icons';
import { EnvironmentsService } from '../services/environmentsService';
import { getEnvironmentsRepository } from '../data/environmentsFactory';
import { SEED_ENVIRONMENT_WORKSPACE_ID } from '../mock/environmentsSeed';
import type { EnvironmentWithVersion } from '../domain/environments';

type LoadState = 'loading' | 'error' | 'ready';

const STATUS_TONE = {
  draft: 'neutral',
  ready: 'success',
  archived: 'warning',
} as const;

const LOCK_LEVEL_TONE = {
  flexible: 'neutral',
  balanced: 'info',
  strict: 'warning',
} as const;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Environments index — lightweight foundation on the new Environments data
 * layer. The guided Environment Builder is a later milestone; this page only
 * lists environments and opens a placeholder for creation.
 */
export function EnvironmentsPage() {
  const service = useMemo(() => new EnvironmentsService(getEnvironmentsRepository()), []);
  const [state, setState] = useState<LoadState>('loading');
  const [environments, setEnvironments] = useState<EnvironmentWithVersion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      // Workspace switching arrives with the Workspace features; until then
      // both demo and configured mode read the seed workspace.
      const workspaceId = SEED_ENVIRONMENT_WORKSPACE_ID;
      const list = await service.listEnvironments(workspaceId);
      const enriched = await Promise.all(
        list.map(async (environment) => ({
          ...environment,
          activeVersion: environment.activeVersionId
            ? (await service.getVersion(environment.activeVersionId, workspaceId)) ?? null
            : null,
        })),
      );
      setEnvironments(enriched);
      setState('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load environments.');
      setState('error');
    }
  }, [service]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="lf-page">
      <PageHeader
        eyebrow="BUILDER"
        title="Environments"
        description="Reusable places for your content — versioned and locked independently of models."
        actions={
          <Button variant="primary" leftIcon={<StudioIcon size={14} />} onClick={() => setCreateOpen(true)}>
            New environment
          </Button>
        }
      />

      {state === 'loading' ? (
        <div aria-busy="true">
          <Skeleton variant="rect" height={120} />
          <div style={{ height: 'var(--lf-space-3)' }} />
          <Skeleton variant="rect" height={120} />
        </div>
      ) : null}

      {state === 'error' ? (
        <EmptyState
          icon={<EnvironmentIcon size={22} />}
          title="Couldn't load environments"
          description={error ?? undefined}
          actions={<Button onClick={() => void load()}>Try again</Button>}
        />
      ) : null}

      {state === 'ready' && environments.length === 0 ? (
        <EmptyState
          icon={<EnvironmentIcon size={22} />}
          title="Create your first environment"
          description="Environments are reusable places — version them, lock the approved setup, and reference it from content jobs later."
          actions={
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              New environment
            </Button>
          }
        />
      ) : null}

      {state === 'ready' && environments.length > 0 ? (
        <div className="lf-envgrid" role="list">
          {environments.map((environment) => {
            const active = environment.activeVersion;
            const locked = active?.status === 'locked';
            return (
              <Card key={environment.id} role="listitem">
                <CardBody>
                  <div className="lf-envcard">
                    <div className="lf-envcard__cover" aria-hidden="true">
                      <EnvironmentIcon size={26} />
                    </div>
                    <div className="lf-envcard__body">
                      <div className="lf-envcard__title">
                        <h2>{environment.name}</h2>
                        <span className="lf-envcard__slug">/{environment.slug}</span>
                      </div>
                      <div className="lf-envcard__badges">
                        <Badge tone={STATUS_TONE[environment.status]} dot>
                          {environment.status}
                        </Badge>
                        {active ? (
                          <Badge tone={locked ? 'locked' : 'primary'}>
                            {locked ? <LockIcon size={12} /> : null}
                            {`v${active.versionNumber} ${locked ? 'Locked' : 'Draft'}`}
                          </Badge>
                        ) : (
                          <Badge tone="neutral">no version yet</Badge>
                        )}
                        {active ? (
                          <Badge tone={LOCK_LEVEL_TONE[active.lockLevel]}>
                            {active.lockLevel} lock
                          </Badge>
                        ) : null}
                      </div>
                      {active?.changeSummary ? (
                        <p className="lf-envcard__summary">{active.changeSummary}</p>
                      ) : null}
                      <p className="lf-envcard__updated">
                        Updated {formatDate(environment.updatedAt)}
                      </p>
                    </div>
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      ) : null}

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New environment"
        size="sm"
        footer={
          <div className="lf-dialogactions">
            <Button onClick={() => setCreateOpen(false)}>Close</Button>
          </div>
        }
      >
        <p>
          The guided Environment Builder will be added next. It will compose room type, hero
          angle, lighting, furniture anchors, signature props and palette into a versioned,
          lockable environment spec — independent of models.
        </p>
        <p className="lf-tile__description">
          This milestone ships the Environments data foundation only; no environments can be
          created from the UI yet.
        </p>
      </Modal>
    </div>
  );
}
