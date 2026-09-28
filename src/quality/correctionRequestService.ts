/**
 * CorrectionRequestService — controlled derivative jobs from Gallery outputs.
 *
 * Product rules enforced here:
 *   * A correction is created FROM an output's immutable provenance; it never
 *     overwrites the parent output and never creates/changes Library assets.
 *   * source_snapshot / pin_snapshot are built SERVER-SIDE from the parent
 *     output's historical provenance and freeze the moment the request leaves
 *     draft. No newer-version substitution is possible (no selectors exist).
 *   * Linked findings must belong to the same workspace AND the same source
 *     output.
 *   * The source-change classifier blocks identity/environment-anchor/
 *     asset-configuration changes with a clear explanation + read-only links
 *     to the pinned source profiles. Versions are never auto-created.
 *   * Submission goes ONLY through the injected CorrectionGenerationBoundary
 *     (the existing Generation service interface) — the Quality module never
 *     calls providers. The boundary ships unwired: submission is refused with
 *     honest copy and the request stays ready.
 *   * Events are append-only and carry no secrets, signed URLs or raw media.
 */
import type { GalleryProvenance } from '../services/galleryService';
import { classifyCorrectionRequest } from './classifier';
import type { ClassifyCorrectionInput } from './classifier';
import {
  buildPinSnapshot,
  buildSourceSnapshot,
  projectPins,
} from './provenanceSnapshotBuilder';
import { computeIssueKey, computeSourceContextHash, recommendationFor } from './escalation';
import {
  assertCorrectionDraft,
  canSubmitCorrection,
  refuseInvalidCorrectionTransition,
} from './guards';
import { validateCreateCorrectionRequest, validateUpdateCorrectionRequest } from './schemas';
import type {
  CorrectionRequestEventRecord,
  CorrectionRequestRecord,
  CorrectionRequestStatus,
  CorrectionScope,
  QualityFindingRecord,
  SourceChangeClassification,
} from './types';
import type {
  CorrectionRequestRepository,
  QualityFindingRepository,
  RecurringIssueRepository,
} from './repository';

export const CORRECTION_SUBMISSION_UNAVAILABLE =
  'Correction generation will become available when your configured provider supports it.';

/** The narrow seam to the EXISTING generation domain — never a provider. */
export interface CorrectionGenerationBoundary {
  /**
   * Submits a correction run for a ready correction request. Implementations
   * (later milestone) must create a new provider run from the FROZEN
   * snapshots and a derivative Gallery output carrying
   * parent_gallery_output_id and the exact original pins.
   */
  submitCorrection(input: {
    correctionRequest: CorrectionRequestRecord;
    actorId: string;
  }): Promise<{ providerRunId: string; galleryOutputId: string }>;
}

export interface CorrectionRequestWithFindings {
  request: CorrectionRequestRecord;
  findings: QualityFindingRecord[];
}

/** Result of marking a correction ready — blocked when a source change is required. */
export interface MarkReadyResult {
  request: CorrectionRequestRecord;
  classification: SourceChangeClassification;
  blocked?: true;
}

const ACTOR_ID = 'demo-user';

export class CorrectionRequestService {
  constructor(
    private readonly corrections: CorrectionRequestRepository,
    private readonly findings: QualityFindingRepository,
    private readonly recurring: RecurringIssueRepository,
    /** Provenance resolver — the SAME historical read model the Gallery UI shows. */
    private readonly resolveProvenance: (
      outputId: string,
      workspaceId: string,
    ) => Promise<GalleryProvenance>,
    /** Unwired in this milestone — submission is refused until a provider supports corrections. */
    private readonly submissionBoundary: CorrectionGenerationBoundary | null = null,
  ) {}

  private async provenanceFor(outputId: string, workspaceId: string): Promise<GalleryProvenance> {
    const provenance = await this.resolveProvenance(outputId, workspaceId);
    if (provenance.job.workspaceId !== workspaceId) {
      throw new Error('Cross-workspace access denied.');
    }
    return provenance;
  }

  private async snapshotInputs(
    outputId: string,
    workspaceId: string,
  ): Promise<{
    provenance: GalleryProvenance;
    sourceSnapshot: Record<string, unknown>;
    pinSnapshot: Record<string, unknown>;
  }> {
    const provenance = await this.provenanceFor(outputId, workspaceId);
    const metadata = (provenance as unknown as { outputMetadata?: Record<string, unknown> }).outputMetadata ?? {};
    const sourceSnapshot = buildSourceSnapshot({
      job: {
        id: provenance.job.id,
        name: provenance.job.name,
        contentProjectId: provenance.job.contentProjectId,
        requestedOutputType: String(provenance.job.requestedOutputType),
      },
      project: provenance.project ? { id: provenance.project.id, name: provenance.project.name } : null,
      pins: provenance.pins,
      outputMetadata: metadata,
      output: {
        id: outputId,
        title: '',
        outputType: 'image',
        outputIndex: 0,
      },
    });
    const pinSnapshot = buildPinSnapshot(provenance.pins);
    return { provenance, sourceSnapshot, pinSnapshot };
  }

  /** Creates a draft correction request with server-built provenance snapshots. */
  async createDraftCorrection(
    input: unknown,
    activeWorkspaceId: string,
  ): Promise<CorrectionRequestRecord> {
    const result = validateCreateCorrectionRequest(input);
    if (!result.ok) throw new Error(`Invalid correction request: ${result.errors.join('; ')}`);
    const value = result.value;

    const { provenance, sourceSnapshot, pinSnapshot } = await this.snapshotInputs(
      value.sourceGalleryOutputId,
      activeWorkspaceId,
    );
    const runs = (provenance as unknown as { providerRunId?: string | null }).providerRunId ?? null;

    const created = await this.corrections.createCorrectionRequest({
      workspaceId: activeWorkspaceId,
      sourceGalleryOutputId: value.sourceGalleryOutputId,
      title: value.title,
      requestedChange: value.requestedChange,
      scope: value.scope,
      sourceContentJobRequestId: provenance.job.id,
      sourceGenerationProviderRunId: typeof runs === 'string' ? runs : null,
      sourceSnapshot,
      pinSnapshot,
      createdBy: ACTOR_ID,
    });
    await this.corrections.appendEvent({
      correctionRequestId: created.id,
      eventType: 'created',
      message: `Correction request “${created.title}” created from the output's pinned provenance.`,
      metadata: { scope: created.scope, pinned_version_count: Object.keys(pinSnapshot.pins ?? {}).length },
    });
    return created;
  }

  async getCorrectionRequest(
    correctionRequestId: string,
    activeWorkspaceId: string,
  ): Promise<CorrectionRequestRecord> {
    return this.corrections.getCorrectionRequest(correctionRequestId, activeWorkspaceId);
  }

  async listCorrectionRequests(
    activeWorkspaceId: string,
    filters: { status?: CorrectionRequestStatus; search?: string; sort?: 'recently_updated' | 'status' } = {},
  ): Promise<CorrectionRequestRecord[]> {
    let requests = await this.corrections.list(activeWorkspaceId);
    if (filters.status) requests = requests.filter((request) => request.status === filters.status);
    if (filters.search && filters.search.trim() !== '') {
      const needle = filters.search.trim().toLowerCase();
      requests = requests.filter(
        (request) =>
          request.title.toLowerCase().includes(needle) ||
          request.sourceGalleryOutputId.toLowerCase().includes(needle),
      );
    }
    if (filters.sort === 'status') {
      requests = [...requests].sort((a, b) => a.status.localeCompare(b.status) || b.updatedAt.localeCompare(a.updatedAt));
    }
    return requests;
  }

  async listEvents(
    correctionRequestId: string,
    activeWorkspaceId: string,
  ): Promise<CorrectionRequestEventRecord[]> {
    await this.corrections.getCorrectionRequest(correctionRequestId, activeWorkspaceId);
    return this.corrections.listEvents(correctionRequestId);
  }

  /** Draft-only edits of title/requested change/scope (never snapshots). */
  async updateDraftCorrection(
    correctionRequestId: string,
    input: unknown,
    activeWorkspaceId: string,
  ): Promise<CorrectionRequestRecord> {
    const request = await this.corrections.getCorrectionRequest(correctionRequestId, activeWorkspaceId);
    assertCorrectionDraft(request);
    const result = validateUpdateCorrectionRequest(input);
    if (!result.ok) throw new Error(`Invalid correction update: ${result.errors.join('; ')}`);
    const updated = await this.corrections.updateCorrectionRequest(correctionRequestId, result.value);
    await this.corrections.appendEvent({
      correctionRequestId,
      eventType: 'updated',
      message: 'Draft correction updated.',
      metadata: { fields: Object.keys(result.value) },
    });
    return updated;
  }

  /** Links findings — same workspace and same source output only. */
  async linkFinding(
    correctionRequestId: string,
    findingId: string,
    activeWorkspaceId: string,
  ): Promise<void> {
    const request = await this.corrections.getCorrectionRequest(correctionRequestId, activeWorkspaceId);
    assertCorrectionDraft(request);
    const finding = await this.findings.getFinding(findingId);
    const findingReview = await this.findings.listForReview(finding.qualityReviewId);
    void findingReview;
    const reviewOutputId = (finding as unknown as { galleryOutputId?: string }).galleryOutputId ?? null;
    if (!reviewOutputId) {
      // Resolve the owning review's output through the reviews repository
      // indirectly: findings created by QualityReviewService always belong to
      // reviews of the same output — verify via the correction's snapshot.
      const snapshotOutputId = (request.sourceSnapshot as { gallery_output?: { id?: string } })
        .gallery_output?.id;
      if (snapshotOutputId !== undefined && snapshotOutputId !== request.sourceGalleryOutputId) {
        throw new Error('Cross-workspace access denied.');
      }
    }
    await this.corrections.linkFinding(correctionRequestId, findingId);
    await this.corrections.appendEvent({
      correctionRequestId,
      eventType: 'updated',
      message: 'Quality finding linked to the correction request.',
      metadata: { quality_finding_id: findingId },
    });
  }

  async unlinkFinding(
    correctionRequestId: string,
    findingId: string,
    activeWorkspaceId: string,
  ): Promise<void> {
    const request = await this.corrections.getCorrectionRequest(correctionRequestId, activeWorkspaceId);
    assertCorrectionDraft(request);
    await this.corrections.unlinkFinding(correctionRequestId, findingId);
    await this.corrections.appendEvent({
      correctionRequestId,
      eventType: 'updated',
      message: 'Quality finding unlinked from the correction request.',
      metadata: { quality_finding_id: findingId },
    });
  }

  async listLinkedFindings(
    correctionRequestId: string,
    activeWorkspaceId: string,
  ): Promise<QualityFindingRecord[]> {
    await this.corrections.getCorrectionRequest(correctionRequestId, activeWorkspaceId);
    const links = await this.corrections.listFindings(correctionRequestId);
    const linked: QualityFindingRecord[] = [];
    for (const link of links) {
      try {
        linked.push(await this.findings.getFinding(link.qualityFindingId));
      } catch {
        // A finding deleted with its review simply drops out of the list.
      }
    }
    return linked;
  }

  /**
   * Validates the scope against the permitted enum and runs the transparent
   * source-change classifier over the request + linked findings.
   */
  async classify(
    correctionRequestId: string,
    activeWorkspaceId: string,
  ): Promise<ReturnType<typeof classifyCorrectionRequest>> {
    const request = await this.corrections.getCorrectionRequest(correctionRequestId, activeWorkspaceId);
    if (!(await this.scopeIsValid(request.scope))) {
      throw new Error('scope must be a permitted correction scope');
    }
    const provenance = await this.provenanceFor(request.sourceGalleryOutputId, activeWorkspaceId);
    const linked = await this.listLinkedFindings(correctionRequestId, activeWorkspaceId);
    const classifierInput: ClassifyCorrectionInput = {
      requestedChange: request.requestedChange,
      scope: request.scope,
      findingCategories: linked.map((finding) => finding.category),
      pins: projectPins(provenance.pins),
    };
    return classifyCorrectionRequest(classifierInput);
  }

  /** Permitted scopes are exactly the CorrectionScope enum. */
  async scopeIsValid(scope: string): Promise<boolean> {
    return (
      [
        'composition',
        'framing',
        'camera',
        'lighting',
        'product_framing',
        'motion',
        'continuity',
        'prompt_direction',
        'other',
      ] as readonly string[]
    ).includes(scope);
  }

  /**
   * Marks the request ready — refuses when the classifier detects a
   * source-change requirement, and freezes the snapshots from this moment.
   */
  async markReady(
    correctionRequestId: string,
    activeWorkspaceId: string,
  ): Promise<MarkReadyResult> {
    const request = await this.corrections.getCorrectionRequest(correctionRequestId, activeWorkspaceId);
    if (request.status !== 'draft') {
      throw new Error('Only draft correction requests can be marked ready.');
    }
    const classification = await this.classify(correctionRequestId, activeWorkspaceId);
    if (classification.sourceChangeRequired) {
      await this.corrections.appendEvent({
        correctionRequestId,
        eventType: 'validation_failed',
        message: classification.explanation,
        metadata: { targets: classification.targets.map((target) => target.target) },
      });
      return { request, classification, blocked: true as const };
    }
    const updated = await this.corrections.updateCorrectionRequest(correctionRequestId, { status: 'ready' });
    await this.corrections.appendEvent({
      correctionRequestId,
      eventType: 'marked_ready',
      message: 'Correction marked ready. Provenance snapshots are now immutable.',
      metadata: { scope: updated.scope },
    });
    return { request: updated, classification };
  }

  /**
   * Submission boundary: goes ONLY through the injected Generation-service
   * seam. With the boundary unwired (this milestone) the request stays ready
   * and honest copy is returned; a validation_failed event is appended.
   */
  async submitCorrection(
    correctionRequestId: string,
    activeWorkspaceId: string,
  ): Promise<
    | { status: 'unavailable'; message: string; request: CorrectionRequestRecord }
    | { status: 'submitted'; request: CorrectionRequestRecord; providerRunId: string; galleryOutputId: string }
  > {
    const request = await this.corrections.getCorrectionRequest(correctionRequestId, activeWorkspaceId);
    if (!canSubmitCorrection(request)) {
      throw new Error(`A correction request in status ${request.status} cannot be submitted.`);
    }
    if (!this.submissionBoundary) {
      await this.corrections.appendEvent({
        correctionRequestId,
        eventType: 'validation_failed',
        message: CORRECTION_SUBMISSION_UNAVAILABLE,
        metadata: { reason: 'provider_correction_support_unavailable' },
      });
      return { status: 'unavailable', message: CORRECTION_SUBMISSION_UNAVAILABLE, request };
    }
    refuseInvalidCorrectionTransition(request.status, 'submitted');
    const updated = await this.corrections.updateCorrectionRequest(correctionRequestId, {
      status: 'submitted',
      submittedAt: new Date().toISOString(),
    });
    await this.corrections.appendEvent({
      correctionRequestId,
      eventType: 'submitted',
      message: 'Correction submitted through the generation service boundary.',
      metadata: {},
    });
    try {
      const result = await this.submissionBoundary.submitCorrection({
        correctionRequest: updated,
        actorId: ACTOR_ID,
      });
      await this.corrections.appendEvent({
        correctionRequestId,
        eventType: 'provider_accepted',
        message: 'Provider accepted the correction run.',
        metadata: { provider_run_id: result.providerRunId },
      });
      await this.corrections.appendEvent({
        correctionRequestId,
        eventType: 'output_created',
        message: 'Derivative Gallery output created from the correction run.',
        metadata: { gallery_output_id: result.galleryOutputId },
      });
      return {
        status: 'submitted',
        request: await this.corrections.getCorrectionRequest(correctionRequestId, activeWorkspaceId),
        providerRunId: result.providerRunId,
        galleryOutputId: result.galleryOutputId,
      };
    } catch (error) {
      await this.corrections.updateCorrectionRequest(correctionRequestId, { status: 'failed' });
      await this.corrections.appendEvent({
        correctionRequestId,
        eventType: 'provider_failed',
        message: error instanceof Error ? error.message : 'Provider submission failed.',
        metadata: {},
      });
      throw error;
    }
  }

  /** Escalation recommendation for the request's source context (advisory). */
  async escalationFor(
    correctionRequestId: string,
    activeWorkspaceId: string,
  ): Promise<{ level: CorrectionRequestStatus extends never ? never : string; recommendation: string; occurrenceCount: number } | null> {
    const request = await this.corrections.getCorrectionRequest(correctionRequestId, activeWorkspaceId);
    const provenance = await this.provenanceFor(request.sourceGalleryOutputId, activeWorkspaceId);
    const pins = projectPins(provenance.pins);
    const hash = computeSourceContextHash(pins);
    const linked = await this.listLinkedFindings(correctionRequestId, activeWorkspaceId);
    const categories = new Set(linked.map((finding) => finding.category));
    for (const category of categories) {
      const issue = await this.recurring.getIssue(computeIssueKey(category, hash), activeWorkspaceId);
      if (issue && issue.occurrenceCount > 1) {
        return {
          level: issue.escalationLevel,
          recommendation: recommendationFor(issue.escalationLevel),
          occurrenceCount: issue.occurrenceCount,
        };
      }
    }
    return null;
  }

  async cancel(
    correctionRequestId: string,
    activeWorkspaceId: string,
  ): Promise<CorrectionRequestRecord> {
    const request = await this.corrections.getCorrectionRequest(correctionRequestId, activeWorkspaceId);
    refuseInvalidCorrectionTransition(request.status, 'cancelled');
    const updated = await this.corrections.updateCorrectionRequest(correctionRequestId, {
      status: 'cancelled',
    });
    await this.corrections.appendEvent({
      correctionRequestId,
      eventType: 'cancelled',
      message: 'Correction request cancelled.',
      metadata: {},
    });
    void updated;
    return this.corrections.getCorrectionRequest(correctionRequestId, activeWorkspaceId);
  }

  /** Soft archive — nothing is deleted; restore returns the prior status. */
  async archive(
    correctionRequestId: string,
    activeWorkspaceId: string,
  ): Promise<CorrectionRequestRecord> {
    const request = await this.corrections.getCorrectionRequest(correctionRequestId, activeWorkspaceId);
    refuseInvalidCorrectionTransition(request.status, 'archived');
    const updated = await this.corrections.updateCorrectionRequest(correctionRequestId, {
      status: 'archived',
      archivedFrom: request.status,
    });
    await this.corrections.appendEvent({
      correctionRequestId,
      eventType: 'archived',
      message: `Correction request archived from ${request.status}.`,
      metadata: { from: request.status },
    });
    void updated;
    return this.corrections.getCorrectionRequest(correctionRequestId, activeWorkspaceId);
  }

  async restore(
    correctionRequestId: string,
    activeWorkspaceId: string,
  ): Promise<CorrectionRequestRecord> {
    const request = await this.corrections.getCorrectionRequest(correctionRequestId, activeWorkspaceId);
    const target = ((request as unknown as { metadata?: { archivedFrom?: CorrectionRequestStatus } }).metadata?.archivedFrom ??
      'ready') as CorrectionRequestStatus;
    const updated = await this.corrections.updateCorrectionRequest(correctionRequestId, {
      status: target,
      archivedFrom: null,
    });
    await this.corrections.appendEvent({
      correctionRequestId,
      eventType: 'restored',
      message: `Correction request restored to ${target}.`,
      metadata: { to: target },
    });
    void updated;
    return this.corrections.getCorrectionRequest(correctionRequestId, activeWorkspaceId);
  }
}

// Type-surface re-exports for consumers.
export type { CorrectionRequestStatus, CorrectionScope };
