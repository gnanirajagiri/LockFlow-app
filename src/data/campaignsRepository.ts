/**
 * Campaigns repository contract.
 *
 * UI never calls Supabase directly; it goes through CampaignService, which
 * applies the status machine and eligibility guards, then one of these
 * adapters. Mock (in-memory demo) and Supabase adapters both implement it.
 */
import type {
  CampaignChannelRecord,
  CampaignEventRecord,
  CampaignItemRecord,
  CampaignItemVariantRecord,
  CampaignRecord,
  CreateCampaignChannelInput,
  CreateCampaignInput,
  CreateCampaignItemInput,
  CreateCampaignItemVariantInput,
  UpdateCampaignChannelInput,
  UpdateCampaignInput,
  UpdateCampaignItemInput,
  UpdateCampaignItemVariantInput,
} from '../domain/campaigns';

export interface CampaignSummary {
  campaign: CampaignRecord;
  itemCount: number;
  approvedOutputCount: number;
  blockedCount: number;
  channelCount: number;
  nextPlannedAt: string | null;
  /** Non-removed items planned within the current week (Mon–Sun). */
  plannedItemCountThisWeek: number;
}

export interface CampaignDetail {
  campaign: CampaignRecord;
  channels: CampaignChannelRecord[];
  items: CampaignItemRecord[];
  variants: CampaignItemVariantRecord[];
  events: CampaignEventRecord[];
}

export interface CampaignsRepository {
  // Campaigns
  listCampaigns(workspaceId: string): Promise<CampaignRecord[]>;
  getCampaign(campaignId: string): Promise<CampaignRecord>;
  createCampaign(input: CreateCampaignInput, slug: string, createdBy: string): Promise<CampaignRecord>;
  updateCampaign(campaignId: string, patch: UpdateCampaignInput): Promise<CampaignRecord>;
  updateCampaignStatus(campaignId: string, status: CampaignRecord['status']): Promise<CampaignRecord>;
  campaignSlugExists(workspaceId: string, slug: string, excludeId?: string): Promise<boolean>;

  // Channels (planning targets only — no account data)
  listChannels(campaignId: string): Promise<CampaignChannelRecord[]>;
  createChannel(input: CreateCampaignChannelInput): Promise<CampaignChannelRecord>;
  updateChannel(channelId: string, patch: UpdateCampaignChannelInput): Promise<CampaignChannelRecord>;
  deleteChannel(channelId: string): Promise<void>;
  reorderChannels(campaignId: string, orderedChannelIds: string[]): Promise<void>;

  // Items (references to approved Gallery outputs)
  listItems(campaignId: string): Promise<CampaignItemRecord[]>;
  /** Single-item lookup (workspace scoping enforced by the service). */
  getItem(itemId: string): Promise<CampaignItemRecord | null>;
  createItem(input: CreateCampaignItemInput, sortOrder: number, createdBy: string): Promise<CampaignItemRecord>;
  updateItem(itemId: string, patch: UpdateCampaignItemInput): Promise<CampaignItemRecord>;
  /** Explicit replacement of the attached output — never automatic. */
  replaceItemOutput(itemId: string, galleryOutputId: string): Promise<CampaignItemRecord>;
  removeItem(itemId: string): Promise<CampaignItemRecord>;
  restoreItem(itemId: string): Promise<CampaignItemRecord>;
  reorderItems(campaignId: string, orderedItemIds: string[]): Promise<void>;
  nextItemSortOrder(campaignId: string): Promise<number>;

  // Copy variants (planning text only — never media)
  listVariants(campaignId: string): Promise<CampaignItemVariantRecord[]>;
  listVariantsForItem(itemId: string): Promise<CampaignItemVariantRecord[]>;
  createVariant(itemId: string, input: CreateCampaignItemVariantInput): Promise<CampaignItemVariantRecord>;
  updateVariant(variantId: string, patch: UpdateCampaignItemVariantInput): Promise<CampaignItemVariantRecord>;
  deleteVariant(variantId: string): Promise<void>;

  // Audit events (append-only)
  listEvents(campaignId: string): Promise<CampaignEventRecord[]>;
  appendEvent(event: Omit<CampaignEventRecord, 'id' | 'createdAt'>): Promise<CampaignEventRecord>;
}
