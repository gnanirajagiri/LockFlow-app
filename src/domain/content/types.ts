/**
 * Content Studio domain — types.
 *
 * Content Studio assembles approved reusable inputs into content plans and
 * future generation jobs. It owns NOTHING: models, environments, Library
 * assets and Looks stay canonical and independently reusable. Every
 * execution-relevant selection is pinned to an exact locked version — newer
 * versions are never silently substituted after a brief or job is created.
 *
 * Generated outputs are never Content Studio records — they belong to
 * Gallery (future). A Content Project is a plan/brief; a Content Job
 * Request is the future generation request with immutable snapshots.
 */
export type ContentProjectStatus = 'draft' | 'ready' | 'archived';

export type ContentInputType = 'model' | 'environment' | 'library_asset' | 'look';

export type ContentInputRole =
  | 'primary_model'
  | 'environment'
  | 'look'
  | 'product'
  | 'prop'
  | 'wardrobe'
  | 'accessory'
  | 'creator_tool'
  | 'brand_asset'
  | 'reference'
  | 'other';

export type ContentOutputType = 'photo' | 'video' | 'story' | 'content_set';

export type ContentJobStatus =
  | 'draft'
  | 'queued'
  | 'processing'
  | 'review'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface ContentProjectRecord {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  status: ContentProjectStatus;
  campaignBrief: string | null;
  objective: string | null;
  audience: string | null;
  brandVoice: string | null;
  /** Phase-1 planned format — captured on the plan, not the job. */
  plannedOutputType: ContentOutputType | null;
  /** Requested variants per planned output (1–10). */
  requestedVariants: number;
  /** Natural-language creative direction captured via the intent bar. */
  creativeDirection: string | null;
  /** Natural-language storyboard direction captured via the intent bar. */
  storyboardDirection: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContentProjectInputRecord {
  id: string;
  contentProjectId: string;
  inputType: ContentInputType;
  /** Exactly one target triple is populated, per inputType. */
  modelId: string | null;
  modelVersionId: string | null;
  environmentId: string | null;
  environmentVersionId: string | null;
  libraryAssetId: string | null;
  libraryAssetVersionId: string | null;
  role: ContentInputRole;
  sortOrder: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContentSceneRecord {
  id: string;
  contentProjectId: string;
  title: string;
  purpose: string | null;
  sceneOrder: number;
  settingNotes: string | null;
  shotNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContentBeatRecord {
  id: string;
  contentSceneId: string;
  title: string;
  beatOrder: number;
  actionDescription: string | null;
  dialogueOrOverlay: string | null;
  cameraDirection: string | null;
  durationSeconds: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContentJobRequestRecord {
  id: string;
  workspaceId: string;
  contentProjectId: string | null;
  name: string;
  requestedOutputType: ContentOutputType;
  status: ContentJobStatus;
  /** Brief at creation time — historic, never rewritten by later edits. */
  briefSnapshot: Record<string, unknown>;
  /** Plan snapshot at creation time — scenes, beats, selections. */
  planSnapshot: Record<string, unknown>;
  requestedVariants: number;
  providerName: string | null;
  providerRequestId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  submittedAt: string | null;
  completedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContentJobPinRecord {
  id: string;
  contentJobRequestId: string;
  pinType: 'model_version' | 'environment_version' | 'library_asset_version' | 'look_version';
  sourceRecordId: string;
  sourceVersionId: string;
  /** Minimal immutable context snapshot — NOT a duplicate of the source row. */
  resolvedDetails: Record<string, unknown>;
  role: ContentInputRole;
  sortOrder: number;
  createdAt: string;
}

export interface ContentJobEventRecord {
  id: string;
  contentJobRequestId: string;
  eventType: string;
  message: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

/** A project input resolved into a specific version (used by the resolver). */
export interface ResolvedProjectInput {
  input: ContentProjectInputRecord;
  versionId: string;
  versionStatus: 'draft' | 'locked' | 'superseded';
  versionNumber: number;
  /** Look items resolved to exact versions (pinned, or the asset's active locked version). */
  lookItems?: Array<{
    libraryAssetId: string;
    libraryAssetVersionId: string;
    role: ContentInputRole;
    sortOrder: number;
  }>;
}

// ── Input payloads ──────────────────────────────────────────────────────────

export interface CreateContentProjectInput {
  workspaceId: string;
  name: string;
  slug?: string;
  campaignBrief?: string;
  objective?: string;
  audience?: string;
  brandVoice?: string;
  plannedOutputType?: ContentOutputType;
  requestedVariants?: number;
}

export interface UpdateContentProjectDraftInput {
  name?: string;
  campaignBrief?: string | null;
  objective?: string | null;
  audience?: string | null;
  brandVoice?: string | null;
  plannedOutputType?: ContentOutputType | null;
  requestedVariants?: number;
  creativeDirection?: string | null;
  storyboardDirection?: string | null;
}

export interface CreateContentProjectInputPayload {
  contentProjectId: string;
  inputType: ContentInputType;
  modelId?: string;
  modelVersionId?: string;
  environmentId?: string;
  environmentVersionId?: string;
  libraryAssetId?: string;
  libraryAssetVersionId?: string;
  role: ContentInputRole;
  notes?: string;
}

export interface CreateContentSceneInput {
  contentProjectId: string;
  title: string;
  purpose?: string;
  settingNotes?: string;
  shotNotes?: string;
}

export interface UpdateContentSceneInput {
  title?: string;
  purpose?: string | null;
  settingNotes?: string | null;
  shotNotes?: string | null;
}

export interface CreateContentBeatInput {
  contentSceneId: string;
  title: string;
  actionDescription?: string;
  dialogueOrOverlay?: string;
  cameraDirection?: string;
  durationSeconds?: number;
}

export interface UpdateContentBeatInput {
  title?: string;
  actionDescription?: string | null;
  dialogueOrOverlay?: string | null;
  cameraDirection?: string | null;
  durationSeconds?: number | null;
}

export interface CreateContentJobRequestInput {
  workspaceId: string;
  contentProjectId?: string;
  name: string;
  requestedOutputType: ContentOutputType;
  requestedVariants?: number;
  briefSnapshot?: Record<string, unknown>;
  planSnapshot?: Record<string, unknown>;
}
