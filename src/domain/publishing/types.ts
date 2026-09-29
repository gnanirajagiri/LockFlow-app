/**
 * Publishing domain — types.
 *
 * Publishing PREPARATION and CONTROLLED submission of approved Gallery
 * outputs through workspace social connections. Gallery remains the media
 * source: publishing records reference outputs and never duplicate or alter
 * media, pins, reviews or provenance.
 *
 * Security posture encoded here:
 *   * `providerMetadataProtected` / run response metadata / webhook payload
 *     metadata are SERVER-ONLY — the safe client view type
 *     (SafePublishingDraftView) structurally omits them.
 *   * media snapshots hold metadata + provenance references, never signed
 *     URLs or raw bytes.
 *   * external account snapshots hold safe display metadata only.
 *   * No scheduled external posts: planned campaign dates are internal and
 *     never trigger publishing.
 */

export type PublishingDraftStatus =
  | 'draft'
  | 'validating'
  | 'ready'
  | 'submitting'
  | 'processing'
  | 'published'
  | 'failed'
  | 'cancelled'
  | 'blocked'
  | 'needs_reauth'
  | 'archived';

export type PublishingPlacement =
  | 'feed_post'
  | 'reel'
  | 'story'
  | 'short_video'
  | 'video_post'
  | 'image_post'
  | 'ad_creative'
  | 'other';

export type PublishingEventType =
  | 'created'
  | 'updated'
  | 'validation_started'
  | 'validation_passed'
  | 'validation_failed'
  | 'marked_ready'
  | 'submit_requested'
  | 'provider_accepted'
  | 'provider_processing'
  | 'provider_published'
  | 'provider_failed'
  | 'retry_requested'
  | 'cancelled'
  | 'blocked'
  | 'reauth_required'
  | 'archived'
  | 'restored';

export type PublishingRunStatus =
  | 'queued'
  | 'submitting'
  | 'accepted'
  | 'processing'
  | 'completed'
  | 'failed';

export type PublishingUploadStatus = 'not_started' | 'uploading' | 'uploaded' | 'failed';

/** Audit-safe metadata: plain scalars only. */
export type PublishingMetadata = Record<string, string | number | boolean> | null;

export interface PublishingMediaSnapshotEntry {
  galleryOutputId: string;
  mediaType: 'image' | 'video';
  title: string;
  outputType: string;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  /** Provenance reference — never a signed URL. */
  contentJobRequestId: string;
}

export interface PublishingMediaSnapshot {
  outputs: PublishingMediaSnapshotEntry[];
}

export interface PublishingCopySnapshot {
  caption?: string;
  callToAction?: string;
  destinationUrl?: string;
  altText?: string;
  internalNotes?: string;
}

export interface ExternalAccountSnapshot {
  providerKey: string;
  connectionId: string;
  connectionLocalName: string;
  accountLabel: string | null;
  accountType: string | null;
}

export interface PublishingValidationIssue {
  field?: string;
  code: string;
  messageSafe: string;
  severity: 'error' | 'warning';
}

export interface PublishingValidationResult {
  valid: boolean;
  errors: PublishingValidationIssue[];
  warnings: PublishingValidationIssue[];
  validatedAt: string | null;
  placement: PublishingPlacement | null;
}

export interface PublishingDraftRecord {
  id: string;
  workspaceId: string;
  campaignId: string;
  campaignItemId: string;
  galleryOutputId: string;
  workspaceSocialConnectionId: string;
  providerKey: string;
  status: PublishingDraftStatus;
  placement: PublishingPlacement;
  mediaSnapshot: PublishingMediaSnapshot;
  copySnapshot: PublishingCopySnapshot;
  externalAccountSnapshot: ExternalAccountSnapshot;
  validationResult: PublishingValidationResult | null;
  idempotencyKey: string;
  providerPublishId: string | null;
  /** Server-only provider diagnostics — structurally omitted from the client view. */
  providerMetadataProtected: unknown | null;
  publishedUrl: string | null;
  publishedAt: string | null;
  failureCode: string | null;
  failureMessageSafe: string | null;
  /** Explicit user rights/policy acknowledgement (ISO timestamp), required before submit. */
  acknowledgementAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface PublishingDraftMediaRecord {
  id: string;
  publishingDraftId: string;
  galleryOutputId: string;
  role: 'primary';
  mediaType: 'image' | 'video';
  /** Server-only provider handle after preparation. */
  providerMediaHandleProtected: string | null;
  uploadStatus: PublishingUploadStatus;
  providerMetadataProtected: unknown | null;
  createdAt: string;
  updatedAt: string;
}

export interface PublishingDraftEventRecord {
  id: string;
  publishingDraftId: string;
  actorId: string | null;
  eventType: PublishingEventType;
  message: string;
  metadata: PublishingMetadata;
  createdAt: string;
}

export interface PublishingProviderRunRecord {
  id: string;
  publishingDraftId: string;
  providerKey: string;
  attemptNumber: number;
  idempotencyKey: string;
  providerRequestId: string | null;
  status: PublishingRunStatus;
  requestSnapshot: PublishingMetadata;
  /** Server-only provider diagnostics. */
  responseMetadataProtected: unknown | null;
  errorCode: string | null;
  errorMessageSafe: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PublishingWebhookEventRecord {
  id: string;
  providerKey: string;
  externalEventId: string | null;
  signatureVerified: boolean;
  eventType: string | null;
  publishingDraftId: string | null;
  providerRunId: string | null;
  /** Server-only sanitized payload metadata. */
  payloadMetadataProtected: unknown | null;
  receivedAt: string;
  processedAt: string | null;
  processingErrorSafe: string | null;
}

// ── Safe client read model ──────────────────────────────────────────────────

/**
 * The ONLY draft shape the browser may receive. Structurally omits provider
 * metadata, media handles, tokens, signed URLs, internal diagnostics and the
 * raw idempotency key.
 */
export interface SafePublishingDraftView {
  id: string;
  workspaceId: string;
  campaignId: string;
  campaignItemId: string;
  galleryOutputId: string;
  providerKey: string;
  workspaceSocialConnectionId: string;
  status: PublishingDraftStatus;
  placement: PublishingPlacement;
  sourceTitle: string;
  mediaType: 'image' | 'video';
  mediaSummary: {
    width: number | null;
    height: number | null;
    durationSeconds: number | null;
  } | null;
  externalAccount: ExternalAccountSnapshot;
  copy: PublishingCopySnapshot;
  validationResult: {
    valid: boolean;
    errors: PublishingValidationIssue[];
    warnings: PublishingValidationIssue[];
    validatedAt: string | null;
  } | null;
  failureCode: string | null;
  failureMessageSafe: string | null;
  publishedUrl: string | null;
  publishedAt: string | null;
  acknowledgementRecorded: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

// ── Provider contract (server-side only) ────────────────────────────────────

export type ServerSafePlacement = PublishingPlacement;

export interface SafeServerMediaReference {
  galleryOutputId: string;
  mediaType: 'image' | 'video';
  /** Server-side storage path — never leaves the server boundary. */
  storagePath: string;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
}

/** Decrypted connection context — exists only inside the server boundary. */
export interface ServerConnectionContext {
  connectionId: string;
  providerKey: string;
  workspaceId: string;
  accessToken: string;
  accountLabel?: string;
}

export interface ProviderCapabilities {
  placements: PublishingPlacement[];
  supportsImages: boolean;
  supportsVideos: boolean;
  supportsPublishNow: boolean;
  supportsStatusPolling: boolean;
  supportsWebhookStatus: boolean;
  supportsAltText: boolean;
  supportsDestinationUrl: boolean;
  maxCaptionLength?: number;
  supportedAspectRatios?: string[];
  supportedDurationsSeconds?: number[];
}

export interface PublishingCopyInput {
  caption?: string;
  callToAction?: string;
  destinationUrl?: string;
  altText?: string;
}

export interface ProviderValidationIssue {
  field?: string;
  code: string;
  messageSafe: string;
}

export interface SocialPublishingProvider {
  readonly providerKey: string;
  readonly displayName: string;
  readonly devOnly: boolean;

  isConfigured(): Promise<boolean>;

  getCapabilities(input: { connection: ServerConnectionContext }): Promise<ProviderCapabilities>;

  validateDraft(input: {
    placement: PublishingPlacement;
    media: SafeServerMediaReference[];
    copy: PublishingCopyInput;
    connection: ServerConnectionContext;
  }): Promise<{ valid: boolean; errors: ProviderValidationIssue[]; warnings: ProviderValidationIssue[] }>;

  prepareMedia(input: {
    media: SafeServerMediaReference[];
    connection: ServerConnectionContext;
    idempotencyKey: string;
  }): Promise<{ providerMediaHandles: Array<{ role: 'primary'; handle: string; metadata?: unknown }> }>;

  publish(input: {
    idempotencyKey: string;
    placement: PublishingPlacement;
    mediaHandles: Array<{ role: 'primary'; handle: string }>;
    copy: PublishingCopyInput;
    connection: ServerConnectionContext;
    metadata: {
      lockflowPublishingDraftId: string;
      workspaceId: string;
      campaignId: string;
      campaignItemId: string;
      galleryOutputId: string;
    };
  }): Promise<{
    providerPublishId: string;
    status: 'accepted' | 'processing' | 'published' | 'failed';
    publishedUrl?: string;
    providerMetadata?: unknown;
  }>;

  getPublishStatus?(input: {
    providerPublishId: string;
    connection: ServerConnectionContext;
  }): Promise<{
    status: 'processing' | 'published' | 'failed';
    publishedUrl?: string;
    errorCode?: string;
    errorMessageSafe?: string;
    providerMetadata?: unknown;
  }>;

  verifyWebhook?(input: {
    headers: Record<string, string>;
    rawBody: string;
  }): Promise<{
    verified: boolean;
    externalEventId?: string;
    eventType?: string;
    providerPublishId?: string;
    status?: 'processing' | 'published' | 'failed';
    publishedUrl?: string;
    providerMetadata?: unknown;
  }>;
}
