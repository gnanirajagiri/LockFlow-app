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

// ── Prompt 27: auditable prompt normalization record ───────────────────────

/**
 * The stored normalization record for a generation run: the verbatim user
 * prompt, the deterministic rule-based extraction, and the exact rules
 * applied. Replaying `rulesApplied` against `userPrompt` reproduces the
 * extraction — the transformation is auditable, never an opaque call.
 */
export interface NormalizedPromptRecord {
  userPrompt: string;
  cleanedPrompt: string;
  aspectRatio: string;
  outputCount: number;
  extracted: {
    subject: string | null;
    setting: string | null;
    lighting: string | null;
    mood: string | null;
    styleHints: string[];
  };
  warnings: string[];
  rulesApplied: string[];
  /** ISO timestamp captured when normalization ran. */
  normalizedAt: string;
}

// ── Prompt 27: locked generation input snapshot ───────────────────────────

/** One locked input line in the snapshot: a pinned version or sheet. */
export interface LockedInputLine {
  kind: 'model_version' | 'environment_version' | 'library_asset' | 'look' | 'character_sheet';
  id: string;
  label: string;
  versionNumber: number | null;
  /** What the line was resolved through (e.g. 'model.activeVersionId'). */
  resolvedVia: string;
  /** Protected trait keys carried by this line (Character Sheet lines). */
  protectedTraitKeys?: string[];
}

/** Minimal version shape the snapshot needs (model & environment versions both satisfy it). */
export interface SnapshotVersionRef {
  id: string;
  versionNumber: number;
  status: string;
}

/**
 * The deterministic, inspectable baseline a generation ran under: pinned
 * versions, protected Character Sheet constraints, settings and counts.
 * Contains identifiers and display labels only — never secrets, never
 * signed URLs. Stored on the run and reassembled identically for variants.
 */
export interface LockedGenerationInputSnapshot {
  prompt: {
    userPrompt: string;
    cleanedPrompt: string;
  };
  aspectRatio: string;
  outputCount: number;
  /** Ordered pinned inputs (model → environment → assets/looks). */
  lockedInputs: LockedInputLine[];
  /** Protected identity constraints per model (prompt 26 projection). */
  characterSheetConstraints: Array<{
    modelId: string;
    modelVersionId: string;
    characterSheetId: string;
    protectedTraitKeys: string[];
    protectedTraitCount: number;
  }>;
  /** Reference roles requested for continuity (counts + roles only). */
  referencePlan: Array<{ role: string; count: number }>;
  /** ISO timestamp captured when the snapshot was assembled. */
  assembledAt: string;
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
