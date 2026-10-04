/**
 * Prompt 30 — generated-set approval, selection & campaign handoff.
 *
 * The formal workflow between generation (prompts 27–29) and campaign
 * execution: outputs from a coordinated content set are reviewed as one
 * package, individually approved/rejected/shortlisted, curated into a final
 * selection, and handed off into Campaigns as controlled references — never
 * copies, never Library assets, never untraceable.
 *
 * Workflow states (per output, stored on review rows):
 *   pending_review → approved | rejected
 *   approved → shortlisted (preferred pick) → selected_for_campaign
 *   selected_for_campaign → handed_off (controlled campaign linkage created)
 * Rejected outputs stay inspectable but are excluded from selection defaults
 * and hard-blocked from handoff.
 *
 * Everything is workspace-scoped, server-validated and audited.
 */
import type { GalleryOutputRecord } from '../domain/gallery/types';

// ── Review states ────────────────────────────────────────────────────────────

export type GeneratedOutputReviewStatus =
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | 'shortlisted'
  | 'selected_for_campaign'
  | 'handed_off';

export const GENERATED_OUTPUT_REVIEW_LABELS: Record<GeneratedOutputReviewStatus, string> = {
  pending_review: 'Pending review',
  approved: 'Approved',
  rejected: 'Rejected',
  shortlisted: 'Shortlisted',
  selected_for_campaign: 'Selected for campaign',
  handed_off: 'Handed off',
};

/** Review actions accepted by the service (state transitions are server-decided). */
export type GeneratedOutputReviewAction = 'approve' | 'reject' | 'shortlist' | 'unshortlist' | 'reset';

/** Legal transitions: current status → set of reachable statuses per action. */
const REVIEW_TRANSITIONS: Record<GeneratedOutputReviewAction, GeneratedOutputReviewStatus[]> = {
  approve: ['approved'],
  reject: ['rejected'],
  shortlist: ['shortlisted'],
  unshortlist: ['approved'],
  reset: ['pending_review'],
};

/**
 * Pure transition validator. Only these rules decide whether a review action
 * is legal — the client never decides.
 */
export function canReviewTransition(
  current: GeneratedOutputReviewStatus,
  action: GeneratedOutputReviewAction,
): { allowed: boolean; reason?: string } {
  const [target] = REVIEW_TRANSITIONS[action];
  if (current === target) return { allowed: false, reason: `Output is already ${GENERATED_OUTPUT_REVIEW_LABELS[target]}.` };
  // Handed-off outputs are immutable through review actions — unlink first.
  if (current === 'handed_off') {
    return { allowed: false, reason: 'This output has been handed off to a campaign; remove the campaign link before changing its review state.' };
  }
  // Selected-for-campaign outputs must leave the selection first.
  if (current === 'selected_for_campaign' && action !== 'approve') {
    return { allowed: false, reason: 'This output is selected for a campaign; remove it from the selection before changing its review state.' };
  }
  return { allowed: true };
}

/** Selection eligibility: rejected outputs are out; everything else may be curated. */
export function isSelectable(status: GeneratedOutputReviewStatus): boolean {
  return status !== 'rejected' && status !== 'pending_review';
}

/** Handoff eligibility: only approved-family statuses reach Campaigns. */
export function isHandoffEligible(status: GeneratedOutputReviewStatus): boolean {
  return status === 'approved' || status === 'shortlisted' || status === 'selected_for_campaign';
}

// ── Records ──────────────────────────────────────────────────────────────────

export interface GeneratedOutputReviewRecord {
  id: string;
  workspaceId: string;
  galleryOutputId: string;
  generationJobId: string | null;
  campaignGenerationRunId: string | null;
  reviewStatus: GeneratedOutputReviewStatus;
  reviewNotes: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GeneratedOutputSelectionRecord {
  id: string;
  workspaceId: string;
  campaignGenerationRunId: string | null;
  name: string | null;
  selectionStatus: 'draft' | 'finalized' | 'handed_off';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface GeneratedOutputSelectionItemRecord {
  id: string;
  workspaceId: string;
  selectionId: string;
  galleryOutputId: string;
  selectionRole: string | null;
  outputOrder: number;
  createdAt: string;
}

export interface CampaignOutputLinkRecord {
  id: string;
  workspaceId: string;
  campaignId: string;
  campaignItemId: string | null;
  galleryOutputId: string;
  sourceGenerationJobId: string | null;
  sourceCampaignGenerationRunId: string | null;
  handoffStatus: 'linked';
  linkedBy: string;
  createdAt: string;
  updatedAt: string;
}

// ── Audit vocabulary ─────────────────────────────────────────────────────────

export type GeneratedOutputAuditEvent =
  | 'generated_output_approved'
  | 'generated_output_rejected'
  | 'generated_output_shortlisted'
  | 'generated_output_selection_created'
  | 'generated_output_added_to_selection'
  | 'generated_output_removed_from_selection'
  | 'generated_output_selection_reordered'
  | 'generated_output_handoff_requested'
  | 'generated_output_handed_off_to_campaign'
  | 'generated_output_handoff_blocked';

export interface GeneratedOutputAuditRow {
  id: string;
  workspaceId: string;
  galleryOutputId: string | null;
  event: GeneratedOutputAuditEvent;
  detail: string | null;
  createdAt: string;
}

/** One grouped output in the set-review view. */
export interface SetReviewOutputView {
  galleryOutput: GalleryOutputRecord;
  review: GeneratedOutputReviewRecord;
  /** Story provenance from the prompt-28 grouping metadata (null for images/videos). */
  storyGroupKey: string | null;
  storySequence: number | null;
  storySequenceTotal: number | null;
  storyFrameLabel: string | null;
}
