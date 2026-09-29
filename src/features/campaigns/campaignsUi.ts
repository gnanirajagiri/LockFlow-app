/**
 * Campaigns UI — shared labels and copy.
 *
 * All copy is honest: campaigns organise content but never publish,
 * connections are "coming soon", and planned dates are internal planning
 * dates only.
 */
import type {
  CampaignItemFormat,
  CampaignItemStatus,
  CampaignRecord,
  CampaignStatus,
} from '../../domain/campaigns';

export const CAMPAIGN_STATUS_TONE: Record<CampaignStatus, 'neutral' | 'info' | 'success' | 'warning' | 'locked'> = {
  draft: 'neutral',
  active: 'success',
  completed: 'info',
  archived: 'locked',
};

export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: 'Draft',
  active: 'Active',
  completed: 'Completed',
  archived: 'Archived',
};

export const CAMPAIGN_ITEM_STATUS_TONE: Record<CampaignItemStatus, 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'locked'> = {
  planned: 'info',
  ready: 'success',
  blocked: 'warning',
  removed: 'neutral',
};

export const CAMPAIGN_ITEM_STATUS_LABELS: Record<CampaignItemStatus, string> = {
  planned: 'Planned',
  ready: 'Ready',
  blocked: 'Blocked',
  removed: 'Removed',
};

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

export const CAMPAIGN_ITEM_FORMAT_LABELS: Record<CampaignItemFormat, string> = {
  feed_post: 'Feed post',
  story: 'Story',
  reel: 'Reel',
  short_video: 'Short video',
  ad_creative: 'Ad creative',
  website: 'Website',
  email: 'Email',
  other: 'Other',
};

export const CAMPAIGN_INTENT_LABELS: Record<string, string> = {
  organic: 'Organic',
  paid: 'Paid',
  both: 'Organic + paid',
};

export function campaignStatusLabel(status: CampaignStatus): string {
  return CAMPAIGN_STATUS_LABELS[status];
}

export function formatCampaignDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatPlannedDateTime(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function campaignDateRange(campaign: CampaignRecord): string {
  if (!campaign.startDate && !campaign.endDate) return 'No dates set';
  if (campaign.startDate && campaign.endDate) {
    return `${formatCampaignDate(campaign.startDate)} → ${formatCampaignDate(campaign.endDate)}`;
  }
  return formatCampaignDate(campaign.startDate ?? campaign.endDate);
}
