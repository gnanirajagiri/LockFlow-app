/**
 * Shared data-loading hook for the environment profile routes.
 *
 * Mirrors useModelData (Models) with the promise-based `reload` so callers
 * can await fresh data before navigating to newly created records.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { EnvironmentsService } from '../../services/environmentsService';
import type { EnvironmentRecord, EnvironmentVersionRecord } from '../../domain/environments';

export type LoadState = 'loading' | 'error' | 'ready';

export interface EnvironmentState {
  state: LoadState;
  error: string | null;
  environment: EnvironmentRecord | null;
  versions: EnvironmentVersionRecord[];
  activeVersion: EnvironmentVersionRecord | null;
  /** Refetches environment + versions. Resolves once fresh data is in state. */
  reload: () => Promise<void>;
}

export function useEnvironmentData(
  service: EnvironmentsService,
  environmentId: string | undefined,
  activeWorkspaceId: string,
): EnvironmentState {
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [environment, setEnvironment] = useState<EnvironmentRecord | null>(null);
  const [versions, setVersions] = useState<EnvironmentVersionRecord[]>([]);
  const [tick, setTick] = useState(0);
  const resolversRef = useRef<Array<() => void>>([]);

  const reload = useCallback(() => {
    return new Promise<void>((resolve) => {
      resolversRef.current.push(resolve);
      setTick((value) => value + 1);
    });
  }, []);

  useEffect(() => {
    if (!environmentId) return;
    let cancelled = false;
    setState('loading');
    setError(null);

    (async () => {
      try {
        const record = await service.getEnvironment(environmentId, activeWorkspaceId);
        const list = await service.getVersions(environmentId, activeWorkspaceId);
        if (!cancelled) {
          setEnvironment(record);
          setVersions(list);
          setState('ready');
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load this environment.');
          setState('error');
        }
      } finally {
        const pending = resolversRef.current;
        resolversRef.current = [];
        for (const resolve of pending) resolve();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [service, environmentId, activeWorkspaceId, tick]);

  const activeVersion =
    environment?.activeVersionId != null
      ? versions.find((version) => version.id === environment.activeVersionId) ?? null
      : null;

  return { state, error, environment, versions, activeVersion, reload };
}

/** Finds the currently-open draft version, if the environment has one. */
export function findDraftEnvironmentVersion(
  versions: EnvironmentVersionRecord[],
): EnvironmentVersionRecord | null {
  return versions.find((version) => version.status === 'draft') ?? null;
}
