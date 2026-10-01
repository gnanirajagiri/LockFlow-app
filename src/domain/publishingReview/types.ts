/**
 * Publishing Review & Submission Orchestration — domain types.
 *
 * This layer sits on top of Prompt 18's publishing-preparation domain and
 * orchestrates review → submission → per-attempt runs for a CAMPAIGN ITEM.
 * It reuses the authoritative eligibility predicates from the campaigns and
 * publishing domains — the rules are composed here, never redefined.
 *
 * Honesty contracts encoded here:
 *   * Eligibility is computed server-side and returned as STRUCTURED
 *     blockers (never free text), so the UI can render precise, localised
 *     guidance and tests can assert exact codes.
 *   * A publish run snapshots the validation result and the request it was
 *     created from. Runs are immutable except for lifecycle bookkeeping
 *     (status/timestamps/safe error fields); retries create NEW runs with
 *     fresh idempotency keys — a failed run is never mutated into success.
 *   * Only safe, non-sensitive error fields exist on run records.
 *   * No calendar auto-publish: nothing here schedules or triggers a
 *     submission from a planned campaign date. Submission is always an
 *     explicit act.
 */

import type {
  PublishingMetadata,
  PublishingPlacement,
} from '../publishing';

// ── Structured eligibility blockers ─────────────────────────────────────────

/**
 * Machine-readable blockers emitted by the review validator. UI and tests
 * match on the CODE; `messageSafe` is human-readable, honest and free of
 * provider internals.
 */
export type PublishingReviewBlockerCode =
  | 'OUTPUT_NOT_APPROVED'
  | 'OUTPUT_ARCHIVED'
  | 'CAMPAIGN_ITEM_INACTIVE'
  | 'CHANNEL_NOT_ASSIGNED'
  | 'CONNECTION_NOT_FOUND'
  | 'CONNECTION_NEEDS_REAUTH'
  | 'PLACEMENT_UNSUPPORTED'
  | 'REQUIRED_FIELD_MISSING'
  | 'DUPLICATE_SUBMISSION';

export interface PublishingReviewBlocker {
  code: PublishingReviewBlockerCode;
  messageSafe: string;
  /** Which input the blocker is about (output/item/connection/draft field). */
  field?: string;
}

export interface PublishingReviewEligibility {
  eligible: boolean;
  blockers: PublishingReviewBlocker[];
  checkedAt: string;
  /** Snapshot of the inputs the decision was made from (audit + debug). */
  inputs: {
    campaignItemId: string;
    galleryOutputId: string | null;
    workspaceSocialConnectionId: string | null;
    placement: PublishingPlacement | null;
  };
}

// ── Run lifecycle (orchestration-level; complements the draft's machine) ────

export type PublishingReviewRunStatus =
  | 'pending'
  | 'validated'
  | 'submitted'
  | 'accepted'
  | 'published'
  | 'failed'
  | 'cancelled';

export const PUBLISHING_REVIEW_RUN_TRANSITIONS: Record<
  PublishingReviewRunStatus,
  PublishingReviewRunStatus[]
> = {
  pending: ['validated', 'failed', 'cancelled'],
  validated: ['submitted', 'failed', 'cancelled'],
  submitted: ['accepted', 'failed'],
  accepted: ['published', 'failed'],
  published: [],
  failed: [],
  cancelled: [],
};

export function canTransitionReviewRun(
  from: PublishingReviewRunStatus,
  to: PublishingReviewRunStatus,
): boolean {
  return PUBLISHING_REVIEW_RUN_TRANSITIONS[from].includes(to);
}

// ── Records ─────────────────────────────────────────────────────────────────

/** The immutable request snapshot frozen when a run is created. */
export interface PublishingRunRequestSnapshot {
  campaignId: string;
  campaignItemId: string;
  galleryOutputId: string;
  workspaceSocialConnectionId: string;
  providerKey: string;
  placement: PublishingPlacement;
  copy: PublishingMetadata;
}

export interface PublishRunRecord {
  id: string;
  workspaceId: string;
  campaignId: string;
  campaignItemId: string;
  /** Set once the item's publishing draft exists (submission target). */
  publishingDraftId: string | null;
  requestedBy: string;
  status: PublishingReviewRunStatus;
  placement: PublishingPlacement;
  /** Immutable snapshot of the request that created this run. */
  requestSnapshot: PublishingRunRequestSnapshot;
  /** Immutable snapshot of the eligibility decision at run creation. */
  validationSnapshot: {
    eligible: boolean;
    blockers: PublishingReviewBlocker[];
    checkedAt: string;
  } | null;
  /** Draft-scope idempotency intent; unique within the campaign item. */
  idempotencyKey: string;
  attemptNumber: number;
  /** Safe fields only — never provider internals, tokens or raw errors. */
  errorCode: string | null;
  errorMessageSafe: string | null;
  providerPublishId: string | null;
  publishedUrl: string | null;
  publishedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type PublishingReviewAuditEventType =
  | 'review_checked'
  | 'review_blocked'
  | 'review_confirmed'
  | 'run_created'
  | 'run_submitted'
  | 'run_accepted'
  | 'run_published'
  | 'run_failed'
  | 'retry_requested'
  | 'run_cancelled';

export interface PublishingReviewAuditEventRecord {
  id: string;
  workspaceId: string;
  campaignId: string;
  campaignItemId: string;
  publishRunId: string | null;
  actorId: string | null;
  eventType: PublishingReviewAuditEventType;
  message: string;
  metadata: PublishingMetadata;
  createdAt: string;
}

// ── Read models / service payloads ──────────────────────────────────────────

export interface PublishingReviewItemInput {
  campaignItemId: string;
  placement: PublishingPlacement;
  /** Explicit acknowledgement is part of the review checklist. */
  acknowledgement: boolean;
}

export interface CreatePublishingReviewInput {
  campaignId: string;
  items: PublishingReviewItemInput[];
}

export interface PublishingReviewItemReport {
  campaignItemId: string;
  galleryOutputId: string;
  eligibility: PublishingReviewEligibility;
  /** Present when the item already has a submission for this intent. */
  existingRunId: string | null;
}

export interface PublishingReviewReport {
  campaignId: string;
  checkedAt: string;
  items: PublishingReviewItemReport[];
  allEligible: boolean;
}

export interface SubmitPublishRunResult {
  run: PublishRunRecord;
  /** Honest outcome — the provider decides; orchestration never fakes it. */
  outcome:
    | 'accepted'
    | 'processing'
    | 'published'
    | 'failed';
  errorMessageSafe: string | null;
}

/** Payload for executing a created run (capability surface re-check). */
export interface SubmitPublishRunInput {
  /** Provider capability surface (declared, not discovered). */
  capabilities: Pick<
    import('../publishing').ProviderCapabilities,
    'placements'
  >;
}

/** Repository creation payload for a publish run (snapshots included). */
export interface CreatePublishRunInput {
  workspaceId: string;
  campaignId: string;
  campaignItemId: string;
  requestedBy: string;
  placement: PublishingPlacement;
  requestSnapshot: PublishingRunRequestSnapshot;
  validationSnapshot: {
    eligible: boolean;
    blockers: PublishingReviewBlocker[];
    checkedAt: string;
  };
  idempotencyKey: string;
  attemptNumber: number;
  status: PublishingReviewRunStatus;
}

export interface PublishRunStatusView {
  run: PublishRunRecord;
  draftStatus: string | null;
  draftPublishedUrl: string | null;
  draftFailureMessageSafe: string | null;
}
