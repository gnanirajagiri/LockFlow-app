/**
 * Video request builder — provider-neutral request + secrets-free snapshot.
 * Snapshot records settings, scene/beat snapshot references and role counts;
 * signed handles are never stored (Prompt-12 rule, unchanged).
 */
import type { VideoGenerationRequest, VideoReferenceImage, AllowedAspectRatio, AllowedDuration, SceneSnapshot, BeatSnapshot } from './videoTypes';

export interface VideoRequestBuilderInput {
  idempotencyKey: string;
  prompt: string;
  negativePrompt?: string;
  aspectRatio: AllowedAspectRatio;
  durationSeconds: AllowedDuration;
  outputCount: number;
  referenceImages: VideoReferenceImage[];
  jobId: string;
  workspaceId: string;
  pinSummary: unknown;
  sceneSnapshot?: SceneSnapshot;
  beatSnapshot?: BeatSnapshot;
}

export function buildVideoProviderRequest(input: VideoRequestBuilderInput): {
  request: VideoGenerationRequest;
  requestSnapshot: Record<string, unknown>;
} {
  const request: VideoGenerationRequest = {
    idempotencyKey: input.idempotencyKey,
    prompt: input.prompt,
    negativePrompt: input.negativePrompt,
    aspectRatio: input.aspectRatio,
    durationSeconds: input.durationSeconds,
    outputCount: input.outputCount,
    referenceImages: input.referenceImages,
    sceneSnapshot: input.sceneSnapshot,
    beatSnapshot: input.beatSnapshot,
    metadata: {
      lockflowJobId: input.jobId,
      workspaceId: input.workspaceId,
      pinSummary: input.pinSummary,
    },
  };

  // Snapshot = everything except the ephemeral signed handles.
  const requestSnapshot: Record<string, unknown> = {
    idempotencyKey: input.idempotencyKey,
    prompt: input.prompt,
    negativePrompt: input.negativePrompt ?? null,
    aspectRatio: input.aspectRatio,
    durationSeconds: input.durationSeconds,
    outputCount: input.outputCount,
    requested_variants: input.outputCount, // read by the SQL retry RPC
    references: input.referenceImages.map((reference) => ({
      role: reference.role,
      mimeType: reference.mimeType,
      handlePreviewLength: reference.urlOrSecureHandle.length,
    })),
    metadata: request.metadata,
  };

  return { request, requestSnapshot };
}
