/**
 * Campaigns service layer.
 *
 * The single entry point the UI uses for Campaigns. Campaigns ORGANISE
 * content; they never own source assets and never touch Gallery records:
 * every Gallery interaction is a read through the injected GalleryService
 * bridge, filtered by the one authoritative eligibility helper
 * (isGalleryOutputEligibleForCampaign). No OAuth, no publishing APIs, no
 * scheduled workers — planned dates are internal planning metadata only.
 */
import type {
  CampaignChannelRecord,
  CampaignEventRecord,
  CampaignItemRecord,
  CampaignItemStatus,
  CampaignItemVariantRecord,
  CampaignRecord,
  CampaignStatus,
  GalleryOutputEligibilityInput,
} from '../domain/campaigns';
import {
  assertCampaignAcceptsItems,
  assertCampaignEditable,
  canTransitionCampaignStatus,
  effectiveItemStatus,
  galleryEligibilityProblem,
  isGalleryOutputEligibleForCampaign,
  slugify as _slugify,
  validateCreateCampaign,
  validateCreateCampaignChannel,
  validateCreateCampaignItem,
  validateCreateItemVariant,
  validateReorder,
  validateUpdateCampaign,
  validateUpdateCampaignChannel,
  validateUpdateCampaignItem,
  validateUpdateItemVariant,
} from '../domain/campaigns';
import type { CampaignsRepository, CampaignDetail, CampaignSummary } from '../data/campaignsRepository';
import type { GalleryService } from './galleryService';

export interface CampaignGallerySummary {
  output: GalleryOutputEligibilityInput;
  title: string;
}

function isInWorkspace(recordWorkspaceId: string, activeWorkspaceId: string): void {
  if (recordWorkspaceId !== activeWorkspaceId) {
    throw new Error('This record belongs to a different workspace.');
  }
}

function invalid(message: string): never {
  throw new Error(message);
}

/** Local-time Monday–Sunday bounds for the "planned items this week" stat. */
function currentWeekRange(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); // Monday
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start: start.toISOString(), end: end.toISOString() };
}

export class CampaignsService {
  constructor(
    private readonly repo: CampaignsRepository,
    /** Read-only Gallery bridge — Campaigns never write through this. */
    private readonly gallery: Pick<GalleryService, 'listOutputs' | 'getOutput'>,
  ) {}

  // ── Campaigns ──────────────────────────────────────────────────────────────

  async listCampaigns(workspaceId: string): Promise<CampaignSummary[]> {
    const campaigns = await this.repo.listCampaigns(workspaceId);
    return Promise.all(
      campaigns.map(async (campaign) => {
        const [channels, items] = await Promise.all([
          this.repo.listChannels(campaign.id),
          this.repo.listItems(campaign.id),
        ]);
        const eligibleOutputs = await this.resolveItemOutputs(workspaceId, items);
        let blockedCount = 0;
        let nextPlannedAt: string | null = null;
        let plannedItemCountThisWeek = 0;
        const week = currentWeekRange();
        for (const item of items) {
          if (item.status === 'removed' || item.removedAt) continue;
          if (
            effectiveItemStatus(
              item,
              isStillEligible(eligibleOutputs, item.galleryOutputId, workspaceId),
            ) === 'blocked'
          ) {
            blockedCount += 1;
          }
          if (item.plannedPublishAt) {
            if (nextPlannedAt === null || item.plannedPublishAt < nextPlannedAt) {
              nextPlannedAt = item.plannedPublishAt;
            }
            if (item.plannedPublishAt >= week.start && item.plannedPublishAt < week.end) {
              plannedItemCountThisWeek += 1;
            }
          }
        }
        return {
          campaign,
          itemCount: items.filter((i) => i.status !== 'removed' && !i.removedAt).length,
          approvedOutputCount: items.filter(
            (i) =>
              i.status !== 'removed' &&
              !i.removedAt &&
              isStillEligible(eligibleOutputs, i.galleryOutputId, workspaceId),
          ).length,
          blockedCount,
          channelCount: channels.length,
          nextPlannedAt,
          plannedItemCountThisWeek,
        };
      }),
    );
  }

  async getCampaign(campaignId: string, activeWorkspaceId: string): Promise<CampaignRecord> {
    const campaign = await this.repo.getCampaign(campaignId);
    isInWorkspace(campaign.workspaceId, activeWorkspaceId);
    return campaign;
  }

  async getCampaignDetail(
    campaignId: string,
    activeWorkspaceId: string,
  ): Promise<CampaignDetail & { itemsWithOutputs: CampaignItemWithOutput[] }> {
    const campaign = await this.getCampaign(campaignId, activeWorkspaceId);
    const [channels, items, variants, events] = await Promise.all([
      this.repo.listChannels(campaignId),
      this.repo.listItems(campaignId),
      this.repo.listVariants(campaignId),
      this.repo.listEvents(campaignId),
    ]);
    const itemMap = await this.resolveItemOutputs(activeWorkspaceId, items);
    const itemsWithOutputs = items.map((item) => ({
      item,
      effectiveStatus: effectiveItemStatus(
        item,
        isStillEligible(itemMap, item.galleryOutputId, activeWorkspaceId),
      ) as CampaignItemStatus,
      output: itemMap.get(item.galleryOutputId) ?? null,
    }));
    return { campaign, channels, items, variants, events, itemsWithOutputs };
  }

  async createCampaign(input: unknown, createdBy: string): Promise<CampaignRecord> {
    const result = validateCreateCampaign(input);
    if (!result.ok) return invalid(`Invalid campaign: ${result.errors.join('; ')}`);
    const value = result.value;
    const slug = _slugify(value.name);
    const campaign = await this.repo.createCampaign(value, slug, createdBy);
    await this.appendEvent(campaign.id, 'created', `Campaign created: ${campaign.name}.`, {
      name: campaign.name,
    });
    return campaign;
  }

  async updateCampaign(
    campaignId: string,
    patch: unknown,
    activeWorkspaceId: string,
  ): Promise<CampaignRecord> {
    const campaign = await this.getCampaign(campaignId, activeWorkspaceId);
    assertCampaignEditable(campaign);
    const result = validateUpdateCampaign(patch);
    if (!result.ok) return invalid(`Invalid campaign update: ${result.errors.join('; ')}`);
    const updated = await this.repo.updateCampaign(campaignId, result.value);
    await this.appendEvent(campaignId, 'updated', 'Campaign details updated.', {
      fields: Object.keys(result.value).join(','),
    });
    return updated;
  }

  async changeCampaignStatus(
    campaignId: string,
    to: CampaignStatus,
    activeWorkspaceId: string,
  ): Promise<CampaignRecord> {
    const campaign = await this.getCampaign(campaignId, activeWorkspaceId);
    if (!canTransitionCampaignStatus(campaign.status, to)) {
      return invalid(`A campaign cannot move from ${campaign.status} to ${to}.`);
    }
    const updated = await this.repo.updateCampaignStatus(campaignId, to);
    const eventType = to === 'archived' ? 'archived' : to === 'draft' && campaign.status === 'archived'
      ? 'restored'
      : 'status_changed';
    await this.appendEvent(
      campaignId,
      eventType,
      to === 'archived'
        ? 'Campaign archived. It is read-only until restored.'
        : `Status moved from ${campaign.status} to ${to}.`,
      { from: campaign.status, to },
    );
    return updated;
  }

  /** Explicit restore from archive (guard treats archived → draft/active/completed). */
  async restoreCampaign(campaignId: string, to: CampaignStatus, activeWorkspaceId: string): Promise<CampaignRecord> {
    return this.changeCampaignStatus(campaignId, to, activeWorkspaceId);
  }

  // ── Channels ───────────────────────────────────────────────────────────────

  async listChannels(campaignId: string, activeWorkspaceId: string): Promise<CampaignChannelRecord[]> {
    await this.getCampaign(campaignId, activeWorkspaceId);
    return this.repo.listChannels(campaignId);
  }

  async addChannel(input: unknown, activeWorkspaceId: string): Promise<CampaignChannelRecord> {
    const result = validateCreateCampaignChannel(input);
    if (!result.ok) return invalid(`Invalid channel: ${result.errors.join('; ')}`);
    const campaign = await this.getCampaign(result.value.campaignId, activeWorkspaceId);
    assertCampaignEditable(campaign);
    const channel = await this.repo.createChannel(result.value);
    await this.appendEvent(
      channel.campaignId,
      'channel_added',
      `Channel added: ${labelForChannel(channel.channel)} (${channel.intent}).`,
      { channel: channel.channel, intent: channel.intent },
    );
    return channel;
  }

  async updateChannel(
    channelId: string,
    campaignId: string,
    patch: unknown,
    activeWorkspaceId: string,
  ): Promise<CampaignChannelRecord> {
    await this.getCampaign(campaignId, activeWorkspaceId);
    assertCampaignEditable(await this.getCampaign(campaignId, activeWorkspaceId));
    const result = validateUpdateCampaignChannel(patch);
    if (!result.ok) return invalid(`Invalid channel update: ${result.errors.join('; ')}`);
    const updated = await this.repo.updateChannel(channelId, result.value);
    await this.appendEvent(campaignId, 'channel_updated' as never, 'Channel plan updated.', {
      channelId,
    });
    return updated;
  }

  async removeChannel(channelId: string, campaignId: string, activeWorkspaceId: string): Promise<void> {
    await this.getCampaign(campaignId, activeWorkspaceId);
    assertCampaignEditable(await this.getCampaign(campaignId, activeWorkspaceId));
    const channels = await this.repo.listChannels(campaignId);
    const channel = channels.find((ch) => ch.id === channelId);
    if (!channel) return invalid('Channel not found in this campaign.');
    await this.repo.deleteChannel(channelId);
    await this.appendEvent(
      campaignId,
      'channel_removed',
      `Channel removed: ${labelForChannel(channel.channel)} (${channel.intent}).`,
      { channel: channel.channel },
    );
  }

  async reorderChannels(
    campaignId: string,
    orderedChannelIds: unknown,
    activeWorkspaceId: string,
  ): Promise<void> {
    await this.getCampaign(campaignId, activeWorkspaceId);
    assertCampaignEditable(await this.getCampaign(campaignId, activeWorkspaceId));
    const channels = await this.repo.listChannels(campaignId);
    const result = validateReorder(orderedChannelIds, channels.map((ch) => ch.id));
    if (!result.ok) return invalid(`Invalid channel order: ${result.errors.join('; ')}`);
    await this.repo.reorderChannels(campaignId, result.value);
  }

  // ── Approved Gallery outputs ───────────────────────────────────────────────

  /**
   * Eligible approved outputs for attachment — the ONLY selection source.
   * Delegates every verdict to isGalleryOutputEligibleForCampaign.
   */
  async listEligibleOutputs(
    workspaceId: string,
    filters: { search?: string; outputType?: GalleryOutputEligibilityInput['outputType']; contentProjectId?: string } = {},
  ): Promise<CampaignGallerySummary[]> {
    const outputs = await this.gallery.listOutputs(workspaceId, {
      outputType: filters.outputType,
      status: 'approved',
      contentProjectId: filters.contentProjectId,
      search: filters.search,
    });
    return outputs
      .filter((output) =>
        isGalleryOutputEligibleForCampaign(
          {
            id: output.id,
            workspaceId: output.workspaceId,
            title: output.title,
            outputType: output.outputType,
            status: output.status,
            contentJobRequestId: output.contentJobRequestId,
            mediaAvailable: output.mediaStoragePath !== null || output.thumbnailStoragePath !== null,
          },
          workspaceId,
        ),
      )
      .map((output) => ({ output: toEligibilityInput(output), title: output.title }));
  }

  // ── Items ──────────────────────────────────────────────────────────────────

  async addItem(input: unknown, createdBy: string, activeWorkspaceId: string): Promise<CampaignItemRecord> {
    const result = validateCreateCampaignItem(input);
    if (!result.ok) return invalid(`Invalid campaign item: ${result.errors.join('; ')}`);
    const value = result.value;
    const campaign = await this.getCampaign(value.campaignId, activeWorkspaceId);
    assertCampaignAcceptsItems(campaign);

    // Attach-time eligibility: approved + same workspace + available + provenance.
    const output = await this.gallery.getOutput(value.galleryOutputId, activeWorkspaceId);
    const problem = galleryEligibilityProblem(toEligibilityInput(output), campaign.workspaceId);
    if (problem) return invalid(problem);

    if (value.plannedChannel) {
      await this.assertChannelPlanned(campaign.id, value.plannedChannel);
    }

    const sortOrder = await this.repo.nextItemSortOrder(campaign.id);
    const item = await this.repo.createItem(value, sortOrder, createdBy);
    await this.appendEvent(
      campaign.id,
      'item_added',
      `Approved content added: ${output.title}.`,
      { galleryOutputId: output.id, title: output.title },
    );
    return item;
  }

  async updateItem(
    itemId: string,
    campaignId: string,
    patch: unknown,
    activeWorkspaceId: string,
  ): Promise<CampaignItemRecord> {
    const campaign = await this.getCampaign(campaignId, activeWorkspaceId);
    assertCampaignEditable(campaign);
    const items = await this.repo.listItems(campaignId);
    const item = items.find((i) => i.id === itemId);
    if (!item) return invalid('Campaign item not found.');
    const result = validateUpdateCampaignItem(patch);
    if (!result.ok) return invalid(`Invalid item update: ${result.errors.join('; ')}`);
    if (result.value.plannedChannel) {
      await this.assertChannelPlanned(campaignId, result.value.plannedChannel);
    }
    const updated = await this.repo.updateItem(itemId, result.value);
    await this.appendEvent(campaignId, 'item_updated', 'Campaign item plan updated.', { itemId });
    return updated;
  }

  /** Explicit replacement — never automatic, never a "newer version" picker. */
  async replaceItemOutput(
    itemId: string,
    campaignId: string,
    galleryOutputId: string,
    activeWorkspaceId: string,
  ): Promise<CampaignItemRecord> {
    const campaign = await this.getCampaign(campaignId, activeWorkspaceId);
    assertCampaignEditable(campaign);
    const items = await this.repo.listItems(campaignId);
    const item = items.find((i) => i.id === itemId);
    if (!item) return invalid('Campaign item not found.');
    if (item.galleryOutputId === galleryOutputId) {
      return invalid('Choose a different approved output to replace this item.');
    }
    const output = await this.gallery.getOutput(galleryOutputId, activeWorkspaceId);
    const problem = galleryEligibilityProblem(toEligibilityInput(output), campaign.workspaceId);
    if (problem) return invalid(problem);
    const replaced = await this.repo.replaceItemOutput(itemId, galleryOutputId);
    await this.appendEvent(
      campaignId,
      'item_replaced',
      `Item now uses approved output: ${output.title}. The previous Gallery output remains unchanged.`,
      { itemId, fromGalleryOutputId: item.galleryOutputId, toGalleryOutputId: galleryOutputId },
    );
    return replaced;
  }

  async removeItem(itemId: string, campaignId: string, activeWorkspaceId: string): Promise<CampaignItemRecord> {
    await this.getCampaign(campaignId, activeWorkspaceId);
    assertCampaignEditable(await this.getCampaign(campaignId, activeWorkspaceId));
    const removed = await this.repo.removeItem(itemId);
    await this.appendEvent(campaignId, 'item_removed', 'Campaign item removed.', {
      itemId,
      galleryOutputId: removed.galleryOutputId,
    });
    return removed;
  }

  async restoreItem(itemId: string, campaignId: string, activeWorkspaceId: string): Promise<CampaignItemRecord> {
    await this.getCampaign(campaignId, activeWorkspaceId);
    assertCampaignEditable(await this.getCampaign(campaignId, activeWorkspaceId));
    const restored = await this.repo.restoreItem(itemId);
    await this.appendEvent(campaignId, 'item_added', 'Campaign item restored.', {
      itemId,
      galleryOutputId: restored.galleryOutputId,
    });
    return restored;
  }

  async reorderItems(
    campaignId: string,
    orderedItemIds: unknown,
    activeWorkspaceId: string,
  ): Promise<void> {
    await this.getCampaign(campaignId, activeWorkspaceId);
    assertCampaignEditable(await this.getCampaign(campaignId, activeWorkspaceId));
    const items = await this.repo.listItems(campaignId);
    const result = validateReorder(orderedItemIds, items.map((i) => i.id));
    if (!result.ok) return invalid(`Invalid item order: ${result.errors.join('; ')}`);
    await this.repo.reorderItems(campaignId, result.value);
  }

  /** Calendar updates touch ONLY the item's planning date. */
  async updateItemPlannedDate(
    itemId: string,
    campaignId: string,
    plannedPublishAt: string | null,
    activeWorkspaceId: string,
  ): Promise<CampaignItemRecord> {
    const campaign = await this.getCampaign(campaignId, activeWorkspaceId);
    assertCampaignEditable(campaign);
    const updated = await this.repo.updateItem(itemId, { plannedPublishAt });
    await this.appendEvent(
      campaignId,
      'calendar_updated',
      plannedPublishAt
        ? 'Planned date updated (internal campaign planning only).'
        : 'Planned date cleared.',
      { itemId },
    );
    return updated;
  }

  // ── Copy variants (planning text only — never media) ──────────────────────

  async listVariants(campaignId: string, activeWorkspaceId: string): Promise<CampaignItemVariantRecord[]> {
    await this.getCampaign(campaignId, activeWorkspaceId);
    return this.repo.listVariants(campaignId);
  }

  async addVariant(
    itemId: string,
    campaignId: string,
    input: unknown,
    activeWorkspaceId: string,
  ): Promise<CampaignItemVariantRecord> {
    const campaign = await this.getCampaign(campaignId, activeWorkspaceId);
    assertCampaignEditable(campaign);
    const items = await this.repo.listItems(campaignId);
    const item = items.find((i) => i.id === itemId);
    if (!item || item.status === 'removed' || item.removedAt) {
      return invalid('Variants can only be added to active campaign items.');
    }
    const result = validateCreateItemVariant(input);
    if (!result.ok) return invalid(`Invalid variant: ${result.errors.join('; ')}`);
    const variant = await this.repo.createVariant(itemId, result.value);
    await this.appendEvent(campaignId, 'item_updated', `Copy variant added: ${variant.label}.`, {
      itemId,
      variantId: variant.id,
    });
    return variant;
  }

  async updateVariant(
    variantId: string,
    campaignId: string,
    patch: unknown,
    activeWorkspaceId: string,
  ): Promise<CampaignItemVariantRecord> {
    await this.getCampaign(campaignId, activeWorkspaceId);
    assertCampaignEditable(await this.getCampaign(campaignId, activeWorkspaceId));
    const result = validateUpdateItemVariant(patch);
    if (!result.ok) return invalid(`Invalid variant update: ${result.errors.join('; ')}`);
    const updated = await this.repo.updateVariant(variantId, result.value);
    await this.appendEvent(campaignId, 'item_updated', 'Copy variant updated.', { variantId });
    return updated;
  }

  async deleteVariant(variantId: string, campaignId: string, activeWorkspaceId: string): Promise<void> {
    await this.getCampaign(campaignId, activeWorkspaceId);
    assertCampaignEditable(await this.getCampaign(campaignId, activeWorkspaceId));
    await this.repo.deleteVariant(variantId);
    await this.appendEvent(campaignId, 'item_updated', 'Copy variant removed.', { variantId });
  }

  // ── Events ─────────────────────────────────────────────────────────────────

  async listEvents(campaignId: string, activeWorkspaceId: string): Promise<CampaignEventRecord[]> {
    await this.getCampaign(campaignId, activeWorkspaceId);
    return this.repo.listEvents(campaignId);
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  /** Resolves which attached outputs are STILL eligible (drives blocked state). */
  private async resolveItemOutputs(
    workspaceId: string,
    items: CampaignItemRecord[],
  ): Promise<Map<string, GalleryOutputEligibilityInput>> {
    const active = items.filter((i) => i.status !== 'removed' && !i.removedAt);
    const map = new Map<string, GalleryOutputEligibilityInput>();
    for (const item of active) {
      if (map.has(item.galleryOutputId)) continue;
      try {
        const output = await this.gallery.getOutput(item.galleryOutputId, workspaceId);
        map.set(output.id, toEligibilityInput(output));
      } catch {
        // Cross-workspace or missing output: leave unmapped → renders blocked.
      }
    }
    return map;
  }

  private async assertChannelPlanned(campaignId: string, channelKey: string): Promise<void> {
    const channels = await this.repo.listChannels(campaignId);
    if (!channels.some((ch) => ch.channel === channelKey)) {
      return invalid('Planned channel must be one of the campaign channels.');
    }
  }

  private appendEvent(
    campaignId: string,
    eventType: CampaignEventRecord['eventType'],
    message: string,
    metadata: Record<string, string | number | boolean>,
  ): Promise<CampaignEventRecord> {
    return this.repo.appendEvent({ campaignId, actorId: null, eventType, message, metadata });
  }
}

export interface CampaignItemWithOutput {
  item: CampaignItemRecord;
  effectiveStatus: CampaignItemStatus;
  output: GalleryOutputEligibilityInput | null;
}

/**
 * Re-evaluates a fetched output through the one authoritative eligibility
 * rule. Fetchability alone is not enough — an output archived after
 * attachment must flip its campaign item to blocked via this read-model
 * check, never via a write to Gallery.
 */
function isStillEligible(
  outputs: Map<string, GalleryOutputEligibilityInput>,
  galleryOutputId: string,
  workspaceId: string,
): boolean {
  const output = outputs.get(galleryOutputId);
  return output !== undefined && isGalleryOutputEligibleForCampaign(output, workspaceId);
}

function toEligibilityInput(output: {
  id: string;
  workspaceId: string;
  title: string;
  outputType: GalleryOutputEligibilityInput['outputType'];
  status: GalleryOutputEligibilityInput['status'];
  contentJobRequestId: string;
  mediaStoragePath: string | null;
  thumbnailStoragePath: string | null;
}): GalleryOutputEligibilityInput {
  return {
    id: output.id,
    workspaceId: output.workspaceId,
    title: output.title,
    outputType: output.outputType,
    status: output.status,
    contentJobRequestId: output.contentJobRequestId,
    mediaAvailable: output.mediaStoragePath !== null || output.thumbnailStoragePath !== null,
  };
}

export const CAMPAIGN_CHANNEL_LABELS: Record<string, string> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  facebook: 'Facebook',
  linkedin: 'LinkedIn',
  x: 'X',
  pinterest: 'Pinterest',
  website: 'Website',
  email: 'Email',
  paid_social: 'Paid social',
  other: 'Other',
};

export function labelForChannel(key: string): string {
  return CAMPAIGN_CHANNEL_LABELS[key] ?? key;
}
