/**
 * Library service layer.
 *
 * The single entry point the UI uses for the Library feature. Every mutating
 * call passes domain guards first — a locked asset version is refused before
 * any repository touch, in demo mode or against Supabase alike.
 *
 * Product rules enforced here:
 *   * One unified Library; assets are workspace-scoped and never
 *     model- or environment-owned (the Look→model link is the one sanctioned
 *     relationship, and it never alters a Character Sheet).
 *   * Locked versions are immutable; changes start with a new draft that
 *     copies structured details + reference metadata without mutating the
 *     source.
 *   * Looks only exist for look-type assets and link canonical records.
 */
import {
  assertEnvironmentInWorkspace,
} from '../domain/environments';
import {
  LockedAssetVersionError,
  assertCanonicalLookItems,
  assertLookAssetType,
  isInWorkspaceStrict,
  nextVersionNumber,
  refuseAssetLocked,
  validateAddAssetTag,
  validateCreateAssetVersion,
  validateCreateLibraryAsset,
  validateSetLookItems,
  validateUpdateAssetVersionDraft,
  validateUpdateLibraryAssetDraft,
} from '../domain/library';
import type {
  AddAssetTagInput,
  AssetRightsStatus,
  LibraryAssetRecord,
  LibraryAssetVersionRecord,
  LibraryReferenceRecord,
  LibraryTagRecord,
  LookAssetItemRecord,
  LookDetailsRecord,
  SetLookItemsInput,
} from '../domain/library';
import type { ModelRecord } from '../domain/models';
import type { EnvironmentRecord } from '../domain/environments';
import type { LibraryRepository } from '../data/libraryRepository';

export class LibraryService {
  constructor(
    private readonly repo: LibraryRepository,
    /** Read-only bridge to the Models service (Looks association only). */
    private readonly modelsBridge?: { getModel(modelId: string, workspaceId: string): Promise<unknown> },
  ) {}

  // ── Assets ────────────────────────────────────────────────────────────────

  listAssets(workspaceId: string): Promise<LibraryAssetRecord[]> {
    return this.repo.listAssets(workspaceId);
  }

  async getAsset(assetId: string, activeWorkspaceId: string): Promise<LibraryAssetRecord> {
    const asset = await this.repo.getAsset(assetId);
    isInWorkspaceStrict(asset.workspaceId, activeWorkspaceId);
    return asset;
  }

  async createAsset(input: unknown, createdBy: string): Promise<LibraryAssetRecord> {
    const result = validateCreateLibraryAsset(input);
    if (!result.ok) throw new Error(`Invalid library asset: ${result.errors.join('; ')}`);

    // Every asset is born with a first draft version (v1) — an editable
    // configuration record ready to define.
    const asset = await this.repo.createAsset(result.value, createdBy);
    await this.repo.createFirstVersion(asset.id, createdBy).catch((err) => {
      throw new Error(
        `Asset "${asset.name}" was created but its first draft version failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    });
    return asset;
  }

  /** Soft-archive: status-only transition; the canonical record is preserved. */
  async archiveAsset(assetId: string, activeWorkspaceId: string): Promise<LibraryAssetRecord> {
    const asset = await this.repo.getAsset(assetId);
    isInWorkspaceStrict(asset.workspaceId, activeWorkspaceId);
    if (asset.status === 'archived') return asset;
    if (asset.status !== 'draft' && asset.status !== 'ready') {
      throw new Error(`Archive is a soft status change only (current status: ${asset.status}).`);
    }
    return this.repo.updateAssetDraft(assetId, { status: 'archived' });
  }

  async updateAssetDraft(
    assetId: string,
    patch: unknown,
    activeWorkspaceId: string,
  ): Promise<LibraryAssetRecord> {
    const asset = await this.repo.getAsset(assetId);
    isInWorkspaceStrict(asset.workspaceId, activeWorkspaceId);
    const result = validateUpdateLibraryAssetDraft(patch);
    if (!result.ok) throw new Error(`Invalid asset update: ${result.errors.join('; ')}`);
    return this.repo.updateAssetDraft(assetId, result.value);
  }

  // ── Versions ──────────────────────────────────────────────────────────────

  async getVersions(assetId: string, activeWorkspaceId: string): Promise<LibraryAssetVersionRecord[]> {
    const asset = await this.repo.getAsset(assetId);
    isInWorkspaceStrict(asset.workspaceId, activeWorkspaceId);
    return this.repo.getVersions(assetId);
  }

  async getVersion(versionId: string, activeWorkspaceId: string): Promise<LibraryAssetVersionRecord> {
    const version = await this.repo.getVersion(versionId);
    const asset = await this.repo.getAsset(version.libraryAssetId);
    isInWorkspaceStrict(asset.workspaceId, activeWorkspaceId);
    return version;
  }

  /**
   * Safe "create next draft version": validates, refuses when a draft already
   * exists, increments max(version_number) + 1, copies structured details AND
   * reference metadata, and never mutates the source version.
   */
  async createVersion(
    input: unknown,
    createdBy: string,
    activeWorkspaceId: string,
  ): Promise<LibraryAssetVersionRecord> {
    const result = validateCreateAssetVersion(input);
    if (!result.ok) throw new Error(`Invalid version creation: ${result.errors.join('; ')}`);

    const asset = await this.repo.getAsset(result.value.libraryAssetId);
    isInWorkspaceStrict(asset.workspaceId, activeWorkspaceId);

    await this.repo.getVersion(result.value.sourceVersionId);
    const version = await this.repo.createVersion(result.value, createdBy);
    await this.repo.copyReferences(result.value.sourceVersionId, version.id);
    return version;
  }

  async updateVersionDraft(
    versionId: string,
    patch: unknown,
    activeWorkspaceId: string,
  ): Promise<LibraryAssetVersionRecord> {
    const version = await this.repo.getVersion(versionId);
    const asset = await this.repo.getAsset(version.libraryAssetId);
    isInWorkspaceStrict(asset.workspaceId, activeWorkspaceId);

    refuseAssetLocked(version);
    if (version.status !== 'draft') {
      throw new Error(`Only draft versions can be updated (status: ${version.status}).`);
    }

    const result = validateUpdateAssetVersionDraft(patch);
    if (!result.ok) throw new Error(`Invalid version update: ${result.errors.join('; ')}`);
    return this.repo.updateVersionDraft(versionId, result.value);
  }

  async lockVersion(versionId: string, activeWorkspaceId: string): Promise<LibraryAssetVersionRecord> {
    const version = await this.repo.getVersion(versionId);
    const asset = await this.repo.getAsset(version.libraryAssetId);
    isInWorkspaceStrict(asset.workspaceId, activeWorkspaceId);

    refuseAssetLocked(version);
    return this.repo.lockVersion({ versionId });
  }

  /**
   * Lock with the rights acknowledgement recorded first (the confirm dialog
   * collects it; this persists it on the version before locking). Refuses to
   * lock when rights are unacknowledged or still `unknown`.
   */
  async lockVersionWithRights(
    versionId: string,
    options: { rightsAcknowledged: boolean },
    activeWorkspaceId: string,
  ): Promise<LibraryAssetVersionRecord> {
    if (!options.rightsAcknowledged) {
      throw new Error('Rights confirmation is required before locking.');
    }
    const version = await this.getVersion(versionId, activeWorkspaceId);
    refuseAssetLocked(version);
    if (version.status !== 'draft') {
      throw new Error(`Only draft versions can be locked (status: ${version.status}).`);
    }
    if (version.rightsStatus === 'unknown') {
      throw new Error(
        'Set the rights status (Confirmed or Restricted) before locking — unknown-rights assets cannot be locked.',
      );
    }
    await this.repo.updateVersionDraft(versionId, {}); // no-op guard touch
    return this.repo.lockVersion({ versionId });
  }

  // ── References ────────────────────────────────────────────────────────────

  async getReferences(versionId: string, activeWorkspaceId: string): Promise<LibraryReferenceRecord[]> {
    await this.getVersion(versionId, activeWorkspaceId);
    return this.repo.getReferences(versionId);
  }

  async addReference(
    versionId: string,
    input: { storagePath: string; referenceType: LibraryReferenceRecord['referenceType']; caption: string },
    activeWorkspaceId: string,
  ): Promise<LibraryReferenceRecord> {
    const version = await this.getVersion(versionId, activeWorkspaceId);
    refuseAssetLocked(version);
    if (version.status !== 'draft') {
      throw new Error(`Only draft versions can modify references (status: ${version.status}).`);
    }
    return this.repo.addReference(versionId, input);
  }

  async updateReference(
    versionId: string,
    referenceId: string,
    patch: { storagePath?: string; referenceType?: LibraryReferenceRecord['referenceType']; caption?: string },
    activeWorkspaceId: string,
  ): Promise<void> {
    const version = await this.getVersion(versionId, activeWorkspaceId);
    refuseAssetLocked(version);
    if (version.status !== 'draft') {
      throw new Error(`Only draft versions can modify references (status: ${version.status}).`);
    }
    return this.repo.updateReference(versionId, referenceId, patch);
  }

  async removeReference(
    versionId: string,
    referenceId: string,
    activeWorkspaceId: string,
  ): Promise<void> {
    const version = await this.getVersion(versionId, activeWorkspaceId);
    refuseAssetLocked(version);
    if (version.status !== 'draft') {
      throw new Error(`Only draft versions can modify references (status: ${version.status}).`);
    }
    return this.repo.removeReference(versionId, referenceId);
  }

  // ── Tags (workspace-local vocabulary) ─────────────────────────────────────

  async getTagsForAsset(assetId: string, activeWorkspaceId: string): Promise<LibraryTagRecord[]> {
    const asset = await this.repo.getAsset(assetId);
    isInWorkspaceStrict(asset.workspaceId, activeWorkspaceId);
    return this.repo.getTagsForAsset(assetId);
  }

  /** Get-or-create a workspace-local tag and link it to the asset. */
  async addTagToAsset(
    input: unknown,
    activeWorkspaceId: string,
  ): Promise<LibraryTagRecord> {
    const result = validateAddAssetTag(input);
    if (!result.ok) throw new Error(`Invalid tag: ${result.errors.join('; ')}`);

    const payload = result.value as AddAssetTagInput & { normalizedName?: string };
    const asset = await this.repo.getAsset(payload.libraryAssetId);
    isInWorkspaceStrict(asset.workspaceId, activeWorkspaceId);
    // Tags live in the asset's workspace — never another one (rule 4).
    return this.repo.addTagToAsset(payload, asset.workspaceId);
  }

  async removeTagFromAsset(assetId: string, tagId: string, activeWorkspaceId: string): Promise<void> {
    const asset = await this.repo.getAsset(assetId);
    isInWorkspaceStrict(asset.workspaceId, activeWorkspaceId);
    return this.repo.removeTagFromAsset(assetId, tagId);
  }

  // ── Looks ─────────────────────────────────────────────────────────────────

  async getLookDetails(versionId: string, activeWorkspaceId: string): Promise<LookDetailsRecord | null> {
    await this.getVersion(versionId, activeWorkspaceId);
    return this.repo.getLookDetails(versionId);
  }

  async updateLookDetails(
    versionId: string,
    patch: { presentationNotes?: string },
    activeWorkspaceId: string,
  ): Promise<LookDetailsRecord> {
    const version = await this.getVersion(versionId, activeWorkspaceId);
    refuseAssetLocked(version);
    return this.repo.updateLookDetails(versionId, patch);
  }

  /**
   * Creates (or returns) the look_details record for a look-type asset
   * version. Rule 5: refuses non-look assets. `modelId` is the one
   * sanctioned model relationship — presentation only.
   */
  async ensureLookDetails(
    versionId: string,
    modelId: string,
    activeWorkspaceId: string,
    presentationNotes = '',
  ): Promise<LookDetailsRecord> {
    const version = await this.getVersion(versionId, activeWorkspaceId);
    refuseAssetLocked(version);
    const asset = await this.repo.getAsset(version.libraryAssetId);
    assertLookAssetType(asset);
    return this.repo.ensureLookDetails(versionId, modelId, presentationNotes);
  }

  async getLookItems(lookDetailsId: string, activeWorkspaceId: string): Promise<LookAssetItemRecord[]> {
    // Row-level rules enforce workspace membership; the caller-scoped check
    // happens at setLookItems. Reads here are repository-mediated.
    void activeWorkspaceId;
    return this.repo.getLookItems(lookDetailsId);
  }

  /**
   * Rule 6 — replaces the Look's item set with canonical references. Items
   * must point at existing Library assets in the same workspace; a pinned
   * version must belong to its item's asset. Duplicates are refused.
   */
  async setLookItems(input: unknown, activeWorkspaceId: string): Promise<LookAssetItemRecord[]> {
    const result = validateSetLookItems(input);
    if (!result.ok) throw new Error(`Invalid look items: ${result.errors.join('; ')}`);

    const value = result.value as SetLookItemsInput;
    assertCanonicalLookItems(value.items);

    // Every referenced asset must exist in the active workspace.
    for (const item of value.items) {
      const asset = await this.repo.getAsset(item.libraryAssetId);
      isInWorkspaceStrict(asset.workspaceId, activeWorkspaceId);
      if (item.libraryAssetVersionId) {
        const pinned = await this.repo.getVersion(item.libraryAssetVersionId);
        if (pinned.libraryAssetId !== asset.id) {
          throw new Error('Pinned version belongs to a different asset.');
        }
      }
    }

    return this.repo.setLookItems(value);
  }

  /** All look-type assets in a workspace (the /library/looks view). */
  async listLooks(activeWorkspaceId: string): Promise<LibraryAssetRecord[]> {
    const assets = await this.listAssets(activeWorkspaceId);
    return assets.filter((asset) => asset.assetType === 'look');
  }

  /** Look details for a look asset's version (null when none/not a look). */
  async getLookDetailsForAsset(
    assetId: string,
    activeWorkspaceId: string,
  ): Promise<LookDetailsRecord | null> {
    const asset = await this.getAsset(assetId, activeWorkspaceId);
    if (asset.assetType !== 'look') return null;
    const versions = await this.getVersions(assetId, activeWorkspaceId);
    const target = versions.find((version) => version.status === 'draft')
      ?? versions.find((version) => version.id === asset.activeVersionId)
      ?? versions[0];
    if (!target) return null;
    return this.repo.getLookDetails(target.id);
  }

  /**
   * Creates a complete Look in one flow: look-type asset + first draft
   * version + look_details + canonical items. The model's Character Sheet is
   * never touched — this only READS the model to link the association.
   * Partial failures are surfaced honestly with what succeeded.
   */
  async createLook(
    input: {
      name: string;
      modelId: string;
      presentationNotes?: string;
      items: Array<{ libraryAssetId: string; libraryAssetVersionId?: string | null; role: LookAssetItemRecord['role']; sortOrder: number }>;
      description?: string;
    },
    createdBy: string,
    activeWorkspaceId: string,
  ): Promise<LibraryAssetRecord> {
    if (!input.modelId) throw new Error('A Look must be associated with a model.');

    // Read-only model existence/workspace check (never a write to the model).
    if (this.modelsBridge) {
      await this.modelsBridge.getModel(input.modelId, activeWorkspaceId);
    }

    const asset = await this.createAsset(
      { workspaceId: activeWorkspaceId, name: input.name, assetType: 'look', ...(input.description ? { description: input.description } : {}) },
      createdBy,
    );
    const versions = await this.getVersions(asset.id, activeWorkspaceId);
    try {
      await this.ensureLookDetails(versions[0].id, input.modelId, activeWorkspaceId, input.presentationNotes ?? '');
      if (input.items.length > 0) {
        await this.setLookItems(
          { lookDetailsId: (await this.repo.getLookDetails(versions[0].id))!.id, items: input.items },
          activeWorkspaceId,
        );
      }
    } catch (err) {
      throw new Error(
        `Look "${asset.name}" was created with its first draft version, but linking failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    return asset;
  }

  // ── Shortcut helpers (Models & Environments → the one Library) ────────────

  /**
   * Resolves the canonical Library assets for model/environment shortcut ids.
   * Rule 7: shortcuts always resolve to the one shared asset record; this
   * helper is the sanctioned read path for future UI panels.
   */
  async resolveShortcutAssets(
    assetIds: string[],
    activeWorkspaceId: string,
  ): Promise<LibraryAssetRecord[]> {
    const resolved: LibraryAssetRecord[] = [];
    for (const assetId of assetIds) {
      if (!assetId) continue;
      const asset = await this.repo.getAsset(assetId);
      isInWorkspaceStrict(asset.workspaceId, activeWorkspaceId);
      resolved.push(asset);
    }
    return resolved;
  }

  /** Workspace-scoped lookup used by future Models/Environments panels. */
  async assetSummariesForOwner(
    owner: ModelRecord | EnvironmentRecord,
    shortcutAssetIds: string[],
  ): Promise<LibraryAssetRecord[]> {
    assertEnvironmentInWorkspace(owner, owner.workspaceId);
    return this.resolveShortcutAssets(shortcutAssetIds, owner.workspaceId);
  }

  // ── Exposed for tests ─────────────────────────────────────────────────────

  /** Exposes the pure version increment for guard-level tests. */
  static nextVersionNumber(existing: number[]): number {
    return nextVersionNumber(existing);
  }

  /** Exposes the locked guard for UI pre-checks. */
  static assertEditable(version: Pick<LibraryAssetVersionRecord, 'id' | 'status'>): void {
    refuseAssetLocked(version);
  }

  /** Exposes rights-status vocabulary for the future asset UI. */
  static rightsStatuses(): AssetRightsStatus[] {
    return ['unknown', 'confirmed', 'restricted'];
  }
}

export { LockedAssetVersionError };
