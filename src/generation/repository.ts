/**
 * Generation repositories — persistence for runs, quota, config and audit
 * events over both the mock store (dev/tests) and Supabase (real).
 */
import type { ReferenceRole } from './types';

export type GenerationRunStatus =
  | 'created'
  | 'submitted'
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface GenerationProviderRunRecord {
  id: string;
  workspaceId: string;
  contentJobRequestId: string;
  createdBy: string;
  providerName: string;
  providerRequestId: string | null;
  idempotencyKey: string;
  status: GenerationRunStatus;
  requestSnapshot: Record<string, unknown>;
  responseSnapshot: Record<string, unknown> | null;
  providerCostMetadata: Record<string, unknown> | null;
  errorCode: string | null;
  errorMessage: string | null;
  attemptNumber: number;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GenerationQuotaUsageRecord {
  id: string;
  workspaceId: string;
  userId: string;
  periodStart: string;
  periodEnd: string;
  imageJobsSubmitted: number;
  imageOutputsRequested: number;
  estimatedOrReportedCostMetadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface GenerationConfigRecord {
  imageGenerationEnabled: boolean;
  providerName: string;
  imageMaxOutputsPerJob: number;
  imageMaxJobsPerUserPerPeriod: number;
  imageMaxJobsPerWorkspacePerPeriod: number;
}

export interface GenerationAuditEventRecord {
  id: string;
  workspaceId: string;
  contentJobRequestId: string | null;
  providerRunId: string | null;
  actorId: string | null;
  eventType: string;
  message: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

/** Reference rows the resolver consumes (already joined to pinned versions). */
export interface PinnedReferenceLookup {
  versionId: string;
  referenceId: string;
  uploadStatus: string;
  mimeType: string | null;
  storageBucket: string | null;
  storagePath: string;
  role: ReferenceRole;
}

export interface CreateProviderRunInput {
  workspaceId: string;
  contentJobRequestId: string;
  createdBy: string;
  providerName: string;
  idempotencyKey: string;
  requestSnapshot: Record<string, unknown>;
}

export interface GenerationRepository {
  // Runs
  createRun(input: CreateProviderRunInput): Promise<GenerationProviderRunRecord>;
  getRun(runId: string): Promise<GenerationProviderRunRecord | null>;
  getRunByIdempotencyKey(key: string): Promise<GenerationProviderRunRecord | null>;
  latestRunForJob(jobId: string): Promise<GenerationProviderRunRecord | null>;
  listRunsForJob(jobId: string): Promise<GenerationProviderRunRecord[]>;
  updateRun(
    runId: string,
    patch: Partial<
      Pick<
        GenerationProviderRunRecord,
        | 'status'
        | 'providerRequestId'
        | 'responseSnapshot'
        | 'providerCostMetadata'
        | 'errorCode'
        | 'errorMessage'
        | 'startedAt'
        | 'completedAt'
      >
    >,
  ): Promise<GenerationProviderRunRecord>;

  // Quota
  getOrCreateQuota(workspaceId: string, userId: string, periodStart: string, periodEnd: string): Promise<GenerationQuotaUsageRecord>;
  incrementQuota(workspaceId: string, userId: string, periodStart: string, periodEnd: string, outputsRequested: number): Promise<void>;
  quotaTotalsForWorkspace(workspaceId: string, periodStart: string): Promise<{ jobs: number; outputs: number }>;

  // Config (single row)
  getConfig(): Promise<GenerationConfigRecord>;
  setConfig(config: GenerationConfigRecord): Promise<void>;

  // Audit
  addAuditEvent(event: Omit<GenerationAuditEventRecord, 'id' | 'createdAt'>): Promise<GenerationAuditEventRecord>;
  listAuditEventsForJob(jobId: string): Promise<GenerationAuditEventRecord[]>;
}

/** Period helpers — monthly window, mirroring the SQL RPCs. */
export function currentPeriod(): { periodStart: string; periodEnd: string } {
  const now = new Date();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return { periodStart: periodStart.toISOString().slice(0, 10), periodEnd: periodEnd.toISOString().slice(0, 10) };
}
