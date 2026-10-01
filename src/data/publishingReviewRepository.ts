/**
 * Publishing Review & Submission Orchestration — repository contract.
 *
 * Publish runs are append-only per attempt: creation snapshots the request
 * and validation; afterwards only lifecycle bookkeeping mutates (status,
 * timestamps, provider publish id, safe error fields). Retries create NEW
 * runs with fresh idempotency keys — a failed run is never rewritten.
 * Audit events are append-only. Everything is workspace-scoped.
 */
import type {
  CreatePublishRunInput,
  PublishRunRecord,
  PublishingReviewAuditEventRecord,
  PublishingReviewAuditEventType,
  PublishingReviewRunStatus,
} from '../domain/publishingReview';
import type { PublishingMetadata } from '../domain/publishing';

export type { CreatePublishRunInput } from '../domain/publishingReview';

export interface UpdatePublishRunInput {
  status?: PublishingReviewRunStatus;
  publishingDraftId?: string | null;
  providerPublishId?: string | null;
  publishedUrl?: string | null;
  publishedAt?: string | null;
  errorCode?: string | null;
  errorMessageSafe?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
}

export interface ListPublishRunsFilter {
  campaignItemId?: string;
  campaignId?: string;
}

export interface PublishingReviewRepositories {
  // Publish runs
  listPublishRuns(workspaceId: string, filter?: ListPublishRunsFilter): Promise<PublishRunRecord[]>;
  getPublishRun(runId: string): Promise<PublishRunRecord | null>;
  /** Idempotency: find a run by (campaignItemId, idempotencyKey). */
  findRunByIdempotencyKey(campaignItemId: string, idempotencyKey: string): Promise<PublishRunRecord | null>;
  createPublishRun(input: CreatePublishRunInput): Promise<PublishRunRecord>;
  /** Lifecycle bookkeeping only — never rewrites snapshots. */
  updatePublishRun(runId: string, patch: UpdatePublishRunInput): Promise<PublishRunRecord>;

  // Audit trail (append-only)
  appendReviewEvent(input: {
    workspaceId: string;
    campaignId: string;
    campaignItemId: string;
    publishRunId: string | null;
    actorId: string | null;
    eventType: PublishingReviewAuditEventType;
    message: string;
    metadata?: PublishingMetadata;
  }): Promise<PublishingReviewAuditEventRecord>;
  listReviewEvents(
    workspaceId: string,
    filter?: { campaignItemId?: string; publishRunId?: string },
  ): Promise<PublishingReviewAuditEventRecord[]>;
}

export type PublishingReviewRepository = PublishingReviewRepositories;
