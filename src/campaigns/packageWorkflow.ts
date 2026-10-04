/**
 * Prompt 31 — platform adaptation & campaign item packaging (workflow).
 *
 * Turns approved Gallery outputs into platform-ready campaign packages —
 * one package per channel/placement, all referencing the SAME source output.
 * A package is a campaign-specific presentation/configuration record, never
 * an unmanaged duplicate: the Gallery output and its locked generation
 * baseline stay untouched, and packaging is reversible (delete the package,
 * the output is unchanged).
 *
 * Rules encoded here (pure, server-side — the client never decides):
 *   * Channel adaptation profiles: supported content types, accepted aspect
 *     ratios, duration limits, required fields, placement rules.
 *   * Media compatibility is evaluated honestly: an aspect mismatch the app
 *     cannot transform stays `variant_needed`; an unsupported type or an
 *     over-length video is `unsupported` — never pretended valid.
 *   * A package reaches `ready_for_review` only when media fits, required
 *     copy is present and a verified connected account is assigned.
 *   * Only ready packages move into the EXISTING Publishing Review flow;
 *     nothing is auto-published here.
 */
import type { CampaignChannelKey } from '../domain/campaigns/types';
import type { GalleryOutputRecord } from '../domain/gallery/types';

/** Existing publishing vocabulary — packages integrate with it directly. */
export type PackagePlacement =
  | 'feed_post' | 'reel' | 'story' | 'short_video'
  | 'video_post' | 'image_post' | 'ad_creative' | 'other';

// ── Statuses ─────────────────────────────────────────────────────────────────

export type CampaignPackageStatus =
  | 'draft'
  | 'needs_media_adaptation'
  | 'needs_copy'
  | 'needs_account'
  | 'blocked'
  | 'ready_for_review'
  | 'approved_for_publish'
  | 'handed_to_publishing';

export const CAMPAIGN_PACKAGE_STATUS_LABELS: Record<CampaignPackageStatus, string> = {
  draft: 'Draft',
  needs_media_adaptation: 'Needs media adaptation',
  needs_copy: 'Needs copy',
  needs_account: 'Needs account',
  blocked: 'Blocked',
  ready_for_review: 'Ready for review',
  approved_for_publish: 'Approved for publish',
  handed_to_publishing: 'Handed to publishing',
};

/** How the source media maps onto the channel's format requirements. */
export type PackageAdaptationStatus = 'source_fits' | 'variant_needed' | 'unsupported';

export type PackageValidationState = 'unvalidated' | 'valid' | 'invalid';

// ── Channel adaptation profiles ──────────────────────────────────────────────

export interface ChannelAdaptationProfile {
  /** Social provider key from the existing connections registry. */
  providerKey: string | null;
  placements: PackagePlacement[];
  supportedMediaTypes: Array<'image' | 'video' | 'story'>;
  acceptedAspectRatios: string[];
  maxDurationSeconds: number | null;
  maxCaptionLength: number;
  hashtagLimit: number;
  requiresDestinationUrl: boolean;
  /** Placements that demand vertical/portrait media (honest warnings). */
  verticalPlacements: PackagePlacement[];
}

/**
 * Platform profiles for the campaign channel keys. Conservative and explicit:
 * unsupported channels (`website`, `email`, `paid_social`, `other`) have no
 * social provider integration, so account assignment is not required but
 * media rules stay honest.
 */
export const CHANNEL_ADAPTATION_PROFILES: Record<CampaignChannelKey, ChannelAdaptationProfile> = {
  instagram: {
    providerKey: 'meta',
    placements: ['feed_post', 'reel', 'story', 'ad_creative'],
    supportedMediaTypes: ['image', 'video', 'story'],
    acceptedAspectRatios: ['1:1', '4:5', '9:16'],
    maxDurationSeconds: 90,
    maxCaptionLength: 2200,
    hashtagLimit: 30,
    requiresDestinationUrl: false,
    verticalPlacements: ['reel', 'story'],
  },
  tiktok: {
    providerKey: 'tiktok',
    placements: ['video_post', 'short_video', 'ad_creative'],
    supportedMediaTypes: ['video'],
    acceptedAspectRatios: ['9:16'],
    maxDurationSeconds: 600,
    maxCaptionLength: 2200,
    hashtagLimit: 20,
    requiresDestinationUrl: false,
    verticalPlacements: ['video_post', 'short_video', 'ad_creative'],
  },
  youtube: {
    providerKey: 'youtube',
    placements: ['video_post', 'short_video'],
    supportedMediaTypes: ['video'],
    acceptedAspectRatios: ['16:9', '9:16'],
    maxDurationSeconds: null,
    maxCaptionLength: 5000,
    hashtagLimit: 15,
    requiresDestinationUrl: false,
    verticalPlacements: ['short_video'],
  },
  facebook: {
    providerKey: 'meta',
    placements: ['feed_post', 'reel', 'story', 'ad_creative'],
    supportedMediaTypes: ['image', 'video'],
    acceptedAspectRatios: ['1:1', '4:5', '9:16', '16:9'],
    maxDurationSeconds: 240,
    maxCaptionLength: 5000,
    hashtagLimit: 30,
    requiresDestinationUrl: false,
    verticalPlacements: ['reel', 'story'],
  },
  linkedin: {
    providerKey: 'linkedin',
    placements: ['feed_post', 'video_post', 'image_post'],
    supportedMediaTypes: ['image', 'video'],
    acceptedAspectRatios: ['1:1', '4:5', '16:9'],
    maxDurationSeconds: 600,
    maxCaptionLength: 3000,
    hashtagLimit: 10,
    requiresDestinationUrl: false,
    verticalPlacements: [],
  },
  x: {
    providerKey: null,
    placements: ['image_post', 'video_post', 'feed_post'],
    supportedMediaTypes: ['image', 'video'],
    acceptedAspectRatios: ['16:9', '1:1'],
    maxDurationSeconds: 140,
    maxCaptionLength: 280,
    hashtagLimit: 10,
    requiresDestinationUrl: false,
    verticalPlacements: [],
  },
  pinterest: {
    providerKey: null,
    placements: ['image_post', 'video_post'],
    supportedMediaTypes: ['image', 'video'],
    acceptedAspectRatios: ['2:3', '1:1', '9:16'],
    maxDurationSeconds: 300,
    maxCaptionLength: 500,
    hashtagLimit: 20,
    requiresDestinationUrl: true,
    verticalPlacements: ['image_post'],
  },
  website: {
    providerKey: null,
    placements: ['other'],
    supportedMediaTypes: ['image'],
    acceptedAspectRatios: ['16:9', '1:1', '4:5', '9:16'],
    maxDurationSeconds: null,
    maxCaptionLength: 5000,
    hashtagLimit: 0,
    requiresDestinationUrl: true,
    verticalPlacements: [],
  },
  email: {
    providerKey: null,
    placements: ['other'],
    supportedMediaTypes: ['image'],
    acceptedAspectRatios: ['16:9', '1:1'],
    maxDurationSeconds: null,
    maxCaptionLength: 5000,
    hashtagLimit: 0,
    requiresDestinationUrl: true,
    verticalPlacements: [],
  },
  paid_social: {
    providerKey: null,
    placements: ['ad_creative', 'feed_post', 'video_post', 'image_post'],
    supportedMediaTypes: ['image', 'video'],
    acceptedAspectRatios: ['1:1', '4:5', '9:16', '16:9'],
    maxDurationSeconds: 60,
    maxCaptionLength: 500,
    hashtagLimit: 0,
    requiresDestinationUrl: true,
    verticalPlacements: ['ad_creative'],
  },
  other: {
    providerKey: null,
    placements: ['other'],
    supportedMediaTypes: ['image', 'video'],
    acceptedAspectRatios: ['1:1', '16:9', '9:16', '4:5'],
    maxDurationSeconds: null,
    maxCaptionLength: 5000,
    hashtagLimit: 0,
    requiresDestinationUrl: false,
    verticalPlacements: [],
  },
};

export interface ChannelRequirementsResult {
  supported: boolean;
  profile: ChannelAdaptationProfile;
  /** Safe, product-friendly reasons when the placement/type is not supported. */
  reasons: string[];
}

/**
 * Server-side requirements lookup: is this media type publishable to this
 * placement on this channel, and what are the format rules?
 */
export function getChannelAdaptationRequirements(
  provider: CampaignChannelKey,
  placement: PackagePlacement,
  mediaType: 'image' | 'video' | 'story',
): ChannelRequirementsResult {
  const profile = CHANNEL_ADAPTATION_PROFILES[provider];
  const reasons: string[] = [];
  if (!profile.placements.includes(placement)) {
    reasons.push(`${placement.replace('_', ' ')} is not a supported placement for ${provider}.`);
  }
  if (!profile.supportedMediaTypes.includes(mediaType)) {
    reasons.push(`${mediaType} content is not supported on ${provider}.`);
  }
  return { supported: reasons.length === 0, profile, reasons };
}

// ── Aspect-ratio helpers ─────────────────────────────────────────────────────

/** Parses "w:h" into a comparable number; returns null when unparseable. */
export function parseAspectRatio(ratio: string | null | undefined): number | null {
  if (!ratio) return null;
  const match = /^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/.exec(ratio.trim());
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!width || !height) return null;
  return width / height;
}

function ratioLabel(ratio: number): string {
  return ratio >= 1 ? `${ratio.toFixed(2)}:1` : `1:${(1 / ratio).toFixed(2)}`;
}

export interface PackageMediaEvaluation {
  adaptationStatus: PackageAdaptationStatus;
  /** Safe, product-friendly evaluation notes (never raw provider payloads). */
  notes: string[];
  /** True when the crop settings themselves ask for an unsupported target. */
  invalidCrop: boolean;
}

/**
 * Honest media-compatibility check. A transform the app can actually perform
 * (center-crop between accepted ratios) marks `variant_needed` with the
 * target recorded; anything else (unsupported type, over-length video,
 * upscale-only crop) stays `unsupported` — never faked as valid.
 */
export function evaluatePackageMedia(
  profile: ChannelAdaptationProfile,
  output: Pick<GalleryOutputRecord, 'outputType' | 'durationSeconds' | 'width' | 'height'>,
  cropSettings: { targetAspectRatio?: string | null } | null,
): PackageMediaEvaluation {
  const notes: string[] = [];
  if (!profile.supportedMediaTypes.includes(output.outputType)) {
    return {
      adaptationStatus: 'unsupported',
      notes: [`${output.outputType} content is not supported on this channel.`],
      invalidCrop: false,
    };
  }
  if (
    profile.maxDurationSeconds !== null
    && output.durationSeconds !== null
    && output.durationSeconds > profile.maxDurationSeconds
  ) {
    return {
      adaptationStatus: 'unsupported',
      notes: [`Video is ${output.durationSeconds}s; this channel allows up to ${profile.maxDurationSeconds}s and no trim capability exists yet.`],
      invalidCrop: false,
    };
  }

  const sourceRatio = parseAspectRatio(
    output.width && output.height ? `${output.width}:${output.height}` : null,
  );
  const targetRatio = parseAspectRatio(cropSettings?.targetAspectRatio ?? null);

  if (targetRatio !== null && !profile.acceptedAspectRatios.includes(cropSettings?.targetAspectRatio ?? '')) {
    return {
      adaptationStatus: 'unsupported',
      notes: [`${cropSettings?.targetAspectRatio} is not an accepted format for this channel.`],
      invalidCrop: true,
    };
  }

  const fits =
    sourceRatio === null ||
    profile.acceptedAspectRatios.some(
      (accepted) => {
        const acceptedRatio = parseAspectRatio(accepted);
        return acceptedRatio !== null && sourceRatio !== null && Math.abs(acceptedRatio - sourceRatio) < 0.02;
      },
    );
  if (fits) {
    notes.push('Source media matches the channel format.');
    return { adaptationStatus: 'source_fits', notes, invalidCrop: false };
  }

  if (targetRatio !== null) {
    if (sourceRatio !== null && targetRatio > sourceRatio) {
      notes.push(`Cropping to ${cropSettings?.targetAspectRatio} would crop away more than the safe area — adaptation not supported.`);
      return { adaptationStatus: 'unsupported', notes, invalidCrop: false };
    }
    notes.push(`Center-crop variant to ${cropSettings?.targetAspectRatio} recorded.`);
    return { adaptationStatus: 'variant_needed', notes, invalidCrop: false };
  }

  notes.push(
    `Source is ${ratioLabel(sourceRatio ?? 1)}; this channel accepts ${profile.acceptedAspectRatios.join(', ')} — a crop variant is needed.`,
  );
  return { adaptationStatus: 'variant_needed', notes, invalidCrop: false };
}

// ── Records ──────────────────────────────────────────────────────────────────

export interface CampaignContentPackageRecord {
  id: string;
  workspaceId: string;
  campaignId: string;
  /** Nullable until the package is attached to a planned campaign item. */
  campaignItemId: string | null;
  channel: CampaignChannelKey;
  placement: PackagePlacement;
  /** Nullable until a verified connected account is assigned. */
  connectedAccountId: string | null;
  sourceGalleryOutputId: string;
  captionOrCopy: string | null;
  headline: string | null;
  callToAction: string | null;
  hashtagsOrTags: string | null;
  destinationUrl: string | null;
  /** Reference to an applied media variant (crop/format), when one exists. */
  mediaVariantReference: string | null;
  cropOrFormatSettings: Record<string, unknown> | null;
  adaptationStatus: PackageAdaptationStatus;
  validationState: PackageValidationState;
  validationErrors: string[];
  status: CampaignPackageStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface PackageMediaVariantRecord {
  id: string;
  workspaceId: string;
  packageId: string;
  sourceGalleryOutputId: string;
  targetAspectRatio: string | null;
  cropSettings: Record<string, unknown> | null;
  /** requested | applied | unsupported — honest about transform capability. */
  status: 'requested' | 'applied' | 'unsupported';
  notes: string | null;
  createdBy: string;
  createdAt: string;
}

export type CampaignPackageAuditEvent =
  | 'campaign_package_created'
  | 'campaign_package_updated'
  | 'campaign_package_validation_passed'
  | 'campaign_package_validation_blocked'
  | 'campaign_package_variant_requested'
  | 'campaign_package_sent_to_review';

export interface CampaignPackageAuditRow {
  id: string;
  workspaceId: string;
  packageId: string | null;
  campaignId: string | null;
  event: CampaignPackageAuditEvent;
  detail: string | null;
  createdAt: string;
}

// ── Validation ───────────────────────────────────────────────────────────────

export interface PackageValidationResult {
  valid: boolean;
  errors: string[];
  /** The server-computed status after validation. */
  nextStatus: CampaignPackageStatus;
}

/**
 * Server-side package validation. Combines channel rules (copy limits,
 * required fields), media adaptation state and connected-account presence
 * into the package's readiness decision.
 */
export function validatePackageRules(input: {
  profile: ChannelAdaptationProfile;
  packageName: string;
  placement: PackagePlacement;
  captionOrCopy: string | null;
  hashtagsOrTags: string | null;
  destinationUrl: string | null;
  connectedAccountId: string | null;
  accountVerified: boolean;
  accountProviderMatches: boolean;
  campaignItemId: string | null;
  media: PackageMediaEvaluation;
}): PackageValidationResult {
  const errors: string[] = [];
  const { profile, media } = input;

  if (media.adaptationStatus === 'unsupported') {
    errors.push(...media.notes);
  } else if (media.adaptationStatus === 'variant_needed') {
    errors.push('Media needs a crop/format variant for this channel before it is ready.');
  }

  const caption = (input.captionOrCopy ?? '').trim();
  if (caption.length === 0) {
    errors.push('Add the caption or copy for this channel.');
  } else if (caption.length > profile.maxCaptionLength) {
    errors.push(`Copy exceeds the ${profile.maxCaptionLength}-character limit for this channel.`);
  }

  if (input.hashtagsOrTags) {
    const tags = input.hashtagsOrTags.split(/[\s,]+/).filter(Boolean);
    if (tags.length > profile.hashtagLimit) {
      errors.push(`More than ${profile.hashtagLimit} hashtags are not accepted on this channel.`);
    }
  }

  if (profile.requiresDestinationUrl && !(input.destinationUrl ?? '').trim()) {
    errors.push('This channel requires a destination URL.');
  }

  if (!input.connectedAccountId) {
    errors.push('Assign a verified connected account before publishing review.');
  } else if (!input.accountVerified) {
    errors.push('The assigned account is not currently verified — reconnect it first.');
  } else if (!input.accountProviderMatches) {
    errors.push('The assigned account belongs to a different platform than the package channel.');
  }

  if (!input.campaignItemId) {
    errors.push('Attach the package to a campaign item before publishing review.');
  }

  let nextStatus: CampaignPackageStatus;
  if (errors.length === 0) {
    nextStatus = 'ready_for_review';
  } else if (media.adaptationStatus === 'unsupported') {
    nextStatus = 'blocked';
  } else if (media.adaptationStatus === 'variant_needed') {
    nextStatus = 'needs_media_adaptation';
  } else if (!input.connectedAccountId || !input.accountVerified || !input.accountProviderMatches) {
    nextStatus = 'needs_account';
  } else if (caption.length === 0) {
    nextStatus = 'needs_copy';
  } else {
    nextStatus = 'draft';
  }
  return { valid: errors.length === 0, errors, nextStatus };
}
