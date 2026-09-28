/**
 * In-memory quality repository — demo mode.
 *
 * One class implementing all four contracts over the demo workspace,
 * mirroring the SQL semantics: workspace scoping, one active draft per
 * reviewer/output, draft-only finding edits (enforced again in services),
 * append-only events, unique link pairs and unique issue keys per workspace.
 */
import type {
  CorrectionRequestEventRecord,
  CorrectionRequestFindingLinkRecord,
  CorrectionRequestRecord,
  CorrectionRequestStatus,
  CreateCorrectionRequestInput,
  CreateQualityFindingInput,
  QualityFindingRecord,
  QualityReviewRecord,
  RecurringIssueRecord,
  UpdateCorrectionRequestInput,
  UpdateQualityFindingInput,
} from './types';
import { escalationLevelFor } from './escalation';
import type {
  CorrectionRequestRepository,
  CreateQualityReviewInput,
  QualityFindingRepository,
  QualityReviewRepository,
  RecordOccurrenceResult,
  RecurringIssueRepository,
} from './repository';

const now = () => new Date().toISOString();

function notFound(what: string, id: string): never {
  throw new Error(`${what} not found: ${id}`);
}

function isInWorkspace(recordWorkspaceId: string, activeWorkspaceId: string): void {
  if (recordWorkspaceId !== activeWorkspaceId) {
    throw new Error('Cross-workspace access denied.');
  }
}

export class MockQualityRepository
  implements QualityReviewRepository, QualityFindingRepository, CorrectionRequestRepository, RecurringIssueRepository
{
  private reviews = new Map<string, QualityReviewRecord>();
  private findings = new Map<string, QualityFindingRecord[]>(); // key: reviewId
  private correctionRequests = new Map<string, CorrectionRequestRecord>();
  private correctionLinks = new Map<string, CorrectionRequestFindingLinkRecord[]>(); // key: requestId
  private correctionEvents = new Map<string, CorrectionRequestEventRecord[]>(); // key: requestId
  private recurringIssues = new Map<string, RecurringIssueRecord>(); // key: `${workspaceId}:${issueKey}`

  // ── Reviews ────────────────────────────────────────────────────────────────

  async listForOutput(galleryOutputId: string, workspaceId: string): Promise<QualityReviewRecord[]> {
    return [...this.reviews.values()]
      .filter((review) => review.galleryOutputId === galleryOutputId && review.workspaceId === workspaceId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getReview(reviewId: string, workspaceId: string): Promise<QualityReviewRecord> {
    const review = this.reviews.get(reviewId);
    if (!review) notFound('Quality review', reviewId);
    isInWorkspace(review.workspaceId, workspaceId);
    return structuredClone(review);
  }

  async createReview(input: CreateQualityReviewInput): Promise<QualityReviewRecord> {
    // One active draft per reviewer/output (mirrors the partial unique index).
    const existingDraft = [...this.reviews.values()].find(
      (review) =>
        review.galleryOutputId === input.galleryOutputId &&
        review.reviewerId === input.reviewerId &&
        review.status === 'draft',
    );
    if (existingDraft) {
      throw new Error('An active draft review already exists for this reviewer and output.');
    }
    const review: QualityReviewRecord = {
      id: crypto.randomUUID(),
      workspaceId: input.workspaceId,
      galleryOutputId: input.galleryOutputId,
      status: 'draft',
      overallResult: 'not_checked',
      reviewerId: input.reviewerId,
      summary: null,
      reviewedAt: null,
      createdAt: now(),
      updatedAt: now(),
    };
    this.reviews.set(review.id, review);
    this.findings.set(review.id, []);
    return structuredClone(review);
  }

  async updateReview(
    reviewId: string,
    patch: Partial<QualityReviewRecord> & { archivedFrom?: string },
  ): Promise<QualityReviewRecord> {
    const review = this.reviews.get(reviewId);
    if (!review) notFound('Quality review', reviewId);
    const next: QualityReviewRecord = {
      ...review,
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
      ...(patch.overallResult !== undefined ? { overallResult: patch.overallResult } : {}),
      ...(patch.reviewedAt !== undefined ? { reviewedAt: patch.reviewedAt } : {}),
      updatedAt: now(),
    };
    if (patch.status === 'archived') {
      // Safe archival metadata only — store the origin for restore paths.
      (next as unknown as { archivedFrom?: string }).archivedFrom = patch.archivedFrom ?? review.status;
    }
    this.reviews.set(reviewId, next);
    return structuredClone(next);
  }

  // ── Findings ───────────────────────────────────────────────────────────────

  async listForReview(qualityReviewId: string): Promise<QualityFindingRecord[]> {
    return structuredClone(this.findings.get(qualityReviewId) ?? []);
  }

  async listForOutputReviewIds(reviewIds: string[]): Promise<QualityFindingRecord[]> {
    const all: QualityFindingRecord[] = [];
    for (const reviewId of reviewIds) {
      all.push(...(this.findings.get(reviewId) ?? []));
    }
    return structuredClone(all);
  }

  async getFinding(findingId: string): Promise<QualityFindingRecord> {
    for (const list of this.findings.values()) {
      const finding = list.find((entry) => entry.id === findingId);
      if (finding) return structuredClone(finding);
    }
    notFound('Quality finding', findingId);
  }

  async createFinding(
    input: CreateQualityFindingInput & { qualityReviewId: string; expectedContext: Record<string, unknown> },
  ): Promise<QualityFindingRecord> {
    if (!this.findings.has(input.qualityReviewId)) notFound('Quality review', input.qualityReviewId);
    const finding: QualityFindingRecord = {
      id: crypto.randomUUID(),
      qualityReviewId: input.qualityReviewId,
      category: input.category,
      result: input.result,
      severity: input.severity ?? 'low',
      expectedContext: structuredClone(input.expectedContext),
      observedNote: input.observedNote ?? null,
      correctionNote: input.correctionNote ?? null,
      createdAt: now(),
      updatedAt: now(),
    };
    this.findings.set(input.qualityReviewId, [...(this.findings.get(input.qualityReviewId) ?? []), finding]);
    return structuredClone(finding);
  }

  async updateFinding(findingId: string, patch: UpdateQualityFindingInput): Promise<QualityFindingRecord> {
    for (const [reviewId, list] of this.findings) {
      const index = list.findIndex((entry) => entry.id === findingId);
      if (index === -1) continue;
      const next: QualityFindingRecord = {
        ...list[index],
        ...(patch.result !== undefined ? { result: patch.result } : {}),
        ...(patch.severity !== undefined ? { severity: patch.severity } : {}),
        ...(patch.observedNote !== undefined ? { observedNote: patch.observedNote } : {}),
        ...(patch.correctionNote !== undefined ? { correctionNote: patch.correctionNote } : {}),
        updatedAt: now(),
      };
      const updated = [...list];
      updated[index] = next;
      this.findings.set(reviewId, updated);
      return structuredClone(next);
    }
    notFound('Quality finding', findingId);
  }

  async deleteFinding(findingId: string): Promise<void> {
    for (const [reviewId, list] of this.findings) {
      const filtered = list.filter((entry) => entry.id !== findingId);
      if (filtered.length !== list.length) {
        this.findings.set(reviewId, filtered);
        return;
      }
    }
    notFound('Quality finding', findingId);
  }

  // ── Correction requests ────────────────────────────────────────────────────

  async list(workspaceId: string): Promise<CorrectionRequestRecord[]> {
    return [...this.correctionRequests.values()]
      .filter((request) => request.workspaceId === workspaceId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getCorrectionRequest(correctionRequestId: string, workspaceId: string): Promise<CorrectionRequestRecord> {
    const request = this.correctionRequests.get(correctionRequestId);
    if (!request) notFound('Correction request', correctionRequestId);
    isInWorkspace(request.workspaceId, workspaceId);
    return structuredClone(request);
  }

  async createCorrectionRequest(
    input: CreateCorrectionRequestInput & {
      sourceContentJobRequestId: string;
      sourceGenerationProviderRunId: string | null;
      sourceSnapshot: Record<string, unknown>;
      pinSnapshot: Record<string, unknown>;
      createdBy: string;
    },
  ): Promise<CorrectionRequestRecord> {
    const request: CorrectionRequestRecord = {
      id: crypto.randomUUID(),
      workspaceId: input.workspaceId,
      sourceGalleryOutputId: input.sourceGalleryOutputId,
      sourceContentJobRequestId: input.sourceContentJobRequestId,
      sourceGenerationProviderRunId: input.sourceGenerationProviderRunId,
      status: 'draft',
      title: input.title,
      requestedChange: input.requestedChange,
      scope: input.scope,
      sourceSnapshot: structuredClone(input.sourceSnapshot),
      pinSnapshot: structuredClone(input.pinSnapshot),
      providerOptionsSnapshot: null,
      createdBy: input.createdBy,
      submittedAt: null,
      completedAt: null,
      createdAt: now(),
      updatedAt: now(),
    };
    this.correctionRequests.set(request.id, request);
    this.correctionLinks.set(request.id, []);
    this.correctionEvents.set(request.id, []);
    return structuredClone(request);
  }

  async updateCorrectionRequest(
    correctionRequestId: string,
    patch: UpdateCorrectionRequestInput & {
      status?: CorrectionRequestStatus;
      submittedAt?: string | null;
      completedAt?: string | null;
      archivedFrom?: string | null;
    },
  ): Promise<CorrectionRequestRecord> {
    const request = this.correctionRequests.get(correctionRequestId);
    if (!request) notFound('Correction request', correctionRequestId);
    const next: CorrectionRequestRecord = {
      ...request,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.requestedChange !== undefined ? { requestedChange: patch.requestedChange } : {}),
      ...(patch.scope !== undefined ? { scope: patch.scope } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.submittedAt !== undefined ? { submittedAt: patch.submittedAt } : {}),
      ...(patch.completedAt !== undefined ? { completedAt: patch.completedAt } : {}),
      updatedAt: now(),
    };
    if (patch.status === 'archived' && patch.archivedFrom) {
      (next as unknown as { metadata?: Record<string, unknown> }).metadata = {
        archivedFrom: patch.archivedFrom,
      };
    }
    // Snapshots are never updated — the repository carries no snapshot patch.
    this.correctionRequests.set(correctionRequestId, next);
    return structuredClone(next);
  }

  async listFindings(correctionRequestId: string): Promise<CorrectionRequestFindingLinkRecord[]> {
    return structuredClone(this.correctionLinks.get(correctionRequestId) ?? []);
  }

  async linkFinding(correctionRequestId: string, qualityFindingId: string): Promise<CorrectionRequestFindingLinkRecord> {
    const existing = (this.correctionLinks.get(correctionRequestId) ?? []).find(
      (link) => link.qualityFindingId === qualityFindingId,
    );
    if (existing) return structuredClone(existing);
    const link: CorrectionRequestFindingLinkRecord = {
      correctionRequestId,
      qualityFindingId,
      createdAt: now(),
    };
    this.correctionLinks.set(correctionRequestId, [
      ...(this.correctionLinks.get(correctionRequestId) ?? []),
      link,
    ]);
    return structuredClone(link);
  }

  async unlinkFinding(correctionRequestId: string, qualityFindingId: string): Promise<void> {
    this.correctionLinks.set(
      correctionRequestId,
      (this.correctionLinks.get(correctionRequestId) ?? []).filter(
        (link) => link.qualityFindingId !== qualityFindingId,
      ),
    );
  }

  async listEvents(correctionRequestId: string): Promise<CorrectionRequestEventRecord[]> {
    return structuredClone(this.correctionEvents.get(correctionRequestId) ?? []);
  }

  async appendEvent(
    event: Omit<CorrectionRequestEventRecord, 'id' | 'createdAt'>,
  ): Promise<CorrectionRequestEventRecord> {
    const record: CorrectionRequestEventRecord = {
      id: crypto.randomUUID(),
      correctionRequestId: event.correctionRequestId,
      eventType: event.eventType,
      message: event.message,
      metadata: structuredClone(event.metadata),
      createdAt: now(),
    };
    this.correctionEvents.set(record.correctionRequestId, [
      ...(this.correctionEvents.get(record.correctionRequestId) ?? []),
      record,
    ]);
    return structuredClone(record);
  }

  // ── Recurring issues ───────────────────────────────────────────────────────

  async getIssue(issueKey: string, workspaceId: string): Promise<RecurringIssueRecord | null> {
    return structuredClone(this.recurringIssues.get(`${workspaceId}:${issueKey}`) ?? null);
  }

  async recordOccurrence(input: {
    workspaceId: string;
    issueKey: string;
    category: RecurringIssueRecord['category'];
    sourceContextHash: string;
  }): Promise<RecordOccurrenceResult> {
    const key = `${input.workspaceId}:${input.issueKey}`;
    const existing = this.recurringIssues.get(key);
    const next: RecurringIssueRecord = existing
      ? {
          ...existing,
          occurrenceCount: existing.occurrenceCount + 1,
          lastSeenAt: now(),
          updatedAt: now(),
        }
      : {
          id: crypto.randomUUID(),
          workspaceId: input.workspaceId,
          issueKey: input.issueKey,
          category: input.category,
          sourceContextHash: input.sourceContextHash,
          occurrenceCount: 1,
          lastSeenAt: now(),
          escalationLevel: 'first_notice',
          createdAt: now(),
          updatedAt: now(),
        };
    next.escalationLevel = escalationLevelFor(next.occurrenceCount);
    this.recurringIssues.set(key, next);
    return {
      issueKey: next.issueKey,
      occurrenceCount: next.occurrenceCount,
      escalationLevel: next.escalationLevel,
    };
  }

  // ── Test helpers ───────────────────────────────────────────────────────────

  /** Seeds a review directly (development seed/tests only). */
  seedReviewForTests(review: QualityReviewRecord, findings: QualityFindingRecord[] = []): void {
    this.reviews.set(review.id, structuredClone(review));
    this.findings.set(review.id, structuredClone(findings));
  }
}
