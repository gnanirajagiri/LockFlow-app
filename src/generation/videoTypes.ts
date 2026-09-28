/**
 * Video generation — provider-neutral contracts (short-form Phase 1).
 *
 * PRODUCT BOUNDARY (non-negotiable): short-form clips (4/6/8 s) for Video and
 * Story output types only. No long-form timelines, audio generation, voice
 * cloning, lip sync or public streaming. Reuses the Prompt-12 generation
 * architecture: server-side only, immutable pins/snapshots, private ingestion.
 */
export type VideoProviderStatus = 'queued' | 'processing' | 'completed' | 'failed';

/** Phase-1 allowed clip durations (seconds). Nothing else is accepted. */
export const ALLOWED_DURATIONS = [4, 6, 8] as const;
export type AllowedDuration = (typeof ALLOWED_DURATIONS)[number];

/** Phase-1 allowed aspect ratios. Stories default to vertical 9:16. */
export const ALLOWED_ASPECT_RATIOS = ['9:16', '1:1', '16:9'] as const;
export type AllowedAspectRatio = (typeof ALLOWED_ASPECT_RATIOS)[number];

/** Phase-1 accepted output containers. */
export const ALLOWED_VIDEO_MIME_TYPES = ['video/mp4', 'video/webm'] as const;

export type VideoReferenceRole =
  | 'model_identity'
  | 'environment'
  | 'product'
  | 'prop'
  | 'wardrobe'
  | 'look'
  | 'other';

export interface VideoReferenceImage {
  role: VideoReferenceRole;
  /** Short-lived signed handle — never a permanent URL, never persisted. */
  urlOrSecureHandle: string;
  mimeType: string;
}

export interface SceneSnapshot {
  id: string;
  title: string;
  purpose: string | null;
  sceneOrder: number;
  settingNotes: string | null;
  shotNotes: string | null;
}

export interface BeatSnapshot {
  id: string;
  contentSceneId: string;
  title: string;
  beatOrder: number;
  actionDescription: string | null;
  /** Text guidance ONLY — dialogue text never implies generated speech. */
  dialogueOrOverlay: string | null;
  cameraDirection: string | null;
}

export interface VideoGenerationRequest {
  idempotencyKey: string;
  prompt: string;
  negativePrompt?: string;
  aspectRatio: AllowedAspectRatio;
  durationSeconds: AllowedDuration;
  outputCount: number;
  referenceImages: VideoReferenceImage[];
  sceneSnapshot?: SceneSnapshot;
  beatSnapshot?: BeatSnapshot;
  metadata: {
    lockflowJobId: string;
    workspaceId: string;
    pinSummary: unknown;
  };
}

export interface VideoGenerationResult {
  remoteUrlOrBytes: string;
  mimeType: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
  thumbnailRemoteUrlOrBytes?: string;
}

export interface VideoGenerationStatusResult {
  status: VideoProviderStatus;
  errorCode?: string;
  errorMessage?: string;
  results?: VideoGenerationResult[];
  providerMetadata?: unknown;
}

export interface VideoGenerationProvider {
  readonly providerName: string;
  isConfigured(): Promise<boolean>;
  submitVideoGeneration(input: VideoGenerationRequest): Promise<{
    providerRequestId: string;
    status: VideoProviderStatus;
  }>;
  getVideoGenerationStatus(providerRequestId: string): Promise<VideoGenerationStatusResult>;
}

/** Pin-type → provider role (mirrors the image map). */
export const VIDEO_PIN_ROLE_MAP: Record<string, VideoReferenceRole> = {
  model: 'model_identity',
  environment: 'environment',
  library_asset: 'product',
  look: 'look',
};
