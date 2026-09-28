/**
 * Shared data-loading hook for the Content Studio project routes — mirrors
 * useLibraryAssetData (promise-based reload so navigation after mutations
 * always sees fresh data).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ContentStudioService } from '../../services/contentService';
import type {
  ContentBeatRecord,
  ContentJobEventRecord,
  ContentJobPinRecord,
  ContentJobRequestRecord,
  ContentProjectInputRecord,
  ContentProjectRecord,
  ContentSceneRecord,
  ResolvedProjectInput,
} from '../../domain/content';

export type LoadState = 'loading' | 'error' | 'ready';

export interface ContentProjectState {
  state: LoadState;
  error: string | null;
  project: ContentProjectRecord | null;
  inputs: ContentProjectInputRecord[];
  scenes: ContentSceneRecord[];
  beatsByScene: Record<string, ContentBeatRecord[]>;
  /** Latest draft job request for this project, if any. */
  draftJob: ContentJobRequestRecord | null;
  jobEvents: ContentJobEventRecord[];
  reload: () => Promise<void>;
}

export function useContentProjectData(
  service: ContentStudioService,
  projectId: string | undefined,
  activeWorkspaceId: string,
): ContentProjectState {
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [project, setProject] = useState<ContentProjectRecord | null>(null);
  const [inputs, setInputs] = useState<ContentProjectInputRecord[]>([]);
  const [scenes, setScenes] = useState<ContentSceneRecord[]>([]);
  const [beatsByScene, setBeatsByScene] = useState<Record<string, ContentBeatRecord[]>>({});
  const [draftJob, setDraftJob] = useState<ContentJobRequestRecord | null>(null);
  const [jobEvents, setJobEvents] = useState<ContentJobEventRecord[]>([]);
  const [tick, setTick] = useState(0);
  const resolversRef = useRef<Array<() => void>>([]);

  const reload = useCallback(() => {
    return new Promise<void>((resolve) => {
      resolversRef.current.push(resolve);
      setTick((value) => value + 1);
    });
  }, []);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setState('loading');
    setError(null);

    (async () => {
      try {
        const record = await service.getProject(projectId, activeWorkspaceId);
        const [inputList, sceneList] = await Promise.all([
          service.listProjectInputs(projectId, activeWorkspaceId),
          service.listScenes(projectId, activeWorkspaceId),
        ]);
        const beatMap: Record<string, ContentBeatRecord[]> = {};
        for (const scene of sceneList) {
          beatMap[scene.id] = await service.listBeats(scene.id, activeWorkspaceId).catch(() => []);
        }
        const jobs = await service.listJobRequests(activeWorkspaceId).catch(() => []);
        const projectJob = jobs
          .filter((job) => job.contentProjectId === projectId)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
        const events = projectJob
          ? await service.listJobEvents(projectJob.id, activeWorkspaceId).catch(() => [])
          : [];
        if (!cancelled) {
          setProject(record);
          setInputs(inputList);
          setScenes(sceneList);
          setBeatsByScene(beatMap);
          setDraftJob(projectJob);
          setJobEvents(events);
          setState('ready');
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load this content plan.');
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
  }, [service, projectId, activeWorkspaceId, tick]);

  return { state, error, project, inputs, scenes, beatsByScene, draftJob, jobEvents, reload };
}

export type { ContentJobPinRecord, ResolvedProjectInput };
