/**
 * Campaigns domain — types.
 *
 * Campaigns are PLANNING/ORGANISATION records only. They reference approved
 * Gallery outputs (never duplicating or mutating media, job pins or source
 * assets), plan channels/dates for future publishing preparation, and keep an
 * append-only audit history. Social accounts, OAuth and publishing are NOT
 * part of this domain: planned dates are internal planning metadata only.
 */
export type CampaignStatus = 'draft' | 'active' | 'completed' | 'archived';

/** Minimal shape Campaigns reads from a Gallery output for eligibility. */
export interface GalleryOutputEligibilityInput {
  id: string;
  workspaceId: string;
  title: string;
  outputType: 'image' | 'video' | 'story';
  status: 'draft' | 'processing' | 'ready_for_review' | 'approved' | 'rejected' | 'archived' | 'failed';
  /** Historical provenance reference — outputs without a job cannot attach. */
  contentJobRequestId: string;
  /** Media/reference state available (existing safe-preview component decides). */
  mediaAvailable: boolean;
}

export type CampaignChannelKey =
  | 'instagram'
  | 'tiktok'
  | 'youtube'
  | 'facebook'
  | 'linkedin'
  | 'x'
  | 'pinterest'
  | 'website'
  | 'email'
  | 'paid_social'
  | 'other';

export type CampaignChannelIntent = 'organic' | 'paid' | 'both';

export type CampaignItemStatus = 'planned' | 'ready' | 'blocked' | 'removed';

export type CampaignItemFormat =
  | 'feed_post'
  | 'story'
  | 'reel'
  | 'short_video'
  | 'ad_creative'
  | 'website'
  | 'email'
  | 'other';

export type CampaignEventType =
  | 'created'
  | 'updated'
  | 'status_changed'
  | 'channel_added'
  | 'channel_removed'
  | 'item_added'
  | 'item_removed'
  | 'item_updated'
  | 'item_replaced'
  | 'calendar_updated'
  | 'archived'
  | 'restored';

export interface CampaignRecord {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  status: CampaignStatus;
  description: string | null;
  objective: string | null;
  audience: string | null;
  keyMessage: string | null;
  startDate: string | null;
  endDate: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface CampaignChannelRecord {
  id: string;
  campaignId: string;
  channel: CampaignChannelKey;
  intent: CampaignChannelIntent;
  notes: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignItemRecord {
  id: string;
  campaignId: string;
  galleryOutputId: string;
  status: CampaignItemStatus;
  plannedChannel: string | null;
  plannedFormat: CampaignItemFormat | null;
  /** Internal planning date/time only — never an external scheduled post. */
  plannedPublishAt: string | null;
  captionDraft: string | null;
  callToAction: string | null;
  notes: string | null;
  sortOrder: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  removedAt: string | null;
}

export interface CampaignItemVariantRecord {
  id: string;
  campaignItemId: string;
  label: string;
  captionDraft: string | null;
  callToAction: string | null;
  formatOverride: CampaignItemFormat | null;
  plannedChannelOverride: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignEventRecord {
  id: string;
  campaignId: string;
  actorId: string | null;
  eventType: CampaignEventType;
  message: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

// ── Input payloads ──────────────────────────────────────────────────────────

export interface CreateCampaignInput {
  workspaceId: string;
  name: string;
  description?: string;
  objective?: string;
  audience?: string;
  keyMessage?: string;
  startDate?: string;
  endDate?: string;
}

export interface UpdateCampaignInput {
  name?: string;
  description?: string | null;
  objective?: string | null;
  audience?: string | null;
  keyMessage?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}

export interface CreateCampaignChannelInput {
  campaignId: string;
  channel: CampaignChannelKey;
  intent: CampaignChannelIntent;
  notes?: string;
}

export interface UpdateCampaignChannelInput {
  intent?: CampaignChannelIntent;
  notes?: string | null;
}

export interface CreateCampaignItemInput {
  campaignId: string;
  galleryOutputId: string;
  plannedChannel?: string | null;
  plannedFormat?: CampaignItemFormat | null;
  plannedPublishAt?: string | null;
  captionDraft?: string;
  callToAction?: string;
  notes?: string;
}

export interface UpdateCampaignItemInput {
  status?: CampaignItemStatus;
  plannedChannel?: string | null;
  plannedFormat?: CampaignItemFormat | null;
  plannedPublishAt?: string | null;
  captionDraft?: string | null;
  callToAction?: string | null;
  notes?: string | null;
}

export interface CreateCampaignItemVariantInput {
  label: string;
  captionDraft?: string;
  callToAction?: string;
  formatOverride?: CampaignItemFormat | null;
  plannedChannelOverride?: string | null;
  notes?: string;
}

export interface UpdateCampaignItemVariantInput {
  label?: string;
  captionDraft?: string | null;
  callToAction?: string | null;
  formatOverride?: CampaignItemFormat | null;
  plannedChannelOverride?: string | null;
  notes?: string | null;
}
