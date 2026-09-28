/**
 * Shared data-loading hook for the Library asset profile routes — mirrors
 * useEnvironmentData (promise-based reload so navigation after mutations
 * always sees fresh data).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LibraryService } from '../../services/libraryService';
import type {
  LibraryAssetRecord,
  LibraryAssetVersionRecord,
  LibraryTagRecord,
} from '../../domain/library';

export type LoadState = 'loading' | 'error' | 'ready';

export interface LibraryAssetState {
  state: LoadState;
  error: string | null;
  asset: LibraryAssetRecord | null;
  versions: LibraryAssetVersionRecord[];
  activeVersion: LibraryAssetVersionRecord | null;
  tags: LibraryTagRecord[];
  reload: () => Promise<void>;
}

export function useLibraryAssetData(
  service: LibraryService,
  assetId: string | undefined,
  activeWorkspaceId: string,
): LibraryAssetState {
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [asset, setAsset] = useState<LibraryAssetRecord | null>(null);
  const [versions, setVersions] = useState<LibraryAssetVersionRecord[]>([]);
  const [tags, setTags] = useState<LibraryTagRecord[]>([]);
  const [tick, setTick] = useState(0);
  const resolversRef = useRef<Array<() => void>>([]);

  const reload = useCallback(() => {
    return new Promise<void>((resolve) => {
      resolversRef.current.push(resolve);
      setTick((value) => value + 1);
    });
  }, []);

  useEffect(() => {
    if (!assetId) return;
    let cancelled = false;
    setState('loading');
    setError(null);

    (async () => {
      try {
        const record = await service.getAsset(assetId, activeWorkspaceId);
        const list = await service.getVersions(assetId, activeWorkspaceId);
        const assetTagList = await service.getTagsForAsset(assetId, activeWorkspaceId);
        if (!cancelled) {
          setAsset(record);
          setVersions(list);
          setTags(assetTagList);
          setState('ready');
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load this asset.');
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
  }, [service, assetId, activeWorkspaceId, tick]);

  const activeVersion =
    asset?.activeVersionId != null
      ? versions.find((version) => version.id === asset.activeVersionId) ?? null
      : null;

  return { state, error, asset, versions, activeVersion, tags, reload };
}

export function findDraftAssetVersion(
  versions: LibraryAssetVersionRecord[],
): LibraryAssetVersionRecord | null {
  return versions.find((version) => version.status === 'draft') ?? null;
}

/** Version selector default: open draft, else active, else first. */
export function useSelectedAssetVersion(
  versions: LibraryAssetVersionRecord[],
  activeVersionId: string | null,
  requested: string | null,
): LibraryAssetVersionRecord | null {
  return useMemo(() => {
    if (requested) {
      const match = versions.find((version) => version.id === requested);
      if (match) return match;
    }
    return (
      findDraftAssetVersion(versions) ??
      versions.find((version) => version.id === activeVersionId) ??
      versions[0] ??
      null
    );
  }, [versions, activeVersionId, requested]);
}
