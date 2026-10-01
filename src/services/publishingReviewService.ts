/**
 * Publishing Review & Submission Orchestration — service.
 *
 * The single entry point the UI uses for campaign-item publishing review,
 * submission and per-attempt runs. Built ON TOP of Prompt 18:
 *   * eligibility = campaigns + publishing predicates composed via the pure
 *     review validator (rules are never redefined here);
 *   * submission = ONE publish run per attempt. Each run freezes immutable
 *     request/validation snapshots; idempotency keys are unique per
 *     (campaign item, attempt) so duplicate confirms dedupe safely;
 *   * retry = a NEW run with a fresh idempotency key. Failed runs are never
 *     mutated into success;
 *   * statuses are honest: dev adapter results are labelled mock, no fake
 *     live success exists anywhere;
 *   * there is NO calendar auto-publish — planned campaign dates never
 *     trigger a run. Submission is always an explicit user act;
 *   * only safe error fields are stored; provider internals never persist.
 *
 * Every read/write is workspace-scoped; cross-workspace access throws.
 */
import type { CampaignItemRecord } from '../domain/campaigns';
import type { GalleryOutputEligibilityInput } from '../domain/campaigns';
import type {
  PublishingPlacement,
  SafePublishingDraftView,
} from '../domain/publishing';
import type {
  CreatePublishingReviewInput,
  PublishRunRecord,
  PublishRunStatusView,
  PublishingReviewAuditEventType,
  PublishingReviewEligibility,
  PublishingReviewItemReport,
  PublishingReviewReport,
  SubmitPublishRunInput,
  SubmitPublishRunResult,
} from '../domain/publishingReview';
import {
  canTransitionReviewRun,
  reviewBlockers,
} from '../domain/publishingReview';
import {
  isGalleryOutputEligibleForPublishing,
  isSocialConnectionEligibleForPublishing,
} from '../domain/publishing';
import type { PublishingReviewSubject } from '../domain/publishingReview';
import type { PublishingRepositories } from '../data/publishingRepository';
import type { PublishingReviewRepositories } from '../data/publishingReviewRepository';
import type { PublishingProviderRegistry } from './publishingProviders';
import type { SocialConnectionsService } from './socialConnectionsService';
import type { GalleryService } from './galleryService';
import type { CampaignsService } from './campaignsService';
import type { PublishingDraftService } from './publishingService';

function invalid(message: string): never {
  throw new Error(message);
}

function assertWorkspace(workspaceId: string): void {
  if (!workspaceId) invalid('A workspace context is required.');
}

/** Local output shape: campaigns eligibility input plus the output id. */
type ReviewOutput = GalleryOutputEligibilityInput & { id: string };

/** Forward path of the run machine used to walk to a target state. */
const RUN_PATH: PublishRunRecord['status'][] = ['validated', 'submitted', 'accepted', 'published'];

export class PublishingReviewService {
  constructor(
    private readonly reviewRepo: PublishingReviewRepositories,
    private readonly drafts: PublishingRepositories,
    private readonly registry: PublishingProviderRegistry,
    private readonly connections: Pick<SocialConnectionsService, 'getConnection' | 'verifyConnection'>,
    private readonly gallery: Pick<GalleryService, 'getOutput'>,
    private readonly campaignService: Pick<CampaignsService, 'getCampaignDetail'>,
    /** Prompt 18 boundary — type-only dependency, injected instance. */
    private readonly draftService: Pick<
      PublishingDraftService,
      'createDraft' | 'validateDraft' | 'submitDraft' | 'retryDraft' | 'reconcileDraft' | 'getDraftView'
    >,
  ) {}

  // ── Eligibility (server-side, structured) ───────────────────────────────────

  /**
   * Computes structured eligibility for one campaign item. Composes the
   * campaigns-domain output rule, the publishing-domain connection rule,
   * provider capability/placement checks, required-field checks and the
   * duplicate-submission guard. Returns blockers; never throws for an
   * ineligible item (that is DATA, not an error).
   */
  async getPublishingEligibility(
    campaignId: string,
    campaignItemId: string,
    placement: PublishingPlacement,
    workspaceId: string,
    options?: { excludeRunId?: string },
  ): Promise<PublishingReviewEligibility> {
    assertWorkspace(workspaceId);
    const { item, output } = await this.resolveItem(campaignId, campaignItemId, workspaceId);
    const connectionId = await this.guessConnectionForItem(workspaceId);
    const connection = connectionId ? await this.safeGetConnection(connectionId, workspaceId) : null;
    const capabilities = await this.safeCapabilities(connection?.providerKey);
    const copy = { caption: item?.captionDraft ?? undefined };

    const subject: PublishingReviewSubject = {
      workspaceId,
      item,
      output,
      connection: connection
        ? { id: connection.id, status: connection.status, providerKey: connection.providerKey }
        : null,
      placement,
      capabilities: connection ? capabilities : null,
      copy,
      activeRuns: await this.activeRunsForItem(workspaceId, campaignItemId, options?.excludeRunId),
    };
    const blockers = reviewBlockers(subject);
    return {
      eligible: blockers.length === 0,
      blockers,
      checkedAt: new Date().toISOString(),
      inputs: {
        campaignItemId,
        galleryOutputId: output?.id ?? null,
        workspaceSocialConnectionId: connection?.id ?? null,
        placement,
      },
    };
  }

  /** Narrowed view of the output for the publishing-domain predicate. */
  private static publishingEligibilityInput(output: ReviewOutput): {
    workspaceId: string;
    status: string;
    contentJobRequestId: string;
    mediaAvailable: boolean;
  } {
    return {
      workspaceId: output.workspaceId,
      status: output.status,
      contentJobRequestId: output.contentJobRequestId,
      mediaAvailable: output.mediaAvailable,
    };
  }

  /**
   * Review report for several items of one campaign — the pre-submission
   * contract the confirm step shows. Emits review_checked/review_blocked.
   */
  async createPublishingReview(
    input: CreatePublishingReviewInput,
    workspaceId: string,
    actorId: string,
  ): Promise<PublishingReviewReport> {
    assertWorkspace(workspaceId);
    if (!input.items.length) invalid('Select at least one campaign item to review.');
    // Loading the campaign enforces workspace scoping.
    await this.campaignService.getCampaignDetail(input.campaignId, workspaceId);

    const items: PublishingReviewItemReport[] = [];
    for (const entry of input.items) {
      const eligibility = await this.getPublishingEligibility(
        input.campaignId,
        entry.campaignItemId,
        entry.placement,
        workspaceId,
      );
      if (!entry.acknowledgement && eligibility.eligible) {
        eligibility.blockers.push({
          code: 'REQUIRED_FIELD_MISSING',
          messageSafe: 'Record the rights/policy acknowledgement before publishing.',
          field: 'acknowledgement',
        });
        eligibility.eligible = false;
      }
      const runs = await this.reviewRepo.listPublishRuns(workspaceId, {
        campaignItemId: entry.campaignItemId,
      });
      const existing = runs.find((r) => r.status !== 'failed' && r.status !== 'cancelled');
      items.push({
        campaignItemId: entry.campaignItemId,
        galleryOutputId: eligibility.inputs.galleryOutputId ?? '',
        eligibility,
        existingRunId: existing?.id ?? null,
      });
      await this.audit(workspaceId, input.campaignId, entry.campaignItemId, null, actorId,
        eligibility.eligible ? 'review_checked' : 'review_blocked',
        eligibility.eligible
          ? 'Publishing review passed.'
          : `Publishing review found ${eligibility.blockers.length} blocker${eligibility.blockers.length === 1 ? '' : 's'}.`,
        { blockers: eligibility.blockers.map((b) => b.code).join(',') });
    }
    return {
      campaignId: input.campaignId,
      checkedAt: new Date().toISOString(),
      items,
      allEligible: items.every((i) => i.eligibility.eligible),
    };
  }

  // ── Submission ──────────────────────────────────────────────────────────────

  /**
   * Creates a publish run from a CONFIRMED review. The run freezes the
   * request + validation snapshots and a unique idempotency key per
   * (campaign item, attempt). Re-confirming the same intent returns the
   * existing run instead of a duplicate (idempotency).
   */
  async createPublishSubmission(
    input: {
      campaignId: string;
      campaignItemId: string;
      placement: PublishingPlacement;
      acknowledgement: boolean;
    },
    workspaceId: string,
    actorId: string,
  ): Promise<PublishRunRecord> {
    assertWorkspace(workspaceId);
    const eligibility = await this.getPublishingEligibility(
      input.campaignId,
      input.campaignItemId,
      input.placement,
      workspaceId,
    );
    if (!input.acknowledgement) {
      eligibility.blockers.push({
        code: 'REQUIRED_FIELD_MISSING',
        messageSafe: 'Record the rights/policy acknowledgement before publishing.',
        field: 'acknowledgement',
      });
      eligibility.eligible = false;
    }

    // Idempotency FIRST (before the duplicate guard): re-confirming the same
    // intent returns the existing run instead of failing on itself.
    const intent = this.intentKey(input.campaignItemId, input.placement);
    const existing = await this.reviewRepo.findRunByIdempotencyKey(input.campaignItemId, intent);
    if (existing && existing.status !== 'failed' && existing.status !== 'cancelled') {
      return existing; // idempotent re-confirm
    }

    if (!eligibility.eligible) {
      invalid(`Publishing review blocked: ${eligibility.blockers.map((b) => b.code).join(', ')}.`);
    }

    const { item, output, connection } = await this.resolveSubmissionContext(
      input.campaignId,
      input.campaignItemId,
      eligibility,
      workspaceId,
    );
    const attempts = await this.reviewRepo.listPublishRuns(workspaceId, {
      campaignItemId: input.campaignItemId,
    });
    const attemptNumber = attempts.length + 1;

    const run = await this.reviewRepo.createPublishRun({
      workspaceId,
      campaignId: input.campaignId,
      campaignItemId: input.campaignItemId,
      requestedBy: actorId,
      placement: input.placement,
      requestSnapshot: {
        campaignId: input.campaignId,
        campaignItemId: input.campaignItemId,
        galleryOutputId: output.id,
        workspaceSocialConnectionId: connection.id,
        providerKey: connection.providerKey,
        placement: input.placement,
        copy: {
          caption: item.captionDraft ?? '',
          callToAction: item.callToAction ?? '',
        },
      },
      validationSnapshot: {
        eligible: eligibility.eligible,
        blockers: eligibility.blockers,
        checkedAt: eligibility.checkedAt,
      },
      idempotencyKey: attemptNumber === 1 ? intent : `${intent}_a${attemptNumber}`,
      attemptNumber,
      status: 'pending',
    });
    await this.audit(workspaceId, input.campaignId, input.campaignItemId, run.id, actorId,
      'review_checked',
      'Publishing review re-checked at confirmation.',
      { blockers: eligibility.blockers.map((b) => b.code).join(',') });
    await this.audit(workspaceId, input.campaignId, input.campaignItemId, run.id, actorId,
      'review_confirmed',
      'Review confirmed — publishing was approved for this item.',
      { placement: input.placement });
    await this.audit(workspaceId, input.campaignId, input.campaignItemId, run.id, actorId,
      'run_created',
      `Publish run #${attemptNumber} created from a confirmed review.`,
      { attempt: attemptNumber, providerKey: connection.providerKey });
    return run;
  }

  /**
   * Executes a pending run: re-validates fresh, ensures the publishing draft
   * exists, submits through the Prompt 18 boundary and records the honest
   * outcome. The provider decides the result — orchestration never fakes it.
   */
  async submitPublishRun(
    runId: string,
    input: SubmitPublishRunInput,
    workspaceId: string,
    actorId: string,
  ): Promise<SubmitPublishRunResult> {
    assertWorkspace(workspaceId);
    const run = await this.getScopedRun(runId, workspaceId);
    if (run.status !== 'pending' && run.status !== 'validated') {
      invalid(`A ${run.status} run cannot be submitted.`);
    }

    // FRESH eligibility immediately before submission — the world may have
    // changed since the review (output archived, connection revoked…). The
    // run itself is excluded: it is the submission in flight, not a duplicate.
    const eligibility = await this.getPublishingEligibility(
      run.campaignId,
      run.campaignItemId,
      run.placement,
      workspaceId,
      { excludeRunId: run.id },
    );
    if (!eligibility.eligible) {
      const failed = await this.failRun(run.id, 'review_blocked',
        eligibility.blockers[0]?.messageSafe ?? 'Publishing review failed.');
      await this.audit(workspaceId, run.campaignId, run.campaignItemId, run.id, actorId,
        'run_failed',
        `Run blocked before submission: ${eligibility.blockers.map((b) => b.code).join(', ')}.`,
        { blockers: eligibility.blockers.map((b) => b.code).join(',') });
      return { run: failed, outcome: 'failed', errorMessageSafe: failed.errorMessageSafe };
    }
    if (!input.capabilities || !input.capabilities.placements.includes(run.placement)) {
      const failed = await this.failRun(run.id, 'PLACEMENT_UNSUPPORTED',
        'The connected account no longer supports this placement.');
      await this.audit(workspaceId, run.campaignId, run.campaignItemId, run.id, actorId,
        'run_failed', 'Run failed: placement unsupported by the account.',
        { blockers: 'PLACEMENT_UNSUPPORTED' });
      return { run: failed, outcome: 'failed', errorMessageSafe: failed.errorMessageSafe };
    }

    await this.reviewRepo.updatePublishRun(run.id, { status: 'validated' });

    // Ensure the publishing draft exists (Prompt 18 domain owns publishing).
    let draft = await this.ensureDraft(run, workspaceId, actorId);

    // A fresh draft must pass the provider validation gate before submit —
    // the Prompt 18 boundary refuses to publish unvalidated drafts.
    if (draft.status === 'draft') {
      try {
        draft = await this.draftService.validateDraft(draft.id, workspaceId, actorId);
      } catch (raw) {
        const safe = mapSafeSubmissionError(raw);
        const failed = await this.failRun(run.id, 'validation_failed', safe, true);
        await this.audit(workspaceId, run.campaignId, run.campaignItemId, run.id, actorId,
          'run_failed', safe, { attempt: run.attemptNumber });
        return { run: failed, outcome: 'failed', errorMessageSafe: safe };
      }
    }

    // Submit through the draft service (idempotent, guarded).
    let draftView: SafePublishingDraftView;
    try {
      draftView = await this.draftService.submitDraft(draft.id, workspaceId, actorId);
    } catch (raw) {
      const safe = mapSafeSubmissionError(raw);
      const failed = await this.failRun(run.id, 'submission_failed', safe, true);
      await this.audit(workspaceId, run.campaignId, run.campaignItemId, run.id, actorId,
        'run_failed', safe, { attempt: run.attemptNumber });
      return { run: failed, outcome: 'failed', errorMessageSafe: safe };
    }

    // Long-running providers: reconcile the draft once (bounded) so an
    // immediately-confirmed post lands honestly instead of pretending.
    if (draftView.status === 'processing') {
      try {
        draftView = await this.draftService.reconcileDraft(draftView.id, workspaceId, actorId);
      } catch {
        // keep processing — status stays honest
      }
    }

    const outcome: SubmitPublishRunResult['outcome'] =
      draftView.status === 'published'
        ? 'published'
        : draftView.status === 'failed'
          ? 'failed'
          : draftView.status === 'processing'
            ? 'processing'
            : 'accepted';

    let updated: PublishRunRecord;
    if (outcome === 'failed') {
      updated = await this.reviewRepo.updatePublishRun(run.id, {
        status: 'failed',
        errorCode: draftView.failureCode ?? 'submission_failed',
        errorMessageSafe: draftView.failureMessageSafe ?? 'The provider did not accept the submission.',
        completedAt: new Date().toISOString(),
      });
    } else {
      // Walk the run machine honestly: validated → submitted → accepted →
      // published. Each step is a real transition, never a jump. A still-
      // processing provider stops at 'submitted' — never fake acceptance.
      const target: PublishRunRecord['status'] =
        outcome === 'published' ? 'published' : outcome === 'accepted' ? 'accepted' : 'submitted';
      updated = await this.advanceRun(run.id, 'validated', target);
      if (outcome === 'published') {
        // Persist the provider-confirmed URL on the run (safe fields only).
        updated = await this.reviewRepo.updatePublishRun(run.id, {
          publishedUrl: draftView.publishedUrl,
          publishedAt: draftView.publishedAt,
          completedAt: new Date().toISOString(),
        });
      }
    }

    const eventType: PublishingReviewAuditEventType =
      outcome === 'failed' ? 'run_failed'
        : outcome === 'published' ? 'run_published'
          : outcome === 'accepted' ? 'run_accepted' : 'run_submitted';
    const message =
      outcome === 'failed'
        ? draftView.failureMessageSafe ?? 'The submission failed.'
        : outcome === 'published'
          ? 'Published — the provider confirmed the post.'
          : outcome === 'accepted'
            ? 'The provider accepted the submission.'
            : 'The provider is processing the submission.';
    await this.audit(workspaceId, run.campaignId, run.campaignItemId, run.id, actorId, eventType,
      message,
      {
        attempt: run.attemptNumber,
        providerKey: run.requestSnapshot.providerKey,
        mockProvider: this.isMockProvider(run.requestSnapshot.providerKey),
      });
    return { run: updated, outcome, errorMessageSafe: outcome === 'failed' ? updated.errorMessageSafe : null };
  }

  // ── Retry ───────────────────────────────────────────────────────────────────

  /**
   * Retry = a NEW run with a fresh idempotency key. The failed run is never
   * mutated; provider-accepted runs are never retried (duplicate-post risk).
   */
  async retryPublishRun(runId: string, workspaceId: string, actorId: string): Promise<PublishRunRecord> {
    assertWorkspace(workspaceId);
    const run = await this.getScopedRun(runId, workspaceId);
    if (run.status !== 'failed') invalid('Only failed runs can be retried.');
    const eligibility = await this.getPublishingEligibility(
      run.campaignId,
      run.campaignItemId,
      run.placement,
      workspaceId,
    );
    if (!eligibility.eligible) {
      invalid(`Retry blocked: ${eligibility.blockers.map((b) => b.code).join(', ')}.`);
    }
    const attempts = await this.reviewRepo.listPublishRuns(workspaceId, {
      campaignItemId: run.campaignItemId,
    });
    const attemptNumber = attempts.length + 1;
    const intent = this.intentKey(run.campaignItemId, run.placement);
    const retry = await this.reviewRepo.createPublishRun({
      workspaceId: run.workspaceId,
      campaignId: run.campaignId,
      campaignItemId: run.campaignItemId,
      requestedBy: actorId,
      placement: run.placement,
      requestSnapshot: structuredClone(run.requestSnapshot),
      validationSnapshot: {
        eligible: eligibility.eligible,
        blockers: eligibility.blockers,
        checkedAt: eligibility.checkedAt,
      },
      idempotencyKey: `${intent}_a${attemptNumber}`,
      attemptNumber,
      status: 'pending',
    });
    await this.audit(workspaceId, run.campaignId, run.campaignItemId, retry.id, actorId,
      'retry_requested',
      `Retry created as run #${attemptNumber}; failed run #${run.attemptNumber} is preserved.`,
      { attempt: attemptNumber, retriedRunId: run.id });
    return retry;
  }

  // ── Status ──────────────────────────────────────────────────────────────────

  /** Safe run status joined with the draft's honest publish state. */
  async getPublishRunStatus(runId: string, workspaceId: string): Promise<PublishRunStatusView> {
    assertWorkspace(workspaceId);
    const run = await this.getScopedRun(runId, workspaceId);
    let draftStatus: string | null = null;
    let draftPublishedUrl: string | null = null;
    let draftFailureMessageSafe: string | null = null;
    if (run.publishingDraftId) {
      const draft = await this.drafts.getDraft(run.publishingDraftId);
      if (draft && draft.workspaceId === workspaceId) {
        draftStatus = draft.status;
        draftPublishedUrl = draft.publishedUrl;
        draftFailureMessageSafe = draft.failureMessageSafe;
      }
    }
    return { run, draftStatus, draftPublishedUrl, draftFailureMessageSafe };
  }

  async listRunsForItem(campaignItemId: string, workspaceId: string): Promise<PublishRunRecord[]> {
    assertWorkspace(workspaceId);
    return this.reviewRepo.listPublishRuns(workspaceId, { campaignItemId });
  }

  async listRunsForCampaign(campaignId: string, workspaceId: string): Promise<PublishRunRecord[]> {
    assertWorkspace(workspaceId);
    return this.reviewRepo.listPublishRuns(workspaceId, { campaignId });
  }

  async listAuditEvents(
    workspaceId: string,
    filter?: { campaignItemId?: string; publishRunId?: string },
  ) {
    assertWorkspace(workspaceId);
    return this.reviewRepo.listReviewEvents(workspaceId, filter);
  }

  /** Optional cancel — only before the run is submitted outward. */
  async cancelRun(runId: string, workspaceId: string, actorId: string): Promise<PublishRunRecord> {
    assertWorkspace(workspaceId);
    const run = await this.getScopedRun(runId, workspaceId);
    if (run.status !== 'pending' && run.status !== 'validated') {
      invalid(`A ${run.status} run can no longer be cancelled.`);
    }
    const updated = await this.reviewRepo.updatePublishRun(run.id, {
      status: 'cancelled',
      completedAt: new Date().toISOString(),
    });
    await this.audit(workspaceId, run.campaignId, run.campaignItemId, run.id, actorId,
      'run_cancelled', 'Publish run cancelled before submission.', { attempt: run.attemptNumber });
    return updated;
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  /** Deterministic per-(item, placement) intent key; attempt 1 uses it raw. */
  private intentKey(campaignItemId: string, placement: PublishingPlacement): string {
    return `prun_${campaignItemId}_${placement}`;
  }

  private isMockProvider(providerKey: string): boolean {
    return this.registry.get(providerKey)?.devOnly ?? false;
  }

  private async resolveItem(
    campaignId: string,
    campaignItemId: string,
    workspaceId: string,
  ): Promise<{ item: CampaignItemRecord | null; output: ReviewOutput | null }> {
    let item: CampaignItemRecord | null = null;
    try {
      const detail = await this.campaignService.getCampaignDetail(campaignId, workspaceId);
      item = detail.items.find((i) => i.id === campaignItemId) ?? null;
    } catch {
      item = null;
    }
    if (!item) return { item: null, output: null };
    try {
      const output = await this.gallery.getOutput(item.galleryOutputId, workspaceId);
      const resolved: ReviewOutput = {
        id: output.id,
        workspaceId: output.workspaceId,
        title: output.title,
        outputType: output.outputType,
        status: output.status,
        contentJobRequestId: output.contentJobRequestId,
        mediaAvailable: output.mediaStoragePath !== null || output.thumbnailStoragePath !== null,
      };
      return { item, output: resolved };
    } catch {
      return { item, output: null };
    }
  }

  private async safeGetConnection(connectionId: string, workspaceId: string) {
    try {
      return await this.connections.getConnection(connectionId, workspaceId);
    } catch {
      return null;
    }
  }

  private async safeCapabilities(providerKey: string | undefined) {
    if (!providerKey) return null;
    const provider = this.registry.get(providerKey);
    if (!provider) return null;
    try {
      // Stub token: capability discovery is token-independent by design.
      return await provider.getCapabilities({
        connection: { connectionId: '', providerKey, workspaceId: '', accessToken: '' },
      });
    } catch {
      return null; // unconfigured provider → capability checks stay open
    }
  }

  /**
   * Demo wiring: the mock workspace has at most one connected account, so
   * the first connected/needs-reauth connection is the review target. The
   * production adapter resolves the item channel → connection mapping
   * server-side; no browser token ever participates.
   */
  private async guessConnectionForItem(workspaceId: string): Promise<string | null> {
    const lister = this.connections as unknown as {
      listConnections?: (ws: string) => Promise<Array<{ id: string; status: string }>>;
    };
    if (!lister.listConnections) return null;
    const rows = await lister.listConnections(workspaceId).catch(() => []);
    return rows.find((c) => c.status === 'connected' || c.status === 'needs_reauth')?.id ?? null;
  }

  private async activeRunsForItem(
    workspaceId: string,
    campaignItemId: string,
    excludeRunId?: string,
  ) {
    const runs = await this.reviewRepo.listPublishRuns(workspaceId, { campaignItemId });
    return runs.filter(
      (r) => r.id !== excludeRunId && r.status !== 'failed' && r.status !== 'cancelled',
    );
  }

  /**
   * Submit-time re-validation with the publishing-domain predicates — the
   * documented mirror of the campaigns rule, applied fresh before any run.
   */
  private async resolveSubmissionContext(
    campaignId: string,
    campaignItemId: string,
    eligibility: PublishingReviewEligibility,
    workspaceId: string,
  ) {
    const { item, output } = await this.resolveItem(campaignId, campaignItemId, workspaceId);
    if (!item || !output) invalid('The campaign item or its output disappeared before submission.');
    if (!isGalleryOutputEligibleForPublishing(
      PublishingReviewService.publishingEligibilityInput(output),
      workspaceId,
    )) {
      invalid('The source output is no longer eligible for publishing.');
    }
    const connectionId = eligibility.inputs.workspaceSocialConnectionId;
    if (!connectionId) invalid('No connection was resolved for this submission.');
    const connection = await this.safeGetConnection(connectionId, workspaceId);
    if (!connection) invalid('The connected account could not be loaded.');
    if (!isSocialConnectionEligibleForPublishing(connection, workspaceId)) {
      invalid('The account is not verified for publishing.');
    }
    return { item, output, connection };
  }

  private async failRun(
    runId: string,
    errorCode: string,
    messageSafe: string,
    withStarted = false,
  ): Promise<PublishRunRecord> {
    return this.reviewRepo.updatePublishRun(runId, {
      status: 'failed',
      errorCode,
      errorMessageSafe: messageSafe,
      completedAt: new Date().toISOString(),
      ...(withStarted ? { startedAt: new Date().toISOString() } : {}),
    });
  }

  /** Walks the run machine one legal transition at a time. */
  private async advanceRun(
    runId: string,
    from: PublishRunRecord['status'],
    target: PublishRunRecord['status'],
  ): Promise<PublishRunRecord> {
    let current = from;
    let record = (await this.reviewRepo.getPublishRun(runId))!;
    for (const step of RUN_PATH) {
      if (current === target) break;
      const next = RUN_PATH[RUN_PATH.indexOf(current) + 1] ?? step;
      if (!canTransitionReviewRun(current, next)) {
        invalid(`A publish run cannot move from ${current} to ${next}.`);
      }
      record = await this.reviewRepo.updatePublishRun(runId, { status: next });
      current = next;
    }
    return record;
  }

  /**
   * Finds the item's publishing draft or creates one through the Prompt 18
   * boundary (which performs its own full eligibility checks).
   */
  private async ensureDraft(
    run: PublishRunRecord,
    workspaceId: string,
    actorId: string,
  ): Promise<SafePublishingDraftView> {
    const all = await this.drafts.listDrafts(workspaceId);
    const existing = all.filter((d) => d.campaignItemId === run.campaignItemId);
    const found = existing.find((d) => d.status !== 'archived' && d.status !== 'cancelled');
    if (found) {
      await this.reviewRepo.updatePublishRun(run.id, { publishingDraftId: found.id });
      if (found.status === 'failed') {
        // The Prompt 18 service moves failed drafts back to ready on retry.
        await this.draftService.retryDraft(found.id, workspaceId, actorId);
      }
      return await this.draftService.getDraftView(found.id, workspaceId);
    }
    const snapshotCopy = run.requestSnapshot.copy ?? {};
    const created = await this.draftService.createDraft(
      {
        campaignId: run.campaignId,
        campaignItemId: run.campaignItemId,
        workspaceSocialConnectionId: run.requestSnapshot.workspaceSocialConnectionId,
        placement: run.placement,
        copy: {
          caption: String(snapshotCopy.caption || '') || undefined,
          callToAction: String(snapshotCopy.callToAction || '') || undefined,
        },
        acknowledgement: true,
      },
      workspaceId,
      actorId,
    );
    await this.reviewRepo.updatePublishRun(run.id, { publishingDraftId: created.id });
    return created;
  }

  private async getScopedRun(runId: string, workspaceId: string): Promise<PublishRunRecord> {
    const run = await this.reviewRepo.getPublishRun(runId);
    if (!run) invalid('Publish run not found.');
    if (run.workspaceId !== workspaceId) {
      invalid('This publish run belongs to a different workspace.');
    }
    return run;
  }

  private async audit(
    workspaceId: string,
    campaignId: string,
    campaignItemId: string,
    publishRunId: string | null,
    actorId: string | null,
    eventType: PublishingReviewAuditEventType,
    message: string,
    metadata?: Record<string, string | number | boolean>,
  ): Promise<void> {
    await this.reviewRepo.appendReviewEvent({
      workspaceId,
      campaignId,
      campaignItemId,
      publishRunId,
      actorId,
      eventType,
      message,
      metadata: metadata ?? null,
    });
  }
}

function mapSafeSubmissionError(raw: unknown): string {
  const text = raw instanceof Error ? raw.message : String(raw);
  if (/review blocked|not eligible|verified for publishing|validat/i.test(text)) return text;
  return 'The submission could not be completed. Retry when the item passes review.';
}
