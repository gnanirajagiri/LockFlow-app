/**
 * Content Studio repository contract.
 *
 * UI never calls Supabase directly; it goes through the ContentStudioService,
 * which applies domain guards, which then calls one of these adapters.
 */
import type {
  ContentBeatRecord,
  ContentJobEventRecord,
  ContentJobPinRecord,
  ContentJobRequestRecord,
  ContentProjectInputRecord,
  ContentProjectRecord,
  ContentSceneRecord,
  CreateContentProjectInput,
  UpdateContentProjectDraftInput,
} from '../domain/content';

/** Lightweight dashboard row: project plus denormalized plan facts. */
export interface ContentProjectSummary {
  project: ContentProjectRecord;
  inputCount: number;
  sceneCount: number;
  beatCount: number;
  modelName: string | null;
  environmentName: string | null;
}

export interface ContentRepository {
  // Projects
  listProjects(workspaceId: string): Promise<ContentProjectRecord[]>;
  getProject(projectId: string): Promise<ContentProjectRecord>;
  createProject(input: CreateContentProjectInput, createdBy: string): Promise<ContentProjectRecord>;
  updateProjectDraft(projectId: string, patch: UpdateContentProjectDraftInput): Promise<ContentProjectRecord>;
  /** Soft archive: status-only transition. */
  archiveProject(projectId: string): Promise<ContentProjectRecord>;
  /** Unique (workspace_id, slug); throws when taken. */
  assertSlugAvailable(workspaceId: string, slug: string): Promise<void>;

  // Project inputs
  listInputs(contentProjectId: string): Promise<ContentProjectInputRecord[]>;
  getInput(inputId: string): Promise<ContentProjectInputRecord>;
  addInput(
    input: Omit<ContentProjectInputRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ContentProjectInputRecord>;
  removeInput(inputId: string): Promise<void>;
  /** Persists a full order (transaction-safe in Supabase; straight write in mock). */
  reorderInputs(contentProjectId: string, orderedIds: string[]): Promise<void>;

  // Scenes
  listScenes(contentProjectId: string): Promise<ContentSceneRecord[]>;
  getScene(sceneId: string): Promise<ContentSceneRecord>;
  addScene(input: Omit<ContentSceneRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<ContentSceneRecord>;
  updateScene(sceneId: string, patch: Record<string, unknown>): Promise<ContentSceneRecord>;
  deleteScene(sceneId: string): Promise<void>;
  reorderScenes(contentProjectId: string, orderedIds: string[]): Promise<void>;

  // Beats
  listBeats(contentSceneId: string): Promise<ContentBeatRecord[]>;
  getBeat(beatId: string): Promise<ContentBeatRecord>;
  addBeat(input: Omit<ContentBeatRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<ContentBeatRecord>;
  updateBeat(beatId: string, patch: Record<string, unknown>): Promise<ContentBeatRecord>;
  deleteBeat(beatId: string): Promise<void>;
  reorderBeats(contentSceneId: string, orderedIds: string[]): Promise<void>;

  // Job requests
  listJobRequests(workspaceId: string): Promise<ContentJobRequestRecord[]>;
  getJobRequest(jobRequestId: string): Promise<ContentJobRequestRecord>;
  createJobRequest(
    input: Omit<ContentJobRequestRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ContentJobRequestRecord>;
  /** Status-only transitions guarded by the service; pins immutability enforced here too. */
  updateJobRequestStatus(jobRequestId: string, status: ContentJobRequestRecord['status']): Promise<ContentJobRequestRecord>;

  // Job pins (create during resolution; immutable afterwards)
  listJobPins(contentJobRequestId: string): Promise<ContentJobPinRecord[]>;
  createJobPins(pins: Array<Omit<ContentJobPinRecord, 'id' | 'createdAt'>>): Promise<ContentJobPinRecord[]>;
  removeJobPins(contentJobRequestId: string): Promise<void>;

  // Job events (append-only audit timeline)
  listJobEvents(contentJobRequestId: string): Promise<ContentJobEventRecord[]>;
  appendJobEvent(event: Omit<ContentJobEventRecord, 'id' | 'createdAt'>): Promise<ContentJobEventRecord>;
}
