/**
 * Development-only Campaigns seed — fictional, planning-only data.
 *
 * Built on the two APPROVED Gallery outputs in gallerySeed.ts (Serum Product
 * Moment video, Morning Vanity Setup image). No social accounts, no OAuth,
 * no publishing state: planned dates are internal campaign planning dates
 * anchored to fixed 2026 dates so the demo calendar is stable. All captions
 * are original fictional copy.
 */
import type {
  CampaignChannelRecord,
  CampaignEventRecord,
  CampaignItemRecord,
  CampaignItemVariantRecord,
  CampaignRecord,
} from '../domain/campaigns';
import { GALLERY_OUTPUT_SEED_IDS } from './gallerySeed';

const WORKSPACE_ID = 'ws_demo';

export const SEED_CAMPAIGNS_WORKSPACE_ID = WORKSPACE_ID;

/** Fixed 2026 Monday so the demo calendar stays stable across sessions. */
export const CAMPAIGN_START_DATE = '2026-10-05';
export const CAMPAIGN_END_DATE = '2026-11-02';

export const CAMPAIGNS_SEED: CampaignRecord[] = [
  {
    id: 'campaign_morning_skincare_launch',
    workspaceId: WORKSPACE_ID,
    name: 'Morning Skincare Launch',
    slug: 'morning-skincare-launch',
    status: 'active',
    description: 'Channel plan for the fictional morning skincare routine launch.',
    objective: 'Introduce a simple morning skincare routine.',
    audience: 'Skincare-focused social viewers.',
    keyMessage: 'A calm routine, one clear product moment.',
    startDate: CAMPAIGN_START_DATE,
    endDate: CAMPAIGN_END_DATE,
    createdBy: 'demo-user',
    createdAt: '2026-09-28T09:00:00.000Z',
    updatedAt: '2026-09-28T09:30:00.000Z',
    archivedAt: null,
  },
];

export const CAMPAIGN_CHANNELS_SEED: CampaignChannelRecord[] = [
  {
    id: 'cchannel_instagram',
    campaignId: 'campaign_morning_skincare_launch',
    channel: 'instagram',
    intent: 'organic',
    notes: 'Reels-first organic presence.',
    sortOrder: 0,
    createdAt: '2026-09-28T09:00:00.000Z',
    updatedAt: '2026-09-28T09:00:00.000Z',
  },
  {
    id: 'cchannel_tiktok',
    campaignId: 'campaign_morning_skincare_launch',
    channel: 'tiktok',
    intent: 'organic',
    notes: 'Short vertical cuts from the approved routine video.',
    sortOrder: 1,
    createdAt: '2026-09-28T09:00:00.000Z',
    updatedAt: '2026-09-28T09:00:00.000Z',
  },
  {
    id: 'cchannel_paid_social',
    campaignId: 'campaign_morning_skincare_launch',
    channel: 'paid_social',
    intent: 'paid',
    notes: 'Paid placements for the vanity-setup creative.',
    sortOrder: 2,
    createdAt: '2026-09-28T09:00:00.000Z',
    updatedAt: '2026-09-28T09:00:00.000Z',
  },
];

export const CAMPAIGN_ITEMS_SEED: CampaignItemRecord[] = [
  {
    id: 'citem_serum_video',
    campaignId: 'campaign_morning_skincare_launch',
    galleryOutputId: GALLERY_OUTPUT_SEED_IDS.serum,
    status: 'planned',
    plannedChannel: 'instagram',
    plannedFormat: 'reel',
    plannedPublishAt: `${CAMPAIGN_START_DATE}T09:00:00.000Z`,
    captionDraft:
      'A calm start to the day: one serum, one clear product moment. Fictional demo copy for planning only.',
    callToAction: 'Discover the routine',
    notes: null,
    sortOrder: 0,
    createdBy: 'demo-user',
    createdAt: '2026-09-28T09:10:00.000Z',
    updatedAt: '2026-09-28T09:10:00.000Z',
    removedAt: null,
    plannedTimezone: null,
    planningStatus: null,
  },
  {
    id: 'citem_vanity_image',
    campaignId: 'campaign_morning_skincare_launch',
    galleryOutputId: GALLERY_OUTPUT_SEED_IDS.vanity,
    status: 'planned',
    plannedChannel: 'paid_social',
    plannedFormat: 'ad_creative',
    plannedPublishAt: '2026-10-07T10:00:00.000Z',
    captionDraft:
      'Morning light, simple shelves, and a routine that fits before coffee. Fictional demo copy for planning only.',
    callToAction: 'Learn more',
    notes: null,
    sortOrder: 1,
    createdBy: 'demo-user',
    createdAt: '2026-09-28T09:12:00.000Z',
    updatedAt: '2026-09-28T09:12:00.000Z',
    removedAt: null,
    plannedTimezone: null,
    planningStatus: null,
  },
];

export const CAMPAIGN_VARIANTS_SEED: CampaignItemVariantRecord[] = [
  {
    id: 'cvariant_paid_short',
    campaignItemId: 'citem_vanity_image',
    label: 'Short paid caption',
    captionDraft: 'The two-minute morning reset. Fictional demo copy for planning only.',
    callToAction: 'Learn more',
    formatOverride: null,
    plannedChannelOverride: null,
    notes: null,
    createdAt: '2026-09-28T09:15:00.000Z',
    updatedAt: '2026-09-28T09:15:00.000Z',
  },
];

export const CAMPAIGN_EVENTS_SEED: CampaignEventRecord[] = [
  {
    id: 'cevent_created',
    campaignId: 'campaign_morning_skincare_launch',
    actorId: 'demo-user',
    eventType: 'created',
    message: 'Campaign created.',
    metadata: { name: 'Morning Skincare Launch' },
    createdAt: '2026-09-28T09:00:00.000Z',
  },
  {
    id: 'cevent_status_active',
    campaignId: 'campaign_morning_skincare_launch',
    actorId: 'demo-user',
    eventType: 'status_changed',
    message: 'Status moved from draft to active.',
    metadata: { from: 'draft', to: 'active' },
    createdAt: '2026-09-28T09:05:00.000Z',
  },
  {
    id: 'cevent_channel_instagram',
    campaignId: 'campaign_morning_skincare_launch',
    actorId: 'demo-user',
    eventType: 'channel_added',
    message: 'Channel added: Instagram (organic).',
    metadata: { channel: 'instagram', intent: 'organic' },
    createdAt: '2026-09-28T09:06:00.000Z',
  },
  {
    id: 'cevent_channel_tiktok',
    campaignId: 'campaign_morning_skincare_launch',
    actorId: 'demo-user',
    eventType: 'channel_added',
    message: 'Channel added: TikTok (organic).',
    metadata: { channel: 'tiktok', intent: 'organic' },
    createdAt: '2026-09-28T09:06:30.000Z',
  },
  {
    id: 'cevent_channel_paid',
    campaignId: 'campaign_morning_skincare_launch',
    actorId: 'demo-user',
    eventType: 'channel_added',
    message: 'Channel added: Paid social (paid).',
    metadata: { channel: 'paid_social', intent: 'paid' },
    createdAt: '2026-09-28T09:07:00.000Z',
  },
  {
    id: 'cevent_item_serum',
    campaignId: 'campaign_morning_skincare_launch',
    actorId: 'demo-user',
    eventType: 'item_added',
    message: 'Approved content added: Serum Product Moment.',
    metadata: { galleryOutputId: GALLERY_OUTPUT_SEED_IDS.serum, title: 'Serum Product Moment' },
    createdAt: '2026-09-28T09:10:00.000Z',
  },
  {
    id: 'cevent_item_vanity',
    campaignId: 'campaign_morning_skincare_launch',
    actorId: 'demo-user',
    eventType: 'item_added',
    message: 'Approved content added: Morning Vanity Setup.',
    metadata: { galleryOutputId: GALLERY_OUTPUT_SEED_IDS.vanity, title: 'Morning Vanity Setup' },
    createdAt: '2026-09-28T09:12:00.000Z',
  },
];
