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
  isInWorkspaceStrict,
  normalizeTagName,
  scopeConsistencyProblem,
  sanitizeLibraryEventMetadata,
} from '../domain/library';
import type {
  CreateLibraryAssetExtendedInput,
  LibraryAssetFilters,
  LibraryAssetRecord,
  LibraryEventRecord,
  LibraryEventType,
  LibraryPickerContext,
  LibraryTagRecord,
  UpdateLibraryAssetExtendedInput,
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
  content?: { getScene(sceneId: string, workspaceId: string): Promise<unknown> };
  environments?: { getEnvironment(environmentId: string, workspaceId: string): Promise<unknown> };
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

    const asset = await this.repo.createAssetExtended(
      { ...input, workspaceId },
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
        includeDrafts: context.includeDrafts ?? false,
      });
    return this.repo.listAssetsFiltered(workspaceId, {
      includeArchived: false, // archived never appears in the picker
      ...(context.usageScope ? { usageScope: context.usageScope } : {}),
      ...(context.linkedModelId ? { linkedModelId: context.linkedModelId } : {}),
      ...(context.linkedItemId ? { linkedItemId: context.linkedItemId } : {}),
      ...(context.linkedEnvironmentId ? { linkedEnvironmentId: context.linkedEnvironmentId } : {}),
      ...(context.search ? { search: context.search } : {}),
      ...(!context.includeDrafts ? { status: 'ready' as const } : {}),
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
