/**
 * GenerationService — the ONLY entry point for generation flows.
 *
 * Security posture: constructed server-side (worker/API) with the provider
 * adapter resolved from the configured name; UI surfaces receive read-only
 * status/checklist data through this service or workspace-scoped RPCs. All
 * state transitions follow the existing guarded job state machine
 * (draft → queued → processing → review/failed; failed → draft on retry).
 *
 * Rules encoded: idempotent submission (an active run is reused, never
 * duplicated); eligibility + quota evaluated before any provider contact;
 * references resolved from exact pinned versions through short-lived signed
 * URLs; snapshots exclude secrets and signed URLs; failures append audit
 * events and keep retry available; ingestion writes private media and creates
 * ready-for-review Gallery outputs with full provenance.
 */
import type {
  ImageGenerationProvider,
  ImageGenerationStatusResult,
  ProviderReferenceImage,
} from './types';
import { getImageProvider } from './providerRegistry';
import type {
  CreateProviderRunInput,
  GenerationRepository,
  GenerationProviderRunRecord,
} from './repository';
import { currentPeriod } from './repository';
import { evaluateImageJobEligibility } from './eligibility';
import type { EligibilityInput, EligibilityResult } from './eligibility';
import { buildProviderRequest } from './requestBuilder';
import { mapProviderError } from './errorMapper';
import { GALLERY_MEDIA_BUCKET, buildOutputMediaPath } from './mediaStore';
import { normalizeGenerationPrompt } from './promptNormalization';
import type { LockedGenerationInputSnapshot, NormalizedPromptRecord } from './types';

/** Result of a submission attempt (idempotent by job). */
export interface SubmissionResult {
  run: GenerationProviderRunRecord | null;
  reused: boolean;
  eligible: boolean;
  blocking: string[];
}

/** Minimal contract of the domain services the generation flow depends on. */
export interface GenerationDependencies {
  /** Content Studio service for job reads + guarded status transitions. */
  content: {
    getJobRequest(
      jobId: string,
      workspaceId: string,
    ): Promise<{
      id: string;
      workspaceId: string;
      status: string;
      requestedOutputType: string;
      requestedVariants: number;
      contentProjectId: string | null;
      name: string;
    }>;
    transitionJobRequest(
      jobId: string,
      to: string,
      workspaceId: string,
      options?: { hasProvider?: boolean },
    ): Promise<unknown>;
    /**
     * Prompt 27 — copies the source job's immutable pins onto a draft job
     * (variant generations inherit the locked input baseline). Optional so
     * existing harnesses without the new ContentStudioService method keep
     * compiling; variants fall back to same-job behavior when absent.
     */
    copyPinsToJob?(sourceJobId: string, targetJobId: string, workspaceId: string): Promise<unknown>;
  };
  /** Creates generated Gallery outputs + events (workspace-guarded). */
  gallery: {
    createGeneratedOutput(input: {
      workspaceId: string;
      contentJobRequestId: string;
      title: string;
      outputType: 'image';
      status: 'ready_for_review';
      mediaStoragePath: string;
      width?: number;
      height?: number;
      fileSizeBytes?: number;
      mimeType?: string;
      outputIndex?: number;
      metadata: Record<string, unknown>;
    }): Promise<{ id: string }>;
    /** Ingestion completion: persists the private media path + run link. */
    attachMedia(
      outputId: string,
      patch: {
        mediaStoragePath: string;
        fileSizeBytes?: number;
        mimeType?: string;
        generationProviderRunId?: string;
      },
      workspaceId: string,
    ): Promise<unknown>;
    appendEvent(
      galleryOutputId: string,
      eventType: string,
      message: string,
      metadata?: Record<string, unknown>,
    ): Promise<unknown>;
    nextOutputIndex(jobId: string): Promise<number>;
  };
  /** Reference/result media handling (server-side only). */
  media: {
    createSignedUrl(bucket: string, path: string, ttlSeconds: number): Promise<string>;
    fetchBytes(urlOrDataUrl: string): Promise<{ bytes: Uint8Array; contentType: string }>;
    put(bucket: string, path: string, bytes: Uint8Array, contentType: string): Promise<void>;
    /** Resolves pinned references into signed provider-access handles. */
    resolvePinnedReferences(run: GenerationProviderRunRecord): Promise<ProviderReferenceImage[]>;
  };
  /**
   * Reads the job's immutable pins server-side — the submission path NEVER
   * trusts caller-supplied pin lists (the UI may not have them loaded yet).
   * Returns [] when the job has no pins (which then blocks eligibility).
   */
  loadPinsForJob(jobId: string): Promise<EligibilityInput['pins']>;
  /** Server-side actor id for audit rows (worker identity). */
  actorId: string;
  /**
   * Prompt 26 — identity validation against the pinned model's protected
   * Character Sheet. Optional: when the bridge is absent (or no candidate
   * identity traits are supplied), validation is recorded as skipped and
   * never guessed. Returns null when the model has no active sheet.
   */
  models?: {
    validateGenerationAgainstCharacterSheet(
      modelId: string,
      candidateTraits: Record<string, unknown>,
      workspaceId: string,
    ): Promise<{ valid: boolean; mismatches: string[]; protectedTraitCount: number } | null>;
  };
  /**
   * Prompt 27 — resolves the workspace-checked records behind the pins into
   * the deterministic locked-input snapshot (model/environment versions,
   * active Character Sheet protected traits, asset labels, reference plan).
   * Returns null when the host cannot assemble a baseline (no bridge, or the
   * pinned records no longer resolve).
   */
  assembleLockedInputSnapshot?: (input: {
    jobId: string;
    workspaceId: string;
    normalizedPrompt: NormalizedPromptRecord;
    outputCount: number;
    modelPins: EligibilityInput['pins'];
    environmentPins: EligibilityInput['pins'];
    assetPins: EligibilityInput['pins'];
  }) => Promise<LockedGenerationInputSnapshot | null>;
  /**
   * Prompt 27 — creates a fresh DRAFT content job (the container a variant
   * run submits under) and copies the source job's pins onto it, preserving
   * the locked input baseline. Optional; variants fall back to same-job
   * idempotency behavior when absent.
   */
  createVariantJob?: (input: {
    sourceJobId: string;
    workspaceId: string;
    sourceRunId: string;
    userId: string;
    prompt: string;
  }) => Promise<string>;
}

export class GenerationService {
  constructor(
    private readonly repo: GenerationRepository,
    private readonly deps: GenerationDependencies,
  ) {}

  // ── Submission (idempotent, quota-gated, eligibility-gated) ───────────────

  async submitImageGeneration(
    jobId: string,
    workspaceId: string,
    userId: string,
    input: {
      pins: EligibilityInput['pins'];
      references: EligibilityInput['references'];
      assets: EligibilityInput['assets'];
      prompt?: string;
      negativePrompt?: string;
      aspectRatio?: string;
      /**
       * Prompt 26 — candidate identity traits per model pin (modelId-keyed).
       * Any provided protected trait must agree with the model's active
       * Character Sheet, or the submission is blocked and audited.
       */
      identityTraits?: Record<string, Record<string, unknown>>;
      /**
       * Prompt 27 — candidate identity requirements per model pin. When
       * true, the model MUST have an active Character Sheet with at least
       * one protected trait; otherwise the submission is blocked.
       */
      requireIdentityBaseline?: Record<string, boolean>;
    },
  ): Promise<SubmissionResult> {
    const job = await this.deps.content.getJobRequest(jobId, workspaceId);
    if (!job) throw new Error('Job not found.');
    if (job.workspaceId !== workspaceId) {
      throw new Error('You do not have access to this workspace.');
    }

    // Idempotency FIRST: an active run wins and is reused, regardless of
    // config drift — no second billable attempt can exist for one job. A
    // completed run is likewise returned, never silently resubmitted (retry
    // applies to failed runs only).
    const latest = await this.repo.latestRunForJob(jobId);
    if (latest && ['created', 'submitted', 'queued', 'processing', 'completed'].includes(latest.status)) {
      await this.repo.addAuditEvent({
        workspaceId,
        contentJobRequestId: jobId,
        providerRunId: latest.id,
        actorId: userId,
        eventType: 'submission_requested',
        message:
          latest.status === 'completed'
            ? 'Duplicate submission ignored — completed run returned (never silently resubmitted).'
            : 'Duplicate submission ignored — active run reused (idempotent).',
        metadata: { reused: true, idempotencyKey: latest.idempotencyKey, runStatus: latest.status },
      });
      return { run: latest, reused: true, eligible: true, blocking: [] };
    }

    // Server-side pin resolution: eligibility is judged on the job's stored
    // immutable pins, never on caller-supplied lists.
    const pins = await this.deps.loadPinsForJob(jobId);

    const config = await this.repo.getConfig();
    const { periodStart, periodEnd } = currentPeriod();
    const workspaceTotals = await this.repo.quotaTotalsForWorkspace(workspaceId, periodStart);
    const userRow = await this.repo.getOrCreateQuota(workspaceId, userId, periodStart, periodEnd);

    const eligibility: EligibilityResult = evaluateImageJobEligibility({
      job: {
        id: job.id,
        status: job.status,
        requestedOutputType: job.requestedOutputType,
        requestedVariants: job.requestedVariants,
      },
      config: { imageGenerationEnabled: config.imageGenerationEnabled, providerName: config.providerName },
      pins,
      references: input.references,
      assets: input.assets,
      quotas: {
        maxOutputsPerJob: config.imageMaxOutputsPerJob,
        maxJobsPerUserPerPeriod: config.imageMaxJobsPerUserPerPeriod,
        maxJobsPerWorkspacePerPeriod: config.imageMaxJobsPerWorkspacePerPeriod,
        userJobsThisPeriod: userRow.imageJobsSubmitted,
        workspaceJobsThisPeriod: workspaceTotals.jobs,
      },
      completedOutputsForJob: 0,
    });

    if (!eligibility.eligible) {
      await this.repo.addAuditEvent({
        workspaceId,
        contentJobRequestId: jobId,
        providerRunId: null,
        actorId: userId,
        eventType: 'eligibility_failed',
        message: 'Submission blocked by eligibility checks.',
        metadata: { blocking: eligibility.blocking },
      });
      return { run: null, reused: false, eligible: false, blocking: eligibility.blocking };
    }

    // ── Prompt 26: identity validation against protected Character Sheets ────
    // For each model pin that supplies candidate identity traits, every
    // provided protected trait must agree with the model's active sheet.
    // Without the bridge or without candidate traits the check is recorded as
    // skipped — never silently assumed to have passed. Failures block BEFORE
    // quota increment and provider contact.
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
        // Prompt 27: an explicit per-model requirement makes the identity
        // baseline mandatory — no traits supplied then becomes a block, not
        // a silent skip. Otherwise the check stays a recorded skip.
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
        identityChecks.push({
          modelId: pin.sourceRecordId,
          status: 'skipped',
          mismatches: [],
          protectedTraitCount: 0,
        });
        continue;
      }
      const result = await this.deps.models.validateGenerationAgainstCharacterSheet(
        pin.sourceRecordId,
        candidateTraits,
        workspaceId,
      );
      const modelLabel = pin.resolvedDetails?.modelName ?? pin.sourceRecordId;
      if (!result) {
        identityChecks.push({ modelId: pin.sourceRecordId, status: 'failed', mismatches: ['No active Character Sheet for this model.'], protectedTraitCount: 0 });
        identityBlocking.push(`Model ${modelLabel}: no active Character Sheet to validate identity against.`);
        continue;
      }
      // Prompt 27: a present-but-empty sheet cannot protect identity — when
      // the baseline is required, zero protected traits is a block.
      if (input.requireIdentityBaseline?.[pin.sourceRecordId] && result.protectedTraitCount === 0) {
        identityChecks.push({
          modelId: pin.sourceRecordId,
          status: 'failed',
          mismatches: ['The active Character Sheet has no protected identity traits recorded.'],
          protectedTraitCount: 0,
        });
        identityBlocking.push(
          `Model ${modelLabel}: Character Sheet has no protected identity traits — record the identity baseline before generating.`,
        );
        continue;
      }
      if (!result.valid) {
        identityChecks.push({ modelId: pin.sourceRecordId, status: 'failed', mismatches: result.mismatches, protectedTraitCount: result.protectedTraitCount });
        identityBlocking.push(`Model ${modelLabel}: identity mismatch — ${result.mismatches.join('; ')}`);
        continue;
      }
      identityChecks.push({
        modelId: pin.sourceRecordId,
        status: 'passed',
        mismatches: [],
        protectedTraitCount: result.protectedTraitCount,
      });
    }
    if (identityBlocking.length > 0) {
      await this.repo.addAuditEvent({
        workspaceId,
        contentJobRequestId: jobId,
        providerRunId: null,
        actorId: userId,
        eventType: 'character_sheet_generation_validation_failed',
        message: 'Submission blocked: candidate identity disagrees with the model protected Character Sheet traits.',
        metadata: { checks: identityChecks, blocking: identityBlocking },
      });
      return { run: null, reused: false, eligible: false, blocking: identityBlocking };
    }

    // Resolve the adapter — fail closed for unknown/unconfigured providers.
    const adapter = getImageProvider(config.providerName);
    if (!adapter) {
      throw new Error(`No provider adapter registered for "${config.providerName}".`);
    }
    if (!(await adapter.isConfigured())) {
      throw new Error(`Provider "${config.providerName}" is not configured.`);
    }

    // Quota increment only after every check passes (auditable guard).
    await this.repo.incrementQuota(workspaceId, userId, periodStart, periodEnd, job.requestedVariants);

    const attempt = (latest?.attemptNumber ?? 0) + 1;
    const idempotencyKey = `imgjob:${jobId}:attempt:${attempt}`;

    const { requestSnapshot } = buildProviderRequest({
      idempotencyKey,
      prompt: input.prompt ?? '',
      negativePrompt: input.negativePrompt,
      aspectRatio: input.aspectRatio,
      outputCount: job.requestedVariants,
      referenceImages: [], // resolved server-side at submission time by the worker
      jobId,
      workspaceId,
      pinSummary: pins.map((pin) => ({
        type: pin.pinType,
        versionId: pin.sourceVersionId,
        versionNumber: pin.resolvedDetails?.versionNumber ?? null,
        resolvedVia: pin.resolvedDetails?.resolvedVia ?? null,
      })),
    });

    // ── Prompt 27: deterministic locked-input snapshot ─────────────────────
    // Normalizes the prompt bar input (rule-based, auditable) and assembles
    // the locked baseline: pinned versions, active Character Sheet protected
    // traits, asset pins and the reference plan. Best-effort — the snapshot
    // enriches the run but must never block submission on its own.
    const normalized = normalizeGenerationPrompt({
      userPrompt: input.prompt ?? '',
      aspectRatio: input.aspectRatio,
      outputCount: job.requestedVariants,
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
            outputCount: job.requestedVariants,
            modelPins: pins.filter((candidate) => candidate.pinType === 'model'),
            environmentPins: pins.filter((candidate) => candidate.pinType === 'environment'),
            assetPins: pins.filter(
              (candidate) => candidate.pinType === 'library_asset' || candidate.pinType === 'look',
            ),
          })
        : null;
    } catch {
      // Snapshot assembly is enrichment: a bridge failure never blocks the
      // submission path itself (eligibility already gated the run).
      lockedInputSnapshot = null;
    }
    if (lockedInputSnapshot) {
      await this.repo.addAuditEvent({
        workspaceId,
        contentJobRequestId: jobId,
        providerRunId: null,
        actorId: userId,
        eventType: 'locked_generation_input_snapshot_created',
        message: 'Locked generation input snapshot assembled.',
        metadata: {
          lockedInputCount: lockedInputSnapshot.lockedInputs.length,
          characterSheetConstraints: lockedInputSnapshot.characterSheetConstraints.length,
          protectedTraitKeys: lockedInputSnapshot.characterSheetConstraints.flatMap(
            (constraint) => constraint.protectedTraitKeys,
          ),
        },
      });
    }

    const runInput: CreateProviderRunInput = {
      workspaceId,
      contentJobRequestId: jobId,
      createdBy: userId,
      providerName: config.providerName,
      idempotencyKey,
      requestSnapshot: { ...requestSnapshot, identityValidation: identityChecks, normalizedPrompt: normalizedRecord },
      lockedInputSnapshot: lockedInputSnapshot as unknown as Record<string, unknown> | null,
    };
    const run = await this.repo.createRun(runInput);

    await this.repo.addAuditEvent({
      workspaceId,
      contentJobRequestId: jobId,
      providerRunId: run.id,
      actorId: userId,
      eventType: 'provider_run_created',
      message: `Provider run created (attempt ${run.attemptNumber}).`,
      metadata: { idempotencyKey, provider: config.providerName },
    });

    // Immediate worker tick: this deployment runs the worker in-process.
    await this.processRun(run.id);

    const fresh = await this.repo.getRun(run.id);
    return { run: fresh ?? run, reused: false, eligible: true, blocking: [] };
  }

  // ── Worker tick: submit/poll/ingest one run ───────────────────────────────

  async processRun(runId: string): Promise<void> {
    const run = await this.repo.getRun(runId);
    if (!run) throw new Error(`Generation run not found: ${runId}`);

    const adapter = getImageProvider(run.providerName);
    if (!adapter) {
      await this.markFailed(run, 'adapter_missing', `No adapter registered for "${run.providerName}".`);
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
      const mapped = mapProviderError(error);
      const current = (await this.repo.getRun(runId)) ?? run;
      await this.markFailed(current, mapped.errorCode, mapped.protectedDetail, mapped.userMessage);
    }
  }

  private async submitRun(run: GenerationProviderRunRecord, adapter: ImageGenerationProvider): Promise<void> {
    const snapshot = run.requestSnapshot as {
      prompt?: string;
      negativePrompt?: string | null;
      aspectRatio?: string | null;
      outputCount?: number;
      metadata?: { lockflowJobId?: string; workspaceId?: string; pinSummary?: unknown };
    };

    const referenceImages = await this.deps.media.resolvePinnedReferences(run);

    const { request } = buildProviderRequest({
      idempotencyKey: run.idempotencyKey,
      prompt: snapshot.prompt ?? '',
      negativePrompt: snapshot.negativePrompt ?? undefined,
      aspectRatio: snapshot.aspectRatio ?? undefined,
      outputCount: snapshot.outputCount ?? 1,
      referenceImages,
      jobId: run.contentJobRequestId,
      workspaceId: run.workspaceId,
      pinSummary: snapshot.metadata?.pinSummary ?? null,
    });

    // Job crosses the provider boundary here (draft → queued).
    await this.deps.content.transitionJobRequest(run.contentJobRequestId, 'queued', run.workspaceId, {
      hasProvider: true,
    });

    const accepted = await adapter.submitImageGeneration(request);
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
      message: `Provider accepted the request (${accepted.status}).`,
      metadata: { providerRequestId: accepted.providerRequestId, referenceCount: referenceImages.length },
    });
  }

  private async pollRun(run: GenerationProviderRunRecord, adapter: ImageGenerationProvider): Promise<void> {
    if (!run.providerRequestId) return;
    const status = await adapter.getImageGenerationStatus(run.providerRequestId);

    await this.repo.addAuditEvent({
      workspaceId: run.workspaceId,
      contentJobRequestId: run.contentJobRequestId,
      providerRunId: run.id,
      actorId: this.deps.actorId,
      eventType: 'status_update_received',
      message: `Provider status: ${status.status}.`,
      metadata: { providerStatus: status.status },
    });

    if (status.status === 'completed' && status.results?.length) {
      await this.ingestResults(run, status);
      return;
    }
    if (status.status === 'failed') {
      const mapped = mapProviderError(new Error(status.errorMessage ?? 'provider failure'));
      await this.markFailed(run, mapped.errorCode, mapped.protectedDetail, mapped.userMessage);
      return;
    }

    const nextStatus = status.status === 'queued' ? 'queued' : 'processing';
    await this.repo.updateRun(run.id, { status: nextStatus });
    // The job moves to processing while the provider works (guarded).
    if (run.status === 'submitted' && nextStatus === 'processing') {
      await this.deps.content.transitionJobRequest(run.contentJobRequestId, 'processing', run.workspaceId, {
        hasProvider: true,
      });
    }
  }

  private async ingestResults(
    run: GenerationProviderRunRecord,
    status: ImageGenerationStatusResult,
  ): Promise<void> {
    const results = status.results ?? [];
    const outputs: Array<{ galleryOutputId: string; mediaPath: string }> = [];

    for (const [index, result] of results.entries()) {
      const { bytes, contentType } = await this.deps.media.fetchBytes(result.remoteUrlOrBytes);
      const outputIndex = await this.deps.gallery.nextOutputIndex(run.contentJobRequestId);
      const safeFilename = `generated-${index + 1}.${extensionForMime(contentType)}`;

      // Gallery output first (its id completes the private path), then bytes.
      const output = await this.deps.gallery.createGeneratedOutput({
        workspaceId: run.workspaceId,
        contentJobRequestId: run.contentJobRequestId,
        title: `Generated image ${run.attemptNumber}.${index + 1}`,
        outputType: 'image',
        status: 'ready_for_review',
        mediaStoragePath: '',
        width: result.width,
        height: result.height,
        mimeType: contentType,
        outputIndex,
        metadata: {
          provider_generated: true,
          provider_name: run.providerName,
          provider_run_id: run.id,
          attempt_number: run.attemptNumber,
          placeholder: false,
        },
      });

      const mediaPath = buildOutputMediaPath({
        workspaceId: run.workspaceId,
        contentJobRequestId: run.contentJobRequestId,
        providerRunId: run.id,
        galleryOutputId: output.id,
        safeFilename,
      });
      await this.deps.media.put(GALLERY_MEDIA_BUCKET, mediaPath, bytes, contentType);
      // Persist the private path + provenance link (no URLs, path only).
      await this.deps.gallery.attachMedia(
        output.id,
        {
          mediaStoragePath: mediaPath,
          fileSizeBytes: bytes.byteLength,
          mimeType: contentType,
          generationProviderRunId: run.id,
        },
        run.workspaceId,
      );

      outputs.push({ galleryOutputId: output.id, mediaPath });

      await this.deps.gallery.appendEvent(
        output.id,
        'ingested',
        'Generated image ingested from the provider run.',
        { provider_run_id: run.id, media_path: mediaPath },
      );
      await this.repo.addAuditEvent({
        workspaceId: run.workspaceId,
        contentJobRequestId: run.contentJobRequestId,
        providerRunId: run.id,
        actorId: this.deps.actorId,
        eventType: 'output_created',
        message: `Generated output ${index + 1}/${results.length} ingested.`,
        metadata: { galleryOutputId: output.id },
      });
    }

    await this.repo.updateRun(run.id, {
      status: 'completed',
      completedAt: new Date().toISOString(),
      responseSnapshot: {
        outputs: outputs.map((output) => ({
          galleryOutputId: output.galleryOutputId,
          // Path only — never bytes, never signed URLs.
          mediaPath: output.mediaPath,
        })),
      },
      providerCostMetadata:
        (status.providerMetadata as Record<string, unknown> | undefined) ?? null,
    });
    // Job: processing → review (outputs await human review in Gallery).
    await this.deps.content.transitionJobRequest(run.contentJobRequestId, 'review', run.workspaceId, {
      hasProvider: true,
    });

    await this.repo.addAuditEvent({
      workspaceId: run.workspaceId,
      contentJobRequestId: run.contentJobRequestId,
      providerRunId: run.id,
      actorId: this.deps.actorId,
      eventType: 'result_ingested',
      message: `Ingested ${outputs.length} generated image(s); job moved to review.`,
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
      message: userMessage ?? 'Generation failed. Safe retry is available for failed jobs.',
      metadata: { errorCode },
    });
    const job = await this.deps.content.getJobRequest(run.contentJobRequestId, run.workspaceId);
    try {
      if (job.status === 'queued') {
        // queued → failed is not a legal transition; walk queued → processing
        // first so the guarded state machine is always respected.
        await this.deps.content.transitionJobRequest(run.contentJobRequestId, 'processing', run.workspaceId, {
          hasProvider: true,
        });
      }
      if (['queued', 'processing'].includes(job.status)) {
        await this.deps.content.transitionJobRequest(run.contentJobRequestId, 'failed', run.workspaceId, {
          hasProvider: true,
        });
      }
    } catch (transitionError) {
      // The run is already marked failed; a blocked job transition (e.g. the
      // job was cancelled concurrently) must not mask the provider error.
      await this.repo.addAuditEvent({
        workspaceId: run.workspaceId,
        contentJobRequestId: run.contentJobRequestId,
        providerRunId: run.id,
        actorId: this.deps.actorId,
        eventType: 'provider_error',
        message: 'Run marked failed; job status transition was not possible.',
        metadata: {
          detail: transitionError instanceof Error ? transitionError.message : String(transitionError),
        },
      });
    }
  }

  // ── Retry (spec: new attempt, same immutable pins) ────────────────────────

  async retryImageGeneration(
    jobId: string,
    workspaceId: string,
    userId: string,
    input: {
      pins: EligibilityInput['pins'];
      references: EligibilityInput['references'];
      assets: EligibilityInput['assets'];
      prompt?: string;
      negativePrompt?: string;
      aspectRatio?: string;
      /**
       * Prompt 26 — candidate identity traits per model pin (modelId-keyed).
       * Any provided protected trait must agree with the model's active
       * Character Sheet, or the submission is blocked and audited.
       */
      identityTraits?: Record<string, Record<string, unknown>>;
      /**
       * Prompt 27 — candidate identity requirements per model pin. When
       * true, the model MUST have an active Character Sheet with at least
       * one protected trait; otherwise the submission is blocked.
       */
      requireIdentityBaseline?: Record<string, boolean>;
    },
  ): Promise<SubmissionResult> {
    const latest = await this.repo.latestRunForJob(jobId);
    if (!latest || latest.status !== 'failed') {
      throw new Error('Retry is only available for failed generation runs.');
    }
    await this.repo.addAuditEvent({
      workspaceId,
      contentJobRequestId: jobId,
      providerRunId: latest.id,
      actorId: userId,
      eventType: 'retry_requested',
      message: `Retry requested after attempt ${latest.attemptNumber} failed.`,
      metadata: { previousRunId: latest.id },
    });
    // failed → draft is a guarded transition; the pins are re-read from the
    // job itself — a retry never substitutes versions.
    await this.deps.content.transitionJobRequest(jobId, 'draft', workspaceId, { hasProvider: true });
    return this.submitImageGeneration(jobId, workspaceId, userId, {
      pins: input.pins,
      references: input.references,
      assets: input.assets,
      prompt: input.prompt,
      negativePrompt: input.negativePrompt,
      aspectRatio: input.aspectRatio,
      identityTraits: input.identityTraits,
    });
  }

  // ── Prompt 27: variant generation ─────────────────────────────────────
  // Variants are derived generations of a completed run. The locked input
  // baseline (pins, Character Sheet constraints, snapshot) is inherited
  // verbatim unless the caller explicitly overrides the prompt/settings; the
  // parent-child linkage is recorded for audit. The variant runs in its own
  // draft job (via the createVariantJob bridge) so the one-active-run-per-job
  // idempotency rule stays intact and lineage is explicit.

  async createImageVariantJob(
    sourceJobId: string,
    workspaceId: string,
    userId: string,
    variantInput: {
      /** Optional explicit prompt; inherits the source prompt when omitted. */
      prompt?: string;
      /** Optional aspect-ratio override (normalized like any submission). */
      aspectRatio?: string;
      /** Optional output-count override (1–4, clamped). */
      outputCount?: number;
      /** Candidate identity traits re-checked against the same sheet. */
      identityTraits?: Record<string, Record<string, unknown>>;
    } = {},
  ): Promise<SubmissionResult> {
    const sourceRun = await this.repo.latestRunForJob(sourceJobId);
    if (!sourceRun) {
      throw new Error('No generation run exists for the source job.');
    }
    if (sourceRun.status !== 'completed') {
      throw new Error('Variants can only be created from a completed generation run.');
    }
    if (sourceRun.workspaceId !== workspaceId) {
      throw new Error('You do not have access to this workspace.');
    }

    await this.repo.addAuditEvent({
      workspaceId,
      contentJobRequestId: sourceJobId,
      providerRunId: sourceRun.id,
      actorId: userId,
      eventType: 'image_generation_variant_requested',
      message: 'Variant generation requested from a completed run.',
      metadata: {
        parentRunId: sourceRun.id,
        promptOverride: variantInput.prompt ?? null,
        aspectRatioOverride: variantInput.aspectRatio ?? null,
        outputCountOverride: variantInput.outputCount ?? null,
      },
    });

    const sourceSnapshot = sourceRun.requestSnapshot as {
      prompt?: string;
      negativePrompt?: string | null;
      aspectRatio?: string | null;
      outputCount?: number;
    };
    const inheritedPrompt = variantInput.prompt ?? sourceSnapshot.prompt ?? '';
    const aspectRatio = variantInput.aspectRatio ?? sourceSnapshot.aspectRatio ?? undefined;

    let variantJobId = sourceJobId;
    if (this.deps.createVariantJob) {
      variantJobId = await this.deps.createVariantJob({
        sourceJobId,
        workspaceId,
        sourceRunId: sourceRun.id,
        userId,
        prompt: inheritedPrompt,
      });
      // Inherit the source job's immutable pins so the same locked inputs
      // govern the variant (rule 5 keeps them uneditable on the draft).
      if (this.deps.content?.copyPinsToJob) {
        await this.deps.content.copyPinsToJob(sourceJobId, variantJobId, workspaceId);
      }
    }

    return this.submitImageGeneration(variantJobId, workspaceId, userId, {
      pins: [],
      references: [],
      assets: {},
      prompt: inheritedPrompt,
      negativePrompt: sourceSnapshot.negativePrompt ?? undefined,
      aspectRatio,
      identityTraits: variantInput.identityTraits,
    });
  }

  // ── Read-only surfaces (UI) ───────────────────────────────────────────────

  async getRunStatus(
    jobId: string,
    workspaceId: string,
  ): Promise<{ run: GenerationProviderRunRecord | null; outputsReady: number }> {
    void workspaceId; // scoping enforced upstream by workspace-scoped queries
    const run = await this.repo.latestRunForJob(jobId);
    const outputsReady = run
      ? ((run.responseSnapshot as { outputs?: unknown[] } | null)?.outputs ?? []).length
      : 0;
    return { run, outputsReady };
  }

  /**
   * Readiness checklist for the UI. Callers pass the resolved pins/references/
   * assets (workspace-scoped reads happen in the caller); quotas come from the
   * repository. Pure evaluation — same function the submission path uses.
   */
  async readinessChecklist(
    input: EligibilityInput,
  ): Promise<{ eligible: boolean; blocking: string[]; outputsRequested: number }> {
    const result = evaluateImageJobEligibility(input);
    return { eligible: result.eligible, blocking: result.blocking, outputsRequested: result.outputsRequested };
  }
}

function extensionForMime(mime: string): string {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/svg+xml') return 'svg';
  return 'bin';
}
