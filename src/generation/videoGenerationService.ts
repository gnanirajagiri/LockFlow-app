/**
 * VideoGenerationService — the ONLY entry point for video generation flows.
 *
 * Reuses the Prompt-12 architecture end to end: provider registry resolution
 * (fail-closed), immutable pins + scene/beat snapshots, separate video quotas,
 * guarded job transitions, private lockflow-gallery-media ingestion, audit
 * events. Server-side only — React components never import providers.
 */
import { normalizeGenerationPrompt } from './promptNormalization';
import type { LockedGenerationInputSnapshot, NormalizedPromptRecord } from './types';
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
  /**
   * Prompt 28 — media flavor of this run: 'video' renders standalone clips;
   * 'story' produces an ordered, grouped sequence under one parent job.
   * Defaults to the job's requested output type when omitted.
   */
  mediaFlavor?: 'video' | 'story';
  /**
   * Prompt 28 — story sequence plan: ordered frame intents for story runs.
   * Each entry becomes one grouped, ordered Gallery output. Ignored for
   * plain video runs.
   */
  storyFrames?: Array<{ label: string; actionDescription: string }>;
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
    /** Prompt 28 — copies source-job pins onto a draft variant job. */
    copyPinsToJob?(sourceJobId: string, targetJobId: string, workspaceId: string): Promise<unknown>;
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
  /**
   * Prompt 28 — Character Sheet identity validation against the pinned
   * model's protected traits. Optional; returns null when the model has no
   * active sheet. Shared with the image service (same prompt-26 hooks).
   */
  models?: {
    validateGenerationAgainstCharacterSheet(
      modelId: string,
      candidateTraits: Record<string, unknown>,
      workspaceId: string,
    ): Promise<{ valid: boolean; mismatches: string[]; protectedTraitCount: number } | null>;
  };
  /**
   * Prompt 28 — assembles the deterministic locked media-input snapshot
   * (shared assembler with the image path). Null when a baseline cannot be
   * resolved.
   */
  assembleLockedInputSnapshot?: (input: {
    jobId: string;
    workspaceId: string;
    normalizedPrompt: NormalizedPromptRecord;
    outputCount: number;
    modelPins: VideoEligibilityInput['pins'];
    environmentPins: VideoEligibilityInput['pins'];
    assetPins: VideoEligibilityInput['pins'];
  }) => Promise<LockedGenerationInputSnapshot | null>;
  /**
   * Prompt 28 — creates a fresh DRAFT content job for a media variant and
   * copies the source job's pins onto it (variant inherits locked inputs).
   */
  createVariantJob?: (input: {
    sourceJobId: string;
    workspaceId: string;
    sourceRunId: string;
    userId: string;
    prompt: string;
    mediaFlavor: 'video' | 'story';
  }) => Promise<string>;
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
      /**
       * Prompt 28 — candidate identity traits per model pin (modelId-keyed);
       * any provided protected trait must agree with the model's sheet.
       */
      identityTraits?: Record<string, Record<string, unknown>>;
      /** Prompt 28 — require an identity baseline for these model pins. */
      requireIdentityBaseline?: Record<string, boolean>;
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

    // ── Prompt 28: media flavor + Character Sheet identity enforcement ────
    // Story runs come from story/story-type jobs; video from video-type or
    // explicit flavor override. Identity gating mirrors the image path:
    // required baselines block, mismatching protected traits block, and
    // everything else is recorded (never guessed).
    const mediaFlavor: 'video' | 'story' =
      input.selection.mediaFlavor ?? (job.requestedOutputType === 'story' ? 'story' : 'video');
    const identityChecks: Array<{
      modelId: string;
      status: 'passed' | 'failed' | 'skipped';
      mismatches: string[];
      protectedTraitCount: number;
    }> = [];
    const identityBlocking: string[] = [];
    for (const pin of pins.filter((candidate) => candidate.pinType === 'model')) {
      const candidateTraits = input.identityTraits?.[pin.sourceRecordId];
      if (!this.deps.models || !candidateTraits) {
        if (input.requireIdentityBaseline?.[pin.sourceRecordId]) {
          const modelLabel = pin.resolvedDetails?.modelName ?? pin.sourceRecordId;
          identityChecks.push({
            modelId: pin.sourceRecordId,
            status: 'failed',
            mismatches: ['No candidate identity traits supplied for a protected model.'],
            protectedTraitCount: 0,
          });
          identityBlocking.push(
            `Model ${modelLabel}: no Character Sheet baseline supplied — protected identity traits are required.`,
          );
          continue;
        }
        identityChecks.push({ modelId: pin.sourceRecordId, status: 'skipped', mismatches: [], protectedTraitCount: 0 });
        continue;
      }
      const sheetResult = await this.deps.models.validateGenerationAgainstCharacterSheet(
        pin.sourceRecordId,
        candidateTraits,
        workspaceId,
      );
      const modelLabel = pin.resolvedDetails?.modelName ?? pin.sourceRecordId;
      if (!sheetResult) {
        identityChecks.push({ modelId: pin.sourceRecordId, status: 'failed', mismatches: ['No active Character Sheet for this model.'], protectedTraitCount: 0 });
        identityBlocking.push(`Model ${modelLabel}: no active Character Sheet to validate identity against.`);
        continue;
      }
      if (
        input.requireIdentityBaseline?.[pin.sourceRecordId] &&
        (sheetResult.protectedTraitCount === 0 || !sheetResult.valid)
      ) {
        identityChecks.push({
          modelId: pin.sourceRecordId,
          status: 'failed',
          mismatches: sheetResult.valid
            ? ['The active Character Sheet has no protected identity traits recorded.']
            : sheetResult.mismatches,
          protectedTraitCount: sheetResult.protectedTraitCount,
        });
        identityBlocking.push(
          sheetResult.valid
            ? `Model ${modelLabel}: Character Sheet has no protected identity traits — record the identity baseline before generating.`
            : `Model ${modelLabel}: identity mismatch — ${sheetResult.mismatches.join('; ')}`,
        );
        continue;
      }
      if (!sheetResult.valid) {
        identityChecks.push({ modelId: pin.sourceRecordId, status: 'failed', mismatches: sheetResult.mismatches, protectedTraitCount: sheetResult.protectedTraitCount });
        identityBlocking.push(`Model ${modelLabel}: identity mismatch — ${sheetResult.mismatches.join('; ')}`);
        continue;
      }
      identityChecks.push({ modelId: pin.sourceRecordId, status: 'passed', mismatches: [], protectedTraitCount: sheetResult.protectedTraitCount });
    }
    if (identityBlocking.length > 0) {
      await this.repo.addAuditEvent({
        workspaceId,
        contentJobRequestId: jobId,
        providerRunId: null,
        actorId: userId,
        eventType: 'character_sheet_media_generation_validation_failed',
        message: 'Media submission blocked: candidate identity disagrees with the model protected Character Sheet traits.',
        metadata: { checks: identityChecks, blocking: identityBlocking, mediaFlavor },
      });
      return { run: null, reused: false, eligible: false, blocking: identityBlocking };
    }
    await this.repo.addAuditEvent({
      workspaceId,
      contentJobRequestId: jobId,
      providerRunId: null,
      actorId: userId,
      eventType: mediaFlavor === 'story' ? 'story_generation_requested' : 'video_generation_requested',
      message: mediaFlavor === 'story' ? 'Story generation requested.' : 'Video generation requested.',
      metadata: {
        mediaFlavor,
        identityChecks,
        validated: true,
        storyFrameCount: input.selection.storyFrames?.length ?? 0,
      },
    });

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

    // ── Prompt 28: deterministic locked media-input snapshot ───────────────
    // Same assembler the image path uses; extended with the media flavor and
    // the ordered story plan so the baseline records exactly what governed
    // the run. Best-effort enrichment — never blocks on its own.
    const normalized = normalizeGenerationPrompt({
      userPrompt: input.prompt ?? '',
      aspectRatio: input.selection.aspectRatio,
      outputCount: input.selection.storyFrames?.length ?? input.selection.outputCount,
    });
    const normalizedRecord: NormalizedPromptRecord = {
      userPrompt: normalized.userPrompt,
      cleanedPrompt: normalized.cleanedPrompt,
      aspectRatio: normalized.aspectRatio,
      outputCount: normalized.outputCount,
      extracted: normalized.extracted,
      warnings: normalized.warnings,
      rulesApplied: normalized.rulesApplied,
      normalizedAt: new Date().toISOString(),
    };
    let lockedInputSnapshot: LockedGenerationInputSnapshot | null = null;
    try {
      lockedInputSnapshot = this.deps.assembleLockedInputSnapshot
        ? await this.deps.assembleLockedInputSnapshot({
            jobId,
            workspaceId,
            normalizedPrompt: normalizedRecord,
            outputCount: input.selection.storyFrames?.length ?? input.selection.outputCount,
            modelPins: pins.filter((candidate) => candidate.pinType === 'model'),
            environmentPins: pins.filter((candidate) => candidate.pinType === 'environment'),
            assetPins: pins.filter(
              (candidate) => candidate.pinType === 'library_asset' || candidate.pinType === 'look',
            ),
          })
        : null;
    } catch {
      lockedInputSnapshot = null;
    }
    if (lockedInputSnapshot) {
      await this.repo.addAuditEvent({
        workspaceId,
        contentJobRequestId: jobId,
        providerRunId: null,
        actorId: userId,
        eventType: 'locked_media_input_snapshot_created',
        message: 'Locked media input snapshot assembled.',
        metadata: {
          mediaFlavor,
          lockedInputCount: lockedInputSnapshot.lockedInputs.length,
          characterSheetConstraints: lockedInputSnapshot.characterSheetConstraints.length,
          protectedTraitKeys: lockedInputSnapshot.characterSheetConstraints.flatMap(
            (constraint) => constraint.protectedTraitKeys,
          ),
          storyFrames: mediaFlavor === 'story' ? (input.selection.storyFrames ?? []).map((frame) => frame.label) : undefined,
        },
      });
    }

    const run = await this.repo.createVideoRun({
      workspaceId,
      contentJobRequestId: jobId,
      createdBy: userId,
      providerName: config.videoProviderName,
      idempotencyKey,
      requestSnapshot: {
        ...requestSnapshot,
        mediaFlavor,
        identityValidation: identityChecks,
        normalizedPrompt: normalizedRecord,
        storyFrames: mediaFlavor === 'story' ? input.selection.storyFrames ?? [] : undefined,
      },
      contentSceneId: input.selection.sceneId,
      contentBeatId: input.selection.beatId,
      sceneSnapshot: scene ? (scene as unknown as Record<string, unknown>) : null,
      beatSnapshot: beat ? (beat as unknown as Record<string, unknown>) : null,
      requestedAspectRatio: input.selection.aspectRatio,
      requestedDurationSeconds: input.selection.durationSeconds,
      lockedInputSnapshot: lockedInputSnapshot as unknown as Record<string, unknown> | null,
    });

    await this.repo.addAuditEvent({
      workspaceId,
      contentJobRequestId: jobId,
      providerRunId: run.id,
      actorId: userId,
      eventType: 'media_generation_submitted',
      message: `${mediaFlavor === 'story' ? 'Story' : 'Video'} provider run created (attempt ${run.attemptNumber}).`,
      metadata: { idempotencyKey, provider: config.videoProviderName, seconds: eligibility.secondsRequested, mediaFlavor },
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

      // Prompt 28 — story runs keep an explicit ordering plan: every output
      // of one run shares a group key and carries its sequence position, so
      // Gallery can render the set as one coherent story.
      const snapshot = run.requestSnapshot as {
        mediaFlavor?: 'video' | 'story';
        storyFrames?: Array<{ label: string; actionDescription: string }>;
      };
      const isStory = snapshot.mediaFlavor === 'story';
      const storyFrames = snapshot.storyFrames ?? [];
      const frame = isStory ? storyFrames[index] : undefined;

      const output = await this.deps.gallery.createGeneratedOutput({
        workspaceId: run.workspaceId,
        contentJobRequestId: run.contentJobRequestId,
        title: frame ? `Story frame ${index + 1} — ${frame.label}` : `Generated clip ${run.attemptNumber}.${index + 1}`,
        outputType: isStory ? 'story' : 'video',
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
          media_flavor: isStory ? 'story' : 'video',
          // Story grouping: one run = one story group; outputs carry their
          // 1-based sequence position and total, plus the frame intent.
          story_group_key: isStory ? `story:${run.id}` : undefined,
          story_sequence: isStory ? index + 1 : undefined,
          story_sequence_total: isStory ? results.length : undefined,
          story_frame_label: frame?.label,
          story_frame_action: frame?.actionDescription,
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
      eventType: 'media_generation_completed',
      message: `Ingested ${outputs.length} clip(s); job moved to review.`,
      metadata: {
        outputs: outputs.length,
        mediaFlavor: (run.requestSnapshot as { mediaFlavor?: string }).mediaFlavor ?? 'video',
      },
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

  // ── Prompt 28: media variant generation ─────────────────────────────────
  // Variants are derived media generations of a completed run: the locked
  // baseline (pins, snapshot, flavor, story plan) is inherited verbatim
  // unless the caller overrides, and the parent linkage is audited.

  async createMediaVariantJob(
    sourceJobId: string,
    workspaceId: string,
    userId: string,
    variantInput: {
      prompt?: string;
      durationSeconds?: AllowedDuration;
      aspectRatio?: AllowedAspectRatio;
      identityTraits?: Record<string, Record<string, unknown>>;
    } = {},
  ): Promise<VideoSubmissionResult> {
    const sourceRun = await this.repo.latestVideoRunForJob(sourceJobId);
    if (!sourceRun) {
      throw new Error('No media generation run exists for the source job.');
    }
    if (sourceRun.status !== 'completed') {
      throw new Error('Media variants can only be created from a completed generation run.');
    }
    if (sourceRun.workspaceId !== workspaceId) {
      throw new Error('You do not have access to this workspace.');
    }

    const sourceSnapshot = sourceRun.requestSnapshot as {
      mediaFlavor?: 'video' | 'story';
      prompt?: string;
      negativePrompt?: string | null;
      storyFrames?: Array<{ label: string; actionDescription: string }>;
    };
    const mediaFlavor = sourceSnapshot.mediaFlavor ?? 'video';

    await this.repo.addAuditEvent({
      workspaceId,
      contentJobRequestId: sourceJobId,
      providerRunId: sourceRun.id,
      actorId: userId,
      eventType: 'media_generation_variant_requested',
      message: `${mediaFlavor === 'story' ? 'Story' : 'Video'} variant requested from a completed run.`,
      metadata: {
        parentRunId: sourceRun.id,
        mediaFlavor,
        promptOverride: variantInput.prompt ?? null,
        durationOverride: variantInput.durationSeconds ?? null,
        aspectRatioOverride: variantInput.aspectRatio ?? null,
      },
    });

    const inheritedPrompt = variantInput.prompt ?? sourceSnapshot.prompt ?? '';
    let variantJobId = sourceJobId;
    if (this.deps.createVariantJob) {
      variantJobId = await this.deps.createVariantJob({
        sourceJobId,
        workspaceId,
        sourceRunId: sourceRun.id,
        userId,
        prompt: inheritedPrompt,
        mediaFlavor,
      });
      if (this.deps.content?.copyPinsToJob) {
        await this.deps.content.copyPinsToJob(sourceJobId, variantJobId, workspaceId);
      }
    }

    return this.submitVideoGeneration(variantJobId, workspaceId, userId, {
      selection: {
        sceneId: sourceRun.contentSceneId ?? null,
        beatId: sourceRun.contentBeatId ?? null,
        durationSeconds: variantInput.durationSeconds ?? (sourceRun.requestedDurationSeconds ?? 4) as AllowedDuration,
        aspectRatio: variantInput.aspectRatio ?? (sourceRun.requestedAspectRatio ?? '9:16') as AllowedAspectRatio,
        outputCount: ((sourceRun.requestSnapshot as { outputCount?: number }).outputCount) ?? 1,
        mediaFlavor,
        storyFrames: sourceSnapshot.storyFrames,
      },
      prompt: inheritedPrompt,
      negativePrompt: sourceSnapshot.negativePrompt ?? undefined,
      identityTraits: variantInput.identityTraits,
    });
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
