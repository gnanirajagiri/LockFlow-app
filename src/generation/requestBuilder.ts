/**
 * Provider request builder — assembles the provider-neutral request AND the
 * auditable snapshot stored on the run. The snapshot deliberately excludes
 * credentials and any signed URLs (rule: no secrets, no permanent URL-like
 * values in database records); it records identifiers, roles and counts so
 * any attempt is reproducible without re-reading media.
 */
import type { ImageGenerationRequest, ProviderReferenceImage } from './types';

export interface RequestBuilderInput {
  idempotencyKey: string;
  /** Human brief captured on the plan/job (no secrets by nature). */
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: string;
  outputCount: number;
  referenceImages: ProviderReferenceImage[];
  jobId: string;
  workspaceId: string;
  pinSummary: unknown;
}

export function buildProviderRequest(input: RequestBuilderInput): {
  request: ImageGenerationRequest;
  requestSnapshot: Record<string, unknown>;
} {
  const request: ImageGenerationRequest = {
    idempotencyKey: input.idempotencyKey,
    prompt: input.prompt,
    negativePrompt: input.negativePrompt,
    aspectRatio: input.aspectRatio,
    outputCount: input.outputCount,
    referenceImages: input.referenceImages,
    metadata: {
      lockflowJobId: input.jobId,
      workspaceId: input.workspaceId,
      pinSummary: input.pinSummary,
    },
  };

  // Snapshot = everything except the ephemeral signed handles.
  const requestSnapshot = {
    idempotencyKey: input.idempotencyKey,
    prompt: input.prompt,
    negativePrompt: input.negativePrompt ?? null,
    aspectRatio: input.aspectRatio ?? null,
    outputCount: input.outputCount,
    references: input.referenceImages.map((reference) => ({
      role: reference.role,
      mimeType: reference.mimeType,
      // Length only — the URL itself is ephemeral and never stored.
      handlePreviewLength: reference.urlOrSecureHandle.length,
    })),
    metadata: request.metadata,
  };

  return { request, requestSnapshot };
}
