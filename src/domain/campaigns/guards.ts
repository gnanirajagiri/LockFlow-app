/**
 * Campaigns domain — guard functions.
 *
 * Pure, framework-free and unit-tested. Encodes the campaign status machine,
 * the single authoritative Gallery-eligibility rule and soft-archive rules.
 * Nothing here touches Gallery records, job pins or source assets.
 */
import type {
  CampaignChannelKey,
  CampaignItemRecord,
  CampaignItemStatus,
  CampaignRecord,
  CampaignStatus,
  GalleryOutputEligibilityInput,
} from './types';

export class CampaignStateError extends Error {
  constructor(from: CampaignStatus, to: CampaignStatus) {
    super(`A campaign cannot move from ${from} to ${to}.`);
    this.name = 'CampaignStateError';
  }
}

/**
 * Allowed campaign transitions (product rule):
 *   draft    -> active, archived
 *   active   -> completed, archived
 *   completed-> active, archived
 *   archived -> draft, active, completed only through explicit restore
 */
export const CAMPAIGN_TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  draft: ['active', 'archived'],
  active: ['completed', 'archived'],
  completed: ['active', 'archived'],
  archived: ['draft', 'active', 'completed'],
};

export function canTransitionCampaignStatus(from: CampaignStatus, to: CampaignStatus): boolean {
  return CAMPAIGN_TRANSITIONS[from].includes(to);
}

export function refuseInvalidCampaignTransition(from: CampaignStatus, to: CampaignStatus): void {
  if (!canTransitionCampaignStatus(from, to)) throw new CampaignStateError(from, to);
}

/** Archived campaigns are read-only until explicitly restored. */
export function assertCampaignEditable(campaign: Pick<CampaignRecord, 'status'>): void {
  if (campaign.status === 'archived') {
    throw new Error('This campaign is archived and read-only. Restore it to make changes.');
  }
}

/** Archived campaigns cannot be applied/used for publishing preparation. */
export function assertCampaignActionable(campaign: Pick<CampaignRecord, 'status'>): void {
  assertCampaignEditable(campaign);
}

/** Items can be planned/edited on draft and active campaigns only. */
export function assertCampaignAcceptsItems(campaign: Pick<CampaignRecord, 'status'>): void {
  if (campaign.status !== 'draft' && campaign.status !== 'active') {
    throw new Error(
      `A ${campaign.status} campaign cannot accept content items. Activate it first or restore it.`,
    );
  }
}

/**
 * ── THE authoritative Gallery-eligibility rule ──────────────────────────────
 * Returns true only when the output is same-workspace, approved, not
 * archived, media/reference state available, and carries a valid historical
 * provenance reference (its content job). UI and service both call THIS —
 * the rule is never duplicated.
 */
export function isGalleryOutputEligibleForCampaign(
  output: GalleryOutputEligibilityInput,
  workspaceId: string,
): boolean {
  if (!output || output.workspaceId !== workspaceId) return false;
  if (output.status !== 'approved') return false;
  if (!output.mediaAvailable) return false;
  if (!output.contentJobRequestId || output.contentJobRequestId.trim() === '') return false;
  return true;
}

/** Human-readable reason an output failed eligibility (for honest UI). */
export function galleryEligibilityProblem(
  output: GalleryOutputEligibilityInput,
  workspaceId: string,
): string | null {
  if (!output || output.workspaceId !== workspaceId) {
    return 'This output belongs to a different workspace.';
  }
  if (output.status !== 'approved') {
    return 'Only approved outputs can be added to a campaign.';
  }
  if (!output.mediaAvailable) {
    return 'This output is not currently available.';
  }
  if (!output.contentJobRequestId || output.contentJobRequestId.trim() === '') {
    return 'This output has no provenance reference.';
  }
  return null;
}

/**
 * An attached output that later becomes archived/unavailable surfaces as a
 * BLOCKED item — the historic relation is preserved, future publishing
 * preparation is blocked, and the Gallery record itself is never touched.
 */
export function effectiveItemStatus(
  item: Pick<CampaignItemRecord, 'status' | 'removedAt'>,
  outputStillEligible: boolean,
): CampaignItemStatus {
  if (item.status === 'removed' || item.removedAt) return 'removed';
  if (!outputStillEligible) return 'blocked';
  return item.status;
}

/** Planned dates are internal planning metadata; validate basic sanity only. */
export function planningDateProblem(startDate: string | null, endDate: string | null): string | null {
  if (startDate && endDate && startDate > endDate) {
    return 'Start date must not be after end date.';
  }
  return null;
}

/** Channel catalogue exposed for selectors (no account/connection data). */
export const CAMPAIGN_CHANNEL_KEYS: CampaignChannelKey[] = [
  'instagram',
  'tiktok',
  'youtube',
  'facebook',
  'linkedin',
  'x',
  'pinterest',
  'website',
  'email',
  'paid_social',
  'other',
];
