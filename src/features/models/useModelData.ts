/**
 * Shared data-loading hook for the model profile routes.
 *
 * Loads the model, its versions and the active version in one place so the
 * layout and every tab agree on the same data. Errors are surfaced as state
 * (never thrown into the router).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ModelsService } from '../../services/modelsService';
import type { ModelRecord, ModelVersionRecord } from '../../domain/models';

export type LoadState = 'loading' | 'error' | 'ready';

export interface ModelState {
  state: LoadState;
  error: string | null;
  model: ModelRecord | null;
  versions: ModelVersionRecord[];
  activeVersion: ModelVersionRecord | null;
  /** Refetches model + versions. Resolves once fresh data is in state, so
   *  callers can await it before navigating to newly created records. */
  reload: () => Promise<void>;
}

export function useModelData(
  service: ModelsService,
  modelId: string | undefined,
  activeWorkspaceId: string,
): ModelState {
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<ModelRecord | null>(null);
  const [versions, setVersions] = useState<ModelVersionRecord[]>([]);
  const [tick, setTick] = useState(0);
  const resolversRef = useRef<Array<() => void>>([]);

  /** Bumps the load tick and resolves once the resulting load finishes. */
  const reload = useCallback(() => {
    return new Promise<void>((resolve) => {
      resolversRef.current.push(resolve);
      setTick((value) => value + 1);
    });
  }, []);

  useEffect(() => {
    if (!modelId) return;
    let cancelled = false;
    setState('loading');
    setError(null);

    (async () => {
      try {
        const record = await service.getModel(modelId, activeWorkspaceId);
        const list = await service.getVersions(modelId, activeWorkspaceId);
        if (!cancelled) {
          setModel(record);
          setVersions(list);
          setState('ready');
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load this model.');
          setState('error');
        }
      } finally {
        // Release anything awaiting reload() — even on cancellation, where
        // the awaiter has navigated away and must not hang.
        const pending = resolversRef.current;
        resolversRef.current = [];
        for (const resolve of pending) resolve();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [service, modelId, activeWorkspaceId, tick]);

  const activeVersion =
    model?.activeVersionId != null
      ? versions.find((version) => version.id === model.activeVersionId) ?? null
      : null;

  return { state, error, model, versions, activeVersion, reload };
}

/** Finds the currently-open draft version, if the model has one. */
export function findDraftVersion(versions: ModelVersionRecord[]): ModelVersionRecord | null {
  return versions.find((version) => version.status === 'draft') ?? null;
}
