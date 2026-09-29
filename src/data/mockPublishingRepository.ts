/**
 * In-memory Publishing repository — mirrors 20260930100000_publishing.sql:
 * unique idempotency keys, one row per (draft, attempt), deduped webhook
 * events by (provider, external event id), append-only draft events.
 */
import type {
  PublishingDraftEventRecord,
  PublishingDraftMediaRecord,
  PublishingDraftRecord,
  PublishingEventType,
  PublishingMetadata,
  PublishingProviderRunRecord,
  PublishingRunStatus,
  PublishingUploadStatus,
  PublishingWebhookEventRecord,
} from '../domain/publishing';
import type {
  CreatePublishingDraftInput,
  PublishingRepositories,
  UpdatePublishingDraftInput,
} from './publishingRepository';

function now(): string {
  return new Date().toISOString();
}

let seq = 0;
function uid(prefix: string): string {
  seq += 1;
  return `${prefix}_dev_${Date.now().toString(36)}${seq.toString(36)}`;
}

export class MockPublishingRepository implements PublishingRepositories {
  private drafts: PublishingDraftRecord[] = [];
  private media: PublishingDraftMediaRecord[] = [];
  private events: PublishingDraftEventRecord[] = [];
  private runs: PublishingProviderRunRecord[] = [];
  private webhooks: PublishingWebhookEventRecord[] = [];

  // ── Drafts ──────────────────────────────────────────────────────────────────

  async listDrafts(workspaceId: string): Promise<PublishingDraftRecord[]> {
    return this.drafts
      .filter((d) => d.workspaceId === workspaceId)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
      .map((d) => structuredClone(d));
  }

  async getDraft(draftId: string): Promise<PublishingDraftRecord | null> {
    const found = this.drafts.find((d) => d.id === draftId);
    return found ? structuredClone(found) : null;
  }

  async createDraft(input: CreatePublishingDraftInput): Promise<PublishingDraftRecord> {
    const existing = this.drafts.find((d) => d.idempotencyKey === input.idempotencyKey);
    if (existing) {
      throw new Error('A submission with this intent already exists.');
    }
    const ts = now();
    const record: PublishingDraftRecord = {
      id: uid('pdraft'),
      workspaceId: input.workspaceId,
      campaignId: input.campaignId,
      campaignItemId: input.campaignItemId,
      galleryOutputId: input.galleryOutputId,
      workspaceSocialConnectionId: input.workspaceSocialConnectionId,
      providerKey: input.providerKey,
      status: input.status,
      placement: input.placement,
      mediaSnapshot: structuredClone(input.mediaSnapshot),
      copySnapshot: { ...input.copySnapshot },
      externalAccountSnapshot: { ...input.externalAccountSnapshot },
      validationResult: null,
      idempotencyKey: input.idempotencyKey,
      providerPublishId: null,
      providerMetadataProtected: null,
      publishedUrl: null,
      publishedAt: null,
      failureCode: null,
      failureMessageSafe: null,
      acknowledgementAt: null,
      createdBy: input.createdBy,
      createdAt: ts,
      updatedAt: ts,
      archivedAt: null,
    };
    this.drafts.push(record);
    return structuredClone(record);
  }

  async updateDraft(draftId: string, patch: UpdatePublishingDraftInput): Promise<PublishingDraftRecord> {
    const idx = this.drafts.findIndex((d) => d.id === draftId);
    if (idx === -1) throw new Error('Publishing draft not found.');
    const next: PublishingDraftRecord = {
      ...this.drafts[idx],
      ...patch,
      updatedAt: now(),
    };
    this.drafts[idx] = next;
    return structuredClone(next);
  }

  async findDraftByIdempotencyKey(idempotencyKey: string): Promise<PublishingDraftRecord | null> {
    const found = this.drafts.find((d) => d.idempotencyKey === idempotencyKey);
    return found ? structuredClone(found) : null;
  }

  // ── Draft media ─────────────────────────────────────────────────────────────

  async listDraftMedia(draftId: string): Promise<PublishingDraftMediaRecord[]> {
    return this.media
      .filter((m) => m.publishingDraftId === draftId)
      .map((m) => structuredClone(m));
  }

  async createDraftMedia(input: {
    publishingDraftId: string;
    galleryOutputId: string;
    role: 'primary';
    mediaType: 'image' | 'video';
  }): Promise<PublishingDraftMediaRecord> {
    const ts = now();
    const record: PublishingDraftMediaRecord = {
      id: uid('pmedia'),
      publishingDraftId: input.publishingDraftId,
      galleryOutputId: input.galleryOutputId,
      role: 'primary',
      mediaType: input.mediaType,
      providerMediaHandleProtected: null,
      uploadStatus: 'not_started',
      providerMetadataProtected: null,
      createdAt: ts,
      updatedAt: ts,
    };
    this.media.push(record);
    return structuredClone(record);
  }

  async updateDraftMedia(
    mediaId: string,
    patch: {
      providerMediaHandleProtected?: string | null;
      uploadStatus?: PublishingUploadStatus;
      providerMetadataProtected?: unknown | null;
    },
  ): Promise<PublishingDraftMediaRecord> {
    const idx = this.media.findIndex((m) => m.id === mediaId);
    if (idx === -1) throw new Error('Publishing draft media not found.');
    const next = { ...this.media[idx], ...patch, updatedAt: now() };
    this.media[idx] = next;
    return structuredClone(next);
  }

  // ── Events ──────────────────────────────────────────────────────────────────

  async appendDraftEvent(input: {
    publishingDraftId: string;
    actorId: string | null;
    eventType: PublishingEventType;
    message: string;
    metadata?: PublishingMetadata;
  }): Promise<PublishingDraftEventRecord> {
    const record: PublishingDraftEventRecord = {
      id: uid('pevent'),
      publishingDraftId: input.publishingDraftId,
      actorId: input.actorId,
      eventType: input.eventType,
      message: input.message.slice(0, 400),
      metadata: input.metadata ?? null,
      createdAt: now(),
    };
    this.events.push(record);
    return structuredClone(record);
  }

  async listDraftEvents(draftId: string): Promise<PublishingDraftEventRecord[]> {
    return this.events
      .filter((e) => e.publishingDraftId === draftId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map((e) => ({ ...e, metadata: e.metadata ? { ...e.metadata } : null }));
  }

  // ── Provider runs ───────────────────────────────────────────────────────────

  async createRun(input: {
    publishingDraftId: string;
    providerKey: string;
    attemptNumber: number;
    idempotencyKey: string;
    requestSnapshot: PublishingMetadata;
  }): Promise<PublishingProviderRunRecord> {
    const duplicate = this.runs.find(
      (r) =>
        r.publishingDraftId === input.publishingDraftId &&
        (r.idempotencyKey === input.idempotencyKey || r.attemptNumber === input.attemptNumber),
    );
    if (duplicate) {
      throw new Error('An active provider run already exists for this submission intent.');
    }
    const ts = now();
    const record: PublishingProviderRunRecord = {
      id: uid('prun'),
      publishingDraftId: input.publishingDraftId,
      providerKey: input.providerKey,
      attemptNumber: input.attemptNumber,
      idempotencyKey: input.idempotencyKey,
      providerRequestId: null,
      status: 'queued',
      requestSnapshot: input.requestSnapshot ? { ...input.requestSnapshot } : null,
      responseMetadataProtected: null,
      errorCode: null,
      errorMessageSafe: null,
      startedAt: null,
      completedAt: null,
      createdAt: ts,
      updatedAt: ts,
    };
    this.runs.push(record);
    return structuredClone(record);
  }

  async listRuns(draftId: string): Promise<PublishingProviderRunRecord[]> {
    return this.runs
      .filter((r) => r.publishingDraftId === draftId)
      .sort((a, b) => a.attemptNumber - b.attemptNumber)
      .map((r) => structuredClone(r));
  }

  async getRun(runId: string): Promise<PublishingProviderRunRecord | null> {
    const found = this.runs.find((r) => r.id === runId);
    return found ? structuredClone(found) : null;
  }

  async updateRun(
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
  ): Promise<PublishingProviderRunRecord> {
    const idx = this.runs.findIndex((r) => r.id === runId);
    if (idx === -1) throw new Error('Provider run not found.');
    const next = { ...this.runs[idx], ...patch, updatedAt: now() };
    this.runs[idx] = next;
    return structuredClone(next);
  }

  // ── Webhook events ──────────────────────────────────────────────────────────

  async recordWebhookEvent(input: {
    providerKey: string;
    externalEventId: string | null;
    signatureVerified: boolean;
    eventType: string | null;
    publishingDraftId: string | null;
    providerRunId: string | null;
    payloadMetadataProtected: unknown | null;
    processingErrorSafe?: string | null;
  }): Promise<{ record: PublishingWebhookEventRecord; duplicate: boolean }> {
    if (input.externalEventId) {
      const existing = this.webhooks.find(
        (w) => w.providerKey === input.providerKey && w.externalEventId === input.externalEventId,
      );
      if (existing) {
        return { record: structuredClone(existing), duplicate: true };
      }
    }
    const record: PublishingWebhookEventRecord = {
      id: uid('pwebhook'),
      providerKey: input.providerKey,
      externalEventId: input.externalEventId,
      signatureVerified: input.signatureVerified,
      eventType: input.eventType,
      publishingDraftId: input.publishingDraftId,
      providerRunId: input.providerRunId,
      payloadMetadataProtected: input.payloadMetadataProtected,
      receivedAt: now(),
      processedAt: null,
      processingErrorSafe: input.processingErrorSafe ?? null,
    };
    this.webhooks.push(record);
    return { record: structuredClone(record), duplicate: false };
  }

  async updateWebhookEvent(
    id: string,
    patch: { processedAt?: string | null; processingErrorSafe?: string | null },
  ): Promise<void> {
    const idx = this.webhooks.findIndex((w) => w.id === id);
    if (idx !== -1) {
      this.webhooks[idx] = { ...this.webhooks[idx], ...patch };
    }
  }
}
