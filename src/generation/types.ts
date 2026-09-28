/**
 * Generation domain — provider-neutral contracts.
 *
 * PRODUCT BOUNDARY (non-negotiable): image generation only. No video, no
 * social publishing, no billing. Only server-side code (the submission
 * service / worker) may call a provider adapter — UI components depend on
 * the GenerationService exclusively and never import provider modules.
 *
 * The DevelopmentFakeImageProvider never performs network calls; production
 * fails closed until IMAGE_PROVIDER_NAME + IMAGE_PROVIDER_API_KEY are set
 * server-side. Secrets never appear in this file, in snapshots, or in logs.
 */
export type ImageGenerationProviderStatus = 'queued' | 'processing' | 'completed' | 'failed';

export type ReferenceRole =
  | 'model_identity'
  | 'environment'
  | 'product'
  | 'prop'
  | 'wardrobe'
  | 'look'
  | 'other';

export interface ProviderReferenceImage {
  role: ReferenceRole;
  /** A short-lived signed URL or secure handle — never a permanent public URL. */
  urlOrSecureHandle: string;
  mimeType: string;
}

export interface ImageGenerationRequest {
  idempotencyKey: string;
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: string;
  width?: number;
  height?: number;
  outputCount: number;
  referenceImages: ProviderReferenceImage[];
  metadata: {
    lockflowJobId: string;
    workspaceId: string;
    pinSummary: unknown;
  };
}

export interface ProviderGenerationResult {
  remoteUrlOrBytes: string;
  mimeType: string;
  width?: number;
  height?: number;
}

export interface ImageGenerationStatusResult {
  status: ImageGenerationProviderStatus;
  errorCode?: string;
  errorMessage?: string;
  results?: ProviderGenerationResult[];
  providerMetadata?: unknown;
}

export interface ImageGenerationProvider {
  readonly providerName: string;
  isConfigured(): Promise<boolean>;
  submitImageGeneration(
    input: ImageGenerationRequest,
  ): Promise<{ providerRequestId: string; status: ImageGenerationProviderStatus }>;
  getImageGenerationStatus(providerRequestId: string): Promise<ImageGenerationStatusResult>;
}

/** Roles LockFlow pin types map onto for the provider payload. */
export const PIN_ROLE_MAP: Record<string, ReferenceRole> = {
  model: 'model_identity',
  environment: 'environment',
  library_asset: 'product',
  look: 'look',
};
