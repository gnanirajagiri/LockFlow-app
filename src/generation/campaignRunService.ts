/**
 * Prompt 29 — CampaignRunService: one campaign brief → one coordinated
 * multi-format generation run.
 *
 * The parent run is the single orchestration record; child image/video/story
 * jobs are created and executed through the EXISTING prompt-27/28 media
 * services (never re-implemented here). Continuity: one shared locked
 * baseline snapshot governs every child job; only explicitly planned
 * controlled variations may differ, and identity is always enforced against
 * the pinned model's Character Sheet.
 *
 * Security: workspace-scoped at every step; child job pins are resolved
 * server-side by the underlying services; secrets never enter records.
 */
import {
  buildCampaignGenerationPlan,
  normalizeCampaignBrief,
  rollUpCampaignRunStatus,
  describePlanMix,
} from './campaignOrchestration';
import type {
  CampaignBriefInput,
  CampaignRunAuditEvent,
  CampaignRunAuditRow,
  CampaignRunStatus,
  NormalizedCampaignBrief,
  StoredOrchestrationPlan,
} from './campaignOrchestration';
import type { LockedGenerationInputSnapshot } from './types';
import type { GenerationProviderRunRecord } from './repository';
import type { ModelVersionRecord } from '../domain/models';

/** One child media job record owned by a campaign run. */
export interface CampaignRunJobRecord {
  id: string;
  workspaceId: string;
  campaignGenerationRunId: string;
  /** The media service run id (image or video-kind run) once submitted. */
  mediaGenerationJobId: string | null;
  mediaType: 'image' | 'video' | 'story';
  plannedRole: string;
  outputGroupKey: string | null;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  promptDraft: string;
  controlledVariation: boolean;
  createdAt: string;
}

/** The parent orchestration record. */
export interface CampaignGenerationRunRecord {
  id: string;
  workspaceId: string;
  campaignId: string | null;
  initiatedBy: string;
  status: CampaignRunStatus;
  sourceBriefText: string;
  normalizedBrief: NormalizedCampaignBrief;
  orchestrationPlan: StoredOrchestrationPlan;
  lockedBaselineSnapshot: LockedGenerationInputSnapshot | null;
  totalJobsCount: number;
  completedJobsCount: number;
  failedJobsCount: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

/** Workspace-scoped store for campaign runs (mirrors the SQL shape). */
export interface CampaignRunStore {
  createRun(input: {
    workspaceId: string;
    campaignId: string | null;
    initiatedBy: string;
    sourceBriefText: string;
    normalizedBrief: NormalizedCampaignBrief;
    orchestrationPlan: StoredOrchestrationPlan;
  }): Promise<CampaignGenerationRunRecord>;
  getRun(runId: string): Promise<CampaignGenerationRunRecord | null>;
  listRuns(workspaceId: string): Promise<CampaignGenerationRunRecord[]>;
  updateRun(
    runId: string,
    patch: Partial<Pick<CampaignGenerationRunRecord, 'status' | 'lockedBaselineSnapshot' | 'completedJobsCount' | 'failedJobsCount' | 'completedAt'>>,
  ): Promise<CampaignGenerationRunRecord>;
  createJob(input: {
    campaignGenerationRunId: string;
    workspaceId: string;
    mediaType: 'image' | 'video' | 'story';
    plannedRole: string;
    outputGroupKey: string | null;
    promptDraft: string;
    controlledVariation: boolean;
  }): Promise<CampaignRunJobRecord>;
  listJobs(runId: string): Promise<CampaignRunJobRecord[]>;
  updateJob(jobId: string, patch: Partial<Pick<CampaignRunJobRecord, 'status' | 'mediaGenerationJobId'>>): Promise<CampaignRunJobRecord>;
  appendAudit(row: Omit<CampaignRunAuditRow, 'id' | 'createdAt'>): Promise<void>;
  listAudit(runId: string): Promise<CampaignRunAuditRow[]>;
}

/** In-memory store (demo mode + tests); mirrors the SQL/RPC shape. */
export class InMemoryCampaignRunStore implements CampaignRunStore {
  private runs = new Map<string, CampaignGenerationRunRecord>();
  private jobs = new Map<string, CampaignRunJobRecord>();
  private audit: CampaignRunAuditRow[] = [];

  async createRun(input: {
    workspaceId: string;
    campaignId: string | null;
    initiatedBy: string;
    sourceBriefText: string;
    normalizedBrief: NormalizedCampaignBrief;
    orchestrationPlan: StoredOrchestrationPlan;
  }): Promise<CampaignGenerationRunRecord> {
    const stamp = new Date().toISOString();
    const record: CampaignGenerationRunRecord = {
      id: `crun_${crypto.randomUUID()}`,
      workspaceId: input.workspaceId,
      campaignId: input.campaignId,
      initiatedBy: input.initiatedBy,
      status: 'draft',
      sourceBriefText: input.sourceBriefText,
      normalizedBrief: structuredClone(input.normalizedBrief),
      orchestrationPlan: structuredClone(input.orchestrationPlan),
      lockedBaselineSnapshot: null,
      totalJobsCount: input.orchestrationPlan.totals.jobs,
      completedJobsCount: 0,
      failedJobsCount: 0,
      createdAt: stamp,
      updatedAt: stamp,
      completedAt: null,
    };
    this.runs.set(record.id, record);
    return structuredClone(record);
  }

  async getRun(runId: string): Promise<CampaignGenerationRunRecord | null> {
    const run = this.runs.get(runId);
    return run ? structuredClone(run) : null;
  }

  async listRuns(workspaceId: string): Promise<CampaignGenerationRunRecord[]> {
    return [...this.runs.values()]
      .filter((run) => run.workspaceId === workspaceId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((run) => structuredClone(run));
  }

  async updateRun(
    runId: string,
    patch: Partial<Pick<CampaignGenerationRunRecord, 'status' | 'lockedBaselineSnapshot' | 'completedJobsCount' | 'failedJobsCount' | 'completedAt'>>,
  ): Promise<CampaignGenerationRunRecord> {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Campaign generation run not found: ${runId}`);
    const next = { ...run, ...patch, updatedAt: new Date().toISOString() };
    this.runs.set(runId, next);
    return structuredClone(next);
  }

  async createJob(input: {
    campaignGenerationRunId: string;
    workspaceId: string;
    mediaType: 'image' | 'video' | 'story';
    plannedRole: string;
    outputGroupKey: string | null;
    promptDraft: string;
    controlledVariation: boolean;
  }): Promise<CampaignRunJobRecord> {
    const record: CampaignRunJobRecord = {
      id: `crunjob_${crypto.randomUUID()}`,
      workspaceId: input.workspaceId,
      campaignGenerationRunId: input.campaignGenerationRunId,
      mediaGenerationJobId: null,
      mediaType: input.mediaType,
      plannedRole: input.plannedRole,
      outputGroupKey: input.outputGroupKey,
      status: 'queued',
      promptDraft: input.promptDraft,
      controlledVariation: input.controlledVariation,
      createdAt: new Date().toISOString(),
    };
    this.jobs.set(record.id, record);
    return structuredClone(record);
  }

  async listJobs(runId: string): Promise<CampaignRunJobRecord[]> {
    return [...this.jobs.values()]
      .filter((job) => job.campaignGenerationRunId === runId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((job) => structuredClone(job));
  }

  async updateJob(
    jobId: string,
    patch: Partial<Pick<CampaignRunJobRecord, 'status' | 'mediaGenerationJobId'>>,
  ): Promise<CampaignRunJobRecord> {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`Campaign run job not found: ${jobId}`);
    const next = { ...job, ...patch };
    this.jobs.set(jobId, next);
    return structuredClone(next);
  }

  async appendAudit(row: Omit<CampaignRunAuditRow, 'id' | 'createdAt'>): Promise<void> {
    this.audit.push({ ...row, id: `crunaudit_${crypto.randomUUID()}`, createdAt: new Date().toISOString() });
  }

  async listAudit(runId: string): Promise<CampaignRunAuditRow[]> {
    return this.audit
      .filter((row) => row.campaignRunId === runId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((row) => structuredClone(row));
  }
}

/** Resolved records behind the brief (workspace-checked by the host). */
export interface CampaignBaselineSource {
  model: { modelId: string; modelName: string; version: ModelVersionRecord } | null;
  characterSheet: import('../domain/models').CharacterSheetRecord | null;
  environment: { environmentId: string; environmentName: string; version: { id: string; versionNumber: number; status: string } } | null;
  assets: Array<{ assetId: string; label: string; kind: 'library_asset' | 'look' }>;
  references: import('../domain/models').ModelReferenceRecord[];
}

/** Bridges to the existing media services + content job creation. */
export interface CampaignRunDependencies {
  /** Content Studio: creates the draft jobs child runs submit under. */
  content: {
    createDraftJobRequest(
      input: Record<string, unknown>,
      createdBy: string,
      workspaceId: string,
    ): Promise<{ id: string }>;
    copyPinsFromModel?(
      sourceJobId: string,
      targetJobId: string,
      workspaceId: string,
    ): Promise<unknown>;
  };
  /** Prompt-27 image path. */
  submitImageRun(input: {
    jobId: string;
    workspaceId: string;
    userId: string;
    prompt: string;
    identityTraits?: Record<string, Record<string, unknown>>;
    requireIdentityBaseline?: Record<string, boolean>;
  }): Promise<{ run: GenerationProviderRunRecord | null; eligible: boolean; blocking: string[] }>;
  /** Prompt-28 video/story path. */
  submitVideoRun(input: {
    jobId: string;
    workspaceId: string;
    userId: string;
    prompt: string;
    selection: {
      mediaFlavor: 'video' | 'story';
      durationSeconds: 4 | 6 | 8;
      aspectRatio: '9:16' | '1:1' | '16:9';
      outputCount: number;
      storyFrames?: Array<{ label: string; actionDescription: string }>;
    };
    identityTraits?: Record<string, Record<string, unknown>>;
    requireIdentityBaseline?: Record<string, boolean>;
  }): Promise<{ run: GenerationProviderRunRecord | null; eligible: boolean; blocking: string[] }>;
  /**
   * Resolves the workspace-checked records behind the brief into the shared
   * locked baseline (same assembler the media services use). Also returns
   * the candidate identity traits for enforcement + the model pin ids.
   */
  resolveBaseline: (input: {
    workspaceId: string;
    modelId: string | null;
    modelVersionId: string | null;
    environmentId: string | null;
    environmentVersionId: string | null;
    assetIds: string[];
  }) => Promise<{
    source: CampaignBaselineSource;
    snapshot: LockedGenerationInputSnapshot | null;
    identityTraits: Record<string, Record<string, unknown>>;
    modelPinIds: string[];
  } | null>;
}

export interface CampaignRunSubmissionResult {
  run: CampaignGenerationRunRecord;
  jobs: CampaignRunJobRecord[];
  eligible: boolean;
  blocking: string[];
}

export class CampaignRunService {
  constructor(
    private readonly store: CampaignRunStore,
    private readonly deps: CampaignRunDependencies,
  ) {}

  /**
   * Creates + validates a run from a structured brief: normalizes the brief,
   * builds the plan, resolves the shared locked baseline (with Character
   * Sheet constraints), and blocks model-based runs without one when the
   * models exist in the workspace but have no recorded identity.
   */
  async createCampaignGenerationRun(
    workspaceId: string,
    userId: string,
    input: CampaignBriefInput & {
      campaignId?: string | null;
      modelId?: string | null;
      modelVersionId?: string | null;
      environmentId?: string | null;
      environmentVersionId?: string | null;
      assetIds?: string[];
    },
  ): Promise<CampaignRunSubmissionResult> {
    // Pre-run audit rows are written after the run record exists (the store
    // keys audit rows by runId), so we create the run first, then backfill
    // the requested/plan events. Ordering is preserved by timestamps.
    const normalizedBriefEarly = normalizeCampaignBrief(input);
    const planEarly = buildCampaignGenerationPlan(normalizedBriefEarly);

    if (planEarly.totals.jobs === 0) {
      return {
        run: null as unknown as CampaignGenerationRunRecord,
        jobs: [],
        eligible: false,
        blocking: ['The brief plans no outputs — request at least one image, video or story.'],
      };
    }

    const normalizedBrief = normalizedBriefEarly;
    const plan = planEarly;

    const run = await this.store.createRun({
      workspaceId,
      campaignId: input.campaignId ?? null,
      initiatedBy: userId,
      sourceBriefText: input.briefText,
      normalizedBrief,
      orchestrationPlan: { ...plan, normalizedBrief, lockedBaseline: null },
    });

    // Backfill the pre-run audit rows now that the parent id exists.
    await this.store.appendAudit({
      workspaceId,
      campaignRunId: run.id,
      event: 'campaign_generation_run_requested',
      detail: input.briefText.slice(0, 200),
    });
    await this.store.appendAudit({
      workspaceId,
      campaignRunId: run.id,
      event: 'campaign_generation_plan_created',
      detail: describePlanMix(plan),
    });

    // Shared locked baseline: one snapshot for the whole content set.
    let baseline: Awaited<ReturnType<CampaignRunDependencies['resolveBaseline']>> = null;
    if (input.modelId || input.environmentId || (input.assetIds ?? []).length > 0) {
      baseline = await this.deps.resolveBaseline({
        workspaceId,
        modelId: input.modelId ?? null,
        modelVersionId: input.modelVersionId ?? null,
        environmentId: input.environmentId ?? null,
        environmentVersionId: input.environmentVersionId ?? null,
        assetIds: input.assetIds ?? [],
      });
    }

    const hasModelBaseline = Boolean(baseline?.snapshot && (baseline.snapshot.characterSheetConstraints.length > 0));
    const modelRequested = Boolean(input.modelId);
    if (modelRequested && !hasModelBaseline) {
      await this.store.updateRun(run.id, { status: 'blocked' });
      await this.store.appendAudit({
        workspaceId,
        campaignRunId: run.id,
        event: 'campaign_generation_run_blocked',
        detail: 'Model-based run without a Character Sheet identity baseline.',
      });
      return {
        run: await this.store.getRun(run.id) as CampaignGenerationRunRecord,
        jobs: [],
        eligible: false,
        blocking: [
          'The selected model has no Character Sheet identity baseline — record protected identity traits before generating a campaign content set.',
        ],
      };
    }

    if (baseline?.snapshot) {
      await this.store.updateRun(run.id, { lockedBaselineSnapshot: baseline.snapshot });
      await this.store.appendAudit({
        workspaceId,
        campaignRunId: run.id,
        event: 'campaign_generation_locked_baseline_created',
        detail: `${baseline.snapshot.lockedInputs.length} locked input(s), ${baseline.snapshot.characterSheetConstraints.length} Character Sheet constraint(s).`,
      });
    }

    await this.store.appendAudit({
      workspaceId,
      campaignRunId: run.id,
      event: 'campaign_generation_run_validated',
      detail: describePlanMix(plan),
    });

    // Child jobs are created immediately (queued) — submission is separate.
    const jobs: CampaignRunJobRecord[] = [];
    for (const planned of plan.jobs) {
      const job = await this.store.createJob({
        campaignGenerationRunId: run.id,
        workspaceId,
        mediaType: planned.mediaType,
        plannedRole: planned.plannedRole,
        outputGroupKey: planned.mediaType === 'story' ? `campaign:${run.id}:story` : null,
        promptDraft: planned.promptDraft,
        controlledVariation: planned.controlledVariation,
      });
      jobs.push(job);
      await this.store.appendAudit({
        workspaceId,
        campaignRunId: run.id,
        event: 'campaign_generation_child_job_created',
        detail: `${planned.mediaType} — ${planned.plannedRole}`,
      });
    }

    return { run: (await this.store.getRun(run.id))!, jobs, eligible: true, blocking: [] };
  }

  /**
   * Submits every queued child job through the existing media services.
   * Child jobs run under their own draft content jobs with the shared
   * baseline enforced per child (identity checks run in each media service).
   */
  async submitCampaignGenerationRun(
    runId: string,
    workspaceId: string,
    userId: string,
  ): Promise<CampaignRunSubmissionResult> {
    const run = await this.store.getRun(runId);
    if (!run) throw new Error(`Campaign generation run not found: ${runId}`);
    if (run.workspaceId !== workspaceId) {
      throw new Error('You do not have access to this workspace.');
    }
    if (run.status === 'running' || run.status === 'completed') {
      throw new Error('This campaign run has already been submitted.');
    }

    await this.store.updateRun(runId, { status: 'running' });
    await this.store.appendAudit({
      workspaceId,
      campaignRunId: runId,
      event: 'campaign_generation_run_submitted',
      detail: `${run.totalJobsCount} child job(s) submitted.`,
    });

    const baseline = run.lockedBaselineSnapshot;
    const modelConstraint = baseline?.characterSheetConstraints[0] ?? null;
    const identityTraits: Record<string, Record<string, unknown>> | undefined = undefined;
    void identityTraits; // candidates come from the media services' own sheets

    const jobs = await this.store.listJobs(runId);
    const blocking: string[] = [];

    for (const job of jobs) {
      if (job.status !== 'queued') continue;
      await this.store.updateJob(job.id, { status: 'running' });
      try {
        // Each child job runs under its own draft content job (same rule as
        // single-job generation: one active run per job).
        const contentJob = await this.deps.content.createDraftJobRequest(
          {
            workspaceId,
            name: `Campaign set ${run.id} — ${job.plannedRole}`,
            requestedOutputType: job.mediaType,
            requestedVariants: 1,
            briefSnapshot: {
              campaignGenerationRunId: run.id,
              campaignId: run.campaignId,
              plannedRole: job.plannedRole,
              prompt: job.promptDraft,
              capturedAt: new Date().toISOString(),
            },
          },
          userId,
          workspaceId,
        );

        const requireIdentityBaseline = modelConstraint
          ? { [modelConstraint.modelId]: true }
          : undefined;

        const result =
          job.mediaType === 'image'
            ? await this.deps.submitImageRun({
                jobId: contentJob.id,
                workspaceId,
                userId,
                prompt: job.promptDraft,
                requireIdentityBaseline,
              })
            : await this.deps.submitVideoRun({
                jobId: contentJob.id,
                workspaceId,
                userId,
                prompt: job.promptDraft,
                selection: {
                  mediaFlavor: job.mediaType === 'story' ? 'story' : 'video',
                  durationSeconds: 4,
                  aspectRatio: '9:16',
                  outputCount: 1,
                  ...(job.mediaType === 'story'
                    ? {
                        storyFrames: Array.from(
                          { length: run.normalizedBrief.mediaPlan.storyFrames },
                          (_, index) => ({
                            label: `Frame ${index + 1}`,
                            actionDescription: job.promptDraft,
                          }),
                        ),
                      }
                    : {}),
                },
                requireIdentityBaseline,
              });

        if (!result.eligible || !result.run) {
          await this.store.updateJob(job.id, { status: 'failed' });
          blocking.push(`${job.mediaType}: ${result.blocking[0] ?? 'submission blocked'}`);
          continue;
        }

        await this.store.updateJob(job.id, {
          status: result.run.status === 'completed' ? 'completed' : 'running',
          mediaGenerationJobId: result.run.id,
        });
      } catch (error) {
        await this.store.updateJob(job.id, { status: 'failed' });
        blocking.push(
          `${job.mediaType}: ${error instanceof Error ? error.message : 'child job failed'}`,
        );
      }
    }

    const updatedJobs = await this.store.listJobs(runId);
    const completed = updatedJobs.filter((job) => job.status === 'completed').length;
    const failed = updatedJobs.filter((job) => job.status === 'failed').length;
    const status = rollUpCampaignRunStatus(updatedJobs.map((job) => ({ status: job.status })));

    await this.store.updateRun(runId, {
      status,
      completedJobsCount: completed,
      failedJobsCount: failed,
      completedAt: ['completed', 'partially_completed', 'failed'].includes(status)
        ? new Date().toISOString()
        : null,
    });

    const terminalEvent: CampaignRunAuditEvent | null =
      status === 'completed'
        ? 'campaign_generation_run_completed'
        : status === 'partially_completed'
          ? 'campaign_generation_run_partially_completed'
          : status === 'failed'
            ? 'campaign_generation_run_failed'
            : null;
    if (terminalEvent) {
      await this.store.appendAudit({
        workspaceId,
        campaignRunId: runId,
        event: terminalEvent,
        detail: `${completed} completed, ${failed} failed.`,
      });
    }

    return {
      run: (await this.store.getRun(runId))!,
      jobs: updatedJobs,
      eligible: failed === 0,
      blocking,
    };
  }

  /**
   * Retries failed child jobs without breaking parent traceability: failed
   * children are reset to queued and resubmitted under the same parent run
   * with the same shared baseline.
   */
  async retryFailedRunJobs(
    workspaceId: string,
    runId: string,
    userId: string,
  ): Promise<CampaignRunSubmissionResult> {
    const run = await this.store.getRun(runId);
    if (!run) throw new Error(`Campaign generation run not found: ${runId}`);
    if (run.workspaceId !== workspaceId) {
      throw new Error('You do not have access to this workspace.');
    }

    const jobs = await this.store.listJobs(runId);
    const failedJobs = jobs.filter((job) => job.status === 'failed');
    if (failedJobs.length === 0) {
      throw new Error('No failed child jobs to retry.');
    }

    await this.store.appendAudit({
      workspaceId,
      campaignRunId: runId,
      event: 'campaign_generation_run_retry_requested',
      detail: `${failedJobs.length} failed child job(s) queued for retry.`,
    });

    for (const job of failedJobs) {
      await this.store.updateJob(job.id, { status: 'queued' });
    }

    return this.submitCampaignGenerationRun(runId, workspaceId, userId);
  }

  /** Read-only detail for UIs (workspace-checked). */
  async getCampaignGenerationRunDetail(workspaceId: string, runId: string) {
    const run = await this.store.getRun(runId);
    if (!run) throw new Error(`Campaign generation run not found: ${runId}`);
    if (run.workspaceId !== workspaceId) {
      throw new Error('You do not have access to this workspace.');
    }
    const [jobs, audit] = await Promise.all([
      this.store.listJobs(runId),
      this.store.listAudit(runId),
    ]);
    return { run, jobs, audit, planMix: describePlanMix(run.orchestrationPlan) };
  }

  async listRuns(workspaceId: string): Promise<CampaignGenerationRunRecord[]> {
    return this.store.listRuns(workspaceId);
  }
}

/** Exported for the mock/SQL split and tests. */
export { normalizeCampaignBrief, buildCampaignGenerationPlan, rollUpCampaignRunStatus, describePlanMix };
