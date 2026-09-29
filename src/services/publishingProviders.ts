/**
 * Publishing providers — registry, development fake and honest production
 * stubs. Only adapters know provider endpoints, upload formats, webhook
 * signatures and status semantics. No production publishing exists: stubs
 * refuse rather than pretend.
 */
import type {
  ProviderCapabilities,
  ProviderValidationIssue,
  PublishingCopyInput,
  SafeServerMediaReference,
  SocialPublishingProvider,
} from '../domain/publishing';

export class PublishingNotConfiguredError extends Error {
  constructor(providerKey: string) {
    super(`Publishing for ${providerKey} is not configured or enabled yet.`);
    this.name = 'PublishingNotConfiguredError';
  }
}

/** Honest stub: refuses everything until credentials + app review exist. */
abstract class UnconfiguredPublishingProvider implements SocialPublishingProvider {
  abstract readonly providerKey: string;
  abstract readonly displayName: string;
  readonly devOnly = false;

  async isConfigured(): Promise<boolean> {
    return false;
  }

  protected refuse(): never {
    throw new PublishingNotConfiguredError(this.providerKey);
  }

  async getCapabilities(): Promise<ProviderCapabilities> {
    this.refuse();
  }

  async validateDraft(): Promise<{ valid: boolean; errors: ProviderValidationIssue[]; warnings: ProviderValidationIssue[] }> {
    this.refuse();
  }

  async prepareMedia(): Promise<{ providerMediaHandles: Array<{ role: 'primary'; handle: string }> }> {
    this.refuse();
  }

  async publish(): Promise<{
    providerPublishId: string;
    status: 'accepted' | 'processing' | 'published' | 'failed';
    publishedUrl?: string;
    providerMetadata?: unknown;
  }> {
    this.refuse();
  }
}

export class MetaPublishingProvider extends UnconfiguredPublishingProvider {
  readonly providerKey = 'meta';
  readonly displayName = 'Meta (Instagram Business / Facebook Page)';
  // Capabilities (for the plan, not active): feed_post, reel, story; images
  // + videos; publish-now; status polling + webhooks (signature-verified).
}

export class TikTokPublishingProvider extends UnconfiguredPublishingProvider {
  readonly providerKey = 'tiktok';
  readonly displayName = 'TikTok';
  // Capabilities (inactive): short_video; video only; publish-now + polling.
}

export class YouTubePublishingProvider extends UnconfiguredPublishingProvider {
  readonly providerKey = 'youtube';
  readonly displayName = 'YouTube';
  // Capabilities (inactive): video_post; video only; long-running processing.
}

export class LinkedInPublishingProvider extends UnconfiguredPublishingProvider {
  readonly providerKey = 'linkedin';
  readonly displayName = 'LinkedIn';
  // Capabilities (inactive): image_post, video_post.
}

/** Test seam: force a failure at a specific simulated stage. */
export interface FakeFailureControl {
  failOn?: 'publish' | 'media_preparation' | 'status_poll';
  errorCode?: string;
}

const FAKE_MAX_CAPTION = 2200;

/**
 * Development fake provider — clearly labelled, simulates the full
 * draft → ready → submitting → processing → published lifecycle, with
 * deliberate failure support for tests and a safe fictional URL.
 */
export class DevelopmentFakePublishingProvider implements SocialPublishingProvider {
  readonly providerKey = 'dev_fake';
  readonly displayName = 'Development fake provider';
  readonly devOnly = true;

  constructor(private readonly failureControl: FakeFailureControl = {}) {}

  async isConfigured(): Promise<boolean> {
    return true;
  }

  async getCapabilities(): Promise<ProviderCapabilities> {
    return {
      placements: ['image_post', 'video_post', 'reel', 'story'],
      supportsImages: true,
      supportsVideos: true,
      supportsPublishNow: true,
      supportsStatusPolling: true,
      supportsWebhookStatus: false, // poll-only path is exercised
      supportsAltText: true,
      supportsDestinationUrl: false,
      maxCaptionLength: FAKE_MAX_CAPTION,
      supportedAspectRatios: ['1:1', '4:5', '9:16', '16:9'],
    };
  }

  async validateDraft(input: {
    placement: string;
    media: SafeServerMediaReference[];
    copy: PublishingCopyInput;
  }): Promise<{ valid: boolean; errors: ProviderValidationIssue[]; warnings: ProviderValidationIssue[] }> {
    const errors: ProviderValidationIssue[] = [];
    const warnings: ProviderValidationIssue[] = [];

    if (input.placement === 'ad_creative') {
      errors.push({
        field: 'placement',
        code: 'placement_unsupported',
        messageSafe: 'Paid placements are not supported in this phase — publishing is organic only.',
      });
    }
    if (input.media.length !== 1) {
      errors.push({
        field: 'media',
        code: 'media_count',
        messageSafe: 'Exactly one primary output is required.',
      });
    }
    if (input.copy.caption && input.copy.caption.length > FAKE_MAX_CAPTION) {
      errors.push({
        field: 'caption',
        code: 'caption_too_long',
        messageSafe: `Caption exceeds the ${FAKE_MAX_CAPTION}-character limit.`,
      });
    }
    if (input.placement === 'image_post' && !input.copy.altText?.trim()) {
      errors.push({
        field: 'altText',
        code: 'alt_text_required',
        messageSafe: 'Accessibility (alt) text is required for image posts.',
      });
    }
    if (input.copy.destinationUrl) {
      warnings.push({
        field: 'destinationUrl',
        code: 'destination_url_unsupported',
        messageSafe: 'This placement does not support destination URLs — the value will be ignored.',
      });
    }
    return { valid: errors.length === 0, errors, warnings };
  }

  async prepareMedia(input: {
    media: SafeServerMediaReference[];
    idempotencyKey: string;
  }): Promise<{ providerMediaHandles: Array<{ role: 'primary'; handle: string; metadata?: unknown }> }> {
    if (this.failureControl.failOn === 'media_preparation') {
      throw new Error('simulated media preparation failure');
    }
    return {
      providerMediaHandles: input.media.map((m) => ({
        role: 'primary' as const,
        handle: `devfake_media_${m.galleryOutputId}_${input.idempotencyKey.slice(0, 8)}`,
        metadata: { simulated: true },
      })),
    };
  }

  async publish(input: {
    idempotencyKey: string;
    placement: string;
    mediaHandles: Array<{ role: 'primary'; handle: string }>;
    copy: PublishingCopyInput;
  }): Promise<{
    providerPublishId: string;
    status: 'accepted' | 'processing' | 'published' | 'failed';
    publishedUrl?: string;
    providerMetadata?: unknown;
  }> {
    if (this.failureControl.failOn === 'publish') {
      throw new Error('simulated publish failure');
    }
    // Deterministic per-intent id: same idempotency key → same publish id,
    // so a retried duplicate submission cannot create a second post.
    const id = `devfake_pub_${simpleHash(input.idempotencyKey)}`;
    return {
      providerPublishId: id,
      status: 'processing',
      providerMetadata: { simulated: true, placement: input.placement },
    };
  }

  async getPublishStatus(input: {
    providerPublishId: string;
  }): Promise<{
    status: 'processing' | 'published' | 'failed';
    publishedUrl?: string;
    errorCode?: string;
    errorMessageSafe?: string;
    providerMetadata?: unknown;
  }> {
    if (this.failureControl.failOn === 'status_poll') {
      return {
        status: 'failed',
        errorCode: 'simulated_processing_failure',
        errorMessageSafe: 'The provider could not complete this post. You can retry if it was never accepted.',
        providerMetadata: { simulated: true },
      };
    }
    return {
      status: 'published',
      publishedUrl: `https://demo.lockflow.local/posts/${input.providerPublishId}`,
      providerMetadata: { simulated: true },
    };
  }
}

function simpleHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export class PublishingProviderRegistry {
  private readonly providers = new Map<string, SocialPublishingProvider>();

  constructor(...providers: SocialPublishingProvider[]) {
    for (const provider of providers) {
      if (this.providers.has(provider.providerKey)) {
        throw new Error(`Duplicate publishing provider key: ${provider.providerKey}`);
      }
      this.providers.set(provider.providerKey, provider);
    }
  }

  get(providerKey: string): SocialPublishingProvider | null {
    return this.providers.get(providerKey) ?? null;
  }

  list(): SocialPublishingProvider[] {
    return [...this.providers.values()];
  }
}

export function createDefaultPublishingRegistry(
  failureControl: FakeFailureControl = {},
): PublishingProviderRegistry {
  return new PublishingProviderRegistry(
    new MetaPublishingProvider(),
    new TikTokPublishingProvider(),
    new YouTubePublishingProvider(),
    new LinkedInPublishingProvider(),
    new DevelopmentFakePublishingProvider(failureControl),
  );
}
