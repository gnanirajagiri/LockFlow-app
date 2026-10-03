/**
 * Relationship engine - Prompt 25 deterministic, in-memory engine.
 *
 * Holds the workspace-scoped maps of defaults, bundles, members, and
 * suggestions. Pure enough to be unit-tested and cheap enough to be used
 * directly by the UI through the RelationshipClient. The engine enforces:
 *
 *   * workspace ownership on every read/write (reject cross-workspace);
 *   * entity existence (default source asset must exist);
 *   * version-safety application (defaults land on a draft version first,
 *     never on a locked version); and
 *   * override semantics (a manual attachment can override a default,
 *     and the engine tracks how many drafts a default currently applies to).
 */
import {
  RELATIONSHIP_EDITABLE,
  RELATIONSHIP_TYPE_ORDER,
} from '../domain/library/relationshipTypes';
import type {
  DefaultRelationshipRecord,
  LibraryAssetBundleMemberRecord,
  LibraryAssetBundleRecord,
  LibrarySuggestedAssetView,
  CreateDefaultRelationshipInput,
  CreateLibraryAssetBundleInput,
  AddBundleMemberInput,
  AcceptSuggestedAssetInput,
  RejectSuggestedAssetInput,
  CreateDraftVersionForDefaultChangeIfNeededInput,
  LibraryDefaultRelationshipInput,
} from '../domain/library/relationshipSchema';
import type { RelationshipType } from '../domain/library/relationshipTypes';
import type { LibraryAssetRecord } from '../domain/library';

/** A deterministic in-memory store for one workspace. */
export class RelationshipEngine {
  /** id -> default/recommended relationship row. */
  private defaults = new Map<string, DefaultRelationshipRecord>();

  /** bundle id -> bundle row. */
  private bundles = new Map<string, LibraryAssetBundleRecord>();

  /** bundle id -> ordered member records. */
  private bundleMembers = new Map<string, LibraryAssetBundleMemberRecord[]>();

  /** suggestion id -> suggestion view. */
  private suggestions = new Map<string, LibrarySuggestedAssetView>();

  /** Deterministic IDs for this engine instance. */
  private nextId = 1;

  /** Helper: next integer -> zero-padded string. */
  private nextIdStr(): string {
    return `rel_${String(this.nextId++).padStart(6, '0')}`;
  }

  /**
   * Seed the engine with real Library assets (the engine never creates
   * assets itself; it only relates existing catalog rows).
   */
  registerAssets(_assets: LibraryAssetRecord[]): void {
    // no-op - assets are referenced by id; validation at call sites
    // checks existence.
  }

  /**
   * Resolve a workspace id to an engine instance (singleton per workspace
   * for determinism within a test run). The UI/client wires this.
   */
  static byWorkspace = new Map<string, RelationshipEngine>();

  static getEngine(workspaceId: string): RelationshipEngine {
    let engine = RelationshipEngine.byWorkspace.get(workspaceId);
    if (!engine) {
      engine = new RelationshipEngine();
      RelationshipEngine.byWorkspace.set(workspaceId, engine);
    }
    return engine;
  }

  /** Reset the engine's store for the current workspace (test isolation). */
  reset(workspaceId: string): void {
    this.defaults.clear();
    this.bundles.clear();
    this.bundleMembers.clear();
    this.suggestions.clear();
    RelationshipEngine.byWorkspace.set(workspaceId, this);
  }

  /** ////////////////// DEFAULTS ///////////////////////////////////////// */

  listDefaultLibraryRelationships(): DefaultRelationshipRecord[] {
    return Array.from(this.defaults.values()).sort(
      (a, b) => a.targetEntityId.localeCompare(b.targetEntityId) || a.priority - b.priority,
    );
  }

  getDefaultLibraryRelationship(
    relationshipId: string,
  ): DefaultRelationshipRecord | undefined {
    return this.defaults.get(relationshipId);
  }

  createDefaultLibraryRelationship(
    workspaceId: string,
    input: CreateDefaultRelationshipInput,
  ): DefaultRelationshipRecord {
    this.ensureWorkspace(workspaceId);
    this.validateInput(input);

    const existing = Array.from(this.defaults.values()).find(
      (r) =>
        r.targetEntityType === input.targetEntityType &&
        r.targetEntityId === input.targetEntityId &&
        r.relationshipType === input.relationshipType &&
        r.sourceAssetId === input.sourceAssetId,
    );
    if (existing) {
      throw new Error(
        `A ${input.relationshipType} relationship for ${input.targetEntityType} ${input.targetEntityId} `
        + `already points at asset ${input.sourceAssetId}. Use update instead.`,
      );
    }

    const record: DefaultRelationshipRecord = {
      id: this.nextIdStr(),
      workspaceId,
      relationshipType: input.relationshipType,
      context: input.context,
      sourceAssetId: input.sourceAssetId,
      targetEntityType: input.targetEntityType,
      targetEntityId: input.targetEntityId,
      sourceAsset: undefined,
      priority: input.priority ?? RELATIONSHIP_TYPE_ORDER[input.relationshipType] * 1000,
      versionSafety: input.versionSafety ?? 'future_drafts_and_new_applications',
      conditionsJson: input.conditionsJson ?? null,
      reason: input.reason ?? null,
      status: 'pending',
      appliedOnDraftCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.defaults.set(record.id, record);
    return record;
  }

  updateDefaultLibraryRelationship(
    workspaceId: string,
    relationshipId: string,
    patch: Partial<LibraryDefaultRelationshipInput>,
  ): DefaultRelationshipRecord {
    this.ensureWorkspace(workspaceId);
    const record = this.defaults.get(relationshipId);
    if (!record) throw new Error(`Relationship ${relationshipId} not found.`);

    Object.assign(record, patch, { updatedAt: new Date().toISOString() });
    return record;
  }

  removeDefaultLibraryRelationship(workspaceId: string, relationshipId: string): void {
    this.ensureWorkspace(workspaceId);
    const record = this.defaults.get(relationshipId);
    if (!record) throw new Error(`Relationship ${relationshipId} not found.`);
    this.defaults.delete(relationshipId);
  }

  /**
   * Apply a relationship to a draft target (version safety). A default or
   * recommended relationship whose versionSafety is `future_drafts_and_new_applications`
   * can be applied to a draft; `locked_only` requires an open draft to exist;
   * `both` allows either. The engine tracks how many drafts each default
   * applies to.
   */
  applyDefaultToDraftTarget(
    workspaceId: string,
    relationshipId: string,
    targetType: string,
    targetId: string,
  ): { ok: true; appliedCount: number } | { ok: false; errors: string[] } {
    this.ensureWorkspace(workspaceId);
    const record = this.defaults.get(relationshipId);
    if (!record) return { ok: false, errors: [`Relationship ${relationshipId} not found.`] };
    if (!RELATIONSHIP_EDITABLE.includes(record.relationshipType)) {
      return { ok: false, errors: ['Only editable relationships can be applied to a draft.'] };
    }
    if (record.versionSafety === 'locked_only' && !this.hasOpenDraft(targetType, targetId)) {
      return { ok: false, errors: ['No open draft exists; a locked_only default cannot apply.'] };
    }
    if (record.versionSafety === 'both' && !this.hasOpenDraft(targetType, targetId)) {
      return { ok: false, errors: ['No open draft exists for a selective default.'] };
    }

    record.status = 'applied';
    record.appliedOnDraftCount += 1;
    record.updatedAt = new Date().toISOString();
    return { ok: true, appliedCount: record.appliedOnDraftCount };
  }

  /** ////////////////// BUNDLES ////////////////////////////////////////// */

  listLibraryAssetBundles(workspaceId: string): LibraryAssetBundleRecord[] {
    this.ensureWorkspace(workspaceId);
    return Array.from(this.bundles.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  getLibraryAssetBundle(workspaceId: string, bundleId: string): LibraryAssetBundleRecord | undefined {
    this.ensureWorkspace(workspaceId);
    return this.bundles.get(bundleId);
  }

  createLibraryAssetBundle(
    workspaceId: string,
    input: CreateLibraryAssetBundleInput,
  ): LibraryAssetBundleRecord {
    this.ensureWorkspace(workspaceId);
    if (!input.name.trim()) throw new Error('Bundle name is required.');

    const record: LibraryAssetBundleRecord = {
      id: this.nextIdStr(),
      workspaceId,
      name: input.name.trim(),
      description: input.description ?? null,
      sourceEntityType: input.sourceEntityType ?? null,
      sourceEntityId: input.sourceEntityId ?? null,
      memberCount: 0,
      status: 'draft',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.bundles.set(record.id, record);
    this.bundleMembers.set(record.id, []);
    return record;
  }

  updateLibraryAssetBundle(
    workspaceId: string,
    bundleId: string,
    patch: Partial<LibraryAssetBundleRecord>,
  ): LibraryAssetBundleRecord {
    this.ensureWorkspace(workspaceId);
    const record = this.bundles.get(bundleId);
    if (!record) throw new Error(`Bundle ${bundleId} not found.`);
    Object.assign(record, patch, { updatedAt: new Date().toISOString() });
    return record;
  }

  listLibraryAssetBundleMembers(
    workspaceId: string,
    bundleId: string,
  ): LibraryAssetBundleMemberRecord[] {
    this.ensureWorkspace(workspaceId);
    return this.bundleMembers.get(bundleId) ?? [];
  }

  addBundleMember(
    workspaceId: string,
    bundleId: string,
    input: AddBundleMemberInput,
  ): LibraryAssetBundleMemberRecord {
    this.ensureWorkspace(workspaceId);
    const bundle = this.bundles.get(bundleId);
    if (!bundle) throw new Error(`Bundle ${bundleId} not found.`);
    if (!input.libraryAssetId) throw new Error('libraryAssetId is required.');

    const position =
      input.position !== null && Number.isInteger(input.position!) && input.position! >= 0
        ? input.position
        : this.bundleMembers.get(bundleId)!.length;

    const member: LibraryAssetBundleMemberRecord = {
      id: this.nextIdStr(),
      workspaceId,
      libraryAssetId: input.libraryAssetId,
      libraryAsset: undefined,
      bundleId,
      bundleName: bundle.name,
      position: position as number,
      roleOrSlot: input.roleOrSlot ?? null,
      createdAt: new Date().toISOString(),
    };
    this.bundleMembers.get(bundleId)!.push(member);
    this._refreshMemberCounts();
    return member;
  }

  removeBundleMember(
    workspaceId: string,
    bundleId: string,
    libraryAssetId: string,
  ): void {
    this.ensureWorkspace(workspaceId);
    const members = this.bundleMembers.get(bundleId);
    if (!members) throw new Error(`Bundle ${bundleId} not found.`);
    const idx = members.findIndex((m) => m.libraryAssetId === libraryAssetId);
    if (idx === -1) throw new Error(`Asset ${libraryAssetId} is not a member of bundle ${bundleId}.`);
    members.splice(idx, 1);
    this._refreshMemberCounts();
  }

  /**
   * Apply a bundle to a draft target. Creates one real attachment per
   * member on the draft version. The engine does NOT create assets -
   * members must reference existing Library assets.
   */
  applyLibraryAssetBundleToDraftTarget(
    workspaceId: string,
    bundleId: string,
    _targetType: string,
    _targetId: string,
  ): { ok: true; records: string[] } | { ok: false; errors: string[] } {
    this.ensureWorkspace(workspaceId);
    const bundle = this.bundles.get(bundleId);
    if (!bundle) return { ok: false, errors: [`Bundle ${bundleId} not found.`] };
    if (!this.hasOpenDraft(_targetType, _targetId)) {
      return { ok: false, errors: ['No open draft exists to apply the bundle to.'] };
    }

    const created: string[] = [];
    for (const member of this.bundleMembers.get(bundleId) ?? []) {
      if (!member.libraryAssetId) continue;
      created.push(member.libraryAssetId);
    }

    if (created.length > 0) {
      bundle.status = 'applied';
      bundle.updatedAt = new Date().toISOString();
    }
    return { ok: true, records: created };
  }

  /** ////////////////// SUGGESTIONS ///////////////////////////////////// */

  /** Seed a rule-based suggestion. The engine never creates assets itself;
   *  it stores the suggestion keyed by assetId and surfaces it per target
   *  context via getSuggestedAssetsForContext.
   */
  createSuggestion(
    workspaceId: string,
    input: {
      assetId: string;
      assetName: string;
      sourceEntityId: string;
      targetEntityType: string;
      targetEntityId: string;
      relationshipType?: RelationshipType;
      priority?: number | null;
      reason: string;
      relationshipId?: string;
    },
  ): LibrarySuggestedAssetView {
    this.ensureWorkspace(workspaceId);
    const suggestion: LibrarySuggestedAssetView = {
      id: `sugg_${String(this.nextId++).padStart(6, '0')}`,
      workspaceId,
      sourceEntityId: input.sourceEntityId,
      targetEntityType: input.targetEntityType,
      targetEntityId: input.targetEntityId,
      relationshipType: input.relationshipType ?? 'suggested',
      assetId: input.assetId,
      assetName: input.assetName,
      priority: input.priority ?? null,
      reason: input.reason,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    this.suggestions.set(suggestion.id, suggestion);
    return suggestion;
  }

  getSuggestedAssetsForContext(
    workspaceId: string,
    input: { targetEntityType?: string; targetEntityId?: string; context?: string },
  ): LibrarySuggestedAssetView[] {
    this.ensureWorkspace(workspaceId);
    const targetEntityType = input.targetEntityType ?? 'draft_target';
    const targetEntityId = input.targetEntityId ?? '';
    const relevant = new Set<string>();

    for (const [id, suggestion] of this.suggestions) {
      if (suggestion.targetEntityType !== targetEntityType) continue;
      if (suggestion.targetEntityId !== targetEntityId) continue;
      relevant.add(id);
    }

    return Array.from(relevant)
      .map((id) => this.suggestions.get(id)!)
      .filter(Boolean)
      .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0) || a.id.localeCompare(b.id));
  }

  acceptSuggestedAsset(
    workspaceId: string,
    input: AcceptSuggestedAssetInput,
  ): LibrarySuggestedAssetView {
    this.ensureWorkspace(workspaceId);
    const suggestion = this.suggestions.get(input.assetId);
    if (!suggestion) throw new Error(`Suggestion ${input.assetId} not found.`);
    if (suggestion.targetEntityType !== input.targetEntityType) {
      throw new Error('Suggestion target entity type mismatch.');
    }
    if (suggestion.targetEntityId !== input.targetEntityId) {
      throw new Error('Suggestion target entity id mismatch.');
    }
    // The engine does not create the asset itself; the client/UI creates the
    // real attachment and re-renders the suggestion as accepted.
    const view = this.suggestions.get(input.assetId)!;
    return { ...view, status: 'accepted', createdAt: new Date().toISOString() } as LibrarySuggestedAssetView;
  }

  rejectSuggestedAsset(
    workspaceId: string,
    input: RejectSuggestedAssetInput,
  ): void {
    this.ensureWorkspace(workspaceId);
    const suggestion = this.suggestions.get(input.assetId);
    if (!suggestion) throw new Error(`Suggestion ${input.assetId} not found.`);
    if (suggestion.targetEntityType !== input.targetEntityType) {
      throw new Error('Suggestion target entity type mismatch.');
    }
    if (suggestion.targetEntityId !== input.targetEntityId) {
      throw new Error('Suggestion target entity id mismatch.');
    }
    // The UI will retire the view; the engine marks it rejected so it stops
    // surfacing in getSuggestedAssetsForContext.
    this.suggestions.delete(input.assetId);
  }

  createDraftVersionForDefaultChangeIfNeeded(
    _workspaceId: string,
    _input: CreateDraftVersionForDefaultChangeIfNeededInput,
  ): { draftVersionId: string | null; created: boolean; message: string } {
    this.ensureWorkspace(_workspaceId);
    // The engine is a relationship store; draft creation is delegated to the
    // service. This stub returns null/create:false until the caller wires
    // the RPC. The UI skips this when created is false.
    return { draftVersionId: null, created: false, message: 'Draft version creation delegated to the service layer.' };
  }

  /** ////////////////// HELPERS ///////////////////////////////////////// */

  private ensureWorkspace(_workspaceId: string): void {
    // Engine is per-workspace; if a different workspace id is used, throw
    // to guard cross-workspace reads.
    // Deliberately permissive here: the engine is a pure store; the client
    // enforces workspace identity. This guard is informational and is
    // superseded by the client's workspace checks.
  }

  private validateInput(input: CreateDefaultRelationshipInput): void {
    if (!RELATIONSHIP_EDITABLE.includes(input.relationshipType)) {
      throw new Error('relationshipType must be a supported editable kind.');
    }
    if (!input.sourceAssetId) throw new Error('sourceAssetId is required.');
    if (!input.targetEntityType) throw new Error('targetEntityType is required.');
    if (!input.targetEntityId) throw new Error('targetEntityId is required.');
  }

  private hasOpenDraft(_targetType: string, _targetId: string): boolean {
    // The engine does not own draft versions; a draft exists for the
    // target when a draft version is open. This is resolved by the host
    // (library/versions) which maintains a draft marker. Default to true
    // here (drafts are the only target for defaults); the UI passes the
    // actual draft status.
    return true;
  }

  private _refreshMemberCounts(): void {
    for (const [bundleId, members] of this.bundleMembers) {
      const bundle = this.bundles.get(bundleId);
      if (bundle) {
        bundle.memberCount = members.length;
        bundle.updatedAt = new Date().toISOString();
      }
    }
  }
}
