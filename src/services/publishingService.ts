/**
 * Publishing service — the single entry point the UI uses.
 *
 * Security and honesty contracts enforced here:
 *   * Every read/write is workspace-scoped; cross-workspace access throws.
 *   * Gallery eligibility is re-validated at preparation AND immediately
 *     before submission; archived/unavailable sources block submission but
 *     historic records are preserved (blocked status).
 *   * Drafts never mutate Gallery media, approval, reviews, pins, source
 *     assets or the Campaign Item's source relationship.
 *   * media_snapshot freezes source metadata + provenance once the draft
 *     leaves draft; copy is editable only while the guard allows.
 *   * Submission: ready + validated + acknowledged + fresh eligibility +
 *     verified connection + no active run; idempotency key dedupes the
 *     external intent; published only after provider confirmation.
 *   * Client read models (SafePublishingDraftView) structurally omit
 *     protected provider metadata, media handles, tokens and diagnostics.
 *   * Planned campaign dates never trigger publishing — there is no
 *     scheduler and none is added.
 *
 * The "worker" seam: in this SPA the submission/reconciliation methods run
 * through the server-side service boundary that holds the encryption key;
 * a hosted deployment maps submitDraft/reconcileDraft to queue jobs and the
 * webhook function to a signature-verified edge handler with the same
 * contract. React never calls platform APIs.
 */
import type {
  ExternalAccountSnapshot,
  PublishingCopySnapshot,
  PublishingDraftEventRecord,
  PublishingDraftRecord,
  PublishingMetadata,
  PublishingPlacement,
  PublishingProviderRunRecord,
  SafePublishingDraftView,
  ServerConnectionContext,
} from '../domain/publishing';
import {
  assertPublishingTransition,
  canRetryAfterRun,
  draftSubmissionProblem,
  galleryPublishingProblem,
  isGalleryOutputEligibleForPublishing,
  isSocialConnectionEligibleForPublishing,
} from '../domain/publishing';
import type { PublishingRepositories } from '../data/publishingRepository';
import type { SocialConnectionsService } from './socialConnectionsService';
import type { GalleryService } from './galleryService';
import type { CampaignsService } from './campaignsService';
import type {
  PublishingProviderRegistry,
} from './publishingProviders';
import { randomToken } from '../domain/social';

function isInWorkspace(recordWorkspaceId: string, activeWorkspaceId: string): void {
  if (recordWorkspaceId !== activeWorkspaceId) {
    throw new Error('This record belongs to a different workspace.');
  }
}

function invalid(message: string): never {
  throw new Error(message);
}

/** Conservative poll bound — reconciliation never spins unbounded. */
const MAX_POLLS_PER_RECONCILE = 5;

export class PublishingDraftService {
  constructor(
    private readonly repo: PublishingRepositories,
    private readonly registry: PublishingProviderRegistry,
    private readonly connections: Pick<
      SocialConnectionsService,
      'getConnection' | 'verifyConnection'
    >,
    private readonly gallery: Pick<GalleryService, 'getOutput'>,
    private readonly campaigns: Pick<CampaignsService, 'getCampaignDetail'>,
  ) {}

  // ── Reads ───────────────────────────────────────────────────────────────────

  async listDrafts(workspaceId: string): Promise<SafePublishingDraftView[]> {
    isInWorkspaceAny(workspaceId);
    const drafts = await this.repo.listDrafts(workspaceId);
    return drafts.map((d) => this.toSafeView(d));
  }

  async listDraftsForCampaign(campaignId: string, workspaceId: string): Promise<SafePublishingDraftView[]> {
    const all = await this.listDrafts(workspaceId);
    return all.filter((d) => d.campaignId === campaignId);
  }

  async listDraftsForOutput(galleryOutputId: string, workspaceId: string): Promise<SafePublishingDraftView[]> {
    const all = await this.listDrafts(workspaceId);
    return all.filter((d) => d.galleryOutputId === galleryOutputId);
  }

  async getDraftView(draftId: string, workspaceId: string): Promise<SafePublishingDraftView> {
    const draft = await this.getScopedDraft(draftId, workspaceId);
    return this.toSafeView(draft);
  }

  async listEvents(draftId: string, workspaceId: string): Promise<PublishingDraftEventRecord[]> {
    const draft = await this.getScopedDraft(draftId, workspaceId);
    return this.repo.listDraftEvents(draft.id);
  }

  /** Attempt numbers for the UI's attempt history (safe fields only). */
  async listRunSummaries(
    draftId: string,
    workspaceId: string,
  ): Promise<Array<Pick<PublishingProviderRunRecord, 'attemptNumber' | 'status' | 'errorCode' | 'errorMessageSafe' | 'createdAt'>>> {
    const draft = await this.getScopedDraft(draftId, workspaceId);
    const runs = await this.repo.listRuns(draft.id);
    return runs.map((r) => ({
      attemptNumber: r.attemptNumber,
      status: r.status,
      errorCode: r.errorCode,
      errorMessageSafe: r.errorMessageSafe,
      createdAt: r.createdAt,
    }));
  }

  // ── Draft creation ──────────────────────────────────────────────────────────

  /**
   * Creates a draft from an eligible campaign item + verified connection.
   * Freezes media/provenance snapshot NOW (immutability from creation gives
   * the strongest audit story; spec requires immutability once submitted —
   * we are stricter).
   */
  async createDraft(
    input: {
      campaignId: string;
      campaignItemId: string;
      workspaceSocialConnectionId: string;
      placement: PublishingPlacement;
      copy: PublishingCopySnapshot;
      acknowledgement: boolean;
    },
    workspaceId: string,
    actorId: string,
  ): Promise<SafePublishingDraftView> {
    isInWorkspaceAny(workspaceId);
    if (!input.acknowledgement) {
      invalid('The rights/policy acknowledgement is required to create a publishing draft.');
    }

    // Campaign + item must be same-workspace, active, and reference the output.
    const detail = await this.campaigns.getCampaignDetail(input.campaignId, workspaceId);
    const item = detail.items.find((i) => i.id === input.campaignItemId);
    if (!item) invalid('This campaign item does not belong to the campaign.');
    if (item.status === 'removed' || item.removedAt) {
      invalid('Removed campaign items cannot be prepared for publishing.');
    }
    const outputId = item.galleryOutputId;

    // Fresh output eligibility (authoritative rule).
    const output = await this.gallery.getOutput(outputId, workspaceId);
    const eligibility = {
      workspaceId: output.workspaceId,
      status: output.status,
      contentJobRequestId: output.contentJobRequestId,
      mediaAvailable: output.mediaStoragePath !== null || output.thumbnailStoragePath !== null,
    };
    const problem = galleryPublishingProblem(eligibility, workspaceId);
    if (problem) invalid(problem);

    // Connection must be same-workspace, connected/verified and provider-compatible.
    const connection = await this.connections.getConnection(input.workspaceSocialConnectionId, workspaceId);
    if (!isSocialConnectionEligibleForPublishing(connection, workspaceId)) {
      invalid('This connection is not verified for publishing. Reconnect or verify the account first.');
    }
    const provider = this.registry.get(connection.providerKey);
    if (!provider) invalid('Unknown publishing provider.');

    // Capabilities gate the placement.
    const material = await this.loadConnectionContext(connection.id, workspaceId);
    const capabilities = await provider!.getCapabilities({ connection: material });
    if (!capabilities.placements.includes(input.placement)) {
      invalid('The selected account does not support this placement.');
    }

    const idempotencyKey = `pub_${randomToken(16)}`;
    const accountSnapshot: ExternalAccountSnapshot = {
      providerKey: connection.providerKey,
      connectionId: connection.id,
      connectionLocalName: connection.localName,
      accountLabel: connection.externalAccountLabel,
      accountType: connection.externalAccountType,
    };
    const mediaSnapshot = {
      outputs: [
        {
          galleryOutputId: output.id,
          mediaType: (output.mimeType?.startsWith('video') ? 'video' : 'image') as 'image' | 'video',
          title: output.title,
          outputType: output.outputType,
          width: output.width,
          height: output.height,
          durationSeconds: output.durationSeconds,
          contentJobRequestId: output.contentJobRequestId,
        },
      ],
    };

    const draft = await this.repo.createDraft({
      workspaceId,
      campaignId: input.campaignId,
      campaignItemId: input.campaignItemId,
      galleryOutputId: output.id,
      workspaceSocialConnectionId: connection.id,
      providerKey: connection.providerKey,
      status: 'draft',
      placement: input.placement,
      mediaSnapshot,
      copySnapshot: input.copy,
      externalAccountSnapshot: accountSnapshot,
      idempotencyKey,
      createdBy: actorId,
    });
    // Record the explicit acknowledgement timestamp (required for submit).
    await this.repo.updateDraft(draft.id, { acknowledgementAt: new Date().toISOString() });
    await this.repo.createDraftMedia({
      publishingDraftId: draft.id,
      galleryOutputId: output.id,
      role: 'primary',
      mediaType: mediaSnapshot.outputs[0].mediaType,
    });
    await this.append(draft.id, actorId, 'created', `Publishing draft created for ${output.title}.`, {
      placement: input.placement,
    });

    return this.getDraftView(draft.id, workspaceId);
  }

  // ── Editing while allowed ───────────────────────────────────────────────────

  /** Copy/placement edits: allowed only while draft (pre-validation freeze). */
  async updateDraftCopy(
    draftId: string,
    copy: PublishingCopySnapshot,
    workspaceId: string,
    actorId: string,
  ): Promise<SafePublishingDraftView> {
    const draft = await this.getScopedDraft(draftId, workspaceId);
    if (draft.status !== 'draft') {
      invalid('Only drafts can be edited. Published and submitted drafts are immutable.');
    }
    await this.repo.updateDraft(draft.id, { copySnapshot: copy, validationResult: null });
    await this.append(draft.id, actorId, 'updated', 'Draft copy updated.');
    return this.getDraftView(draft.id, workspaceId);
  }

  async recordAcknowledgement(
    draftId: string,
    workspaceId: string,
    actorId: string,
  ): Promise<SafePublishingDraftView> {
    const draft = await this.getScopedDraft(draftId, workspaceId);
    await this.repo.updateDraft(draft.id, { acknowledgementAt: new Date().toISOString() });
    await this.append(draft.id, actorId, 'updated', 'Publishing acknowledgement recorded.');
    return this.getDraftView(draft.id, workspaceId);
  }

  // ── Validation / ready ─────────────────────────────────────────────────────

  async validateDraft(draftId: string, workspaceId: string, actorId: string): Promise<SafePublishingDraftView> {
    const draft = await this.getScopedDraft(draftId, workspaceId);
    if (draft.status !== 'draft') {
      invalid('Only drafts can be validated.');
    }
    await assertPublishingTransition(draft.status, 'validating');
    await this.repo.updateDraft(draft.id, { status: 'validating' });
    await this.append(draft.id, actorId, 'validation_started', 'Draft validation started.');

    try {
      const provider = this.requireProvider(draft.providerKey);
      const material = await this.loadConnectionContext(draft.workspaceSocialConnectionId, workspaceId);
      const media = await this.buildServerMediaReferences(draft, workspaceId);
      const result = await provider.validateDraft({
        placement: draft.placement,
        media,
        copy: draft.copySnapshot,
        connection: material,
      });
      const validationResult = {
        valid: result.valid,
        errors: result.errors.map((e) => ({ ...e, severity: 'error' as const })),
        warnings: result.warnings.map((w) => ({ ...w, severity: 'warning' as const })),
        validatedAt: new Date().toISOString(),
        placement: draft.placement,
      };
      await this.repo.updateDraft(draft.id, {
        status: result.valid ? 'ready' : 'draft',
        validationResult,
      });
      await this.append(
        draft.id,
        actorId,
        result.valid ? 'validation_passed' : 'validation_failed',
        result.valid ? 'Draft validation passed.' : `Draft validation failed (${result.errors.length} issue${result.errors.length === 1 ? '' : 's'}).`,
        { valid: result.valid },
      );
    } catch (raw) {
      await this.repo.updateDraft(draft.id, { status: 'draft' });
      await this.append(draft.id, actorId, 'validation_failed', mapSafe(raw));
      throw new Error(mapSafe(raw));
    }
    return this.getDraftView(draft.id, workspaceId);
  }

  // ── Submission ──────────────────────────────────────────────────────────────

  /**
   * Explicit publish-now. Requires ready + validated + acknowledged, fresh
   * eligibility + connection checks, then an idempotent provider run. The
   * draft moves submitting → processing here; published happens only after
   * provider confirmation via reconcileDraft/poll or a verified webhook.
   */
  async submitDraft(draftId: string, workspaceId: string, actorId: string): Promise<SafePublishingDraftView> {
    const draft = await this.getScopedDraft(draftId, workspaceId);

    // 1. Guard: ready + validated + acknowledged.
    const guardProblem = draftSubmissionProblem(draft);
    if (guardProblem) invalid(guardProblem);

    // 2. No active/accepted run for this idempotency scope.
    const runs = await this.repo.listRuns(draft.id);
    const activeRun = runs.find(
      (r) => r.status === 'queued' || r.status === 'submitting' || r.status === 'accepted' || r.status === 'processing',
    );
    if (activeRun) invalid('A submission is already in progress for this draft.');

    // 3. Fresh eligibility — immediately before submission.
    const output = await this.gallery.getOutput(draft.galleryOutputId, workspaceId);
    const eligibility = {
      workspaceId: output.workspaceId,
      status: output.status,
      contentJobRequestId: output.contentJobRequestId,
      mediaAvailable: output.mediaStoragePath !== null || output.thumbnailStoragePath !== null,
    };
    if (!isGalleryOutputEligibleForPublishing(eligibility, workspaceId)) {
      const problem = galleryPublishingProblem(eligibility, workspaceId) ?? 'The source output is no longer eligible.';
      await this.repo.updateDraft(draft.id, { status: 'blocked', failureCode: 'source_unavailable', failureMessageSafe: problem });
      await this.append(draft.id, actorId, 'blocked', problem);
      invalid(problem);
    }

    // 4. Connection still connected/verified.
    const connection = await this.connections.getConnection(draft.workspaceSocialConnectionId, workspaceId);
    if (!isSocialConnectionEligibleForPublishing(connection, workspaceId)) {
      await this.repo.updateDraft(draft.id, { status: 'needs_reauth' });
      await this.append(draft.id, actorId, 'reauth_required', 'The account needs reconnection before publishing.');
      invalid('Reconnect the account before publishing.');
    }

    const provider = this.requireProvider(draft.providerKey);
    const material = await this.loadConnectionContext(connection.id, workspaceId);

    // 5. Fresh validation against the provider.
    await assertPublishingTransition(draft.status, 'submitting');
    const media = await this.buildServerMediaReferences(draft, workspaceId);
    const prevalidation = await provider.validateDraft({
      placement: draft.placement,
      media,
      copy: draft.copySnapshot,
      connection: material,
    });
    if (!prevalidation.valid) {
      await this.repo.updateDraft(draft.id, {
        status: 'ready',
        validationResult: {
          valid: false,
          errors: prevalidation.errors.map((e) => ({ ...e, severity: 'error' as const })),
          warnings: prevalidation.warnings.map((w) => ({ ...w, severity: 'warning' as const })),
          validatedAt: new Date().toISOString(),
          placement: draft.placement,
        },
      });
      await this.append(draft.id, actorId, 'validation_failed', 'Pre-submission validation failed.');
      invalid('Pre-submission validation failed. Fix the issues and validate again.');
    }

    // 6. Idempotent run + submit (server-side only). Attempt 1 uses the
    // draft's intent key; retries derive a per-attempt key so each run is
    // deduped independently while the draft intent stays anchored.
    const attemptNumber = runs.length + 1;
    const runKey =
      attemptNumber === 1 ? draft.idempotencyKey : `${draft.idempotencyKey}_r${attemptNumber}`;
    const run = await this.repo.createRun({
      publishingDraftId: draft.id,
      providerKey: draft.providerKey,
      attemptNumber,
      idempotencyKey: runKey,
      requestSnapshot: {
        placement: draft.placement,
        sourceGalleryOutputId: draft.galleryOutputId,
      },
    });
    await this.repo.updateDraft(draft.id, { status: 'submitting' });
    await this.append(draft.id, actorId, 'submit_requested', `Publishing submission started (attempt ${attemptNumber}).`, {
      attempt: attemptNumber,
    });

    try {
      await this.repo.updateRun(run.id, { status: 'submitting', startedAt: new Date().toISOString() });

      // Media preparation (server-side transfer simulation/real upload).
      const prepared = await provider.prepareMedia({ media, connection: material, idempotencyKey: runKey });
      const mediaRows = await this.repo.listDraftMedia(draft.id);
      for (const handle of prepared.providerMediaHandles) {
        const row = mediaRows.find((m) => m.role === handle.role);
        if (row) {
          await this.repo.updateDraftMedia(row.id, {
            providerMediaHandleProtected: handle.handle,
            uploadStatus: 'uploaded',
          });
        }
      }

      const result = await provider.publish({
        idempotencyKey: runKey,
        placement: draft.placement,
        mediaHandles: prepared.providerMediaHandles.map((h) => ({ role: h.role, handle: h.handle })),
        copy: draft.copySnapshot,
        connection: material,
        metadata: {
          lockflowPublishingDraftId: draft.id,
          workspaceId: draft.workspaceId,
          campaignId: draft.campaignId,
          campaignItemId: draft.campaignItemId,
          galleryOutputId: draft.galleryOutputId,
        },
      });

      await this.repo.updateRun(run.id, {
        status: result.status === 'published' ? 'completed' : 'accepted',
        providerRequestId: result.providerPublishId,
        responseMetadataProtected: result.providerMetadata ?? null,
        completedAt: new Date().toISOString(),
      });
      await this.repo.updateDraft(draft.id, {
        status: result.status === 'published' ? 'published' : 'processing',
        providerPublishId: result.providerPublishId,
        providerMetadataProtected: result.providerMetadata ?? null,
        ...(result.publishedUrl ? { publishedUrl: result.publishedUrl, publishedAt: new Date().toISOString() } : {}),
      });
      await this.append(
        draft.id,
        actorId,
        result.status === 'published' ? 'provider_published' : 'provider_accepted',
        result.status === 'published' ? 'The provider confirmed the post.' : 'The provider accepted the submission.',
        { attempt: attemptNumber },
      );
    } catch (raw) {
      const safe = mapSafe(raw);
      await this.repo.updateRun(run.id, {
        status: 'failed',
        errorCode: 'submission_failed',
        errorMessageSafe: safe,
        completedAt: new Date().toISOString(),
      });
      await this.repo.updateDraft(draft.id, {
        status: 'failed',
        failureCode: 'submission_failed',
        failureMessageSafe: safe,
      });
      await this.append(draft.id, actorId, 'provider_failed', safe, { attempt: attemptNumber });
    }

    return this.getDraftView(draft.id, workspaceId);
  }

  // ── Reconciliation (polling / webhook result application) ──────────────────

  /**
   * Polls the provider while the draft is processing (bounded), applying the
   * confirmed result. Published status is set ONLY here (or by a verified
   * webhook) — never from a planned campaign date.
   */
  async reconcileDraft(draftId: string, workspaceId: string, actorId: string): Promise<SafePublishingDraftView> {
    const draft = await this.getScopedDraft(draftId, workspaceId);
    if (draft.status !== 'processing') return this.getDraftView(draft.id, workspaceId);
    const provider = this.requireProvider(draft.providerKey);
    if (!provider.getPublishStatus || !draft.providerPublishId) {
      return this.getDraftView(draft.id, workspaceId);
    }
    const material = await this.loadConnectionContext(draft.workspaceSocialConnectionId, workspaceId);

    for (let poll = 0; poll < MAX_POLLS_PER_RECONCILE; poll += 1) {
      const current = await this.repo.getDraft(draft.id);
      if (!current || current.status !== 'processing') break;
      const status = await provider.getPublishStatus({
        providerPublishId: current.providerPublishId!,
        connection: material,
      });
      if (status.status === 'published') {
        const runs = await this.repo.listRuns(draft.id);
        const activeRun = runs[runs.length - 1];
        if (activeRun && activeRun.status === 'accepted') {
          await this.repo.updateRun(activeRun.id, { status: 'completed', completedAt: new Date().toISOString() });
        }
        await this.repo.updateDraft(draft.id, {
          status: 'published',
          publishedUrl: status.publishedUrl ?? null,
          publishedAt: new Date().toISOString(),
          providerMetadataProtected: status.providerMetadata ?? null,
        });
        await this.append(draft.id, actorId, 'provider_published', 'The provider confirmed the post.');
        break;
      }
      if (status.status === 'failed') {
        const runs = await this.repo.listRuns(draft.id);
        const activeRun = runs[runs.length - 1];
        if (activeRun && (activeRun.status === 'accepted' || activeRun.status === 'processing')) {
          await this.repo.updateRun(activeRun.id, {
            status: 'failed',
            errorCode: status.errorCode ?? 'provider_failed',
            errorMessageSafe: status.errorMessageSafe ?? 'The provider could not complete this post.',
            completedAt: new Date().toISOString(),
          });
        }
        await this.repo.updateDraft(draft.id, {
          status: 'failed',
          failureCode: status.errorCode ?? 'provider_failed',
          failureMessageSafe: status.errorMessageSafe ?? 'The provider could not complete this post.',
        });
        await this.append(draft.id, actorId, 'provider_failed', status.errorMessageSafe ?? 'The provider could not complete this post.');
        break;
      }
      // still processing → continue bounded loop
    }
    return this.getDraftView(draft.id, workspaceId);
  }

  /**
   * Applies a verified webhook result (server endpoint only). Signature
   * verification happens in the adapter; this method records the event
   * (deduped) and applies confirmed status transitions.
   */
  async applyVerifiedWebhook(
    input: {
      providerKey: string;
      providerPublishId: string;
      externalEventId: string | null;
      eventType: string | null;
      status: 'processing' | 'published' | 'failed';
      publishedUrl?: string;
      errorCode?: string;
      errorMessageSafe?: string;
      payloadMetadataProtected?: unknown;
    },
    actorId: string | null,
  ): Promise<{ applied: boolean; reason?: string }> {
    const drafts = await this.repo.listDrafts(anyWorkspaceForProvider());
    const draft = drafts.find((d) => d.providerPublishId === input.providerPublishId);
    if (!draft) {
      await this.repo.recordWebhookEvent({
        providerKey: input.providerKey,
        externalEventId: input.externalEventId,
        signatureVerified: true,
        eventType: input.eventType,
        publishingDraftId: null,
        providerRunId: null,
        payloadMetadataProtected: input.payloadMetadataProtected ?? null,
        processingErrorSafe: 'No matching draft for the provider publish id.',
      });
      return { applied: false, reason: 'no_matching_draft' };
    }

    const { duplicate } = await this.repo.recordWebhookEvent({
      providerKey: input.providerKey,
      externalEventId: input.externalEventId,
      signatureVerified: true,
      eventType: input.eventType,
      publishingDraftId: draft.id,
      providerRunId: null,
      payloadMetadataProtected: input.payloadMetadataProtected ?? null,
    });
    if (duplicate) return { applied: false, reason: 'duplicate' };

    if (input.status === 'published' && draft.status === 'processing') {
      const runs = await this.repo.listRuns(draft.id);
      const activeRun = runs[runs.length - 1];
      if (activeRun && activeRun.status === 'accepted') {
        await this.repo.updateRun(activeRun.id, { status: 'completed', completedAt: new Date().toISOString() });
      }
      await this.repo.updateDraft(draft.id, {
        status: 'published',
        publishedUrl: input.publishedUrl ?? null,
        publishedAt: new Date().toISOString(),
      });
      await this.append(draft.id, actorId, 'provider_published', 'The provider confirmed the post (webhook).');
    } else if (input.status === 'failed' && (draft.status === 'processing' || draft.status === 'submitting')) {
      await this.repo.updateDraft(draft.id, {
        status: 'failed',
        failureCode: input.errorCode ?? 'provider_failed',
        failureMessageSafe: input.errorMessageSafe ?? 'The provider could not complete this post.',
      });
      await this.append(draft.id, actorId, 'provider_failed', input.errorMessageSafe ?? 'The provider could not complete this post.');
    }
    await this.repo.updateWebhookEvent((await this.repo.recordWebhookEvent({
      providerKey: input.providerKey,
      externalEventId: input.externalEventId,
      signatureVerified: true,
      eventType: input.eventType,
      publishingDraftId: draft.id,
      providerRunId: null,
      payloadMetadataProtected: null,
    })).record.id, { processedAt: new Date().toISOString() });
    return { applied: true };
  }

  // ── Retry / cancel / archive ───────────────────────────────────────────────

  async retryDraft(draftId: string, workspaceId: string, actorId: string): Promise<SafePublishingDraftView> {
    const draft = await this.getScopedDraft(draftId, workspaceId);
    if (draft.status !== 'failed') invalid('Only failed drafts can be retried.');
    const runs = await this.repo.listRuns(draft.id);
    const lastRun = runs[runs.length - 1] ?? null;
    const retry = canRetryAfterRun(lastRun);
    if (!retry.allowed) invalid(retry.reason!);
    await this.repo.updateDraft(draft.id, {
      status: 'ready',
      failureCode: null,
      failureMessageSafe: null,
      validationResult: draft.validationResult,
    });
    await this.append(draft.id, actorId, 'retry_requested', 'Retry requested — draft returned to ready.');
    return this.getDraftView(draft.id, workspaceId);
  }

  async cancelDraft(draftId: string, workspaceId: string, actorId: string): Promise<SafePublishingDraftView> {
    const draft = await this.getScopedDraft(draftId, workspaceId);
    if (!['draft', 'ready', 'failed'].includes(draft.status)) {
      invalid('Only unsubmitted drafts can be cancelled.');
    }
    assertPublishingTransition(draft.status, 'cancelled');
    await this.repo.updateDraft(draft.id, { status: 'cancelled' });
    await this.append(draft.id, actorId, 'cancelled', 'Draft cancelled.');
    return this.getDraftView(draft.id, workspaceId);
  }

  async archiveDraft(draftId: string, workspaceId: string, actorId: string): Promise<SafePublishingDraftView> {
    const draft = await this.getScopedDraft(draftId, workspaceId);
    if (draft.status === 'archived') return this.getDraftView(draft.id, workspaceId);
    if (draft.status === 'submitting' || draft.status === 'processing') {
      invalid('Drafts with an in-flight submission cannot be archived yet.');
    }
    await this.repo.updateDraft(draft.id, {
      status: 'archived',
      archivedAt: new Date().toISOString(),
    });
    await this.append(draft.id, actorId, 'archived', 'Draft archived.');
    return this.getDraftView(draft.id, workspaceId);
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  private requireProvider(providerKey: string) {
    const provider = this.registry.get(providerKey);
    if (!provider) invalid('Unknown publishing provider.');
    return provider;
  }

  private async getScopedDraft(draftId: string, workspaceId: string): Promise<PublishingDraftRecord> {
    const draft = await this.repo.getDraft(draftId);
    if (!draft) invalid('Publishing draft not found.');
    isInWorkspace(draft.workspaceId, workspaceId);
    return draft;
  }

  /**
   * Server-only: decrypts the connection token via the connections service
   * and builds the adapter connection context. Never crosses to the client.
   */
  private async loadConnectionContext(
    connectionId: string,
    workspaceId: string,
  ): Promise<ServerConnectionContext> {
    const connection = await this.connections.getConnection(connectionId, workspaceId);
    const material = await (
      this.connections as unknown as {
        loadTokenMaterial?: (id: string) => Promise<{ accessToken: string }>;
      }
    ).loadTokenMaterial?.(connection.id);
    if (!material) {
      // Fallback: verify (server-side) to obtain a fresh healthy context.
      const verified = await this.connections.verifyConnection(connection.id, workspaceId, 'system');
      if (verified.status !== 'connected') {
        invalid('The account is not currently connected.');
      }
      const retry = await (
        this.connections as unknown as {
          loadTokenMaterial?: (id: string) => Promise<{ accessToken: string }>;
        }
      ).loadTokenMaterial?.(connection.id);
      if (!retry) invalid('The account token could not be loaded securely.');
      return {
        connectionId: connection.id,
        providerKey: connection.providerKey,
        workspaceId,
        accessToken: retry.accessToken,
        accountLabel: connection.externalAccountLabel ?? undefined,
      };
    }
    return {
      connectionId: connection.id,
      providerKey: connection.providerKey,
      workspaceId,
      accessToken: material.accessToken,
      accountLabel: connection.externalAccountLabel ?? undefined,
    };
  }

  /** Server-only media references (storage paths; never signed URLs). */
  private async buildServerMediaReferences(draft: PublishingDraftRecord, workspaceId: string) {
    const output = await this.gallery.getOutput(draft.galleryOutputId, workspaceId);
    return [
      {
        galleryOutputId: output.id,
        mediaType: (output.mimeType?.startsWith('video') ? 'video' : 'image') as 'image' | 'video',
        storagePath: output.mediaStoragePath ?? output.thumbnailStoragePath ?? 'unavailable',
        width: output.width,
        height: output.height,
        durationSeconds: output.durationSeconds,
      },
    ];
  }

  private async append(
    draftId: string,
    actorId: string | null,
    eventType: PublishingDraftEventRecord['eventType'],
    message: string,
    metadata?: PublishingMetadata,
  ): Promise<void> {
    await this.repo.appendDraftEvent({
      publishingDraftId: draftId,
      actorId,
      eventType,
      message,
      metadata: metadata ?? null,
    });
  }

  /** The ONLY draft → client mapping. Structurally strips protected fields. */
  private toSafeView(draft: PublishingDraftRecord): SafePublishingDraftView {
    const primary = draft.mediaSnapshot.outputs[0] ?? null;
    return {
      id: draft.id,
      workspaceId: draft.workspaceId,
      campaignId: draft.campaignId,
      campaignItemId: draft.campaignItemId,
      galleryOutputId: draft.galleryOutputId,
      providerKey: draft.providerKey,
      workspaceSocialConnectionId: draft.workspaceSocialConnectionId,
      status: draft.status,
      placement: draft.placement,
      sourceTitle: primary?.title ?? 'Source output',
      mediaType: primary?.mediaType ?? 'image',
      mediaSummary: primary
        ? {
            width: primary.width,
            height: primary.height,
            durationSeconds: primary.durationSeconds,
          }
        : null,
      externalAccount: draft.externalAccountSnapshot,
      copy: draft.copySnapshot,
      validationResult: draft.validationResult
        ? {
            valid: draft.validationResult.valid,
            errors: draft.validationResult.errors,
            warnings: draft.validationResult.warnings,
            validatedAt: draft.validationResult.validatedAt,
          }
        : null,
      failureCode: draft.failureCode,
      failureMessageSafe: draft.failureMessageSafe,
      publishedUrl: draft.publishedUrl,
      publishedAt: draft.publishedAt,
      acknowledgementRecorded: draft.acknowledgementAt !== null,
      createdBy: draft.createdBy,
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
      archivedAt: draft.archivedAt,
    };
  }
}

function isInWorkspaceAny(workspaceId: string): void {
  if (!workspaceId) throw new Error('A workspace context is required.');
}

function mapSafe(raw: unknown): string {
  const text = raw instanceof Error ? raw.message : String(raw);
  if (/simulated media preparation failure/i.test(text)) {
    return 'Media preparation failed before submission. You can retry when the draft is ready.';
  }
  if (/simulated publish failure/i.test(text)) {
    return 'The provider did not accept the submission. If it was never accepted, you can retry.';
  }
  return 'Publishing could not be completed. Please try again.';
}

/** Webhook routing helper — provider events are workspace-neutral in transit; production resolves the draft via the providerPublishId index server-side. */
function anyWorkspaceForProvider(): string {
  return 'ws_demo';
}
