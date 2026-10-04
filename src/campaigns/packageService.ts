/**
 * Prompt 31 — CampaignContentPackageService: workspace-scoped platform
 * adaptation and packaging over approved Gallery outputs.
 *
 * Uses the existing seams only:
 *   * GalleryService.getOutput — source outputs stay in Gallery; packaging
 *     never mutates them (approved-only rule enforced server-side);
 *   * CampaignsService — campaign/item ownership is workspace-checked through
 *     the existing service, not re-implemented;
 *   * SocialConnectionsService.listConnections — verified-account eligibility
 *     without touching OAuth/token logic (safe record fields only);
 *   * PublishingReviewService.createPublishingReview — the EXISTING explicit
 *     review flow is the only exit toward publishing; nothing auto-publishes.
 *
 * All decisions (eligibility, validation, adaptation) are server-side;
 * the client receives safe, product-friendly messages only.
 */
import {
  getChannelAdaptationRequirements,
  evaluatePackageMedia,
  validatePackageRules,
} from './packageWorkflow';
import type {
  CampaignContentPackageRecord,
  CampaignPackageAuditEvent,
  CampaignPackageAuditRow,
  CampaignPackageStatus,
  PackageMediaVariantRecord,
  PackagePlacement,
} from './packageWorkflow';
import type { CampaignChannelKey } from '../domain/campaigns/types';
import type { GalleryOutputRecord } from '../domain/gallery/types';

// ── Store contract ───────────────────────────────────────────────────────────

export interface PackageStore {
  createPackage(record: CampaignContentPackageRecord): Promise<CampaignContentPackageRecord>;
  getPackage(packageId: string): Promise<CampaignContentPackageRecord | null>;
  updatePackage(
    packageId: string,
    patch: Partial<CampaignContentPackageRecord>,
  ): Promise<CampaignContentPackageRecord>;
  listPackages(workspaceId: string, campaignId: string): Promise<CampaignContentPackageRecord[]>;
  createVariant(record: PackageMediaVariantRecord): Promise<PackageMediaVariantRecord>;
  listVariants(packageId: string): Promise<PackageMediaVariantRecord[]>;
  appendAudit(row: Omit<CampaignPackageAuditRow, 'id' | 'createdAt'>): Promise<void>;
  listAudit(workspaceId: string, filter?: { event?: CampaignPackageAuditEvent }): Promise<CampaignPackageAuditRow[]>;
}

/** In-memory store mirroring the SQL shape (demo mode + tests). */
export class InMemoryPackageStore implements PackageStore {
  readonly packages = new Map<string, CampaignContentPackageRecord>();
  readonly variants: PackageMediaVariantRecord[] = [];
  readonly auditRows: CampaignPackageAuditRow[] = [];

  async createPackage(record: CampaignContentPackageRecord): Promise<CampaignContentPackageRecord> {
    this.packages.set(record.id, structuredClone(record));
    return structuredClone(record);
  }

  async getPackage(packageId: string): Promise<CampaignContentPackageRecord | null> {
    const record = this.packages.get(packageId);
    return record ? structuredClone(record) : null;
  }

  async updatePackage(
    packageId: string,
    patch: Partial<CampaignContentPackageRecord>,
  ): Promise<CampaignContentPackageRecord> {
    const record = this.packages.get(packageId);
    if (!record) throw new Error(`Package not found: ${packageId}`);
    const next = { ...record, ...patch, updatedAt: new Date().toISOString() };
    this.packages.set(packageId, next);
    return structuredClone(next);
  }

  async listPackages(workspaceId: string, campaignId: string): Promise<CampaignContentPackageRecord[]> {
    return [...this.packages.values()]
      .filter((record) => record.workspaceId === workspaceId && record.campaignId === campaignId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((record) => structuredClone(record));
  }

  async createVariant(record: PackageMediaVariantRecord): Promise<PackageMediaVariantRecord> {
    this.variants.push(structuredClone(record));
    return structuredClone(record);
  }

  async listVariants(packageId: string): Promise<PackageMediaVariantRecord[]> {
    return this.variants.filter((variant) => variant.packageId === packageId).map((variant) => structuredClone(variant));
  }

  async appendAudit(row: Omit<CampaignPackageAuditRow, 'id' | 'createdAt'>): Promise<void> {
    this.auditRows.push({ ...row, id: `pkgaudit_${crypto.randomUUID()}`, createdAt: new Date().toISOString() });
  }

  async listAudit(workspaceId: string, filter?: { event?: CampaignPackageAuditEvent }): Promise<CampaignPackageAuditRow[]> {
    return this.auditRows
      .filter((row) => row.workspaceId === workspaceId)
      .filter((row) => !filter?.event || row.event === filter.event)
      .map((row) => structuredClone(row));
  }
}

// ── Dependencies ─────────────────────────────────────────────────────────────

/** Verified-account view the service may see (never token material). */
export interface VerifiedConnectionView {
  id: string;
  providerKey: string;
  status: string;
}

export interface PackageDependencies {
  /** Workspace-checked Gallery read (approved-only rule enforced here). */
  getOutput(galleryOutputId: string, workspaceId: string): Promise<GalleryOutputRecord>;
  /** Workspace-checked campaign ownership probe. */
  getCampaign(campaignId: string, workspaceId: string): Promise<{ id: string; workspaceId: string }>;
  /** Verified connections of the workspace (sanitized record fields only). */
  listVerifiedConnections(workspaceId: string): Promise<VerifiedConnectionView[]>;
  /**
   * The EXISTING publishing-review entry point. Receives an item+placement;
   * returns whether the existing review passed (blockers are safe strings).
   */
  sendToPublishingReview(input: {
    campaignId: string;
    campaignItemId: string;
    placement: PackagePlacement;
    workspaceId: string;
  }): Promise<{ eligible: boolean; blockers: string[] }>;
}

// ── Service ──────────────────────────────────────────────────────────────────

export interface CreateCampaignContentPackageInput {
  campaignId: string;
  channel: CampaignChannelKey;
  placement: PackagePlacement;
  sourceGalleryOutputId: string;
  campaignItemId?: string | null;
  connectedAccountId?: string | null;
  captionOrCopy?: string | null;
  headline?: string | null;
  callToAction?: string | null;
  hashtagsOrTags?: string | null;
  destinationUrl?: string | null;
  cropOrFormatSettings?: Record<string, unknown> | null;
}

export type UpdateCampaignContentPackageInput = Partial<
  Omit<CreateCampaignContentPackageInput, 'campaignId' | 'channel' | 'sourceGalleryOutputId'>
>;

export class CampaignContentPackageService {
  constructor(
    private readonly store: PackageStore,
    private readonly deps: PackageDependencies,
  ) {}

  /** Pure requirements lookup (provider × placement × media type). */
  async getChannelAdaptationRequirements(
    provider: CampaignChannelKey,
    placement: PackagePlacement,
    mediaType: 'image' | 'video' | 'story',
  ) {
    return getChannelAdaptationRequirements(provider, placement, mediaType);
  }

  /**
   * Packages an approved Gallery output for one channel/placement. The
   * source output is never mutated; cross-workspace links fail loudly.
   */
  async createCampaignContentPackage(
    workspaceId: string,
    input: CreateCampaignContentPackageInput,
    actorId: string,
  ): Promise<CampaignContentPackageRecord> {
    // Ownership checks through the existing seams (workspace-safe).
    const campaign = await this.deps.getCampaign(input.campaignId, workspaceId);
    if (campaign.workspaceId !== workspaceId) {
      throw new Error('You do not have access to this workspace.');
    }
    const output = await this.deps.getOutput(input.sourceGalleryOutputId, workspaceId);
    if (output.workspaceId !== workspaceId) {
      throw new Error('You do not have access to this workspace.');
    }
    if (output.status !== 'approved') {
      throw new Error('Only approved Gallery outputs can be packaged for a channel.');
    }

    // Channel/placement/type compatibility is a hard gate on creation.
    const requirements = getChannelAdaptationRequirements(
      input.channel,
      input.placement,
      output.outputType,
    );
    if (!requirements.supported) {
      throw new Error(requirements.reasons.join(' '));
    }

    const media = evaluatePackageMedia(requirements.profile, output, input.cropOrFormatSettings ?? null);
    const stamp = new Date().toISOString();
    const record: CampaignContentPackageRecord = {
      id: `pkg_${crypto.randomUUID()}`,
      workspaceId,
      campaignId: input.campaignId,
      campaignItemId: input.campaignItemId ?? null,
      channel: input.channel,
      placement: input.placement,
      connectedAccountId: input.connectedAccountId ?? null,
      sourceGalleryOutputId: input.sourceGalleryOutputId,
      captionOrCopy: input.captionOrCopy ?? null,
      headline: input.headline ?? null,
      callToAction: input.callToAction ?? null,
      hashtagsOrTags: input.hashtagsOrTags ?? null,
      destinationUrl: input.destinationUrl ?? null,
      mediaVariantReference: null,
      cropOrFormatSettings: input.cropOrFormatSettings ?? null,
      adaptationStatus: media.adaptationStatus,
      validationState: 'unvalidated',
      validationErrors: [],
      status: 'draft',
      createdBy: actorId,
      createdAt: stamp,
      updatedAt: stamp,
    };
    const created = await this.store.createPackage(record);
    await this.store.appendAudit({
      workspaceId,
      packageId: created.id,
      campaignId: input.campaignId,
      event: 'campaign_package_created',
      detail: `Approved output packaged for ${input.channel} (${input.placement}).`,
    });
    return created;
  }

  /** Safe per-channel edits: copy, CTA, tags, URL, account, item, crop. */
  async updateCampaignContentPackage(
    workspaceId: string,
    packageId: string,
    input: UpdateCampaignContentPackageInput,
    actorId: string,
  ): Promise<CampaignContentPackageRecord> {
    const record = await this.requirePackage(workspaceId, packageId);
    const patch: Partial<CampaignContentPackageRecord> = {};
    if (input.captionOrCopy !== undefined) patch.captionOrCopy = input.captionOrCopy;
    if (input.headline !== undefined) patch.headline = input.headline;
    if (input.callToAction !== undefined) patch.callToAction = input.callToAction;
    if (input.hashtagsOrTags !== undefined) patch.hashtagsOrTags = input.hashtagsOrTags;
    if (input.destinationUrl !== undefined) patch.destinationUrl = input.destinationUrl;
    if (input.connectedAccountId !== undefined) patch.connectedAccountId = input.connectedAccountId;
    if (input.campaignItemId !== undefined) patch.campaignItemId = input.campaignItemId;
    if (input.cropOrFormatSettings !== undefined) patch.cropOrFormatSettings = input.cropOrFormatSettings;
    if (input.placement !== undefined) {
      const requirements = getChannelAdaptationRequirements(record.channel, input.placement, 'image');
      if (!requirements.profile.placements.includes(input.placement)) {
        throw new Error(`${input.placement.replace('_', ' ')} is not a supported placement for ${record.channel}.`);
      }
      patch.placement = input.placement;
    }

    // Edits reset validation — the package must be re-validated honestly.
    patch.validationState = 'unvalidated';
    patch.validationErrors = [];
    if (record.status !== 'handed_to_publishing' && record.status !== 'approved_for_publish') {
      patch.status = 'draft';
    }

    const updated = await this.store.updatePackage(packageId, patch);
    await this.store.appendAudit({
      workspaceId,
      packageId,
      campaignId: record.campaignId,
      event: 'campaign_package_updated',
      detail: `Package updated (${Object.keys(patch).join(', ')}).`,
    });
    void actorId;
    return updated;
  }

  /**
   * Server-side validation: channel rules + media compatibility + verified
   * account + campaign-item attachment. Sets the honest readiness status.
   */
  async validateCampaignContentPackage(
    workspaceId: string,
    packageId: string,
  ): Promise<CampaignContentPackageRecord> {
    const record = await this.requirePackage(workspaceId, packageId);
    const output = await this.deps.getOutput(record.sourceGalleryOutputId, workspaceId);
    const requirements = getChannelAdaptationRequirements(record.channel, record.placement, output.outputType);
    const media = evaluatePackageMedia(requirements.profile, output, record.cropOrFormatSettings);

    const connections = await this.deps.listVerifiedConnections(workspaceId);
    const assigned = record.connectedAccountId
      ? connections.find((connection) => connection.id === record.connectedAccountId) ?? null
      : null;
    const profile = requirements.profile;

    const result = validatePackageRules({
      profile,
      packageName: record.id,
      placement: record.placement,
      captionOrCopy: record.captionOrCopy,
      hashtagsOrTags: record.hashtagsOrTags,
      destinationUrl: record.destinationUrl,
      connectedAccountId: record.connectedAccountId,
      accountVerified: assigned?.status === 'connected',
      accountProviderMatches: assigned !== null && (profile.providerKey === null || assigned.providerKey === profile.providerKey),
      campaignItemId: record.campaignItemId,
      media,
    });

    const updated = await this.store.updatePackage(packageId, {
      adaptationStatus: media.adaptationStatus,
      validationState: result.valid ? 'valid' : 'invalid',
      validationErrors: result.errors,
      status: result.nextStatus,
    });
    await this.store.appendAudit({
      workspaceId,
      packageId,
      campaignId: record.campaignId,
      event: result.valid ? 'campaign_package_validation_passed' : 'campaign_package_validation_blocked',
      detail: result.valid
        ? 'Package is ready for publishing review.'
        : `Blocked: ${result.errors.length} issue(s).`,
    });
    return updated;
  }

  /**
   * Requests a per-channel media variant (crop/format). Only transforms the
   * app can honestly perform are accepted; the variant is recorded as
   * `requested` — readiness stays blocked until a real transform exists.
   */
  async createPackageMediaVariant(
    workspaceId: string,
    packageId: string,
    settings: { targetAspectRatio?: string; cropSettings?: Record<string, unknown> },
    actorId: string,
  ): Promise<PackageMediaVariantRecord> {
    const record = await this.requirePackage(workspaceId, packageId);
    const output = await this.deps.getOutput(record.sourceGalleryOutputId, workspaceId);
    const requirements = getChannelAdaptationRequirements(record.channel, record.placement, output.outputType);
    const media = evaluatePackageMedia(
      requirements.profile,
      output,
      { targetAspectRatio: settings.targetAspectRatio ?? null },
    );

    const variant: PackageMediaVariantRecord = {
      id: `pkgvar_${crypto.randomUUID()}`,
      workspaceId,
      packageId,
      sourceGalleryOutputId: record.sourceGalleryOutputId,
      targetAspectRatio: settings.targetAspectRatio ?? null,
      cropSettings: settings.cropSettings ?? null,
      status: media.adaptationStatus === 'unsupported' ? 'unsupported' : 'requested',
      notes: media.notes.join(' ') || null,
      createdBy: actorId,
      createdAt: new Date().toISOString(),
    };
    const created = await this.store.createVariant(variant);
    if (variant.status !== 'unsupported') {
      await this.store.updatePackage(packageId, {
        cropOrFormatSettings: { ...(record.cropOrFormatSettings ?? {}), targetAspectRatio: settings.targetAspectRatio ?? null },
        mediaVariantReference: created.id,
        adaptationStatus: media.adaptationStatus,
      });
    }
    await this.store.appendAudit({
      workspaceId,
      packageId,
      campaignId: record.campaignId,
      event: 'campaign_package_variant_requested',
      detail: variant.status === 'unsupported'
        ? `Variant not possible: ${variant.notes ?? 'unsupported transform'}.`
        : `Variant requested (target ${settings.targetAspectRatio ?? 'n/a'}).`,
    });
    return created;
  }

  /**
   * Hands a READY package into the EXISTING Publishing Review flow. Nothing
   * is published here; the existing explicit review/confirm steps follow.
   */
  async sendPackageToPublishingReview(
    workspaceId: string,
    packageId: string,
    actorId: string,
  ): Promise<{ status: CampaignPackageStatus; blockers: string[] }> {
    const record = await this.requirePackage(workspaceId, packageId);
    if (record.status !== 'ready_for_review') {
      throw new Error('Only ready packages can move into publishing review — validate the package first.');
    }
    if (!record.campaignItemId) {
      throw new Error('Attach the package to a campaign item before publishing review.');
    }

    const review = await this.deps.sendToPublishingReview({
      campaignId: record.campaignId,
      campaignItemId: record.campaignItemId,
      placement: record.placement,
      workspaceId,
    });
    if (!review.eligible) {
      await this.store.updatePackage(packageId, {
        validationErrors: review.blockers,
      });
      await this.store.appendAudit({
        workspaceId,
        packageId,
        campaignId: record.campaignId,
        event: 'campaign_package_validation_blocked',
        detail: `Publishing review found blockers: ${review.blockers.join('; ')}`,
      });
      return { status: record.status, blockers: review.blockers };
    }

    await this.store.updatePackage(packageId, { status: 'handed_to_publishing' });
    await this.store.appendAudit({
      workspaceId,
      packageId,
      campaignId: record.campaignId,
      event: 'campaign_package_sent_to_review',
      detail: 'Package handed to the existing publishing review flow.',
    });
    void actorId;
    return { status: 'handed_to_publishing', blockers: [] };
  }

  /** All packages of one campaign (workspace-scoped). */
  async listCampaignContentPackages(
    workspaceId: string,
    campaignId: string,
  ): Promise<CampaignContentPackageRecord[]> {
    return this.store.listPackages(workspaceId, campaignId);
  }

  /** Package variants (per-channel media preparation history). */
  async listPackageVariants(workspaceId: string, packageId: string): Promise<PackageMediaVariantRecord[]> {
    await this.requirePackage(workspaceId, packageId);
    return this.store.listVariants(packageId);
  }

  async listAudit(workspaceId: string, filter?: { event?: CampaignPackageAuditEvent }) {
    return this.store.listAudit(workspaceId, filter);
  }

  /** Loads the package and enforces workspace scoping. */
  private async requirePackage(
    workspaceId: string,
    packageId: string,
  ): Promise<CampaignContentPackageRecord> {
    const record = await this.store.getPackage(packageId);
    if (!record) throw new Error(`Package not found: ${packageId}`);
    if (record.workspaceId !== workspaceId) {
      throw new Error('You do not have access to this workspace.');
    }
    return record;
  }
}
