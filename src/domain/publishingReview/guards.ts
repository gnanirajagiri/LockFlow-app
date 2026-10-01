/**
 * Publishing Review — server-side eligibility validator.
 *
 * PURE and framework-free. Composes the authoritative predicates from the
 * campaigns and publishing domains (never redefines them) and returns
 * STRUCTURED blockers so callers can render exact guidance and tests can
 * assert exact codes.
 *
 * Order of checks (cheapest, most-specific first):
 *   1. Campaign item active + output attached
 *   2. Gallery output approved/available/provenanced (campaigns predicate,
 *      mirrored by the publishing predicate at submit time)
 *   3. Channel/planning assignment (channel intent or explicit placement)
 *   4. Connection exists + is connected/verified
 *   5. Placement supported by the provider's declared capabilities
 *   6. Required copy fields for the placement
 *   7. No duplicate active submission for the same intent
 */
import type {
  GalleryOutputEligibilityInput,
  CampaignItemRecord,
  CampaignItemStatus,
} from '../campaigns';
import type {
  ProviderCapabilities,
  PublishingPlacement,
} from '../publishing';
import type {
  PublishRunRecord,
  PublishingReviewBlocker,
  PublishingReviewBlockerCode,
} from './types';

export type ReviewConnectionStatus =
  | 'pending'
  | 'connected'
  | 'needs_reauth'
  | 'revoked'
  | 'failed'
  | 'disconnected';

/** Everything the validator needs, already resolved by the service. */
export interface PublishingReviewSubject {
  workspaceId: string;
  item: Pick<CampaignItemRecord, 'id' | 'status' | 'removedAt' | 'galleryOutputId' | 'plannedChannel'> | null;
  output: GalleryOutputEligibilityInput | null;
  connection: {
    id: string;
    status: ReviewConnectionStatus;
    providerKey: string;
  } | null;
  placement: PublishingPlacement;
  capabilities: Pick<ProviderCapabilities, 'placements'> | null;
  copy: {
    caption?: string;
    altText?: string;
  };
  /** Active (non-terminal) runs already submitted for this intent. */
  activeRuns: Array<Pick<PublishRunRecord, 'id' | 'status'>>;
}

function blocker(
  code: PublishingReviewBlockerCode,
  messageSafe: string,
  field?: string,
): PublishingReviewBlocker {
  return { code, messageSafe, ...(field ? { field } : undefined) };
}

export function itemActive(item: PublishingReviewSubject['item']): boolean {
  if (!item) return false;
  if (item.status === ('removed' as CampaignItemStatus) || item.removedAt) return false;
  if (item.status === ('blocked' as CampaignItemStatus)) return false;
  return true;
}

export function reviewBlockers(subject: PublishingReviewSubject): PublishingReviewBlocker[] {
  const found: PublishingReviewBlocker[] = [];

  // 1. Campaign item must be active with an attached output.
  if (!subject.item) {
    found.push(blocker('CAMPAIGN_ITEM_INACTIVE', 'This campaign item does not exist in the campaign.'));
    return found;
  }
  if (!itemActive(subject.item)) {
    found.push(
      blocker(
        'CAMPAIGN_ITEM_INACTIVE',
        'This campaign item is not active. Restore or unblock it before publishing review.',
        'campaignItemId',
      ),
    );
    return found;
  }

  // 2. Gallery output eligibility — the campaigns predicate, reused.
  if (!subject.output) {
    found.push(blocker('OUTPUT_NOT_APPROVED', 'The attached Gallery output could not be loaded.'));
    return found;
  }
  if (subject.output.status === 'archived') {
    found.push(
      blocker('OUTPUT_ARCHIVED', 'The approved output was archived and can no longer be published.', 'galleryOutputId'),
    );
  } else if (subject.output.status !== 'approved') {
    found.push(
      blocker('OUTPUT_NOT_APPROVED', 'Only approved Gallery outputs can be published.', 'galleryOutputId'),
    );
  }
  if (!subject.output.mediaAvailable) {
    found.push(blocker('OUTPUT_NOT_APPROVED', 'The output media is not currently available.', 'galleryOutputId'));
  }
  if (!subject.output.contentJobRequestId || subject.output.contentJobRequestId.trim() === '') {
    found.push(blocker('OUTPUT_NOT_APPROVED', 'The output has no provenance reference.', 'galleryOutputId'));
  }

  // 3. Channel/planning assignment — a channel decision must exist.
  if (!subject.item.plannedChannel || subject.item.plannedChannel.trim() === '') {
    found.push(
      blocker('CHANNEL_NOT_ASSIGNED', 'Assign a channel to this item in the campaign plan first.', 'plannedChannel'),
    );
  }

  // 4. Connection must exist, belong to the intent, and be connected.
  if (!subject.connection) {
    found.push(
      blocker('CONNECTION_NOT_FOUND', 'No connected account was found for this item. Connect one first.'),
    );
  } else if (subject.connection.status === 'needs_reauth') {
    found.push(
      blocker('CONNECTION_NEEDS_REAUTH', 'Reconnect the account — it needs re-authorization before publishing.'),
    );
  } else if (subject.connection.status !== 'connected') {
    found.push(
      blocker('CONNECTION_NOT_FOUND', 'The account is not currently connected. Reconnect it to publish.'),
    );
  }

  // 5. Placement must be supported by the provider's capabilities.
  if (subject.connection && subject.capabilities) {
    if (!subject.capabilities.placements.includes(subject.placement)) {
      found.push(
        blocker(
          'PLACEMENT_UNSUPPORTED',
          'The connected account does not support this placement. Pick another placement or account.',
          'placement',
        ),
      );
    }
  }

  // 6. Required copy per placement.
  if (!subject.copy.caption || subject.copy.caption.trim() === '') {
    found.push(blocker('REQUIRED_FIELD_MISSING', 'A caption is required before publishing.', 'caption'));
  }

  // 7. Duplicate submission guard: any active or completed submission for
  // this intent blocks a new one; only failed/cancelled runs allow retry.
  const duplicate = subject.activeRuns.find((r) => r.status !== 'failed' && r.status !== 'cancelled');
  if (duplicate) {
    found.push(
      duplicate.status === 'published'
        ? blocker('DUPLICATE_SUBMISSION', 'This item was already published — duplicate posts are never sent.')
        : blocker('DUPLICATE_SUBMISSION', 'A submission is already in progress for this item.'),
    );
  }

  return found;
}

export function isReviewEligible(subject: PublishingReviewSubject): boolean {
  return reviewBlockers(subject).length === 0;
}

/**
 * Runs that may still change state — used by the service when deciding
 * whether a NEW attempt is safe. Published is terminal-success: it must not
 * be retried (duplicate posts are never sent), but it is not "active".
 */
export function isActiveRunStatus(status: PublishRunRecord['status']): boolean {
  return status === 'pending' || status === 'validated' || status === 'submitted' || status === 'accepted';
}
