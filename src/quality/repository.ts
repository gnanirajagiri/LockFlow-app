/**
 * Quality domain — repository contracts.
 *
 * The UI never touches these directly; services apply domain guards and call
 * one adapter (in-memory mock in demo mode mirroring the SQL semantics).
 * Snapshots and expected context are plain records here — immutability rules
 * are enforced by the services; append-only events have no update/delete.
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

export interface CreateQualityReviewInput {
  workspaceId: string;
  galleryOutputId: string;
  reviewerId: string;
}

export interface QualityReviewRepository {
  listForOutput(galleryOutputId: string, workspaceId: string): Promise<QualityReviewRecord[]>;
  getReview(reviewId: string, workspaceId: string): Promise<QualityReviewRecord>;
  createReview(input: CreateQualityReviewInput): Promise<QualityReviewRecord>;
  updateReview(reviewId: string, patch: Partial<QualityReviewRecord> & { status?: QualityReviewRecord['status']; summary?: string | null; overallResult?: QualityReviewRecord['overallResult']; reviewedAt?: string | null; archivedFrom?: string }): Promise<QualityReviewRecord>;
}

export interface QualityFindingRepository {
  listForReview(qualityReviewId: string): Promise<QualityFindingRecord[]>;
  listForOutputReviewIds(reviewIds: string[]): Promise<QualityFindingRecord[]>;
  getFinding(findingId: string): Promise<QualityFindingRecord>;
  createFinding(input: CreateQualityFindingInput & { qualityReviewId: string; expectedContext: Record<string, unknown> }): Promise<QualityFindingRecord>;
  updateFinding(findingId: string, patch: UpdateQualityFindingInput): Promise<QualityFindingRecord>;
  deleteFinding(findingId: string): Promise<void>;
}

export interface CorrectionRequestRepository {
  list(workspaceId: string): Promise<CorrectionRequestRecord[]>;
  getCorrectionRequest(correctionRequestId: string, workspaceId: string): Promise<CorrectionRequestRecord>;
  createCorrectionRequest(input: CreateCorrectionRequestInput & {
    sourceContentJobRequestId: string;
    sourceGenerationProviderRunId: string | null;
    sourceSnapshot: Record<string, unknown>;
    pinSnapshot: Record<string, unknown>;
    createdBy: string;
  }): Promise<CorrectionRequestRecord>;
  updateCorrectionRequest(correctionRequestId: string, patch: UpdateCorrectionRequestInput & {
    status?: CorrectionRequestStatus;
    submittedAt?: string | null;
    completedAt?: string | null;
    archivedFrom?: string | null;
  }): Promise<CorrectionRequestRecord>;
  listFindings(correctionRequestId: string): Promise<CorrectionRequestFindingLinkRecord[]>;
  linkFinding(correctionRequestId: string, qualityFindingId: string): Promise<CorrectionRequestFindingLinkRecord>;
  unlinkFinding(correctionRequestId: string, qualityFindingId: string): Promise<void>;
  listEvents(correctionRequestId: string): Promise<CorrectionRequestEventRecord[]>;
  appendEvent(event: Omit<CorrectionRequestEventRecord, 'id' | 'createdAt'>): Promise<CorrectionRequestEventRecord>;
}

export interface RecordOccurrenceResult {
  issueKey: string;
  occurrenceCount: number;
  escalationLevel: RecurringIssueRecord['escalationLevel'];
}

export interface RecurringIssueRepository {
  getIssue(issueKey: string, workspaceId: string): Promise<RecurringIssueRecord | null>;
  recordOccurrence(input: {
    workspaceId: string;
    issueKey: string;
    category: RecurringIssueRecord['category'];
    sourceContextHash: string;
  }): Promise<RecordOccurrenceResult>;
}
