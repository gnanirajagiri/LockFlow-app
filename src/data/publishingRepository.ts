/**
 * Publishing — repository contract.
 *
 * Protected provider metadata lives on records the server may read; the
 * service's safe client view strips it. Runs and webhooks are server-only
 * (deny-all RLS in production; mock keeps them in memory).
 */
import type {
  PublishingCopySnapshot,
  PublishingDraftEventRecord,
  PublishingDraftMediaRecord,
  PublishingDraftRecord,
  PublishingDraftStatus,
  PublishingEventType,
  PublishingMetadata,
  PublishingPlacement,
  PublishingProviderRunRecord,
  PublishingRunStatus,
  PublishingUploadStatus,
  PublishingWebhookEventRecord,
  PublishingMediaSnapshot,
  ExternalAccountSnapshot,
  PublishingValidationResult,
} from '../domain/publishing';

export interface CreatePublishingDraftInput {
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
  idempotencyKey: string;
  createdBy: string;
}

export interface UpdatePublishingDraftInput {
  placement?: PublishingPlacement;
  copySnapshot?: PublishingCopySnapshot;
  status?: PublishingDraftStatus;
  validationResult?: PublishingValidationResult | null;
  providerPublishId?: string | null;
  providerMetadataProtected?: unknown | null;
  publishedUrl?: string | null;
  publishedAt?: string | null;
  failureCode?: string | null;
  failureMessageSafe?: string | null;
  acknowledgementAt?: string | null;
  archivedAt?: string | null;
}

export interface PublishingRepositories {
  // Drafts
  listDrafts(workspaceId: string): Promise<PublishingDraftRecord[]>;
  getDraft(draftId: string): Promise<PublishingDraftRecord | null>;
  createDraft(input: CreatePublishingDraftInput): Promise<PublishingDraftRecord>;
  updateDraft(draftId: string, patch: UpdatePublishingDraftInput): Promise<PublishingDraftRecord>;
  findDraftByIdempotencyKey(idempotencyKey: string): Promise<PublishingDraftRecord | null>;

  // Draft media
  listDraftMedia(draftId: string): Promise<PublishingDraftMediaRecord[]>;
  createDraftMedia(input: {
    publishingDraftId: string;
    galleryOutputId: string;
    role: 'primary';
    mediaType: 'image' | 'video';
  }): Promise<PublishingDraftMediaRecord>;
  updateDraftMedia(
    mediaId: string,
    patch: {
      providerMediaHandleProtected?: string | null;
      uploadStatus?: PublishingUploadStatus;
      providerMetadataProtected?: unknown | null;
    },
  ): Promise<PublishingDraftMediaRecord>;

  // Events (append-only)
  appendDraftEvent(input: {
    publishingDraftId: string;
    actorId: string | null;
    eventType: PublishingEventType;
    message: string;
    metadata?: PublishingMetadata;
  }): Promise<PublishingDraftEventRecord>;
  listDraftEvents(draftId: string): Promise<PublishingDraftEventRecord[]>;

  // Provider runs (server-only)
  createRun(input: {
    publishingDraftId: string;
    providerKey: string;
    attemptNumber: number;
    idempotencyKey: string;
    requestSnapshot: PublishingMetadata;
  }): Promise<PublishingProviderRunRecord>;
  listRuns(draftId: string): Promise<PublishingProviderRunRecord[]>;
  getRun(runId: string): Promise<PublishingProviderRunRecord | null>;
  updateRun(
    runId: string,
    patch: {
      status?: PublishingRunStatus;
      providerRequestId?: string | null;
      responseMetadataProtected?: unknown | null;
      errorCode?: string | null;
      errorMessageSafe?: string | null;
      startedAt?: string | null;
      completedAt?: string | null;
    },
  ): Promise<PublishingProviderRunRecord>;

  // Webhook events (server-only)
  recordWebhookEvent(input: {
    providerKey: string;
    externalEventId: string | null;
    signatureVerified: boolean;
    eventType: string | null;
    publishingDraftId: string | null;
    providerRunId: string | null;
    payloadMetadataProtected: unknown | null;
    processingErrorSafe?: string | null;
  }): Promise<{ record: PublishingWebhookEventRecord; duplicate: boolean }>;
  updateWebhookEvent(
    id: string,
    patch: { processedAt?: string | null; processingErrorSafe?: string | null },
  ): Promise<void>;
}

export type PublishingDraftRepository = PublishingRepositories;
