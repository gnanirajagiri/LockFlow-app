/**
 * QualityReviewService — continuity quality reviews over Gallery outputs.
 *
 * Product rules enforced here:
 *   * A review evaluates an output against the EXACT pinned inputs from the
 *     output's immutable job pins/snapshots — never newer active versions.
 *   * Findings are review records: they never mutate Models, Environments,
 *     Looks, Library assets, job pins or output media (the service takes no
 *     such dependency and the repositories expose no such operation).
 *   * Findings and the summary are editable only while the review is a draft;
 *     completed reviews are read-only (append-only except safe archival).
 *   * Completing a review never touches the Gallery output's approval status.
 *   * Completing a review with warning/fail findings records advisory
 *     recurring-issue occurrences (server-side only, workspace-scoped).
 */
import type { GalleryProvenance } from '../services/galleryService';
import type { GalleryOutputRecord } from '../domain/gallery';
import {
  buildExpectedContext,
  projectPins,
} from './provenanceSnapshotBuilder';
import { computeIssueKey, computeSourceContextHash, recommendationFor } from './escalation';
import { assertReviewDraft, refuseInvalidQualityReviewTransition, QualityStateError } from './guards';
import { validateCreateQualityFinding, validateUpdateQualityFinding } from './schemas';
import type {
  CorrectionRequestFindingLinkRecord,
  QualityFindingRecord,
  QualityFindingCategory,
  QualityResult,
  QualityReviewRecord,
} from './types';
import type {
  QualityFindingRepository,
  QualityReviewRepository,
  RecurringIssueRepository,
} from './repository';

const REVIEWER_ID = 'demo-user';

/** Worst-of composition for the default overall result. */
function overallFromFindings(findings: QualityFindingRecord[]): QualityResult {
  if (findings.some((finding) => finding.result === 'fail')) return 'fail';
  if (findings.some((finding) => finding.result === 'warning')) return 'warning';
  if (findings.length > 0 && findings.every((finding) => finding.result === 'pass')) return 'pass';
  return 'not_checked';
}

/** Minimal output shape the UI helpers need (GalleryOutputRecord-compatible). */
export interface GalleryOutputRecordLike {
  id: string;
  title: string;
  outputType: string;
  status: string;
  workspaceId: string;
  metadata: Record<string, unknown>;
  mediaStoragePath: string | null;
}

export interface CompletedReviewEscalation {
  category: QualityFindingCategory;
  issueKey: string;
  occurrenceCount: number;
  escalationLevel: 'first_notice' | 'strengthen_references' | 'constrain_prompt' | 'provider_review';
  recommendation: string;
}

export interface CompleteReviewResult {
  review: QualityReviewRecord;
  findings: QualityFindingRecord[];
  escalations: CompletedReviewEscalation[];
}

export class QualityReviewService {
  constructor(
    private readonly reviews: QualityReviewRepository,
    private readonly findings: QualityFindingRepository,
    private readonly recurring: RecurringIssueRepository,
    /** Provenance resolver — the SAME historical read model the Gallery UI shows. */
    private readonly resolveProvenance: (
      outputId: string,
      workspaceId: string,
    ) => Promise<GalleryProvenance>,
    /** Output reader (workspace-checked GalleryService.getOutput). */
    private readonly outputReader: (
      outputId: string,
      workspaceId: string,
    ) => Promise<GalleryOutputRecordLike> = async () => {
      throw new Error('Output reading is not wired for this instance.');
    },
    /** Development workspace used by seed-level UI helpers (never a scope). */
    private readonly developmentWorkspaceId: string = 'ws_demo',
  ) {}

  private async requireOutput(
    outputId: string,
    workspaceId: string,
  ): Promise<GalleryOutputRecord> {
    // Delegated workspace check: resolveProvenance calls GalleryService
    // getOutput which throws on cross-workspace access.
    const provenance = await this.resolveProvenance(outputId, workspaceId);
    if (provenance.job.workspaceId !== workspaceId) {
      throw new Error('Cross-workspace access denied.');
    }
    return {
      id: outputId,
      workspaceId: provenance.job.workspaceId,
      contentJobRequestId: provenance.job.id,
      parentGalleryOutputId: null,
      title: '',
      outputType: 'image',
      status: 'ready_for_review',
      mediaStoragePath: null,
      thumbnailStoragePath: null,
      durationSeconds: null,
      width: null,
      height: null,
      fileSizeBytes: null,
      mimeType: null,
      outputIndex: 0,
      metadata: {},
      createdBy: REVIEWER_ID,
      createdAt: provenance.job.createdAt,
      updatedAt: provenance.job.updatedAt,
    } as unknown as GalleryOutputRecord;
  }

  /** Resolves the workspace that owns an output (UI entry helper). */
  async workspaceForOutput(outputId: string): Promise<string> {
    const output = await this.resolveProvenance(outputId, this.developmentWorkspaceId);
    return output.job.workspaceId;
  }

  /**
   * UI helper: the output record for the quality pages. Goes through the
   * Gallery service (workspace-checked); never exposes signed URLs.
   */
  async getOutputForQuality(
    outputId: string,
  ): Promise<{
    id: string;
    title: string;
    outputType: string;
    status: string;
    workspaceId: string;
    metadata: Record<string, unknown>;
    mediaStoragePath: string | null;
  }> {
    const output = await this.outputReader(outputId, this.developmentWorkspaceId);
    return {
      id: output.id,
      title: output.title,
      outputType: output.outputType,
      status: output.status,
      workspaceId: output.workspaceId,
      metadata: output.metadata,
      mediaStoragePath: output.mediaStoragePath,
    };
  }

  /** UI helper: the historical provenance for the quality pages. */
  async getProvenanceForQuality(outputId: string): Promise<GalleryProvenance> {
    return this.resolveProvenance(outputId, this.developmentWorkspaceId);
  }

  /** Creates a draft review seeded from the output's immutable provenance. */
  async createDraftReview(outputId: string, activeWorkspaceId: string): Promise<QualityReviewRecord> {
    await this.requireOutput(outputId, activeWorkspaceId);
    return this.reviews.createReview({
      workspaceId: activeWorkspaceId,
      galleryOutputId: outputId,
      reviewerId: REVIEWER_ID,
    });
  }

  async getReview(reviewId: string, activeWorkspaceId: string): Promise<QualityReviewRecord> {
    return this.reviews.getReview(reviewId, activeWorkspaceId);
  }

  async listReviewsForOutput(outputId: string, activeWorkspaceId: string): Promise<QualityReviewRecord[]> {
    await this.requireOutput(outputId, activeWorkspaceId);
    return this.reviews.listForOutput(outputId, activeWorkspaceId);
  }

  /** Reviews plus their findings for an output (detail pages). */
  async listReviewsAndFindingsForOutput(
    outputId: string,
    activeWorkspaceId: string,
  ): Promise<Array<{ review: QualityReviewRecord; findings: QualityFindingRecord[] }>> {
    const reviews = await this.listReviewsForOutput(outputId, activeWorkspaceId);
    const all = await this.findings.listForOutputReviewIds(reviews.map((review) => review.id));
    return reviews.map((review) => ({
      review,
      findings: all.filter((finding) => finding.qualityReviewId === review.id),
    }));
  }

  async listFindings(reviewId: string, activeWorkspaceId: string): Promise<QualityFindingRecord[]> {
    await this.reviews.getReview(reviewId, activeWorkspaceId);
    return this.findings.listForReview(reviewId);
  }

  /** Adds a finding with expected context captured from the immutable pins. */
  async addFinding(
    reviewId: string,
    input: unknown,
    activeWorkspaceId: string,
  ): Promise<QualityFindingRecord> {
    const review = await this.reviews.getReview(reviewId, activeWorkspaceId);
    assertReviewDraft(review);
    const result = validateCreateQualityFinding(input);
    if (!result.ok) throw new Error(`Invalid finding: ${result.errors.join('; ')}`);
    const provenance = await this.resolveProvenance(review.galleryOutputId, activeWorkspaceId);
    const expectedContext = buildExpectedContext(result.value.category, {
      job: {
        id: provenance.job.id,
        name: provenance.job.name,
        contentProjectId: provenance.job.contentProjectId,
        requestedOutputType: String(provenance.job.requestedOutputType),
      },
      project: provenance.project ? { id: provenance.project.id, name: provenance.project.name } : null,
      pins: provenance.pins,
      outputMetadata: {},
      output: { id: review.galleryOutputId, title: '', outputType: 'image', outputIndex: 0 },
    });
    return this.findings.createFinding({
      qualityReviewId: reviewId,
      category: result.value.category,
      result: result.value.result,
      ...(result.value.severity !== undefined ? { severity: result.value.severity } : {}),
      ...(result.value.observedNote !== undefined ? { observedNote: result.value.observedNote } : {}),
      ...(result.value.correctionNote !== undefined ? { correctionNote: result.value.correctionNote } : {}),
      expectedContext,
    });
  }

  async updateFinding(
    findingId: string,
    input: unknown,
    activeWorkspaceId: string,
  ): Promise<QualityFindingRecord> {
    const finding = await this.findings.getFinding(findingId);
    const review = await this.reviews.getReview(finding.qualityReviewId, activeWorkspaceId);
    assertReviewDraft(review);
    const result = validateUpdateQualityFinding(input);
    if (!result.ok) throw new Error(`Invalid finding update: ${result.errors.join('; ')}`);
    return this.findings.updateFinding(findingId, result.value);
  }

  async deleteFinding(findingId: string, activeWorkspaceId: string): Promise<void> {
    const finding = await this.findings.getFinding(findingId);
    const review = await this.reviews.getReview(finding.qualityReviewId, activeWorkspaceId);
    assertReviewDraft(review);
    await this.findings.deleteFinding(findingId);
  }

  async updateSummary(
    reviewId: string,
    summary: string | null,
    activeWorkspaceId: string,
  ): Promise<QualityReviewRecord> {
    const review = await this.reviews.getReview(reviewId, activeWorkspaceId);
    assertReviewDraft(review);
    return this.reviews.updateReview(reviewId, {
      summary: summary === null ? null : String(summary).slice(0, 2000),
    });
  }

  /**
   * Completes a review: freezes it read-only and records advisory recurring
   * occurrences for every warning/fail finding. NEVER touches the Gallery
   * output's approval status.
   */
  async completeReview(
    reviewId: string,
    activeWorkspaceId: string,
    options: { overallResult?: QualityResult; summary?: string } = {},
  ): Promise<CompleteReviewResult> {
    const review = await this.reviews.getReview(reviewId, activeWorkspaceId);
    assertReviewDraft(review);
    const findings = await this.findings.listForReview(reviewId);
    const overall = options.overallResult ?? overallFromFindings(findings);
    await this.reviews.updateReview(reviewId, {
      status: 'completed',
      overallResult: overall,
      summary: options.summary !== undefined ? options.summary.slice(0, 2000) : review.summary,
      reviewedAt: new Date().toISOString(),
    });

    // Advisory escalation for recurring warning/fail findings.
    const escalations: CompletedReviewEscalation[] = [];
    const flagged = findings.filter((finding) => finding.result === 'warning' || finding.result === 'fail');
    if (flagged.length > 0) {
      const provenance = await this.resolveProvenance(review.galleryOutputId, activeWorkspaceId);
      const pins = projectPins(provenance.pins);
      const sourceContextHash = computeSourceContextHash(pins);
      for (const finding of flagged) {
        const issueKey = computeIssueKey(finding.category, sourceContextHash);
        const occurrence = await this.recurring.recordOccurrence({
          workspaceId: activeWorkspaceId,
          issueKey,
          category: finding.category,
          sourceContextHash,
        });
        escalations.push({
          category: finding.category,
          issueKey: occurrence.issueKey,
          occurrenceCount: occurrence.occurrenceCount,
          escalationLevel: occurrence.escalationLevel,
          recommendation: recommendationFor(occurrence.escalationLevel),
        });
      }
    }

    return {
      review: await this.reviews.getReview(reviewId, activeWorkspaceId),
      findings: await this.findings.listForReview(reviewId),
      escalations,
    };
  }

  /** Soft archival — completed reviews can be archived, nothing is deleted. */
  async archiveReview(reviewId: string, activeWorkspaceId: string): Promise<QualityReviewRecord> {
    const review = await this.reviews.getReview(reviewId, activeWorkspaceId);
    refuseInvalidQualityReviewTransition(review.status, 'archived');
    return this.reviews.updateReview(reviewId, { status: 'archived', archivedFrom: review.status });
  }

  /** Guard exposure for tests/UI: draft-only editability error. */
  ensureEditable(review: QualityReviewRecord): void {
    assertReviewDraft(review);
  }

  ensureStateErrorMatches(error: unknown): error is QualityStateError {
    return error instanceof QualityStateError;
  }
}

// Re-export for consumers that need the link record type.
export type { CorrectionRequestFindingLinkRecord };
