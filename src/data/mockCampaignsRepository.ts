/**
 * In-memory Campaigns repository — mirrors the SQL contract from
 * 20260928170000_campaigns.sql: unique slugs per workspace, unique
 * campaign/channel/intent, deferrable unique item ordering, append-only
 * events. Demo data lives in src/mock/campaignsSeed.ts.
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
import type { CampaignsRepository } from './campaignsRepository';
import { CAMPAIGNS_SEED, CAMPAIGN_CHANNELS_SEED, CAMPAIGN_EVENTS_SEED, CAMPAIGN_ITEMS_SEED, CAMPAIGN_VARIANTS_SEED } from '../mock/campaignsSeed';

function now(): string {
  return new Date().toISOString();
}

let seq = 0;
function uid(prefix: string): string {
  seq += 1;
  return `${prefix}_dev_${Date.now().toString(36)}${seq.toString(36)}`;
}

export class MockCampaignsRepository implements CampaignsRepository {
  private campaigns: CampaignRecord[];
  private channels: CampaignChannelRecord[];
  private items: CampaignItemRecord[];
  private variants: CampaignItemVariantRecord[];
  private events: CampaignEventRecord[];

  constructor() {
    this.campaigns = CAMPAIGNS_SEED.map((c) => ({ ...c }));
    this.channels = CAMPAIGN_CHANNELS_SEED.map((c) => ({ ...c }));
    this.items = CAMPAIGN_ITEMS_SEED.map((i) => ({ ...i }));
    this.variants = CAMPAIGN_VARIANTS_SEED.map((v) => ({ ...v }));
    this.events = CAMPAIGN_EVENTS_SEED.map((e) => ({ ...e, metadata: { ...e.metadata } }));
  }

  // ── Campaigns ──────────────────────────────────────────────────────────────

  async listCampaigns(workspaceId: string): Promise<CampaignRecord[]> {
    return this.campaigns
      .filter((c) => c.workspaceId === workspaceId)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  async getCampaign(campaignId: string): Promise<CampaignRecord> {
    const campaign = this.campaigns.find((c) => c.id === campaignId);
    if (!campaign) throw new Error(`Campaign ${campaignId} not found.`);
    return { ...campaign };
  }

  async createCampaign(
    input: CreateCampaignInput,
    slug: string,
    createdBy: string,
  ): Promise<CampaignRecord> {
    if (await this.campaignSlugExists(input.workspaceId, slug)) {
      throw new Error('A campaign with this slug already exists in the workspace.');
    }
    const record: CampaignRecord = {
      id: uid('campaign'),
      workspaceId: input.workspaceId,
      name: input.name,
      slug,
      status: 'draft',
      description: input.description ?? null,
      objective: input.objective ?? null,
      audience: input.audience ?? null,
      keyMessage: input.keyMessage ?? null,
      startDate: input.startDate ?? null,
      endDate: input.endDate ?? null,
      createdBy,
      createdAt: now(),
      updatedAt: now(),
      archivedAt: null,
    };
    this.campaigns.unshift(record);
    return { ...record };
  }

  async updateCampaign(campaignId: string, patch: UpdateCampaignInput): Promise<CampaignRecord> {
    const campaign = await this.getCampaign(campaignId);
    const next: CampaignRecord = {
      ...campaign,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.objective !== undefined ? { objective: patch.objective } : {}),
      ...(patch.audience !== undefined ? { audience: patch.audience } : {}),
      ...(patch.keyMessage !== undefined ? { keyMessage: patch.keyMessage } : {}),
      ...(patch.startDate !== undefined ? { startDate: patch.startDate } : {}),
      ...(patch.endDate !== undefined ? { endDate: patch.endDate } : {}),
      updatedAt: now(),
    };
    if (next.startDate && next.endDate && next.startDate > next.endDate) {
      throw new Error('Start date must not be after end date.');
    }
    this.campaigns = this.campaigns.map((c) => (c.id === campaignId ? next : c));
    return { ...next };
  }

  async updateCampaignStatus(
    campaignId: string,
    status: CampaignRecord['status'],
  ): Promise<CampaignRecord> {
    const campaign = await this.getCampaign(campaignId);
    const next: CampaignRecord = {
      ...campaign,
      status,
      archivedAt: status === 'archived' ? (campaign.archivedAt ?? now()) : null,
      updatedAt: now(),
    };
    this.campaigns = this.campaigns.map((c) => (c.id === campaignId ? next : c));
    return { ...next };
  }

  async campaignSlugExists(workspaceId: string, slug: string, excludeId?: string): Promise<boolean> {
    return this.campaigns.some(
      (c) => c.workspaceId === workspaceId && c.slug === slug && c.id !== excludeId,
    );
  }

  // ── Channels ───────────────────────────────────────────────────────────────

  async listChannels(campaignId: string): Promise<CampaignChannelRecord[]> {
    return this.channels
      .filter((ch) => ch.campaignId === campaignId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async createChannel(input: CreateCampaignChannelInput): Promise<CampaignChannelRecord> {
    const existing = await this.listChannels(input.campaignId);
    if (existing.some((ch) => ch.channel === input.channel && ch.intent === input.intent)) {
      throw new Error('This channel and intent combination is already planned for the campaign.');
    }
    const record: CampaignChannelRecord = {
      id: uid('cchannel'),
      campaignId: input.campaignId,
      channel: input.channel,
      intent: input.intent,
      notes: input.notes ?? null,
      sortOrder: existing.length,
      createdAt: now(),
      updatedAt: now(),
    };
    this.channels.push(record);
    return { ...record };
  }

  async updateChannel(channelId: string, patch: UpdateCampaignChannelInput): Promise<CampaignChannelRecord> {
    const channel = this.channels.find((ch) => ch.id === channelId);
    if (!channel) throw new Error(`Channel ${channelId} not found.`);
    const next: CampaignChannelRecord = {
      ...channel,
      ...(patch.intent !== undefined ? { intent: patch.intent } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      updatedAt: now(),
    };
    if (
      this.channels.some(
        (ch) =>
          ch.id !== channelId &&
          ch.campaignId === channel.campaignId &&
          ch.channel === next.channel &&
          ch.intent === next.intent,
      )
    ) {
      throw new Error('This channel and intent combination is already planned for the campaign.');
    }
    this.channels = this.channels.map((ch) => (ch.id === channelId ? next : ch));
    return { ...next };
  }

  async deleteChannel(channelId: string): Promise<void> {
    this.channels = this.channels.filter((ch) => ch.id !== channelId);
  }

  async reorderChannels(campaignId: string, orderedChannelIds: string[]): Promise<void> {
    const order = new Map(orderedChannelIds.map((id, index) => [id, index]));
    this.channels = this.channels.map((ch) =>
      ch.campaignId === campaignId && order.has(ch.id)
        ? { ...ch, sortOrder: order.get(ch.id) as number, updatedAt: now() }
        : ch,
    );
  }

  // ── Items ──────────────────────────────────────────────────────────────────

  async listItems(campaignId: string): Promise<CampaignItemRecord[]> {
    return this.items
      .filter((i) => i.campaignId === campaignId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async createItem(
    input: CreateCampaignItemInput,
    sortOrder: number,
    createdBy: string,
  ): Promise<CampaignItemRecord> {
    const record: CampaignItemRecord = {
      id: uid('citem'),
      campaignId: input.campaignId,
      galleryOutputId: input.galleryOutputId,
      status: 'planned',
      plannedChannel: input.plannedChannel ?? null,
      plannedFormat: input.plannedFormat ?? null,
      plannedPublishAt: input.plannedPublishAt ?? null,
      captionDraft: input.captionDraft ?? null,
      callToAction: input.callToAction ?? null,
      notes: input.notes ?? null,
      sortOrder,
      createdBy,
      createdAt: now(),
      updatedAt: now(),
      removedAt: null,
      plannedTimezone: input.plannedTimezone ?? null,
      planningStatus: input.planningStatus ?? null,
    };
    this.items.push(record);
    return { ...record };
  }

  async getItem(itemId: string): Promise<CampaignItemRecord | null> {
    const found = this.items.find((i) => i.id === itemId);
    return found ? { ...found } : null;
  }

  async updateItem(itemId: string, patch: UpdateCampaignItemInput): Promise<CampaignItemRecord> {
    const item = this.items.find((i) => i.id === itemId);
    if (!item) throw new Error(`Campaign item ${itemId} not found.`);
    const next: CampaignItemRecord = {
      ...item,
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.plannedChannel !== undefined ? { plannedChannel: patch.plannedChannel } : {}),
      ...(patch.plannedFormat !== undefined ? { plannedFormat: patch.plannedFormat } : {}),
      ...(patch.plannedPublishAt !== undefined ? { plannedPublishAt: patch.plannedPublishAt } : {}),
      ...(patch.captionDraft !== undefined ? { captionDraft: patch.captionDraft } : {}),
      ...(patch.callToAction !== undefined ? { callToAction: patch.callToAction } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      ...(patch.plannedTimezone !== undefined ? { plannedTimezone: patch.plannedTimezone } : {}),
      ...(patch.planningStatus !== undefined ? { planningStatus: patch.planningStatus } : {}),
      updatedAt: now(),
    };
    this.items = this.items.map((i) => (i.id === itemId ? next : i));
    return { ...next };
  }

  async replaceItemOutput(itemId: string, galleryOutputId: string): Promise<CampaignItemRecord> {
    const item = this.items.find((i) => i.id === itemId);
    if (!item) throw new Error(`Campaign item ${itemId} not found.`);
    const next: CampaignItemRecord = {
      ...item,
      galleryOutputId,
      status: 'planned',
      removedAt: null,
      updatedAt: now(),
    };
    this.items = this.items.map((i) => (i.id === itemId ? next : i));
    return { ...next };
  }

  async removeItem(itemId: string): Promise<CampaignItemRecord> {
    const item = this.items.find((i) => i.id === itemId);
    if (!item) throw new Error(`Campaign item ${itemId} not found.`);
    const next: CampaignItemRecord = { ...item, status: 'removed', removedAt: now(), updatedAt: now() };
    this.items = this.items.map((i) => (i.id === itemId ? next : i));
    return { ...next };
  }

  async restoreItem(itemId: string): Promise<CampaignItemRecord> {
    const item = this.items.find((i) => i.id === itemId);
    if (!item) throw new Error(`Campaign item ${itemId} not found.`);
    const next: CampaignItemRecord = { ...item, status: 'planned', removedAt: null, updatedAt: now() };
    this.items = this.items.map((i) => (i.id === itemId ? next : i));
    return { ...next };
  }

  async reorderItems(campaignId: string, orderedItemIds: string[]): Promise<void> {
    const order = new Map(orderedItemIds.map((id, index) => [id, index]));
    this.items = this.items.map((i) =>
      i.campaignId === campaignId && order.has(i.id)
        ? { ...i, sortOrder: order.get(i.id) as number, updatedAt: now() }
        : i,
    );
  }

  async nextItemSortOrder(campaignId: string): Promise<number> {
    const items = await this.listItems(campaignId);
    return items.length === 0 ? 0 : Math.max(...items.map((i) => i.sortOrder)) + 1;
  }

  // ── Variants ───────────────────────────────────────────────────────────────

  async listVariants(campaignId: string): Promise<CampaignItemVariantRecord[]> {
    const itemIds = new Set(this.items.filter((i) => i.campaignId === campaignId).map((i) => i.id));
    return this.variants.filter((v) => itemIds.has(v.campaignItemId));
  }

  async listVariantsForItem(itemId: string): Promise<CampaignItemVariantRecord[]> {
    return this.variants.filter((v) => v.campaignItemId === itemId);
  }

  async createVariant(
    itemId: string,
    input: CreateCampaignItemVariantInput,
  ): Promise<CampaignItemVariantRecord> {
    const record: CampaignItemVariantRecord = {
      id: uid('cvariant'),
      campaignItemId: itemId,
      label: input.label,
      captionDraft: input.captionDraft ?? null,
      callToAction: input.callToAction ?? null,
      formatOverride: input.formatOverride ?? null,
      plannedChannelOverride: input.plannedChannelOverride ?? null,
      notes: input.notes ?? null,
      createdAt: now(),
      updatedAt: now(),
    };
    this.variants.push(record);
    return { ...record };
  }

  async updateVariant(
    variantId: string,
    patch: UpdateCampaignItemVariantInput,
  ): Promise<CampaignItemVariantRecord> {
    const variant = this.variants.find((v) => v.id === variantId);
    if (!variant) throw new Error(`Variant ${variantId} not found.`);
    const next: CampaignItemVariantRecord = {
      ...variant,
      ...(patch.label !== undefined ? { label: patch.label } : {}),
      ...(patch.captionDraft !== undefined ? { captionDraft: patch.captionDraft } : {}),
      ...(patch.callToAction !== undefined ? { callToAction: patch.callToAction } : {}),
      ...(patch.formatOverride !== undefined ? { formatOverride: patch.formatOverride } : {}),
      ...(patch.plannedChannelOverride !== undefined
        ? { plannedChannelOverride: patch.plannedChannelOverride }
        : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      updatedAt: now(),
    };
    this.variants = this.variants.map((v) => (v.id === variantId ? next : v));
    return { ...next };
  }

  async deleteVariant(variantId: string): Promise<void> {
    this.variants = this.variants.filter((v) => v.id !== variantId);
  }

  // ── Events (append-only) ───────────────────────────────────────────────────

  async listEvents(campaignId: string): Promise<CampaignEventRecord[]> {
    return this.events
      .filter((e) => e.campaignId === campaignId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  async appendEvent(event: Omit<CampaignEventRecord, 'id' | 'createdAt'>): Promise<CampaignEventRecord> {
    const record: CampaignEventRecord = {
      ...event,
      metadata: { ...event.metadata },
      id: uid('cevent'),
      createdAt: now(),
    };
    this.events.push(record);
    return { ...record };
  }
}
