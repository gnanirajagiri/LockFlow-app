/**
 * In-memory Publishing Review repository — mirrors
 * 20261001100000_publishing_review.sql:
 *   * one row per (campaign item, attempt); idempotency unique per item
 *   * snapshots frozen at creation; updates touch lifecycle fields only
 *   * audit events append-only
 */
import type {
  CreatePublishRunInput,
  PublishRunRecord,
  PublishingReviewAuditEventRecord,
  PublishingReviewAuditEventType,
  PublishingReviewBlocker,
} from '../domain/publishingReview';
import type { PublishingMetadata } from '../domain/publishing';
import type {
  ListPublishRunsFilter,
  PublishingReviewRepositories,
  UpdatePublishRunInput,
} from './publishingReviewRepository';

function now(): string {
  return new Date().toISOString();
}

let seq = 0;
function uid(prefix: string): string {
  seq += 1;
  return `${prefix}_dev_${Date.now().toString(36)}${seq.toString(36)}`;
}

function cloneBlockers(list: PublishingReviewBlocker[]): PublishingReviewBlocker[] {
  return list.map((b) => ({ ...b }));
}

export class MockPublishingReviewRepository implements PublishingReviewRepositories {
  private runs: PublishRunRecord[] = [];
  private events: PublishingReviewAuditEventRecord[] = [];

  async listPublishRuns(
    workspaceId: string,
    filter?: ListPublishRunsFilter,
  ): Promise<PublishRunRecord[]> {
    return this.runs
      .filter((r) => r.workspaceId === workspaceId)
      .filter((r) => (filter?.campaignId ? r.campaignId === filter.campaignId : true))
      .filter((r) => (filter?.campaignItemId ? r.campaignItemId === filter.campaignItemId : true))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map((r) => structuredClone(r));
  }

  async getPublishRun(runId: string): Promise<PublishRunRecord | null> {
    const found = this.runs.find((r) => r.id === runId);
    return found ? structuredClone(found) : null;
  }

  async findRunByIdempotencyKey(
    campaignItemId: string,
    idempotencyKey: string,
  ): Promise<PublishRunRecord | null> {
    const found = this.runs.find(
      (r) => r.campaignItemId === campaignItemId && r.idempotencyKey === idempotencyKey,
    );
    return found ? structuredClone(found) : null;
  }

  async createPublishRun(input: CreatePublishRunInput): Promise<PublishRunRecord> {
    const duplicate = this.runs.find(
      (r) =>
        r.campaignItemId === input.campaignItemId &&
        (r.idempotencyKey === input.idempotencyKey || r.attemptNumber === input.attemptNumber),
    );
    if (duplicate) {
      throw new Error('A publish run already exists for this submission intent.');
    }
    const ts = now();
    const record: PublishRunRecord = {
      id: uid('prrun'),
      workspaceId: input.workspaceId,
      campaignId: input.campaignId,
      campaignItemId: input.campaignItemId,
      publishingDraftId: null,
      requestedBy: input.requestedBy,
      status: input.status,
      placement: input.placement,
      requestSnapshot: structuredClone(input.requestSnapshot),
      validationSnapshot: input.validationSnapshot
        ? {
            eligible: input.validationSnapshot.eligible,
            blockers: cloneBlockers(input.validationSnapshot.blockers),
            checkedAt: input.validationSnapshot.checkedAt,
          }
        : null,
      idempotencyKey: input.idempotencyKey,
      attemptNumber: input.attemptNumber,
      errorCode: null,
      errorMessageSafe: null,
      providerPublishId: null,
      publishedUrl: null,
      publishedAt: null,
      startedAt: null,
      completedAt: null,
      createdAt: ts,
      updatedAt: ts,
      // Prompt 20 operational fields:
      lastStatusCheckedAt: null,
      nextStatusCheckAt: null,
      providerPublishedAt: null,
      providerPermalink: null,
      failureCategory: null,
      isRetryable: false,
    };
    this.runs.push(record);
    return structuredClone(record);
  }

  async updatePublishRun(runId: string, patch: UpdatePublishRunInput): Promise<PublishRunRecord> {
    const idx = this.runs.findIndex((r) => r.id === runId);
    if (idx === -1) throw new Error('Publish run not found.');
    // Snapshots are immutable — the repository refuses to rewrite them.
    if ('requestSnapshot' in patch || 'validationSnapshot' in patch) {
      throw new Error('Publish run snapshots are immutable.');
    }
    const next: PublishRunRecord = { ...this.runs[idx], ...patch, updatedAt: now() };
    this.runs[idx] = next;
    return structuredClone(next);
  }

  async appendReviewEvent(input: {
    workspaceId: string;
    campaignId: string;
    campaignItemId: string;
    publishRunId: string | null;
    actorId: string | null;
    eventType: PublishingReviewAuditEventType;
    message: string;
    metadata?: PublishingMetadata;
  }): Promise<PublishingReviewAuditEventRecord> {
    const record: PublishingReviewAuditEventRecord = {
      id: uid('prevent'),
      workspaceId: input.workspaceId,
      campaignId: input.campaignId,
      campaignItemId: input.campaignItemId,
      publishRunId: input.publishRunId,
      actorId: input.actorId,
      eventType: input.eventType,
      message: input.message.slice(0, 400),
      metadata: input.metadata ? { ...input.metadata } : null,
      createdAt: now(),
    };
    this.events.push(record);
    return structuredClone(record);
  }

  async listReviewEvents(
    workspaceId: string,
    filter?: { campaignItemId?: string; publishRunId?: string },
  ): Promise<PublishingReviewAuditEventRecord[]> {
    return this.events
      .filter((e) => e.workspaceId === workspaceId)
      .filter((e) => (filter?.campaignItemId ? e.campaignItemId === filter.campaignItemId : true))
      .filter((e) => (filter?.publishRunId ? e.publishRunId === filter.publishRunId : true))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map((e) => ({ ...e, metadata: e.metadata ? { ...e.metadata } : null }));
  }
}
