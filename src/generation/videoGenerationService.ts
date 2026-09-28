/**
 * VideoGenerationService — the ONLY entry point for video generation flows.
 *
 * Reuses the Prompt-12 architecture end to end: provider registry resolution
 * (fail-closed), immutable pins + scene/beat snapshots, separate video quotas,
 * guarded job transitions, private lockflow-gallery-media ingestion, audit
 * events. Server-side only — React components never import providers.
 */
import type {
  VideoGenerationProvider,
  VideoGenerationStatusResult,
  VideoReferenceImage,
  SceneSnapshot,
  BeatSnapshot,
  AllowedAspectRatio,
  AllowedDuration,
} from './videoTypes';
import { getVideoProvider } from './providerRegistry';
import type { GenerationProviderRunRecord, GenerationRepository } from './repository';
import { evaluateVideoJobEligibility } from './videoEligibility';
import type { VideoEligibilityInput, VideoEligibilityResult, VideoQuotas } from './videoEligibility';
import { buildVideoProviderRequest } from './videoRequestBuilder';
import { mapVideoProviderError } from './videoErrorMapper';
import { buildVideoOutputMediaPath } from './videoMediaStore';

export interface VideoSubmissionResult {
  run: GenerationProviderRunRecord | null;
  reused: boolean;
  eligible: boolean;
  blocking: string[];
}

export interface VideoSelection {
  sceneId: string | null;
  beatId: string | null;
  durationSeconds: AllowedDuration;
  aspectRatio: AllowedAspectRatio;
  outputCount: number;
}

/** Minimal contract of the domain services the video flow depends on. */
export interface VideoGenerationDependencies {
  content: {
    getJobRequest(jobId: string, workspaceId: string): Promise<{
      id: string;
      workspaceId: string;
      status: string;
      requestedOutputType: string;
      contentProjectId: string | null;
      name: string;
    }>;
    transitionJobRequest(jobId: string, to: string, workspaceId: string, options?: { hasProvider?: boolean }): Promise<unknown>;
    listScenes(projectId: string, workspaceId: string): Promise<Array<{ id: string }>>;
    getSceneSnapshot(sceneId: string, workspaceId: string): Promise<SceneSnapshot | null>;
    getBeatSnapshot(beatId: string, workspaceId: string): Promise<BeatSnapshot | null>;
  };
  gallery: {
    createGeneratedOutput(input: {
      workspaceId: string;
      contentJobRequestId: string;
      title: string;
      outputType: 'video' | 'story';
      status: 'ready_for_review';
      mediaStoragePath: string;
      thumbnailStoragePath?: string;
      width?: number;
      height?: number;
      durationSeconds?: number;
      fileSizeBytes?: number;
      mimeType?: string;
      outputIndex?: number;
      contentSceneId?: string;
      contentBeatId?: string;
      metadata: Record<string, unknown>;
    }): Promise<{ id: string }>;
    attachMedia(outputId: string, patch: {
      mediaStoragePath: string;
      thumbnailStoragePath?: string;
      durationSeconds?: number;
      width?: number;
      height?: number;
      fileSizeBytes?: number;
      mimeType?: string;
      generationProviderRunId?: string;
    }, workspaceId: string): Promise<unknown>;
    appendEvent(outputId: string, eventType: string, message: string, metadata?: Record<string, unknown>): Promise<unknown>;
    nextOutputIndex(jobId: string): Promise<number>;
  };
  media: {
    fetchBytes(urlOrDataUrl: string): Promise<{ bytes: Uint8Array; contentType: string }>;
    put(bucket: string, path: string, bytes: Uint8Array, contentType: string): Promise<void>;
    resolvePinnedReferences(run: GenerationProviderRunRecord): Promise<VideoReferenceImage[]>;
  };
  /** Server-side pin resolution — never trusts caller-supplied pin lists. */
  loadPinsForJob(jobId: string): Promise<VideoEligibilityInput['pins']>;
  actorId: string;
}

export class VideoGenerationService {
  constructor(
    private readonly repo: GenerationRepository,
    private readonly deps: VideoGenerationDependencies,
  ) {}

  // ── Submission (idempotent, quota-gated, eligibility-gated) ───────────────

  async submitVideoGeneration(
    jobId: string,
    workspaceId: string,
    userId: string,
    input: {
      selection: VideoSelection;
      references?: VideoEligibilityInput['references'];
      assets?: VideoEligibilityInput['assets'];
      prompt?: string;
      negativePrompt?: string;
    },
  ): Promise<VideoSubmissionResult> {
    const job = await this.deps.content.getJobRequest(jobId, workspaceId);
    if (!job) throw new Error('Job not found.');
    if (job.workspaceId !== workspaceId) {
      throw new Error('You do not have access to this workspace.');
    }

    // Idempotency: an active OR completed video run is returned (never
    // silently resubmitted); retry is the only new-attempt path.
    const latest = await this.repo.latestVideoRunForJob(jobId);
    if (latest && ['created', 'submitted', 'queued', 'processing', 'completed'].includes(latest.status)) {
      await this.repo.addAuditEvent({
        workspaceId,
        contentJobRequestId: jobId,
        providerRunId: latest.id,
        actorId: userId,
        eventType: 'submission_requested',
        message: 'Duplicate video submission ignored — existing run returned (idempotent).',
        metadata: { reused: true, idempotencyKey: latest.idempotencyKey, runStatus: latest.status },
      });
      return { run: latest, reused: true, eligible: true, blocking: [] };
    }

    const config = await this.repo.getConfig();
    const pins = await this.deps.loadPinsForJob(jobId);
    const sceneIds = job.contentProjectId
      ? (await this.deps.content.listScenes(job.contentProjectId, workspaceId)).map((scene) => scene.id)
      : [];
    const scene = input.selection.sceneId
      ? await this.deps.content.getSceneSnapshot(input.selection.sceneId, workspaceId)
      : null;
    const beat = input.selection.beatId
      ? await this.deps.content.getBeatSnapshot(input.selection.beatId, workspaceId)
      : null;

    const quotas: VideoQuotas = {
      maxOutputsPerJob: config.videoMaxOutputsPerJob,
      maxJobsPerUserPerPeriod: config.videoMaxJobsPerUserPerPeriod,
      maxJobsPerWorkspacePerPeriod: config.videoMaxJobsPerWorkspacePerPeriod,
      maxSecondsPerUserPerPeriod: config.videoMaxSecondsPerUserPerPeriod,
      maxSecondsPerWorkspacePerPeriod: config.videoMaxSecondsPerWorkspacePerPeriod,
      userJobsThisPeriod: 0,
      workspaceJobsThisPeriod: 0,
      userSecondsThisPeriod: 0,
      workspaceSecondsThisPeriod: 0,
    };

    const eligibility: VideoEligibilityResult = evaluateVideoJobEligibility({
      job: {
        id: job.id,
        status: job.status,
        requestedOutputType: job.requestedOutputType,
        sceneIds,
      },
      config: { videoGenerationEnabled: config.videoGenerationEnabled, videoProviderName: config.videoProviderName },
      pins,
      references: input.references ?? [],
      assets: input.assets ?? {},
      quotas: await this.repo.getVideoQuotaView(workspaceId, userId, quotas),
      selection: input.selection,
    });

    if (!eligibility.eligible) {
      await this.repo.addAuditEvent({
        workspaceId,
        contentJobRequestId: jobId,
        providerRunId: null,
        actorId: userId,
        eventType: 'eligibility_failed',
        message: 'Video submission blocked by eligibility checks.',
        metadata: { blocking: eligibility.blocking },
      });
      return { run: null, reused: false, eligible: false, blocking: eligibility.blocking };
    }

    const adapter = getVideoProvider(config.videoProviderName);
    if (!adapter) {
      throw new Error(`No video provider adapter registered for "${config.videoProviderName}".`);
    }
    if (!(await adapter.isConfigured())) {
      throw new Error(`Video provider "${config.videoProviderName}" is not configured.`);
    }

    // Quota increment only after all checks passed (jobs + seconds).
    await this.repo.incrementVideoQuota(workspaceId, userId, eligibility.secondsRequested);

    const attempt = (latest?.attemptNumber ?? 0) + 1;
    const idempotencyKey = `vidjob:${jobId}:attempt:${attempt}`;

    const { requestSnapshot } = buildVideoProviderRequest({
      idempotencyKey,
      prompt: input.prompt ?? '',
      negativePrompt: input.negativePrompt,
      aspectRatio: input.selection.aspectRatio,
      durationSeconds: input.selection.durationSeconds,
      outputCount: input.selection.outputCount,
      referenceImages: [], // resolved server-side at submission time
      jobId,
      workspaceId,
      pinSummary: pins.map((pin) => ({
        type: pin.pinType,
        versionId: pin.sourceVersionId,
        versionNumber: pin.resolvedDetails?.versionNumber ?? null,
        resolvedVia: pin.resolvedDetails?.resolvedVia ?? null,
      })),
      sceneSnapshot: scene ?? undefined,
      beatSnapshot: beat ?? undefined,
    });

    const run = await this.repo.createVideoRun({
      workspaceId,
      contentJobRequestId: jobId,
      createdBy: userId,
      providerName: config.videoProviderName,
      idempotencyKey,
      requestSnapshot,
      contentSceneId: input.selection.sceneId,
      contentBeatId: input.selection.beatId,
      sceneSnapshot: scene ? (scene as unknown as Record<string, unknown>) : null,
      beatSnapshot: beat ? (beat as unknown as Record<string, unknown>) : null,
      requestedAspectRatio: input.selection.aspectRatio,
      requestedDurationSeconds: input.selection.durationSeconds,
    });

    await this.repo.addAuditEvent({
      workspaceId,
      contentJobRequestId: jobId,
      providerRunId: run.id,
      actorId: userId,
      eventType: 'provider_run_created',
      message: `Video provider run created (attempt ${run.attemptNumber}).`,
      metadata: { idempotencyKey, provider: config.videoProviderName, seconds: eligibility.secondsRequested },
    });

    await this.processRun(run.id);
    const fresh = await this.repo.getRun(run.id);
    return { run: fresh ?? run, reused: false, eligible: true, blocking: [] };
  }

  // ── Worker tick ───────────────────────────────────────────────────────────

  async processRun(runId: string): Promise<void> {
    const run = await this.repo.getRun(runId);
    if (!run || run.generationKind !== 'video') return;

    const adapter = getVideoProvider(run.providerName);
    if (!adapter) {
      await this.markFailed(run, 'adapter_missing', `No video adapter registered for "${run.providerName}".`);
      return;
    }

    try {
      if (run.status === 'created') {
        await this.submitRun(run, adapter);
      }
      const current = await this.repo.getRun(runId);
      if (current && ['submitted', 'queued', 'processing'].includes(current.status)) {
        await this.pollRun(current, adapter);
      }
    } catch (error) {
      const mapped = mapVideoProviderError(error);
      const current = (await this.repo.getRun(runId)) ?? run;
      await this.markFailed(current, mapped.errorCode, mapped.protectedDetail, mapped.userMessage);
    }
  }

  private async submitRun(run: GenerationProviderRunRecord, adapter: VideoGenerationProvider): Promise<void> {
    const snapshot = run.requestSnapshot as {
      prompt?: string;
      negativePrompt?: string | null;
      aspectRatio?: AllowedAspectRatio;
      durationSeconds?: AllowedDuration;
      outputCount?: number;
      metadata?: { lockflowJobId?: string; workspaceId?: string; pinSummary?: unknown };
    };

    const referenceImages = await this.deps.media.resolvePinnedReferences(run);

    const { request } = buildVideoProviderRequest({
      idempotencyKey: run.idempotencyKey,
      prompt: snapshot.prompt ?? '',
      negativePrompt: snapshot.negativePrompt ?? undefined,
      aspectRatio: (run.requestedAspectRatio ?? snapshot.aspectRatio ?? '9:16') as AllowedAspectRatio,
      durationSeconds: (run.requestedDurationSeconds ?? snapshot.durationSeconds ?? 4) as AllowedDuration,
      outputCount: snapshot.outputCount ?? 1,
      referenceImages,
      jobId: run.contentJobRequestId,
      workspaceId: run.workspaceId,
      pinSummary: snapshot.metadata?.pinSummary ?? null,
      sceneSnapshot: (run.sceneSnapshot as SceneSnapshot | null) ?? undefined,
      beatSnapshot: (run.beatSnapshot as BeatSnapshot | null) ?? undefined,
    });

    await this.deps.content.transitionJobRequest(run.contentJobRequestId, 'queued', run.workspaceId, { hasProvider: true });

    const accepted = await adapter.submitVideoGeneration(request);
    await this.repo.updateRun(run.id, {
      status: 'submitted',
      providerRequestId: accepted.providerRequestId,
      startedAt: run.startedAt ?? new Date().toISOString(),
    });
    await this.repo.addAuditEvent({
      workspaceId: run.workspaceId,
      contentJobRequestId: run.contentJobRequestId,
      providerRunId: run.id,
      actorId: this.deps.actorId,
      eventType: 'provider_request_accepted',
      message: `Video provider accepted the request (${accepted.status}).`,
      metadata: { providerRequestId: accepted.providerRequestId, referenceCount: referenceImages.length },
    });
  }

  private async pollRun(run: GenerationProviderRunRecord, adapter: VideoGenerationProvider): Promise<void> {
    if (!run.providerRequestId) return;
    const status = await adapter.getVideoGenerationStatus(run.providerRequestId);

    await this.repo.addAuditEvent({
      workspaceId: run.workspaceId,
      contentJobRequestId: run.contentJobRequestId,
      providerRunId: run.id,
      actorId: this.deps.actorId,
      eventType: 'status_update_received',
      message: `Video provider status: ${status.status}.`,
      metadata: { providerStatus: status.status },
    });

    if (status.status === 'completed' && status.results?.length) {
      await this.ingestResults(run, status);
      return;
    }
    if (status.status === 'failed') {
      const mapped = mapVideoProviderError(new Error(status.errorMessage ?? 'provider failure'));
      await this.markFailed(run, mapped.errorCode, mapped.protectedDetail, mapped.userMessage);
      return;
    }

    await this.repo.updateRun(run.id, { status: status.status === 'queued' ? 'queued' : 'processing' });
    if (run.status === 'submitted') {
      await this.deps.content.transitionJobRequest(run.contentJobRequestId, 'processing', run.workspaceId, { hasProvider: true });
    }
  }

  private async ingestResults(run: GenerationProviderRunRecord, status: VideoGenerationStatusResult): Promise<void> {
    const results = status.results ?? [];
    const outputs: Array<{ galleryOutputId: string; mediaPath: string }> = [];

    for (const [index, result] of results.entries()) {
      // Phase-1 container contract: mp4/webm only.
      if (!(result.mimeType === 'video/mp4' || result.mimeType === 'video/webm')) {
        throw new Error(`Unsupported video container from provider: ${result.mimeType}`);
      }
      const { bytes, contentType } = await this.deps.media.fetchBytes(result.remoteUrlOrBytes);
      const outputIndex = await this.deps.gallery.nextOutputIndex(run.contentJobRequestId);

      const output = await this.deps.gallery.createGeneratedOutput({
        workspaceId: run.workspaceId,
        contentJobRequestId: run.contentJobRequestId,
        title: `Generated clip ${run.attemptNumber}.${index + 1}`,
        outputType: 'video',
        status: 'ready_for_review',
        mediaStoragePath: '',
        width: result.width,
        height: result.height,
        durationSeconds: result.durationSeconds,
        mimeType: contentType,
        outputIndex,
        contentSceneId: run.contentSceneId ?? undefined,
        contentBeatId: run.contentBeatId ?? undefined,
        metadata: {
          provider_generated: true,
          provider_name: run.providerName,
          provider_run_id: run.id,
          generation_kind: 'video',
          attempt_number: run.attemptNumber,
          scene_snapshot: run.sceneSnapshot ?? null,
          beat_snapshot: run.beatSnapshot ?? null,
          placeholder: false,
        },
      });

      const mediaPath = buildVideoOutputMediaPath({
        workspaceId: run.workspaceId,
        contentJobRequestId: run.contentJobRequestId,
        providerRunId: run.id,
        galleryOutputId: output.id,
        safeFilename: `clip-${index + 1}.${contentType === 'video/mp4' ? 'mp4' : 'webm'}`,
        kind: 'videos',
      });
      await this.deps.media.put('lockflow-gallery-media', mediaPath, bytes, contentType);

      // Thumbnail only when the provider supplied one (no transcoding infra).
      let thumbnailPath: string | undefined;
      if (result.thumbnailRemoteUrlOrBytes) {
        const thumb = await this.deps.media.fetchBytes(result.thumbnailRemoteUrlOrBytes);
        thumbnailPath = buildVideoOutputMediaPath({
          workspaceId: run.workspaceId,
          contentJobRequestId: run.contentJobRequestId,
          providerRunId: run.id,
          galleryOutputId: output.id,
          safeFilename: `thumb-${index + 1}.${thumb.contentType === 'image/png' ? 'png' : 'webp'}`,
          kind: 'thumbnails',
        });
        await this.deps.media.put('lockflow-gallery-media', thumbnailPath, thumb.bytes, thumb.contentType);
      }

      await this.deps.gallery.attachMedia(
        output.id,
        {
          mediaStoragePath: mediaPath,
          thumbnailStoragePath: thumbnailPath,
          durationSeconds: result.durationSeconds,
          width: result.width,
          height: result.height,
          fileSizeBytes: bytes.byteLength,
          mimeType: contentType,
          generationProviderRunId: run.id,
        },
        run.workspaceId,
      );
      outputs.push({ galleryOutputId: output.id, mediaPath });

      await this.deps.gallery.appendEvent(output.id, 'ingested', 'Generated clip ingested from the video provider run.', {
        provider_run_id: run.id,
        media_path: mediaPath,
      });
      await this.repo.addAuditEvent({
        workspaceId: run.workspaceId,
        contentJobRequestId: run.contentJobRequestId,
        providerRunId: run.id,
        actorId: this.deps.actorId,
        eventType: 'output_created',
        message: `Generated clip ${index + 1}/${results.length} ingested.`,
        metadata: { galleryOutputId: output.id },
      });
    }

    await this.repo.updateRun(run.id, {
      status: 'completed',
      completedAt: new Date().toISOString(),
      responseSnapshot: { outputs: outputs.map((output) => ({ galleryOutputId: output.galleryOutputId, mediaPath: output.mediaPath })) },
      providerCostMetadata: (status.providerMetadata as Record<string, unknown> | undefined) ?? null,
    });
    await this.deps.content.transitionJobRequest(run.contentJobRequestId, 'review', run.workspaceId, { hasProvider: true });
    await this.repo.addAuditEvent({
      workspaceId: run.workspaceId,
      contentJobRequestId: run.contentJobRequestId,
      providerRunId: run.id,
      actorId: this.deps.actorId,
      eventType: 'result_ingested',
      message: `Ingested ${outputs.length} clip(s); job moved to review.`,
      metadata: { outputs: outputs.length },
    });
  }

  private async markFailed(
    run: GenerationProviderRunRecord,
    errorCode: string,
    protectedDetail: string,
    userMessage?: string,
  ): Promise<void> {
    const current = (await this.repo.getRun(run.id)) ?? run;
    if (current.status === 'failed' || current.status === 'completed') return;
    await this.repo.updateRun(run.id, {
      status: 'failed',
      errorCode,
      errorMessage: protectedDetail.slice(0, 500),
      completedAt: new Date().toISOString(),
    });
    await this.repo.addAuditEvent({
      workspaceId: run.workspaceId,
      contentJobRequestId: run.contentJobRequestId,
      providerRunId: run.id,
      actorId: this.deps.actorId,
      eventType: 'provider_error',
      message: userMessage ?? 'Video generation failed. Safe retry is available for failed jobs.',
      metadata: { errorCode },
    });
    const job = await this.deps.content.getJobRequest(run.contentJobRequestId, run.workspaceId);
    try {
      if (job.status === 'queued') {
        await this.deps.content.transitionJobRequest(run.contentJobRequestId, 'processing', run.workspaceId, { hasProvider: true });
      }
      if (['queued', 'processing'].includes(job.status)) {
        await this.deps.content.transitionJobRequest(run.contentJobRequestId, 'failed', run.workspaceId, { hasProvider: true });
      }
    } catch (transitionError) {
      await this.repo.addAuditEvent({
        workspaceId: run.workspaceId,
        contentJobRequestId: run.contentJobRequestId,
        providerRunId: run.id,
        actorId: this.deps.actorId,
        eventType: 'provider_error',
        message: 'Run marked failed; job status transition was not possible.',
        metadata: { detail: transitionError instanceof Error ? transitionError.message : String(transitionError) },
      });
    }
  }

  // ── Retry (new attempt, same immutable pins + snapshots) ──────────────────

  async retryVideoGeneration(jobId: string, workspaceId: string, userId: string): Promise<VideoSubmissionResult> {
    const latest = await this.repo.latestVideoRunForJob(jobId);
    if (!latest || latest.status !== 'failed') {
      throw new Error('Retry is only available for failed generation runs.');
    }
    await this.repo.addAuditEvent({
      workspaceId,
      contentJobRequestId: jobId,
      providerRunId: latest.id,
      actorId: userId,
      eventType: 'retry_requested',
      message: `Video retry requested after attempt ${latest.attemptNumber} failed.`,
      metadata: { previousRunId: latest.id },
    });
    await this.deps.content.transitionJobRequest(jobId, 'draft', workspaceId, { hasProvider: true });
    return this.submitVideoGeneration(jobId, workspaceId, userId, {
      selection: {
        sceneId: latest.contentSceneId ?? null,
        beatId: latest.contentBeatId ?? null,
        durationSeconds: (latest.requestedDurationSeconds ?? 4) as AllowedDuration,
        aspectRatio: (latest.requestedAspectRatio ?? '9:16') as AllowedAspectRatio,
        outputCount: ((latest.requestSnapshot as { outputCount?: number }).outputCount) ?? 1,
      },
    });
  }

  // ── Read-only surface ─────────────────────────────────────────────────────

  async getRunStatus(jobId: string, workspaceId: string): Promise<{ run: GenerationProviderRunRecord | null; outputsReady: number }> {
    void workspaceId;
    const run = await this.repo.latestVideoRunForJob(jobId);
    const outputsReady = run
      ? ((run.responseSnapshot as { outputs?: unknown[] } | null)?.outputs ?? []).length
      : 0;
    return { run, outputsReady };
  }
}
