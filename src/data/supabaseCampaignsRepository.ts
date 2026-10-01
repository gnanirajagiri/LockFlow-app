/**
 * Supabase adapter — Campaigns.
 *
 * Mirrors the contracts in 20260928170000_campaigns.sql. The service layer
 * owns all guards; this adapter is a thin translator. Uses camel↔snake row
 * mapping and defers ordering writes like the Templates adapter.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
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

type Row = Record<string, unknown>;

function now(): string {
  return new Date().toISOString();
}

function mapCampaign(row: Row): CampaignRecord {
  return {
    id: row.id as string,
    workspaceId: row.workspace_id as string,
    name: row.name as string,
    slug: row.slug as string,
    status: row.status as CampaignRecord['status'],
    description: (row.description as string | null) ?? null,
    objective: (row.objective as string | null) ?? null,
    audience: (row.audience as string | null) ?? null,
    keyMessage: (row.key_message as string | null) ?? null,
    startDate: (row.start_date as string | null) ?? null,
    endDate: (row.end_date as string | null) ?? null,
    createdBy: row.created_by as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    archivedAt: (row.archived_at as string | null) ?? null,
  };
}

function mapChannel(row: Row): CampaignChannelRecord {
  return {
    id: row.id as string,
    campaignId: row.campaign_id as string,
    channel: row.channel as CampaignChannelRecord['channel'],
    intent: row.intent as CampaignChannelRecord['intent'],
    notes: (row.notes as string | null) ?? null,
    sortOrder: row.sort_order as number,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapItem(row: Row): CampaignItemRecord {
  return {
    id: row.id as string,
    campaignId: row.campaign_id as string,
    galleryOutputId: row.gallery_output_id as string,
    status: row.status as CampaignItemRecord['status'],
    plannedChannel: (row.planned_channel as string | null) ?? null,
    plannedFormat: (row.planned_format as CampaignItemRecord['plannedFormat'] | null) ?? null,
    plannedPublishAt: (row.planned_publish_at as string | null) ?? null,
    captionDraft: (row.caption_draft as string | null) ?? null,
    callToAction: (row.call_to_action as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    sortOrder: row.sort_order as number,
    createdBy: row.created_by as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    removedAt: (row.removed_at as string | null) ?? null,
    // Prompt 20 planning fields (nullable, safe defaults until the column
    // migration is applied to the hosted project).
    plannedTimezone: ((row as Record<string, unknown>).planned_timezone as string | null) ?? null,
    planningStatus: ((row as Record<string, unknown>).planning_status as string | null) ?? null,
  };
}

function mapVariant(row: Row): CampaignItemVariantRecord {
  return {
    id: row.id as string,
    campaignItemId: row.campaign_item_id as string,
    label: row.label as string,
    captionDraft: (row.caption_draft as string | null) ?? null,
    callToAction: (row.call_to_action as string | null) ?? null,
    formatOverride: (row.format_override as CampaignItemVariantRecord['formatOverride'] | null) ?? null,
    plannedChannelOverride: (row.planned_channel_override as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapEvent(row: Row): CampaignEventRecord {
  return {
    id: row.id as string,
    campaignId: row.campaign_id as string,
    actorId: (row.actor_id as string | null) ?? null,
    eventType: row.event_type as CampaignEventRecord['eventType'],
    message: row.message as string,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: row.created_at as string,
  };
}

export class SupabaseCampaignsRepository implements CampaignsRepository {
  constructor(private readonly client: SupabaseClient) {}

  // ── Campaigns ──────────────────────────────────────────────────────────────

  async listCampaigns(workspaceId: string): Promise<CampaignRecord[]> {
    const res = await this.client
      .from('campaigns')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('updated_at', { ascending: false });
    if (res.error) throw res.error;
    return ((res.data ?? []) as Row[]).map(mapCampaign);
  }

  async getCampaign(campaignId: string): Promise<CampaignRecord> {
    const res = await this.client.from('campaigns').select('*').eq('id', campaignId).maybeSingle();
    if (res.error) throw res.error;
    if (!res.data) throw new Error(`Campaign ${campaignId} not found.`);
    return mapCampaign(res.data as Row);
  }

  async createCampaign(
    input: CreateCampaignInput,
    slug: string,
    createdBy: string,
  ): Promise<CampaignRecord> {
    const res = await this.client
      .from('campaigns')
      .insert({
        workspace_id: input.workspaceId,
        name: input.name,
        slug,
        description: input.description ?? null,
        objective: input.objective ?? null,
        audience: input.audience ?? null,
        key_message: input.keyMessage ?? null,
        start_date: input.startDate ?? null,
        end_date: input.endDate ?? null,
        created_by: createdBy,
      })
      .select('*')
      .single();
    if (res.error) throw res.error;
    return mapCampaign(res.data as Row);
  }

  async updateCampaign(campaignId: string, patch: UpdateCampaignInput): Promise<CampaignRecord> {
    const update: Row = {};
    if (patch.name !== undefined) update.name = patch.name;
    if (patch.description !== undefined) update.description = patch.description;
    if (patch.objective !== undefined) update.objective = patch.objective;
    if (patch.audience !== undefined) update.audience = patch.audience;
    if (patch.keyMessage !== undefined) update.key_message = patch.keyMessage;
    if (patch.startDate !== undefined) update.start_date = patch.startDate;
    if (patch.endDate !== undefined) update.end_date = patch.endDate;
    const res = await this.client
      .from('campaigns')
      .update(update)
      .eq('id', campaignId)
      .select('*')
      .single();
    if (res.error) throw res.error;
    return mapCampaign(res.data as Row);
  }

  async updateCampaignStatus(campaignId: string, status: CampaignRecord['status']): Promise<CampaignRecord> {
    const res = await this.client
      .from('campaigns')
      .update({ status, archived_at: status === 'archived' ? now() : null })
      .eq('id', campaignId)
      .select('*')
      .single();
    if (res.error) throw res.error;
    return mapCampaign(res.data as Row);
  }

  async campaignSlugExists(workspaceId: string, slug: string, excludeId?: string): Promise<boolean> {
    let query = this.client
      .from('campaigns')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('slug', slug)
      .limit(1);
    if (excludeId) query = query.neq('id', excludeId);
    const res = await query;
    if (res.error) throw res.error;
    return (res.data ?? []).length > 0;
  }

  // ── Channels ───────────────────────────────────────────────────────────────

  async listChannels(campaignId: string): Promise<CampaignChannelRecord[]> {
    const res = await this.client
      .from('campaign_channels')
      .select('*')
      .eq('campaign_id', campaignId)
      .order('sort_order');
    if (res.error) throw res.error;
    return ((res.data ?? []) as Row[]).map(mapChannel);
  }

  async createChannel(input: CreateCampaignChannelInput): Promise<CampaignChannelRecord> {
    const existing = await this.listChannels(input.campaignId);
    const res = await this.client
      .from('campaign_channels')
      .insert({
        campaign_id: input.campaignId,
        channel: input.channel,
        intent: input.intent,
        notes: input.notes ?? null,
        sort_order: existing.length,
      })
      .select('*')
      .single();
    if (res.error) throw res.error;
    return mapChannel(res.data as Row);
  }

  async updateChannel(channelId: string, patch: UpdateCampaignChannelInput): Promise<CampaignChannelRecord> {
    const update: Row = {};
    if (patch.intent !== undefined) update.intent = patch.intent;
    if (patch.notes !== undefined) update.notes = patch.notes;
    const res = await this.client
      .from('campaign_channels')
      .update(update)
      .eq('id', channelId)
      .select('*')
      .single();
    if (res.error) throw res.error;
    return mapChannel(res.data as Row);
  }

  async deleteChannel(channelId: string): Promise<void> {
    const res = await this.client.from('campaign_channels').delete().eq('id', channelId);
    if (res.error) throw res.error;
  }

  async reorderChannels(campaignId: string, orderedChannelIds: string[]): Promise<void> {
    // Two-phase rewrite under the deferrable-style ordering contract.
    const offset = 1000;
    for (const [index, id] of orderedChannelIds.entries()) {
      const res = await this.client
        .from('campaign_channels')
        .update({ sort_order: offset + index })
        .eq('id', id)
        .eq('campaign_id', campaignId);
      if (res.error) throw res.error;
    }
    for (const [index, id] of orderedChannelIds.entries()) {
      const res = await this.client
        .from('campaign_channels')
        .update({ sort_order: index })
        .eq('id', id)
        .eq('campaign_id', campaignId);
      if (res.error) throw res.error;
    }
  }

  // ── Items ──────────────────────────────────────────────────────────────────

  async getItem(itemId: string): Promise<CampaignItemRecord | null> {
    const res = await this.client
      .from('campaign_items')
      .select('*')
      .eq('id', itemId)
      .maybeSingle();
    if (res.error) throw res.error;
    return res.data ? mapItem(res.data as Row) : null;
  }

  async listItems(campaignId: string): Promise<CampaignItemRecord[]> {
    const res = await this.client
      .from('campaign_items')
      .select('*')
      .eq('campaign_id', campaignId)
      .order('sort_order');
    if (res.error) throw res.error;
    return ((res.data ?? []) as Row[]).map(mapItem);
  }

  async createItem(
    input: CreateCampaignItemInput,
    sortOrder: number,
    createdBy: string,
  ): Promise<CampaignItemRecord> {
    const res = await this.client
      .from('campaign_items')
      .insert({
        campaign_id: input.campaignId,
        gallery_output_id: input.galleryOutputId,
        status: 'planned',
        planned_channel: input.plannedChannel ?? null,
        planned_format: input.plannedFormat ?? null,
        planned_publish_at: input.plannedPublishAt ?? null,
        caption_draft: input.captionDraft ?? null,
        call_to_action: input.callToAction ?? null,
        notes: input.notes ?? null,
        sort_order: sortOrder,
        created_by: createdBy,
      })
      .select('*')
      .single();
    if (res.error) throw res.error;
    return mapItem(res.data as Row);
  }

  async updateItem(itemId: string, patch: UpdateCampaignItemInput): Promise<CampaignItemRecord> {
    const update: Row = {};
    if (patch.status !== undefined) update.status = patch.status;
    if (patch.plannedChannel !== undefined) update.planned_channel = patch.plannedChannel;
    if (patch.plannedFormat !== undefined) update.planned_format = patch.plannedFormat;
    if (patch.plannedPublishAt !== undefined) update.planned_publish_at = patch.plannedPublishAt;
    if (patch.captionDraft !== undefined) update.caption_draft = patch.captionDraft;
    if (patch.callToAction !== undefined) update.call_to_action = patch.callToAction;
    if (patch.notes !== undefined) update.notes = patch.notes;
    const res = await this.client
      .from('campaign_items')
      .update(update)
      .eq('id', itemId)
      .select('*')
      .single();
    if (res.error) throw res.error;
    return mapItem(res.data as Row);
  }

  async replaceItemOutput(itemId: string, galleryOutputId: string): Promise<CampaignItemRecord> {
    const res = await this.client
      .from('campaign_items')
      .update({ gallery_output_id: galleryOutputId, status: 'planned', removed_at: null })
      .eq('id', itemId)
      .select('*')
      .single();
    if (res.error) throw res.error;
    return mapItem(res.data as Row);
  }

  async removeItem(itemId: string): Promise<CampaignItemRecord> {
    const res = await this.client
      .from('campaign_items')
      .update({ status: 'removed', removed_at: now() })
      .eq('id', itemId)
      .select('*')
      .single();
    if (res.error) throw res.error;
    return mapItem(res.data as Row);
  }

  async restoreItem(itemId: string): Promise<CampaignItemRecord> {
    const res = await this.client
      .from('campaign_items')
      .update({ status: 'planned', removed_at: null })
      .eq('id', itemId)
      .select('*')
      .single();
    if (res.error) throw res.error;
    return mapItem(res.data as Row);
  }

  async reorderItems(campaignId: string, orderedItemIds: string[]): Promise<void> {
    const offset = 1000;
    for (const [index, id] of orderedItemIds.entries()) {
      const res = await this.client
        .from('campaign_items')
        .update({ sort_order: offset + index })
        .eq('id', id)
        .eq('campaign_id', campaignId);
      if (res.error) throw res.error;
    }
    for (const [index, id] of orderedItemIds.entries()) {
      const res = await this.client
        .from('campaign_items')
        .update({ sort_order: index })
        .eq('id', id)
        .eq('campaign_id', campaignId);
      if (res.error) throw res.error;
    }
  }

  async nextItemSortOrder(campaignId: string): Promise<number> {
    const items = await this.listItems(campaignId);
    return items.length === 0 ? 0 : Math.max(...items.map((i) => i.sortOrder)) + 1;
  }

  // ── Variants ───────────────────────────────────────────────────────────────

  async listVariants(campaignId: string): Promise<CampaignItemVariantRecord[]> {
    const itemIds = (await this.listItems(campaignId)).map((i) => i.id);
    if (itemIds.length === 0) return [];
    const res = await this.client
      .from('campaign_item_variants')
      .select('*')
      .in('campaign_item_id', itemIds);
    if (res.error) throw res.error;
    return ((res.data ?? []) as Row[]).map(mapVariant);
  }

  async listVariantsForItem(itemId: string): Promise<CampaignItemVariantRecord[]> {
    const res = await this.client
      .from('campaign_item_variants')
      .select('*')
      .eq('campaign_item_id', itemId);
    if (res.error) throw res.error;
    return ((res.data ?? []) as Row[]).map(mapVariant);
  }

  async createVariant(
    itemId: string,
    input: CreateCampaignItemVariantInput,
  ): Promise<CampaignItemVariantRecord> {
    const res = await this.client
      .from('campaign_item_variants')
      .insert({
        campaign_item_id: itemId,
        label: input.label,
        caption_draft: input.captionDraft ?? null,
        call_to_action: input.callToAction ?? null,
        format_override: input.formatOverride ?? null,
        planned_channel_override: input.plannedChannelOverride ?? null,
        notes: input.notes ?? null,
      })
      .select('*')
      .single();
    if (res.error) throw res.error;
    return mapVariant(res.data as Row);
  }

  async updateVariant(
    variantId: string,
    patch: UpdateCampaignItemVariantInput,
  ): Promise<CampaignItemVariantRecord> {
    const update: Row = {};
    if (patch.label !== undefined) update.label = patch.label;
    if (patch.captionDraft !== undefined) update.caption_draft = patch.captionDraft;
    if (patch.callToAction !== undefined) update.call_to_action = patch.callToAction;
    if (patch.formatOverride !== undefined) update.format_override = patch.formatOverride;
    if (patch.plannedChannelOverride !== undefined) {
      update.planned_channel_override = patch.plannedChannelOverride;
    }
    if (patch.notes !== undefined) update.notes = patch.notes;
    const res = await this.client
      .from('campaign_item_variants')
      .update(update)
      .eq('id', variantId)
      .select('*')
      .single();
    if (res.error) throw res.error;
    return mapVariant(res.data as Row);
  }

  async deleteVariant(variantId: string): Promise<void> {
    const res = await this.client.from('campaign_item_variants').delete().eq('id', variantId);
    if (res.error) throw res.error;
  }

  // ── Events ─────────────────────────────────────────────────────────────────

  async listEvents(campaignId: string): Promise<CampaignEventRecord[]> {
    const res = await this.client
      .from('campaign_events')
      .select('*')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: false });
    if (res.error) throw res.error;
    return ((res.data ?? []) as Row[]).map(mapEvent);
  }

  async appendEvent(event: Omit<CampaignEventRecord, 'id' | 'createdAt'>): Promise<CampaignEventRecord> {
    const res = await this.client
      .from('campaign_events')
      .insert({
        campaign_id: event.campaignId,
        actor_id: event.actorId ?? null,
        event_type: event.eventType,
        message: event.message,
        metadata: event.metadata,
      })
      .select('*')
      .single();
    if (res.error) throw res.error;
    return mapEvent(res.data as Row);
  }
}
