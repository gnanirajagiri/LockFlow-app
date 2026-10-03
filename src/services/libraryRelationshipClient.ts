/** Relationship client — the P25 UI adapter over the deterministic engine.

It is the single seam between the UI contracts (the view shapes the feature
panels consume) and the engine (the in-memory store the engine produces). The UI
never touches `engine.defaults` / `engine.bundles` / `engine.suggestions`
directly; it goes through this client, which is also where the RLS-equivalent
workspace scoping and privacy trimming happen (see section 10 of the test suite).

Runtime: the engine is per-workspace and is wired by the host.
`RelationshipClient` itself is pure — no network, no storage reads.
 */
import type {
  DefaultRelationshipRecord,
  LibraryAssetBundleMemberRecord,
  LibraryAssetBundleRecord,
  LibrarySuggestedAssetView,
  LibraryAssetBundleMemberView,
  LibraryAttachmentRecordView,
  CreateDefaultRelationshipInput,
  CreateLibraryAssetBundleInput,
  AddBundleMemberInput,
  AcceptSuggestedAssetInput,
  RejectSuggestedAssetInput,
  CreateDraftVersionForDefaultChangeIfNeededInput,
  LibraryDefaultRelationshipView,
  LibraryDefaultRelationshipInput,
} from '../domain/library/relationshipSchema';
import type { RelationshipEngine } from './libraryRelationshipEngine';

/** Workspace-scoped seed payload the host (route layout) supplies to the UI. */
export interface RelationshipClientOptions {
  /** The per-workspace deterministic engine. */
  engine: RelationshipEngine;
  /** Returns the workspace id for a given request context. */
  workspaceProvider: () => string;
}

/** UI-safe default-relationship view. The engine row is trimmed of the
 *  source/target asset records so the returned view carries only scalars
 *  and ids (section 10: storage-data privacy).
 */


/** UI-safe bundle record. memberCount is resolved by the engine; the member
 *  details live in LibraryAssetBundleMemberView.
 */


/** UI-safe bundle member row. The owned asset record is trimmed (privacy). */


/** UI-safe suggestion surfaced for a context. sourceAssetName is trimmed out
 *  of the raw suggestion so the response never leaks repository payloads
 *  (section 10).
 */


/** One draft attachment created by applying a default or a bundle (version-
 *  safety enforcement lives in the engine; the client returns the records the
 *  host uses to notify the user).
 */


export class RelationshipClient {
  private readonly engine: RelationshipEngine;
  private readonly workspaceProvider: () => string;

  constructor(options: RelationshipClientOptions) {
    this.engine = options.engine;
    this.workspaceProvider = options.workspaceProvider;
  }

  /** ── Defaults (workspace scoping) ─────────────────────────────────────── */

  /** Lists pending default relationships for the workspace (accepted and
   *  rejected suggestions are retired from the list). Deterministic and
   *  free of repository payloads.
   */
  async listDefaultLibraryRelationships(
    workspaceId: string,
  ): Promise<LibraryDefaultRelationshipView[]> {
    this.enforceWorkspace(workspaceId);
    return this.toViewRows(this.engine.listDefaultLibraryRelationships());
  }

  async getDefaultLibraryRelationship(
    workspaceId: string,
    relationshipId: string,
  ): Promise<LibraryDefaultRelationshipView | null> {
    this.enforceWorkspace(workspaceId);
    const row = this.engine.getDefaultLibraryRelationship(relationshipId);
    if (!row) return null;
    return this.toView(row);
  }

  async createDefaultLibraryRelationship(
    workspaceId: string,
    input: CreateDefaultRelationshipInput,
  ): Promise<LibraryDefaultRelationshipView> {
    this.enforceWorkspace(workspaceId);
    const record = this.engine.createDefaultLibraryRelationship(workspaceId, input);
    return this.toView(record);
  }

  async updateDefaultLibraryRelationship(
    workspaceId: string,
    relationshipId: string,
    patch: Partial<LibraryDefaultRelationshipInput>,
  ): Promise<LibraryDefaultRelationshipView> {
    this.enforceWorkspace(workspaceId);
    const record = this.engine.updateDefaultLibraryRelationship(
      workspaceId,
      relationshipId,
      patch,
    );
    return this.toView(record);
  }

  async removeDefaultLibraryRelationship(
    workspaceId: string,
    relationshipId: string,
  ): Promise<void> {
    this.enforceWorkspace(workspaceId);
    this.engine.removeDefaultLibraryRelationship(workspaceId, relationshipId);
  }

  /** ── Bundles / sets (reusable asset bundles) ─────────────────────────── */

  async listLibraryAssetBundles(workspaceId: string): Promise<LibraryAssetBundleRecord[]> {
    this.enforceWorkspace(workspaceId);
    return this.engine.listLibraryAssetBundles(workspaceId).map((b) => ({ ...b }));
  }

  async getLibraryAssetBundle(
    workspaceId: string,
    bundleId: string,
  ): Promise<LibraryAssetBundleRecord | null> {
    this.enforceWorkspace(workspaceId);
    const bundle = this.engine.getLibraryAssetBundle(workspaceId, bundleId);
    return bundle ? { ...bundle } : null;
  }

  async createLibraryAssetBundle(
    workspaceId: string,
    input: CreateLibraryAssetBundleInput,
  ): Promise<LibraryAssetBundleRecord> {
    this.enforceWorkspace(workspaceId);
    return this.engine.createLibraryAssetBundle(workspaceId, input);
  }

  async updateLibraryAssetBundle(
    workspaceId: string,
    bundleId: string,
    patch: Partial<LibraryAssetBundleRecord>,
  ): Promise<LibraryAssetBundleRecord> {
    this.enforceWorkspace(workspaceId);
    return this.engine.updateLibraryAssetBundle(workspaceId, bundleId, patch);
  }

  async listLibraryAssetBundleMembers(
    workspaceId: string,
    bundleId: string,
  ): Promise<LibraryAssetBundleMemberView[]> {
    this.enforceWorkspace(workspaceId);
    const members = this.engine.listLibraryAssetBundleMembers(workspaceId, bundleId);
    return members.map((m) => this.mapBundleMember(m));
  }

  async addBundleMember(
    workspaceId: string,
    bundleId: string,
    input: AddBundleMemberInput,
  ): Promise<LibraryAssetBundleMemberView> {
    this.enforceWorkspace(workspaceId);
    return this.mapBundleMember(this.engine.addBundleMember(workspaceId, bundleId, input));
  }

  async removeBundleMember(
    workspaceId: string,
    bundleId: string,
    libraryAssetId: string,
  ): Promise<void> {
    this.enforceWorkspace(workspaceId);
    this.engine.removeBundleMember(workspaceId, bundleId, libraryAssetId);
  }

  /** ── Bundle application to drafts (version safety) ───────────────────── */

  async applyLibraryAssetBundleToDraftTarget(
    workspaceId: string,
    bundleId: string,
    targetType: string,
    targetId: string,
  ): Promise<LibraryAttachmentRecordView[]> {
    this.enforceWorkspace(workspaceId);
    const result = this.engine.applyLibraryAssetBundleToDraftTarget(
      workspaceId,
      bundleId,
      targetType,
      targetId,
    );
    if (!result.ok) {
      throw new Error(result.errors[0] ?? 'Bundle could not be applied.');
    }
    return result.records.map((libraryAssetId) => ({
      id: `attach_${libraryAssetId}`,
      workspaceId,
      libraryAssetId,
      targetType,
      targetId,
      roleOrSlot: 'bundle_application',
      isPrimary: true,
      attachedBy: null,
      createdAt: new Date().toISOString(),
    }));
  }

  /** ── Suggestions (accept / reject / override) ────────────────────────── */

  async getSuggestedAssetsForContext(
    workspaceId: string,
    input: { targetEntityType?: string; targetEntityId?: string; context?: string },
  ): Promise<LibrarySuggestedAssetView[]> {
    this.enforceWorkspace(workspaceId);
    const suggestions = this.engine.getSuggestedAssetsForContext(workspaceId, input);
    return suggestions.map((s) => ({
      ...s,
      sourceAssetId: undefined,
      sourceAssetName: undefined,
    }));
  }

  async acceptSuggestedAsset(
    workspaceId: string,
    input: AcceptSuggestedAssetInput,
  ): Promise<LibrarySuggestedAssetView> {
    this.enforceWorkspace(workspaceId);
    return this.engine.acceptSuggestedAsset(workspaceId, input);
  }

  async rejectSuggestedAsset(
    workspaceId: string,
    input: RejectSuggestedAssetInput,
  ): Promise<void> {
    this.enforceWorkspace(workspaceId);
    this.engine.rejectSuggestedAsset(workspaceId, input);
  }

  /** ── Draft propagation for default changes ───────────────────────────── */

  async createDraftVersionForDefaultChangeIfNeeded(
    workspaceId: string,
    input: CreateDraftVersionForDefaultChangeIfNeededInput,
  ): Promise<{ draftVersionId: string | null; created: boolean; message: string }> {
    this.enforceWorkspace(workspaceId);
    return this.engine.createDraftVersionForDefaultChangeIfNeeded(workspaceId, input);
  }

  /** ── Helpers (internal) ─────────────────────────────────────────────── */

  private mapBundleMember(member: LibraryAssetBundleMemberRecord): LibraryAssetBundleMemberView {
    return {
      id: member.id,
      bundleId: member.bundleId,
      libraryAssetId: member.libraryAssetId,
      roleOrSlot: member.roleOrSlot ?? null,
      position: member.position,
    };
  }

  /** Build UI-safe view rows from engine records (storage-data privacy:
   *  the returned view carries only scalars and ids, never asset objects).
   */
  private toViewRows(rows: DefaultRelationshipRecord[]): LibraryDefaultRelationshipView[] {
    return rows.map((r) => this.toView(r));
  }

  private toView(record: DefaultRelationshipRecord): LibraryDefaultRelationshipView {
    return {
      id: record.id,
      relationshipType: record.relationshipType,
      context: record.context,
      sourceAssetId: record.sourceAssetId,
      targetEntityType: record.targetEntityType,
      targetEntityId: record.targetEntityId,
      priority: record.priority,
      versionSafety: record.versionSafety,
      conditionsJson: record.conditionsJson,
      reason: record.reason,
      status: record.status,
      appliedOnDraftCount: record.appliedOnDraftCount,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  /** Enforce that a caller only touches its own workspace (RLS-equivalent). */
  private enforceWorkspace(workspaceId: string): void {
    const owner = this.workspaceProvider();
    if (workspaceId !== owner) {
      throw new Error(
        `Cross-workspace access denied (session scoped to ${owner}, requested ${workspaceId}).`,
      );
    }
  }
}
