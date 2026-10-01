/**
 * Library Operations service (Prompt 21) — the unified-Library layer.
 *
 * Extends the existing LibraryService (Prompt 21 does not replace anything):
 *   * ONE Library — reusable assets organized by WHERE they are used
 *     (model / item / environment / shared). No "global/my library" axis.
 *   * The Gallery stays the home of generated outputs. Nothing here creates,
 *     reads for listing, or duplicates Gallery records; `generated_derivative`
 *     assets only record a safe provenance label.
 *   * Links are validated server-side: a linked model/scene/environment must
 *     exist in the SAME workspace, so cross-workspace links are impossible.
 *   * Archived assets remain inspectable but are excluded from default
 *     picker results (explicit opt-in to include drafts; archived never).
 *   * Only safe file references (storage object ids / placeholder file ids)
 *     are accepted — no signed URLs, no storage secrets.
 *   * Every action writes a structured audit event (append-only repo table).
 */
import {
  ATTACHMENT_TARGET_LABELS,
  INTAKE_METHOD_SOURCE_KIND,
  attachmentRoleProblems,
  isInWorkspaceStrict,
  libraryAttachmentWarnings,
  normalizeRoleOrSlot,
  normalizeTagName,
  parseLibraryAssetDescription,
  sanitizeExternalImageUrl,
  scopeConsistencyProblem,
  sanitizeLibraryEventMetadata,
} from '../domain/library';
import type {
  CreateLibraryAssetExtendedInput,
  LibraryAssetFileRecord,
  LibraryAssetFilters,
  LibraryAssetRecord,
  LibraryAssetSuggestion,
  LibraryAttachmentRecord,
  LibraryAttachmentTargetType,
  LibraryEventRecord,
  LibraryEventType,
  LibraryIntakeMethod,
  LibraryPickerContext,
  LibraryTagRecord,
  ParseLibraryAssetDescriptionInput,
  RegisterLibraryAssetFileInput,
  UpdateLibraryAssetExtendedInput,
} from '../domain/library';
import {
  validateParseLibraryAssetDescription,
  validateRegisterLibraryAssetFile,
} from '../domain/library';
import type { LibraryRepository } from '../data/libraryRepository';

function invalid(message: string): never {
  throw new Error(message);
}

function assertWorkspace(workspaceId: string): void {
  if (!workspaceId) invalid('A workspace context is required.');
}

/** Injection shape so this service stays decoupled from concrete services. */
export interface LibraryOpsBridges {
  models?: { getModel(modelId: string, workspaceId: string): Promise<unknown> };
  content?: {
    getScene(sceneId: string, workspaceId: string): Promise<unknown>;
    getJobRequest?(jobRequestId: string, workspaceId: string): Promise<unknown>;
  };
  environments?: { getEnvironment(environmentId: string, workspaceId: string): Promise<unknown> };
  campaigns?: { getCampaign(campaignId: string, workspaceId: string): Promise<unknown> };
}

export class LibraryOpsService {
  constructor(
    private readonly repo: LibraryRepository,
    private readonly bridges: LibraryOpsBridges = {},
  ) {}

  // ── Reads ───────────────────────────────────────────────────────────────────

  /** Filtered, workspace-scoped listing (the Assets/Archived views). */
  async listLibraryAssets(workspaceId: string, filters: LibraryAssetFilters = {}): Promise<LibraryAssetRecord[]> {
    assertWorkspace(workspaceId);
    return this.repo.listAssetsFiltered(workspaceId, filters);
  }

  /** Single asset with a viewed audit event; archived assets stay inspectable. */
  async getLibraryAsset(workspaceId: string, assetId: string, actorId: string | null = null): Promise<LibraryAssetRecord> {
    assertWorkspace(workspaceId);
    const asset = await this.repo.getAsset(assetId);
    isInWorkspaceStrict(asset.workspaceId, workspaceId);
    await this.audit(workspaceId, asset.id, actorId, 'library_asset_viewed', `Asset “${asset.name}” viewed.`, null);
    return asset;
  }

  /** Tags for the detail view (workspace-local vocabulary). */
  async getAssetTags(workspaceId: string, assetId: string): Promise<LibraryTagRecord[]> {
    assertWorkspace(workspaceId);
    const asset = await this.repo.getAsset(assetId);
    isInWorkspaceStrict(asset.workspaceId, workspaceId);
    return this.repo.getTagsForAsset(asset.id);
  }

  async getAssetEvents(workspaceId: string, assetId: string, limit = 30): Promise<LibraryEventRecord[]> {
    assertWorkspace(workspaceId);
    const asset = await this.repo.getAsset(assetId);
    isInWorkspaceStrict(asset.workspaceId, workspaceId);
    return this.repo.listLibraryEvents(workspaceId, { libraryAssetId: asset.id, limit });
  }

  // ── Create / update ─────────────────────────────────────────────────────────

  /**
   * Creates an asset with taxonomy + safe links. Every link is validated
   * against the SAME workspace via the injected service bridges; scope/link
   * consistency is enforced before any write.
   */
  async createLibraryAsset(
    workspaceId: string,
    input: CreateLibraryAssetExtendedInput,
    actorId: string,
  ): Promise<LibraryAssetRecord> {
    assertWorkspace(workspaceId);
    if (input.workspaceId && input.workspaceId !== workspaceId) {
      invalid('Assets are created inside the active workspace.');
    }
    await this.validateLinks(workspaceId, {
      usageScope: input.usageScope ?? null,
      linkedModelId: input.linkedModelId ?? null,
      linkedItemId: input.linkedItemId ?? null,
      linkedEnvironmentId: input.linkedEnvironmentId ?? null,
    });
    const problem = scopeConsistencyProblem({
      usageScope: input.usageScope ?? null,
      linkedModelId: input.linkedModelId ?? null,
      linkedItemId: input.linkedItemId ?? null,
      linkedEnvironmentId: input.linkedEnvironmentId ?? null,
    });
    if (problem) invalid(problem);

    // ── Prompt 22: intake provenance ────────────────────────────────────
    const intake = input.intake;
    if (intake?.sourceUrl) {
      if (!sanitizeExternalImageUrl(intake.sourceUrl)) {
        invalid('That image URL is not allowed — use a public http(s) URL.');
      }
    }
    const sourceKind = input.sourceKind ?? (intake ? INTAKE_METHOD_SOURCE_KIND[intake.intakeMethod] : undefined);
    const metadata = intake
      ? { ...(input.metadata ?? {}), intake }
      : input.metadata;

    const asset = await this.repo.createAssetExtended(
      {
        ...input,
        workspaceId,
        ...(sourceKind !== undefined ? { sourceKind } : {}),
        ...(metadata !== undefined ? { metadata } : {}),
      },
      actorId,
    );
    await this.audit(workspaceId, asset.id, actorId, 'library_asset_created',
      `Asset “${asset.name}” created (${asset.assetType}${asset.usageScope ? `, ${asset.usageScope} scope` : ''}).`,
      { assetType: asset.assetType, usageScope: asset.usageScope ?? '' });
    return asset;
  }

  /** Partial update with the same link/scope validation as creation. */
  async updateLibraryAsset(
    workspaceId: string,
    assetId: string,
    patch: UpdateLibraryAssetExtendedInput,
    actorId: string,
  ): Promise<LibraryAssetRecord> {
    assertWorkspace(workspaceId);
    const existing = await this.repo.getAsset(assetId);
    isInWorkspaceStrict(existing.workspaceId, workspaceId);

    const merged = {
      usageScope: patch.usageScope !== undefined ? patch.usageScope : existing.usageScope,
      linkedModelId: patch.linkedModelId !== undefined ? patch.linkedModelId : existing.linkedModelId,
      linkedItemId: patch.linkedItemId !== undefined ? patch.linkedItemId : existing.linkedItemId,
      linkedEnvironmentId: patch.linkedEnvironmentId !== undefined ? patch.linkedEnvironmentId : existing.linkedEnvironmentId,
    };
    await this.validateLinks(workspaceId, merged);
    const problem = scopeConsistencyProblem(merged);
    if (problem) invalid(problem);

    if (patch.name !== undefined && (patch.name.length < 1 || patch.name.length > 80)) {
      invalid('name must be 1–80 characters.');
    }

    const updated = await this.repo.updateAssetExtended(assetId, patch);
    await this.audit(workspaceId, assetId, actorId, 'library_asset_updated',
      `Asset “${updated.name}” updated.`, null);
    return updated;
  }

  /** Adds a tag through the workspace-normalized vocabulary. */
  async addAssetTag(workspaceId: string, assetId: string, tagName: string, actorId: string): Promise<LibraryTagRecord> {
    assertWorkspace(workspaceId);
    const asset = await this.repo.getAsset(assetId);
    isInWorkspaceStrict(asset.workspaceId, workspaceId);
    const tag = await this.repo.addTagToAsset(
      { libraryAssetId: assetId, name: tagName, normalizedName: normalizeTagName(tagName) },
      workspaceId,
    );
    await this.audit(workspaceId, assetId, actorId, 'library_asset_updated',
      `Tag “${tag.name}” added.`, { tag: tag.normalizedName });
    return tag;
  }

  // ── Archive / restore ───────────────────────────────────────────────────────

  /** Soft-archive: inspectable forever, excluded from default pickers. */
  async archiveLibraryAsset(workspaceId: string, assetId: string, actorId: string): Promise<LibraryAssetRecord> {
    assertWorkspace(workspaceId);
    const existing = await this.repo.getAsset(assetId);
    isInWorkspaceStrict(existing.workspaceId, workspaceId);
    if (existing.archivedAt) invalid('This asset is already archived.');
    const asset = await this.repo.archiveAsset(assetId, actorId);
    await this.audit(workspaceId, assetId, actorId, 'library_asset_archived',
      `Asset “${asset.name}” archived.`, null);
    return asset;
  }

  /** Restore from the archive (distinct from delete — nothing is destroyed). */
  async restoreLibraryAsset(workspaceId: string, assetId: string, actorId: string): Promise<LibraryAssetRecord> {
    assertWorkspace(workspaceId);
    const existing = await this.repo.getAsset(assetId);
    isInWorkspaceStrict(existing.workspaceId, workspaceId);
    if (!existing.archivedAt && existing.status !== 'archived') {
      invalid('This asset is not archived.');
    }
    const asset = await this.repo.restoreAsset(assetId);
    await this.audit(workspaceId, assetId, actorId, 'library_asset_restored',
      `Asset “${asset.name}” restored from the archive.`, null);
    return asset;
  }

  // ── Picker ──────────────────────────────────────────────────────────────────

  /**
   * Reusable attach/attach-confirm source. Defaults to ACTIVE + READY assets
   * in the requested scope; drafts require includeDrafts; archived assets
   * are never picker candidates (use the Archived view + restore instead).
   */
  async listLibraryPickerAssets(
    workspaceId: string,
    context: LibraryPickerContext = {},
    actorId: string | null = null,
  ): Promise<LibraryAssetRecord[]> {
    assertWorkspace(workspaceId);
    await this.audit(workspaceId, context.linkedModelId ?? context.linkedItemId ?? context.linkedEnvironmentId ?? null,
      actorId, 'library_picker_opened', 'Library picker opened.', {
        ...(context.usageScope ? { usageScope: context.usageScope } : {}),
        ...(context.targetType ? { targetType: context.targetType } : {}),
        includeDrafts: context.includeDrafts ?? false,
        includeArchived: context.includeArchived ?? false,
      });
    return this.repo.listAssetsFiltered(workspaceId, {
      // Archived rows only appear on EXPLICIT opt-in — and the picker marks
      // them with a warning; default results never contain them.
      includeArchived: context.includeArchived ?? false,
      ...(context.usageScope ? { usageScope: context.usageScope } : {}),
      ...(context.assetTypes && context.assetTypes.length > 0 ? { assetType: context.assetTypes } : {}),
      ...(context.linkedModelId ? { linkedModelId: context.linkedModelId } : {}),
      ...(context.linkedItemId ? { linkedItemId: context.linkedItemId } : {}),
      ...(context.linkedEnvironmentId ? { linkedEnvironmentId: context.linkedEnvironmentId } : {}),
      ...(context.search ? { search: context.search } : {}),
      ...(!context.includeDrafts
        ? (context.includeArchived
          // Archived opt-in: ready + archived, drafts still excluded.
          ? { statuses: ['ready', 'archived'] as const }
          : { status: 'ready' as const })
        : {}),
    });
  }

  /**
   * Records an attach (the consumer calls this after wiring the asset into
   * its own domain records). Library itself never mutates other domains.
   */
  async recordLibraryAttach(
    workspaceId: string,
    assetId: string,
    attachedTo: { kind: 'model' | 'item' | 'environment'; id: string },
    actorId: string,
  ): Promise<void> {
    assertWorkspace(workspaceId);
    const asset = await this.repo.getAsset(assetId);
    isInWorkspaceStrict(asset.workspaceId, workspaceId);
    await this.audit(workspaceId, assetId, actorId, 'library_asset_attached',
      `Asset “${asset.name}” attached to a ${attachedTo}.`, { attachedTo: attachedTo.kind });
  }

  // ══ Prompt 22: ingestion, attachments & picker workflows ═════════════════

  /** Logs the START of an Add-Asset flow (which intake path was chosen). */
  async startLibraryAssetAdd(
    workspaceId: string,
    method: LibraryIntakeMethod,
    actorId: string,
    summary?: string,
  ): Promise<{ method: LibraryIntakeMethod; startedAt: string }> {
    assertWorkspace(workspaceId);
    if (!(method in INTAKE_METHOD_SOURCE_KIND)) invalid('Unknown intake method.');
    await this.audit(workspaceId, null, actorId, 'library_asset_add_started',
      `Add-asset flow started (${method}).`,
      { method, ...(summary ? { summary: summary.slice(0, 120) } : {}) });
    return { method, startedAt: new Date().toISOString() };
  }

  /** Logs an INLINE add start (from a picker's empty state). */
  async recordInlineLibraryAddStart(
    workspaceId: string,
    actorId: string,
    summary?: string,
  ): Promise<void> {
    assertWorkspace(workspaceId);
    await this.audit(workspaceId, null, actorId, 'library_inline_add_started',
      'Inline add-asset started from a picker.',
      summary ? { summary: summary.slice(0, 120) } : null);
  }

  /**
   * Prompt-assisted suggestion: parses the description into SUGGESTED
   * metadata. Nothing is saved; the suggestion is only a proposal — the
   * user must confirm or edit it before any asset is created.
   */
  async parseLibraryAssetDescription(
    workspaceId: string,
    input: ParseLibraryAssetDescriptionInput,
    actorId: string | null,
  ): Promise<LibraryAssetSuggestion> {
    assertWorkspace(workspaceId);
    const validated = validateParseLibraryAssetDescription(input);
    if (!validated.ok) invalid(validated.errors.join(' '));
    const suggestion = parseLibraryAssetDescription(validated.value.description);
    await this.audit(workspaceId, null, actorId, 'library_asset_parse_suggested',
      `Suggested metadata for “${suggestion.name}”.`,
      {
        assetType: suggestion.assetType,
        usageScope: suggestion.usageScope,
        tagCount: suggestion.tags.length,
      });
    return suggestion;
  }

  /**
   * The EXPLICIT confirmation gate for prompt-assisted intake: the UI calls
   * this only after the user reviewed/edited the suggestion. Re-validates
   * everything through the normal creation path.
   */
  async confirmLibraryAssetFromSuggestion(
    workspaceId: string,
    suggestion: LibraryAssetSuggestion,
    actorId: string,
  ): Promise<LibraryAssetRecord> {
    assertWorkspace(workspaceId);
    return this.createLibraryAsset(
      workspaceId,
      {
        workspaceId,
        name: suggestion.name,
        assetType: suggestion.assetType,
        usageScope: suggestion.usageScope,
        ...(suggestion.description ? { description: suggestion.description } : {}),
        ...(suggestion.tags.length ? { tags: suggestion.tags } : {}),
        ...(suggestion.rightsOrUsageNote ? { rightsOrUsageNote: suggestion.rightsOrUsageNote } : {}),
        sourceKind: INTAKE_METHOD_SOURCE_KIND.prompt_assisted,
        intake: { intakeMethod: 'prompt_assisted', parseConfirmed: true },
      },
      actorId,
    );
  }

  /** Registers a SAFE file reference (bucket+path) for an asset. */
  async registerLibraryAssetFile(
    workspaceId: string,
    assetId: string,
    input: RegisterLibraryAssetFileInput,
    actorId: string,
  ): Promise<LibraryAssetFileRecord> {
    assertWorkspace(workspaceId);
    const asset = await this.repo.getAsset(assetId);
    isInWorkspaceStrict(asset.workspaceId, workspaceId);
    const validated = validateRegisterLibraryAssetFile(input);
    if (!validated.ok) invalid(validated.errors.join(' '));
    // Server-side ownership: the canonical object path's segment 2 must be
    // THIS workspace id — the same parsing the storage RLS performs, so a
    // client cannot point a file reference at another workspace.
    const segments = validated.value.storagePath.split('/');
    if (segments[0] !== 'workspaces' || segments[1] !== workspaceId) {
      invalid('File references must live under this workspace\u2019s storage prefix.');
    }
    if (validated.value.sourceUrl) {
      const safeUrl = sanitizeExternalImageUrl(validated.value.sourceUrl);
      if (!safeUrl) invalid('That image URL is not allowed — use a public http(s) URL.');
      validated.value.sourceUrl = safeUrl;
    }
    const record = await this.repo.insertAssetFile(
      { ...validated.value, workspaceId, libraryAssetId: assetId },
      actorId,
    );
    await this.audit(workspaceId, assetId, actorId, 'library_asset_updated',
      `File reference “${record.fileName}” registered.`,
      { fileKind: record.fileKind, uploadStatus: record.uploadStatus });
    return record;
  }

  /** Safe file references for an asset (workspace-checked). */
  async listAssetFiles(workspaceId: string, assetId: string): Promise<LibraryAssetFileRecord[]> {
    assertWorkspace(workspaceId);
    const asset = await this.repo.getAsset(assetId);
    isInWorkspaceStrict(asset.workspaceId, workspaceId);
    return this.repo.listAssetFiles(assetId);
  }

  /**
   * Full attachment validation WITHOUT writing: target existence,
   * workspace scoping, role/slot rules, archived/draft warnings, primary
   * conflicts and duplicate-attach detection.
   */
  async validateAssetAttachment(
    workspaceId: string,
    assetId: string,
    targetType: LibraryAttachmentTargetType,
    targetId: string,
    roleOrSlot: string | undefined,
    opts: { allowArchived?: boolean; isPrimary?: boolean } = {},
  ): Promise<{ ok: boolean; problems: string[]; warnings: string[] }> {
    assertWorkspace(workspaceId);
    const problems: string[] = [];
    const warnings: string[] = [];

    if (!ATTACHMENT_TARGET_LABELS[targetType]) problems.push('Unsupported attachment target.');
    problems.push(...attachmentRoleProblems(roleOrSlot ?? ''));

    if (problems.length === 0) {
      try {
        await this.validateAttachmentTarget(workspaceId, targetType, targetId);
      } catch (err) {
        problems.push(err instanceof Error ? err.message : 'Target validation failed.');
      }
    }

    let asset: LibraryAssetRecord | null = null;
    try {
      asset = await this.repo.getAsset(assetId);
      isInWorkspaceStrict(asset.workspaceId, workspaceId);
    } catch {
      asset = null;
    }
    if (!asset) {
      problems.push('The asset does not exist in this workspace.');
    } else {
      const archived = asset.archivedAt !== null || asset.status === 'archived';
      if (archived && !opts.allowArchived) {
        problems.push('Archived assets cannot be newly attached — restore the asset first.');
      } else if (archived) {
        warnings.push(...libraryAttachmentWarnings(asset, { archivedSelectedExplicitly: true }));
      } else if (asset.status === 'draft') {
        warnings.push(...libraryAttachmentWarnings(asset));
      }
      if (opts.isPrimary) {
        const slot = normalizeRoleOrSlot(roleOrSlot);
        const primaries = await this.repo.listAttachments(workspaceId, {
          targetType, targetId, roleOrSlot: slot, isPrimary: true,
        });
        if (primaries.some((p) => p.libraryAssetId !== assetId)) {
          problems.push('A primary attachment already exists for this slot.');
        }
      }
      const duplicates = await this.repo.listAttachments(workspaceId, {
        libraryAssetId: assetId, targetType, targetId, roleOrSlot: normalizeRoleOrSlot(roleOrSlot),
      });
      if (duplicates.length > 0) {
        problems.push('This asset is already attached to this slot on the target.');
      }
    }

    return { ok: problems.length === 0, problems, warnings };
  }

  /**
   * Attaches one or more Library assets to a target. Validates the target
   * once, every asset through `validateAssetAttachment`, then inserts the
   * canonical reference rows. Attaching NEVER copies the asset.
   */
  async attachLibraryAssets(
    workspaceId: string,
    targetType: LibraryAttachmentTargetType,
    targetId: string,
    items: Array<{ assetId: string; roleOrSlot?: string; isPrimary?: boolean }>,
    actorId: string,
    opts: { allowArchived?: boolean } = {},
  ): Promise<LibraryAttachmentRecord[]> {
    assertWorkspace(workspaceId);
    if (items.length === 0) invalid('Select at least one asset to attach.');
    if (items.length > 50) invalid('Attach at most 50 assets at once.');
    await this.validateAttachmentTarget(workspaceId, targetType, targetId);

    for (const item of items) {
      const validation = await this.validateAssetAttachment(
        workspaceId, item.assetId, targetType, targetId, item.roleOrSlot,
        { ...opts, isPrimary: item.isPrimary },
      );
      if (!validation.ok) invalid(validation.problems.join(' '));
    }

    const records: LibraryAttachmentRecord[] = [];
    for (const item of items) {
      const record = await this.repo.insertAttachment(
        {
          workspaceId,
          libraryAssetId: item.assetId,
          targetType,
          targetId,
          ...(item.roleOrSlot !== undefined ? { roleOrSlot: item.roleOrSlot } : {}),
          ...(item.isPrimary !== undefined ? { isPrimary: item.isPrimary } : {}),
        },
        actorId,
      );
      const asset = await this.repo.getAsset(item.assetId);
      await this.audit(workspaceId, item.assetId, actorId, 'library_asset_attached',
        `Asset “${asset.name}” attached to a ${ATTACHMENT_TARGET_LABELS[targetType]}.`,
        { targetType, roleOrSlot: record.roleOrSlot, isPrimary: record.isPrimary });
      records.push(record);
    }
    return records;
  }

  /** Detaches (removes the reference; the asset itself is untouched). */
  async detachLibraryAsset(
    workspaceId: string,
    attachmentId: string,
    actorId: string,
  ): Promise<void> {
    assertWorkspace(workspaceId);
    const record = await this.repo.getAttachment(workspaceId, attachmentId);
    const asset = await this.repo.getAsset(record.libraryAssetId).catch(() => null);
    await this.repo.deleteAttachment(workspaceId, attachmentId);
    await this.audit(workspaceId, record.libraryAssetId, actorId, 'library_asset_detached',
      `Asset “${asset?.name ?? record.libraryAssetId}” detached from a ${ATTACHMENT_TARGET_LABELS[record.targetType]}.`,
      { targetType: record.targetType, targetId: record.targetId, roleOrSlot: record.roleOrSlot });
  }

  /** Attachment records for an asset (“where is this used?”). */
  async listAttachmentsForAsset(workspaceId: string, assetId: string): Promise<LibraryAttachmentRecord[]> {
    assertWorkspace(workspaceId);
    const asset = await this.repo.getAsset(assetId);
    isInWorkspaceStrict(asset.workspaceId, workspaceId);
    return this.repo.listAttachments(workspaceId, { libraryAssetId: assetId });
  }

  /** Attachment records for a target (“what is attached here?”). */
  async listAttachmentsForTarget(
    workspaceId: string,
    targetType: LibraryAttachmentTargetType,
    targetId: string,
  ): Promise<LibraryAttachmentRecord[]> {
    assertWorkspace(workspaceId);
    return this.repo.listAttachments(workspaceId, { targetType, targetId });
  }

  /** Removes a tag by name through the workspace-normalized vocabulary. */
  async removeAssetTag(
    workspaceId: string,
    assetId: string,
    tagName: string,
    actorId: string,
  ): Promise<void> {
    assertWorkspace(workspaceId);
    const asset = await this.repo.getAsset(assetId);
    isInWorkspaceStrict(asset.workspaceId, workspaceId);
    const normalized = normalizeTagName(tagName);
    const tags = await this.repo.getTagsForAsset(assetId);
    const tag = tags.find((t) => t.normalizedName === normalized);
    if (!tag) invalid(`Tag “${tagName}” is not on this asset.`);
    await this.repo.removeTagFromAsset(assetId, tag.id);
    await this.audit(workspaceId, assetId, actorId, 'library_asset_updated',
      `Tag “${tag.name}” removed.`, { tag: normalized });
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  /** Server-side link validation: same-workspace existence for each link. */
  private async validateLinks(
    workspaceId: string,
    links: {
      usageScope: string | null;
      linkedModelId: string | null;
      linkedItemId: string | null;
      linkedEnvironmentId: string | null;
    },
  ): Promise<void> {
    if (links.linkedModelId) {
      if (!this.bridges.models) invalid('Model validation is unavailable.');
      await this.bridges.models.getModel(links.linkedModelId, workspaceId).catch(() =>
        invalid('The linked model does not exist in this workspace.'),
      );
    }
    if (links.linkedItemId) {
      if (!this.bridges.content) invalid('Item validation is unavailable.');
      await this.bridges.content.getScene(links.linkedItemId, workspaceId).catch(() =>
        invalid('The linked item does not exist in this workspace.'),
      );
    }
    if (links.linkedEnvironmentId) {
      if (!this.bridges.environments) invalid('Environment validation is unavailable.');
      await this.bridges.environments.getEnvironment(links.linkedEnvironmentId, workspaceId).catch(() =>
        invalid('The linked environment does not exist in this workspace.'),
      );
    }
  }

  /** Target existence + same-workspace validation via the injected bridges. */
  private async validateAttachmentTarget(
    workspaceId: string,
    targetType: LibraryAttachmentTargetType,
    targetId: string,
  ): Promise<void> {
    const label = ATTACHMENT_TARGET_LABELS[targetType];
    if (!label) invalid('Unsupported attachment target.');
    const refusal = () => invalid(`The linked ${label} does not exist in this workspace.`);
    if (targetType === 'content_scene') {
      if (!this.bridges.content?.getScene) invalid('Scene validation is unavailable.');
      await this.bridges.content.getScene(targetId, workspaceId).catch(() => refusal());
    } else if (targetType === 'content_job') {
      if (!this.bridges.content?.getJobRequest) invalid('Job validation is unavailable.');
      await this.bridges.content.getJobRequest(targetId, workspaceId).catch(() => refusal());
    } else if (targetType === 'campaign') {
      if (!this.bridges.campaigns) invalid('Campaign validation is unavailable.');
      await this.bridges.campaigns.getCampaign(targetId, workspaceId).catch(() => refusal());
    } else if (targetType === 'model') {
      if (!this.bridges.models) invalid('Model validation is unavailable.');
      await this.bridges.models.getModel(targetId, workspaceId).catch(() => refusal());
    } else {
      if (!this.bridges.environments) invalid('Environment validation is unavailable.');
      await this.bridges.environments.getEnvironment(targetId, workspaceId).catch(() => refusal());
    }
  }

  private async audit(
    workspaceId: string,
    libraryAssetId: string | null,
    actorId: string | null,
    eventType: LibraryEventType,
    message: string,
    metadata: Record<string, string | number | boolean> | null,
  ): Promise<void> {
    await this.repo.appendLibraryEvent({
      workspaceId,
      libraryAssetId,
      actorId,
      eventType,
      message,
      metadata: sanitizeLibraryEventMetadata(metadata),
    });
  }
}
