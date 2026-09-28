/**
 * In-memory generation repository — demo mode + automated tests. Mirrors the
 * SQL schema in 20260928130000_generation_domain.sql (same fields, same
 * unique constraints, same idempotency semantics).
 */
import type {
  CreateProviderRunInput,
  GenerationAuditEventRecord,
  GenerationConfigRecord,
  GenerationProviderRunRecord,
  GenerationQuotaUsageRecord,
  GenerationRepository,
} from './repository';
import { currentPeriod } from './repository';

function now(): string {
  return new Date().toISOString();
}

function stamp(): GenerationQuotaUsageRecord {
  const { periodStart, periodEnd } = currentPeriod();
  return {
    id: crypto.randomUUID(),
    workspaceId: '',
    userId: '',
    periodStart,
    periodEnd,
    imageJobsSubmitted: 0,
    imageOutputsRequested: 0,
    estimatedOrReportedCostMetadata: null,
    createdAt: now(),
    updatedAt: now(),
  };
}

export class MockGenerationRepository implements GenerationRepository {
  private runs = new Map<string, GenerationProviderRunRecord>();
  private quota = new Map<string, GenerationQuotaUsageRecord>();
  private audit: GenerationAuditEventRecord[] = [];
  private config: GenerationConfigRecord = {
    imageGenerationEnabled: false,
    providerName: 'none',
    imageMaxOutputsPerJob: 4,
    imageMaxJobsPerUserPerPeriod: 5,
    imageMaxJobsPerWorkspacePerPeriod: 20,
    videoGenerationEnabled: false,
    videoProviderName: 'none',
    videoMaxOutputsPerJob: 2,
    videoMaxJobsPerUserPerPeriod: 3,
    videoMaxJobsPerWorkspacePerPeriod: 10,
    videoMaxSecondsPerUserPerPeriod: 48,
    videoMaxSecondsPerWorkspacePerPeriod: 240,
  };

  // ── Runs ──────────────────────────────────────────────────────────────────
  async createRun(input: CreateProviderRunInput): Promise<GenerationProviderRunRecord> {
    const kind = input.generationKind ?? 'image';
    const attempt =
      [...this.runs.values()]
        .filter((run) => run.contentJobRequestId === input.contentJobRequestId && (run.generationKind ?? 'image') === kind)
        .reduce((max, run) => Math.max(max, run.attemptNumber), 0) + 1;
    const record: GenerationProviderRunRecord = {
      id: crypto.randomUUID(),
      workspaceId: input.workspaceId,
      contentJobRequestId: input.contentJobRequestId,
      createdBy: input.createdBy,
      providerName: input.providerName,
      providerRequestId: null,
      idempotencyKey: input.idempotencyKey,
      status: 'created',
      requestSnapshot: input.requestSnapshot,
      responseSnapshot: null,
      providerCostMetadata: null,
      errorCode: null,
      errorMessage: null,
      attemptNumber: attempt,
      startedAt: null,
      completedAt: null,
      createdAt: now(),
      updatedAt: now(),
      generationKind: kind,
      contentSceneId: input.contentSceneId ?? null,
      contentBeatId: input.contentBeatId ?? null,
      sceneSnapshot: input.sceneSnapshot ?? null,
      beatSnapshot: input.beatSnapshot ?? null,
      requestedAspectRatio: input.requestedAspectRatio ?? null,
      requestedDurationSeconds: input.requestedDurationSeconds ?? null,
    };
    this.runs.set(record.id, record);
    return structuredClone(record);
  }

  async getRun(runId: string): Promise<GenerationProviderRunRecord | null> {
    const run = this.runs.get(runId);
    return run ? structuredClone(run) : null;
  }

  async getRunByIdempotencyKey(key: string): Promise<GenerationProviderRunRecord | null> {
    for (const run of this.runs.values()) {
      if (run.idempotencyKey === key) return structuredClone(run);
    }
    return null;
  }

  async latestRunForJob(jobId: string): Promise<GenerationProviderRunRecord | null> {
    const all = await this.listRunsForJob(jobId);
    return all[all.length - 1] ?? null;
  }

  async listRunsForJob(jobId: string): Promise<GenerationProviderRunRecord[]> {
    return [...this.runs.values()]
      .filter((run) => run.contentJobRequestId === jobId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((run) => structuredClone(run));
  }

  async updateRun(
    runId: string,
    patch: Partial<GenerationProviderRunRecord>,
  ): Promise<GenerationProviderRunRecord> {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Generation run not found: ${runId}`);
    Object.assign(run, patch, { updatedAt: now() });
    return structuredClone(run);
  }

  // ── Quota ─────────────────────────────────────────────────────────────────
  private quotaKey(workspaceId: string, userId: string, periodStart: string): string {
    return `${workspaceId}:${userId}:${periodStart}`;
  }

  async getOrCreateQuota(
    workspaceId: string,
    userId: string,
    periodStart: string,
    periodEnd: string,
  ): Promise<GenerationQuotaUsageRecord> {
    const key = this.quotaKey(workspaceId, userId, periodStart);
    const existing = this.quota.get(key);
    if (existing) return structuredClone(existing);
    const row = { ...stamp(), workspaceId, userId, periodStart, periodEnd };
    this.quota.set(key, row);
    return structuredClone(row);
  }

  async incrementQuota(
    workspaceId: string,
    userId: string,
    periodStart: string,
    periodEnd: string,
    outputsRequested: number,
  ): Promise<void> {
    const row = await this.getOrCreateQuota(workspaceId, userId, periodStart, periodEnd);
    row.imageJobsSubmitted += 1;
    row.imageOutputsRequested += outputsRequested;
    this.quota.set(this.quotaKey(workspaceId, userId, periodStart), row);
  }

  async quotaTotalsForWorkspace(
    workspaceId: string,
    periodStart: string,
  ): Promise<{ jobs: number; outputs: number }> {
    let jobs = 0;
    let outputs = 0;
    for (const row of this.quota.values()) {
      if (row.workspaceId === workspaceId && row.periodStart === periodStart) {
        jobs += row.imageJobsSubmitted;
        outputs += row.imageOutputsRequested;
      }
    }
    return { jobs, outputs };
  }

  // ── Video milestone ──────────────────────────────────────────────────────

  private videoQuota = new Map<
    string,
    { workspaceId: string; userId: string; periodStart: string; periodEnd: string; jobs: number; seconds: number }
  >();

  async latestVideoRunForJob(jobId: string): Promise<GenerationProviderRunRecord | null> {
    const all = [...this.runs.values()]
      .filter((run) => run.contentJobRequestId === jobId && run.generationKind === 'video')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return all[all.length - 1] ? structuredClone(all[all.length - 1]) : null;
  }

  async createVideoRun(input: CreateProviderRunInput): Promise<GenerationProviderRunRecord> {
    return this.createRun({ ...input, generationKind: 'video' });
  }

  async incrementVideoQuota(workspaceId: string, userId: string, secondsRequested: number): Promise<void> {
    const { periodStart, periodEnd } = currentPeriod();
    const key = `${workspaceId}:${userId}:${periodStart}`;
    const row = this.videoQuota.get(key) ?? {
      workspaceId,
      userId,
      periodStart,
      periodEnd,
      jobs: 0,
      seconds: 0,
    };
    row.jobs += 1;
    row.seconds += secondsRequested;
    this.videoQuota.set(key, row);
  }

  async getVideoQuotaView(
    workspaceId: string,
    userId: string,
    limits: {
      maxOutputsPerJob: number;
      maxJobsPerUserPerPeriod: number;
      maxJobsPerWorkspacePerPeriod: number;
      maxSecondsPerUserPerPeriod: number;
      maxSecondsPerWorkspacePerPeriod: number;
    },
  ): Promise<{
    maxOutputsPerJob: number;
    maxJobsPerUserPerPeriod: number;
    maxJobsPerWorkspacePerPeriod: number;
    maxSecondsPerUserPerPeriod: number;
    maxSecondsPerWorkspacePerPeriod: number;
    userJobsThisPeriod: number;
    workspaceJobsThisPeriod: number;
    userSecondsThisPeriod: number;
    workspaceSecondsThisPeriod: number;
  }> {
    const { periodStart } = currentPeriod();
    let userJobs = 0;
    let userSeconds = 0;
    let workspaceJobs = 0;
    let workspaceSeconds = 0;
    for (const row of this.videoQuota.values()) {
      if (row.workspaceId === workspaceId && row.periodStart === periodStart) {
        workspaceJobs += row.jobs;
        workspaceSeconds += row.seconds;
        if (row.userId === userId) {
          userJobs = row.jobs;
          userSeconds = row.seconds;
        }
      }
    }
    return { ...limits, userJobsThisPeriod: userJobs, workspaceJobsThisPeriod: workspaceJobs, userSecondsThisPeriod: userSeconds, workspaceSecondsThisPeriod: workspaceSeconds };
  }

  // ── Config ────────────────────────────────────────────────────────────────
  async getConfig(): Promise<GenerationConfigRecord> {
    return structuredClone(this.config);
  }

  async setConfig(config: GenerationConfigRecord): Promise<void> {
    this.config = structuredClone(config);
  }

  // ── Audit ─────────────────────────────────────────────────────────────────
  async addAuditEvent(
    event: Omit<GenerationAuditEventRecord, 'id' | 'createdAt'>,
  ): Promise<GenerationAuditEventRecord> {
    const record: GenerationAuditEventRecord = {
      ...event,
      id: crypto.randomUUID(),
      createdAt: now(),
    };
    this.audit.push(record);
    return structuredClone(record);
  }

  async listAuditEventsForJob(jobId: string): Promise<GenerationAuditEventRecord[]> {
    return this.audit
      .filter((event) => event.contentJobRequestId === jobId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
}
