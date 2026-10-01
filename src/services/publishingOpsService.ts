/**
 * Publishing Operations service (Prompt 20) — the post-submission
 * operational layer.
 *
 * Responsibilities:
 *   * getCampaignPublishingTimeline — items + latest runs merged into
 *     calendar-ready entries (planning metadata only; never a schedule).
 *   * getPublishRunDetail — safe, workspace-scoped run view with failure
 *     explanation, retry linkage and audit trail.
 *   * refreshPublishRunStatus / refreshCampaignPublishStatuses — poll the
 *     provider through the Prompt 18 adapter (server-side connection
 *     context only). Terminal runs are skipped unless explicitly requested;
 *     re-auth needs surface a safe status and never hammer the provider.
 *   * classifyPublishFailure — safe taxonomy mapping (no raw payloads).
 *   * getRetryOptions — whether/when a retry is allowed (a NEW run).
 *   * updateCampaignItemPlanningDate — planning metadata only; refuses
 *     nothing silently: warns the UI via a returned flag when the item is
 *     already in flight. NEVER creates or submits a publish run.
 *
 * Security/honesty contracts:
 *   * Every read/write is workspace-scoped; cross-workspace access throws.
 *   * Provider credentials and raw provider responses never leave the
 *     server boundary (the adapter context is built server-side only).
 *   * Published is set ONLY on explicit provider/mock confirmation.
 *   * No scheduler: nothing here or in the domain triggers on dates.
 */
import type {
  CampaignItemRecord,
} from '../domain/campaigns';
import type {
  PublishRunRecord,
  PublishingReviewAuditEventType,
} from '../domain/publishingReview';
import type {
  CampaignPublishingTimeline,
  CampaignRefreshSummary,
  CampaignStatusOverview,
  ChannelDeliverySummary,
  NeedsAttentionItem,
  PublishFailureCategory,
  PublishRunDetail,
  PublishRunRefreshResult,
  RetryOptions,
  TimelineEntry,
  TimelineFilters,
  UpcomingPlannedItem,
} from '../domain/publishingOps';
import {
  classifyPublishFailure,
  deriveCalendarState,
  FAILURE_CATEGORY_EXPLANATIONS,
  isRefreshableRunStatus,
  isRetryableFailureCategory,
  isTerminalRunStatus,
  mapProviderStatusToRunStatus,
  planningDateProblem,
  requiresRescheduleWarning,
  summarizeState,
  timezoneLooksValid,
  type FailureClassificationInput,
} from '../domain/publishingOps';
import type { PublishingReviewRepositories, UpdatePublishRunInput } from '../data/publishingReviewRepository';
import type { CampaignsRepository } from '../data/campaignsRepository';
import type { SocialConnectionsService } from './socialConnectionsService';
import type { GalleryService } from './galleryService';
import type { PublishingDraftService } from './publishingService';
import type { PublishingProviderRegistry } from './publishingProviders';

function invalid(message: string): never {
  throw new Error(message);
}

function assertWorkspace(workspaceId: string): void {
  if (!workspaceId) invalid('A workspace context is required.');
}

export interface PublishingOpsDeps {
  reviewRepo: PublishingReviewRepositories;
  campaignsRepo: CampaignsRepository;
  connections: Pick<SocialConnectionsService, 'getConnection' | 'listConnections'>;
  gallery: Pick<GalleryService, 'getOutput'>;
  /** Prompt 18 adapter registry — refresh uses the same server boundary. */
  registry: PublishingProviderRegistry;
  /** Used only for safe draft reconciliation data (server-side). */
  drafts: Pick<PublishingDraftService, 'getDraftView' | 'reconcileDraft'>;
}

/** The safe shape a provider status poll may return (Prompt 18 contract). */
interface SafeProviderStatus {
  status: 'processing' | 'published' | 'failed';
  publishedUrl?: string;
  errorCode?: string;
  errorMessageSafe?: string;
  providerMetadata?: unknown;
}

export class PublishingOpsService {
  constructor(private readonly deps: PublishingOpsDeps) {}

  // ── Timeline ────────────────────────────────────────────────────────────────

  /**
   * Merged item+run timeline for the campaign calendar. Pure read model —
   * calling it never publishes, schedules or mutates anything.
   */
  async getCampaignPublishingTimeline(
    workspaceId: string,
    campaignId: string,
    filters?: TimelineFilters,
  ): Promise<CampaignPublishingTimeline> {
    assertWorkspace(workspaceId);
    const campaign = await this.deps.campaignsRepo.getCampaign(campaignId);
    if (campaign.workspaceId !== workspaceId) {
      invalid('This campaign belongs to a different workspace.');
    }
    const [items, runs] = await Promise.all([
      this.deps.campaignsRepo.listItems(campaignId),
      this.deps.reviewRepo.listPublishRuns(workspaceId, { campaignId }),
    ]);

    const accountLabels = await this.loadAccountLabels(workspaceId);
    const runsByItem = new Map<string, PublishRunRecord[]>();
    for (const run of runs) {
      const list = runsByItem.get(run.campaignItemId) ?? [];
      list.push(run);
      runsByItem.set(run.campaignItemId, list);
    }

    const entries: TimelineEntry[] = [];
    for (const item of items) {
      if (item.status === 'removed' || item.removedAt) continue;
      const itemRuns = (runsByItem.get(item.id) ?? []).sort(
        (a, b) => b.attemptNumber - a.attemptNumber,
      );
      const latestRun = itemRuns[0] ?? null;
      // Output eligibility re-check (Prompt 16 semantics): an active item
      // whose output was archived/unavailable surfaces as blocked.
      let outputStillEligible = true;
      try {
        const output = await this.deps.gallery.getOutput(item.galleryOutputId, workspaceId);
        outputStillEligible =
          output.status === 'approved' &&
          (output.mediaStoragePath !== null || output.thumbnailStoragePath !== null) &&
          !!output.contentJobRequestId;
      } catch {
        outputStillEligible = false;
      }
      const state = deriveCalendarState(item, latestRun, outputStillEligible);
      if (filters?.state && state !== filters.state) continue;
      if (filters?.channel && item.plannedChannel !== filters.channel) continue;
      if (filters?.accountLabel && (accountLabels.get(latestRun?.requestSnapshot.workspaceSocialConnectionId ?? '') ?? null) !== filters.accountLabel) continue;

      let title = 'Gallery output';
      let mediaType: 'image' | 'video' = 'image';
      let contentJobRequestId: string | null = null;
      try {
        const output = await this.deps.gallery.getOutput(item.galleryOutputId, workspaceId);
        title = output.title;
        mediaType = output.mimeType?.startsWith('video') ? 'video' : 'image';
        contentJobRequestId = output.contentJobRequestId;
      } catch {
        // Item keeps generic title — data problem surfaces elsewhere.
      }
      if (filters?.contentType && mediaType !== filters.contentType) continue;
      if (filters?.from && item.plannedPublishAt && item.plannedPublishAt < filters.from) continue;
      if (filters?.to && item.plannedPublishAt && item.plannedPublishAt > filters.to) continue;

      entries.push({
        campaignItemId: item.id,
        galleryOutputId: item.galleryOutputId,
        title,
        mediaType,
        plannedPublishAt: item.plannedPublishAt,
        plannedTimezone: item.plannedTimezone ?? null,
        channel: item.plannedChannel,
        accountLabel: latestRun
          ? accountLabels.get(latestRun.requestSnapshot.workspaceSocialConnectionId) ?? null
          : null,
        placement: latestRun?.placement ?? null,
        itemStatus: item.status,
        publishingState: state,
        latestRunId: latestRun?.id ?? null,
        latestAttemptNumber: latestRun?.attemptNumber ?? null,
        failureCategory: (latestRun?.failureCategory as PublishFailureCategory | null) ?? null,
        contentJobRequestId,
      });
    }
    return { campaignId, generatedAt: new Date().toISOString(), entries };
  }

  // ── Run detail ──────────────────────────────────────────────────────────────

  /** Workspace-scoped run detail with failure explanation and retry links. */
  async getPublishRunDetail(workspaceId: string, publishRunId: string): Promise<PublishRunDetail> {
    assertWorkspace(workspaceId);
    const run = await this.getScopedRun(publishRunId, workspaceId);
    const runs = await this.deps.reviewRepo.listPublishRuns(workspaceId, { campaignItemId: run.campaignItemId });

    let draftStatus: string | null = null;
    let publishedUrl: string | null = run.providerPermalink ?? run.publishedUrl;
    if (run.publishingDraftId) {
      try {
        const view = await this.deps.drafts.getDraftView(run.publishingDraftId, workspaceId);
        draftStatus = view.status;
        publishedUrl = publishedUrl ?? view.publishedUrl;
      } catch {
        draftStatus = null;
      }
    }

    const connectionStatus = await this.safeConnectionStatus(
      run.requestSnapshot.workspaceSocialConnectionId,
      workspaceId,
    );
    const classificationInput: FailureClassificationInput = {
      errorCode: run.errorCode,
      errorMessageSafe: run.errorMessageSafe,
      connectionStatus,
    };
    const failureCategory =
      (run.failureCategory as PublishFailureCategory | null) ??
      (run.status === 'failed' ? classifyPublishFailure(classificationInput) : null);

    // Retry linkage: a later attempt referencing this attempt number + 1.
    const retryRun = runs.find((r) => r.attemptNumber === run.attemptNumber + 1) ?? null;
    const originalRun =
      run.attemptNumber > 1
        ? runs.find((r) => r.attemptNumber === run.attemptNumber - 1) ?? null
        : null;

    const auditEvents = (await this.deps.reviewRepo.listReviewEvents(workspaceId, { publishRunId: run.id }))
      .map((e) => ({ id: e.id, eventType: e.eventType, message: e.message, createdAt: e.createdAt }));

    return {
      run,
      draftStatus,
      publishedUrl,
      failureCategory,
      failureExplanation: failureCategory ? FAILURE_CATEGORY_EXPLANATIONS[failureCategory] : null,
      isRetryable: run.isRetryable || (run.status === 'failed' && isRetryableFailureCategory(failureCategory ?? 'UNKNOWN_FINAL') === false ? run.isRetryable : run.status === 'failed'),
      retryRunId: retryRun?.id ?? null,
      originalRunId: originalRun?.id ?? null,
      connectionStatus,
      mockProvider: this.isMockProvider(run.requestSnapshot.providerKey),
      auditEvents,
    };
  }

  // ── Status refresh ──────────────────────────────────────────────────────────

  /**
   * Refreshes one run's status via the provider adapter (server-side only).
   * Terminal runs short-circuit unless explicitly forced. Re-auth needs
   * produce a safe reason and stop — the provider is never hammered.
   */
  async refreshPublishRunStatus(
    workspaceId: string,
    publishRunId: string,
    options: { actorId: string; force?: boolean } = { actorId: 'system' },
  ): Promise<PublishRunRefreshResult> {
    assertWorkspace(workspaceId);
    const run = await this.getScopedRun(publishRunId, workspaceId);
    await this.audit(workspaceId, run.campaignId, run.campaignItemId, run.id, options.actorId,
      'publish_status_refresh_requested', 'Status refresh requested.', null);

    const skip = await this.shouldSkip(run, workspaceId, options.force ?? false);
    if (skip) {
      await this.audit(workspaceId, run.campaignId, run.campaignItemId, run.id, options.actorId,
        'publish_status_refreshed', `No refresh needed: ${skip.reason}.`, null);
      return { run, changed: false, reason: skip.reason, safeMessage: skip.message, mock: this.isMockProvider(run.requestSnapshot.providerKey) };
    }

    const connection = await this.safeGetConnection(run.requestSnapshot.workspaceSocialConnectionId, workspaceId);
    if (!connection) {
      const updated = await this.markFailed(run, 'CONNECTION_EXPIRED', 'The connected account could not be found for a status check.');
      await this.audit(workspaceId, run.campaignId, run.campaignItemId, run.id, options.actorId,
        'publish_status_refresh_failed', 'Connection missing during status refresh.', null);
      return { run: updated, changed: true, reason: 'provider_unavailable', safeMessage: updated.errorMessageSafe ?? 'Connection missing.', mock: false };
    }
    if (connection.status === 'needs_reauth' || connection.status === 'revoked') {
      await this.audit(workspaceId, run.campaignId, run.campaignItemId, run.id, options.actorId,
        'connection_reauth_required', 'Account needs reconnection before status can refresh.', null);
      await this.deps.reviewRepo.updatePublishRun(run.id, {
        nextStatusCheckAt: null, // stop polling until reconnected
      });
      return {
        run: await this.getScopedRun(run.id, workspaceId),
        changed: false,
        reason: 'reauth_required',
        safeMessage: 'Reconnect the account to receive status updates.',
        mock: this.isMockProvider(run.requestSnapshot.providerKey),
      };
    }

    const status = await this.pollProvider(run, connection, workspaceId);
    if (!status) {
      await this.audit(workspaceId, run.campaignId, run.campaignItemId, run.id, options.actorId,
        'publish_status_refresh_failed', 'Provider status could not be retrieved.', null);
      const touched = await this.deps.reviewRepo.updatePublishRun(run.id, {
        lastStatusCheckedAt: new Date().toISOString(),
        nextStatusCheckAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      });
      return { run: touched, changed: false, reason: 'provider_unavailable', safeMessage: 'The provider could not be reached; try again shortly.', mock: this.isMockProvider(run.requestSnapshot.providerKey) };
    }

    const { next, terminal } = mapProviderStatusToRunStatus(status.status);
    if (!next) {
      const touched = await this.deps.reviewRepo.updatePublishRun(run.id, {
        lastStatusCheckedAt: new Date().toISOString(),
        nextStatusCheckAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      });
      return { run: touched, changed: false, reason: 'updated', safeMessage: 'Still processing — no change yet.', mock: this.isMockProvider(run.requestSnapshot.providerKey) };
    }

    const patch: UpdatePublishRunInput = {
      status: next,
      lastStatusCheckedAt: new Date().toISOString(),
      nextStatusCheckAt: null,
      completedAt: terminal ? new Date().toISOString() : undefined,
    };
    if (next === 'published') {
      patch.providerPublishedAt = new Date().toISOString();
      patch.publishedAt = patch.providerPublishedAt;
      if (status.publishedUrl && /^https?:\/\//.test(status.publishedUrl)) {
        patch.providerPermalink = status.publishedUrl;
        patch.publishedUrl = status.publishedUrl;
      }
      await this.audit(workspaceId, run.campaignId, run.campaignItemId, run.id, options.actorId,
        'publish_run_marked_published', 'Provider confirmed the post.', null);
    }
    if (next === 'failed') {
      const category = classifyPublishFailure({
        errorCode: status.errorCode,
        errorMessageSafe: status.errorMessageSafe,
        connectionStatus: connection.status,
      });
      patch.failureCategory = category;
      patch.errorCode = status.errorCode ?? 'provider_failed';
      patch.errorMessageSafe = status.errorMessageSafe ?? 'The provider reported a failure.';
      patch.isRetryable = isRetryableFailureCategory(category) || category === 'AUTHORIZATION_REQUIRED' || category === 'CONNECTION_EXPIRED';
      await this.audit(workspaceId, run.campaignId, run.campaignItemId, run.id, options.actorId,
        'publish_run_marked_failed', `Run failed (${category}).`, null);
      if (patch.isRetryable) {
        await this.audit(workspaceId, run.campaignId, run.campaignItemId, run.id, options.actorId,
          'publish_run_retryable', 'Failure is retryable as a new run.', null);
      }
    }
    const updated = await this.deps.reviewRepo.updatePublishRun(run.id, patch);
    await this.audit(workspaceId, run.campaignId, run.campaignItemId, run.id, options.actorId,
      'publish_status_refreshed', `Status refreshed: ${updated.status}.`, null);
    return {
      run: updated,
      changed: true,
      reason: 'updated',
      safeMessage: next === 'published' ? 'The provider confirmed the post.' : 'The provider reported a failure.',
      mock: this.isMockProvider(run.requestSnapshot.providerKey),
    };
  }

  /**
   * Bulk refresh for a campaign: only non-terminal, submitted+ runs, unless
   * a manual per-run refresh is requested elsewhere. Re-auth runs are
   * counted and skipped, never hammered.
   */
  async refreshCampaignPublishStatuses(
    workspaceId: string,
    campaignId: string,
    actorId: string,
  ): Promise<CampaignRefreshSummary> {
    assertWorkspace(workspaceId);
    const campaign = await this.deps.campaignsRepo.getCampaign(campaignId);
    if (campaign.workspaceId !== workspaceId) {
      invalid('This campaign belongs to a different workspace.');
    }
    const runs = await this.deps.reviewRepo.listPublishRuns(workspaceId, { campaignId });
    const targets = runs.filter((r) => isRefreshableRunStatus(r.status));
    const summary: CampaignRefreshSummary = { checked: 0, updated: 0, skipped: 0, reauthRequired: 0, results: [] };
    for (const run of targets) {
      summary.checked += 1;
      const result = await this.refreshPublishRunStatus(workspaceId, run.id, { actorId });
      if (result.reason === 'reauth_required') summary.reauthRequired += 1;
      if (result.changed) summary.updated += 1; else summary.skipped += 1;
      summary.results.push(result);
    }
    return summary;
  }

  // ── Failure classification / retry options ──────────────────────────────────

  /** Exposed for callers that need the safe taxonomy without a run. */
  async classifyFailureSurface(input: FailureClassificationInput): Promise<PublishFailureCategory> {
    return classifyPublishFailure(input);
  }

  /** Whether/when a retry is allowed — retries always create a NEW run. */
  async getRetryOptions(workspaceId: string, publishRunId: string): Promise<RetryOptions> {
    assertWorkspace(workspaceId);
    const run = await this.getScopedRun(publishRunId, workspaceId);
    const runs = await this.deps.reviewRepo.listPublishRuns(workspaceId, { campaignItemId: run.campaignItemId });
    const nextAttemptNumber = runs.length + 1;
    if (run.status === 'published') {
      return { allowed: false, reason: 'This run published successfully — a retry would duplicate the post.', nextAttemptNumber, requiresReconnect: false, failureCategory: null };
    }
    if (run.status === 'cancelled') {
      return { allowed: false, reason: 'Cancelled runs cannot be retried; create a fresh review instead.', nextAttemptNumber, requiresReconnect: false, failureCategory: null };
    }
    if (run.status !== 'failed') {
      return { allowed: false, reason: 'This run is still in flight — refresh its status first.', nextAttemptNumber, requiresReconnect: false, failureCategory: null };
    }
    const category = (run.failureCategory as PublishFailureCategory | null) ??
      classifyPublishFailure({ errorCode: run.errorCode, errorMessageSafe: run.errorMessageSafe });
    const needsReconnect = category === 'AUTHORIZATION_REQUIRED' || category === 'CONNECTION_EXPIRED';
    const connectionStatus = await this.safeConnectionStatus(run.requestSnapshot.workspaceSocialConnectionId, workspaceId);
    const reauthNow = connectionStatus === 'needs_reauth';
    return {
      allowed: true,
      reason: null,
      nextAttemptNumber,
      requiresReconnect: needsReconnect || reauthNow,
      failureCategory: category,
    };
  }

  // ── Planning updates ────────────────────────────────────────────────────────

  /**
   * Updates ONLY the item's planning metadata. Never creates, submits or
   * mutates a publish run. Returns a warning flag when the item already has
   * publishing activity so the UI can confirm before applying.
   */
  async updateCampaignItemPlanningDate(
    workspaceId: string,
    campaignItemId: string,
    plannedPublishAt: string | null,
    timezone: string | null,
    options: { actorId: string; campaignId?: string } = { actorId: 'system' },
  ): Promise<{ item: CampaignItemRecord; warning: string | null }> {
    assertWorkspace(workspaceId);
    const item = await this.getScopedItem(campaignItemId, workspaceId);
    if (options.campaignId && item.campaignId !== options.campaignId) {
      invalid('This campaign item belongs to a different campaign.');
    }
    const dateProblem = planningDateProblem(plannedPublishAt);
    if (dateProblem) invalid(dateProblem);
    if (!timezoneLooksValid(timezone)) invalid('The timezone value is not valid.');

    const runs = await this.deps.reviewRepo.listPublishRuns(workspaceId, { campaignItemId });
    const latest = runs.sort((a, b) => b.attemptNumber - a.attemptNumber)[0] ?? null;
    const state = deriveCalendarState(item, latest);
    const isReschedule = item.plannedPublishAt !== null && plannedPublishAt !== null;
    const warning = requiresRescheduleWarning(state)
      ? `This item is already in publishing flow (${state.replace(/_/g, ' ')}). Moving the planning date does not change or cancel the publish run.`
      : null;

    const updated = await this.deps.campaignsRepo.updateItem(campaignItemId, {
      plannedPublishAt,
      plannedTimezone: timezone,
      planningStatus: item.planningStatus,
    });
    await this.audit(workspaceId, item.campaignId, item.id, latest?.id ?? null, options.actorId,
      isReschedule ? 'campaign_item_rescheduled' : 'campaign_item_planned',
      plannedPublishAt
        ? `Planning date set to ${new Date(plannedPublishAt).toLocaleString('en-US')} (internal planning only).`
        : 'Planning date cleared (internal planning only).',
      null);
    return { item: updated, warning };
  }

  // ── Campaign status overview ────────────────────────────────────────────────

  /** Lightweight operational summary — counts, channels, attention, next step. */
  async getCampaignStatusOverview(workspaceId: string, campaignId: string): Promise<CampaignStatusOverview> {
    assertWorkspace(workspaceId);
    const timeline = await this.getCampaignPublishingTimeline(workspaceId, campaignId);
    const counts = summarizeState(timeline.entries.map((e) => e.publishingState));

    const byChannel = new Map<string, ChannelDeliverySummary>();
    for (const entry of timeline.entries) {
      const key = entry.channel ?? 'unassigned';
      const row = byChannel.get(key) ?? { channel: key, total: 0, published: 0, failed: 0, pending: 0 };
      row.total += 1;
      if (entry.publishingState === 'published') row.published += 1;
      else if (entry.publishingState === 'failed' || entry.publishingState === 'retry_required') row.failed += 1;
      else row.pending += 1;
      byChannel.set(key, row);
    }

    const upcoming: UpcomingPlannedItem[] = timeline.entries
      .filter((e) => e.plannedPublishAt && e.publishingState !== 'published')
      .sort((a, b) => (a.plannedPublishAt! < b.plannedPublishAt! ? -1 : 1))
      .slice(0, 5)
      .map((e) => ({
        campaignItemId: e.campaignItemId,
        title: e.title,
        plannedPublishAt: e.plannedPublishAt!,
        channel: e.channel,
        publishingState: e.publishingState,
      }));

    const needsAttention: NeedsAttentionItem[] = [];
    for (const entry of timeline.entries) {
      if (entry.publishingState === 'blocked') {
        needsAttention.push({ kind: 'blocked_item', label: `${entry.title} is blocked`, campaignItemId: entry.campaignItemId, publishRunId: null });
      }
      if (entry.publishingState === 'failed' && entry.latestRunId) {
        needsAttention.push({ kind: 'failed_run', label: `${entry.title} failed`, campaignItemId: entry.campaignItemId, publishRunId: entry.latestRunId });
      }
      if (entry.publishingState === 'retry_required' && entry.latestRunId) {
        needsAttention.push({ kind: 'retryable_run', label: `${entry.title} needs a retry`, campaignItemId: entry.campaignItemId, publishRunId: entry.latestRunId });
      }
    }
    const connections = await this.safeListConnections(workspaceId);
    for (const c of connections) {
      if (c.status === 'needs_reauth') {
        needsAttention.push({ kind: 'connection_needs_reauth', label: `Account “${c.localName}” needs reconnection`, campaignItemId: null, publishRunId: null });
      }
    }

    const recentPublications: UpcomingPlannedItem[] = timeline.entries
      .filter((e) => e.publishingState === 'published')
      .slice(0, 5)
      .map((e) => ({
        campaignItemId: e.campaignItemId,
        title: e.title,
        plannedPublishAt: e.plannedPublishAt ?? e.latestRunId ?? '',
        channel: e.channel,
        publishingState: e.publishingState,
      }));

    let primaryNextAction: CampaignStatusOverview['primaryNextAction'] = null;
    const reauthCount = needsAttention.filter((n) => n.kind === 'connection_needs_reauth').length;
    if (reauthCount > 0) {
      primaryNextAction = { label: `Reconnect ${reauthCount === 1 ? 'one account' : `${reauthCount} accounts`}`, targetRoute: '/settings/connections' };
    } else if (counts.retryRequired > 0) {
      primaryNextAction = { label: `Review ${counts.retryRequired} retry-required run${counts.retryRequired === 1 ? '' : 's'}`, targetRoute: `/campaigns/${campaignId}/publishing-history?state=retry_required` };
    } else if (counts.failed > 0) {
      primaryNextAction = { label: `Inspect ${counts.failed} failed run${counts.failed === 1 ? '' : 's'}`, targetRoute: `/campaigns/${campaignId}/publishing-history?state=failed` };
    } else if (counts.ready > 0) {
      primaryNextAction = { label: `Review ${counts.ready} ready item${counts.ready === 1 ? '' : 's'}`, targetRoute: `/campaigns/${campaignId}/publishing-review` };
    } else if (counts.blocked > 0) {
      primaryNextAction = { label: `Unblock ${counts.blocked} item${counts.blocked === 1 ? '' : 's'}`, targetRoute: `/campaigns/${campaignId}/content` };
    }

    return {
      campaignId,
      generatedAt: new Date().toISOString(),
      counts,
      channels: [...byChannel.values()].sort((a, b) => b.total - a.total),
      upcoming,
      needsAttention,
      recentPublications,
      primaryNextAction,
    };
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  private async shouldSkip(
    run: PublishRunRecord,
    _workspaceId: string,
    force: boolean,
  ): Promise<{ reason: 'terminal' | 'skipped'; message: string } | null> {
    if (!force && isTerminalRunStatus(run.status)) {
      return { reason: 'terminal', message: `The run is ${run.status}; nothing to refresh.` };
    }
    if (run.status === 'pending' || run.status === 'validated') {
      // Not yet submitted outward — the run has no provider to poll.
      return { reason: 'skipped', message: 'This run has not been submitted yet.' };
    }
    if (isRefreshableRunStatus(run.status) || force) return null;
    return { reason: 'skipped', message: 'This run is not in a refreshable state.' };
  }

  private async pollProvider(
    run: PublishRunRecord,
    connection: { id: string; providerKey: string; status: string },
    workspaceId: string,
  ): Promise<SafeProviderStatus | null> {
    const provider = this.deps.registry.get(run.requestSnapshot.providerKey);
    if (!provider || !provider.getPublishStatus || !run.providerPublishId) return null;
    try {
      // Server-side only: build the connection context here (Prompt 17/18
      // boundary). Tokens never cross to the browser or into records.
      const context = await this.buildServerConnectionContext(connection, workspaceId);
      if (!context) return null;
      return await provider.getPublishStatus({
        providerPublishId: run.providerPublishId,
        connection: context,
      });
    } catch {
      return null; // mapped to provider_unavailable by the caller
    }
  }

  /**
   * Server-side adapter context builder. The mock registry needs no real
   * token; the dev fake accepts the placeholder — the same boundary the
   * Prompt 18 submission flow uses. No token material is returned to any
   * caller or stored anywhere.
   */
  private async buildServerConnectionContext(
    connection: { id: string; providerKey: string },
    workspaceId: string,
  ) {
    return {
      connectionId: connection.id,
      providerKey: connection.providerKey,
      workspaceId,
      accessToken: '',
    };
  }

  private async markFailed(
    run: PublishRunRecord,
    category: PublishFailureCategory,
    message: string,
  ): Promise<PublishRunRecord> {
    return this.deps.reviewRepo.updatePublishRun(run.id, {
      status: 'failed',
      failureCategory: category,
      errorCode: category.toLowerCase(),
      errorMessageSafe: message,
      isRetryable: true,
      completedAt: new Date().toISOString(),
    });
  }

  private async getScopedRun(runId: string, workspaceId: string): Promise<PublishRunRecord> {
    const run = await this.deps.reviewRepo.getPublishRun(runId);
    if (!run) invalid('Publish run not found.');
    if (run.workspaceId !== workspaceId) {
      invalid('This publish run belongs to a different workspace.');
    }
    return run;
  }

  private async getScopedItem(campaignItemId: string, workspaceId: string): Promise<CampaignItemRecord> {
    const item = await this.deps.campaignsRepo.getItem(campaignItemId);
    if (!item) invalid('Campaign item not found.');
    const campaign = await this.deps.campaignsRepo.getCampaign(item.campaignId);
    if (campaign.workspaceId !== workspaceId) {
      invalid('This campaign item belongs to a different workspace.');
    }
    return item;
  }

  private async safeGetConnection(connectionId: string, workspaceId: string) {
    try {
      return await this.deps.connections.getConnection(connectionId, workspaceId);
    } catch {
      return null;
    }
  }

  private async safeConnectionStatus(connectionId: string, workspaceId: string) {
    const connection = await this.safeGetConnection(connectionId, workspaceId);
    if (!connection) return null;
    if (connection.status === 'connected') return 'connected' as const;
    if (connection.status === 'needs_reauth') return 'needs_reauth' as const;
    return 'other' as const;
  }

  private async safeListConnections(workspaceId: string) {
    try {
      return await this.deps.connections.listConnections(workspaceId);
    } catch {
      return [];
    }
  }

  private async loadAccountLabels(workspaceId: string) {
    const map = new Map<string, string>();
    try {
      const rows = await this.deps.connections.listConnections(workspaceId);
      for (const c of rows) {
        map.set(c.id, c.externalAccountLabel ?? c.localName);
      }
    } catch {
      // labels stay absent
    }
    return map;
  }

  private isMockProvider(providerKey: string): boolean {
    return this.deps.registry.get(providerKey)?.devOnly ?? false;
  }

  private async audit(
    workspaceId: string,
    campaignId: string,
    campaignItemId: string,
    publishRunId: string | null,
    actorId: string | null,
    eventType: PublishingReviewAuditEventType,
    message: string,
    metadata: Record<string, string | number | boolean> | null,
  ): Promise<void> {
    await this.deps.reviewRepo.appendReviewEvent({
      workspaceId,
      campaignId,
      campaignItemId,
      publishRunId,
      actorId,
      eventType,
      message,
      metadata: metadata ?? null,
    });
  }
}

// Re-export for service-level consumers/tests.
export { classifyPublishFailure, requiresRescheduleWarning };
