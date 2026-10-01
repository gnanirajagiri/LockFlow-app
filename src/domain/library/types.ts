/**
 * Library domain — types.
 *
 * LockFlow has EXACTLY ONE unified Library. Assets are reusable workspace
 * inputs (products, props, wardrobe, accessories, creator tools, brand
 * assets, references, scenes, saved Looks) with one canonical record each.
 * Generated outputs are never Library records — they belong to Gallery.
 *
 * A Look is the one asset type associated with a model; its items point at
 * canonical Library assets (never copies) and it never alters the model's
 * protected Character Sheet.
 */
export type LibraryAssetType =
  | 'product'
  | 'prop'
  | 'wardrobe'
  | 'accessory'
  | 'personal_item'
  | 'creator_tool'
  | 'brand_asset'
  | 'reference'
  | 'scene'
  | 'look'
  | 'other';

export type LibraryAssetStatus = 'draft' | 'ready' | 'archived';
export type AssetVersionStatus = 'draft' | 'locked' | 'superseded';
export type AssetRightsStatus = 'unknown' | 'confirmed' | 'restricted';

// ── Prompt 21: unified-Library organization (by where an asset is USED) ────

/**
 * Usage scope — the taxonomy axis. Assets are organized by where they are
 * used: on a model, on an item, in an environment, or shared broadly.
 * There is no "global/my library" axis anywhere in the product.
 */
export type LibraryUsageScope = 'model' | 'item' | 'environment' | 'shared';

/** Where an asset's bytes/metadata came from (safe provenance label only). */
export type LibrarySourceKind = 'manual' | 'reference_upload' | 'generated_derivative' | 'import';

export type LibraryReferenceType =
  | 'front'
  | 'back'
  | 'detail'
  | 'in_context'
  | 'label'
  | 'material'
  | 'other';

export type LookItemRole =
  | 'wardrobe'
  | 'accessory'
  | 'personal_item'
  | 'product'
  | 'creator_tool'
  | 'other';

export interface LibraryAssetRecord {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  assetType: LibraryAssetType;
  status: LibraryAssetStatus;
  activeVersionId: string | null;
  coverImagePath: string | null;
  description: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  // ── Prompt 21: unified taxonomy + safe links (all nullable) ────────────
  /** Where the asset is used; null = legacy row before taxonomy existed. */
  usageScope: LibraryUsageScope | null;
  /** Safe provenance label; never carries provider payloads. */
  sourceKind: LibrarySourceKind | null;
  /** Specific usage links — validated same-workspace by the service. */
  linkedModelId: string | null;
  linkedItemId: string | null;
  linkedEnvironmentId: string | null;
  /** Brand entities do not exist yet; placeholder for future use. */
  linkedBrandId: string | null;
  /** Storage file placeholders — safe references only, never signed URLs. */
  primaryFileId: string | null;
  thumbnailFileId: string | null;
  /** Audit-safe free-form metadata (plain scalars/objects, no secrets). */
  metadata: Record<string, unknown> | null;
  archivedAt: string | null;
  archivedBy: string | null;
}

export interface LibraryAssetVersionRecord {
  id: string;
  libraryAssetId: string;
  versionNumber: number;
  status: AssetVersionStatus;
  changeSummary: string;
  coverImagePath: string | null;
  /** The approved configuration (JSONB in Postgres). */
  structuredDetails: Record<string, unknown>;
  rightsStatus: AssetRightsStatus;
  lockedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface LibraryReferenceRecord {
  id: string;
  libraryAssetVersionId: string;
  storagePath: string;
  referenceType: LibraryReferenceType;
  caption: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  /** Present on real uploads; absent on metadata-only placeholder rows. */
  storageBucket?: string | null;
  originalFilename?: string | null;
  displayFilename?: string | null;
  mimeType?: string | null;
  fileSizeBytes?: number | null;
  width?: number | null;
  height?: number | null;
  uploadStatus?: 'pending' | 'uploaded' | 'failed' | 'deleted';
  rightsConfirmedAt?: string | null;
}

export interface LibraryTagRecord {
  id: string;
  workspaceId: string;
  name: string;
  normalizedName: string;
  createdAt: string;
}

export interface LibraryTagLinkRecord {
  libraryAssetId: string;
  tagId: string;
  createdAt: string;
}

export interface LookDetailsRecord {
  id: string;
  libraryAssetVersionId: string;
  modelId: string;
  presentationNotes: string;
  createdAt: string;
  updatedAt: string;
}

export interface LookAssetItemRecord {
  id: string;
  lookDetailsId: string;
  libraryAssetId: string;
  libraryAssetVersionId: string | null;
  role: LookItemRole;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

// ── Input payloads ──────────────────────────────────────────────────────────

export interface CreateLibraryAssetInput {
  workspaceId: string;
  name: string;
  slug?: string;
  assetType: LibraryAssetType;
  description?: string;
}

/** Prompt 21 — extended creation payload (taxonomy + safe links). */
export interface CreateLibraryAssetExtendedInput extends CreateLibraryAssetInput {
  usageScope?: LibraryUsageScope;
  sourceKind?: LibrarySourceKind;
  linkedModelId?: string | null;
  linkedItemId?: string | null;
  linkedEnvironmentId?: string | null;
  linkedBrandId?: string | null;
  primaryFileId?: string | null;
  thumbnailFileId?: string | null;
  metadata?: Record<string, unknown> | null;
  /** Normalized tag names to attach at creation. */
  tags?: string[];
}

/** Prompt 21 — partial extended update. */
export interface UpdateLibraryAssetExtendedInput {
  name?: string;
  description?: string | null;
  coverImagePath?: string | null;
  usageScope?: LibraryUsageScope | null;
  linkedModelId?: string | null;
  linkedItemId?: string | null;
  linkedEnvironmentId?: string | null;
  linkedBrandId?: string | null;
  primaryFileId?: string | null;
  thumbnailFileId?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** Prompt 21 — list filters (the whole taxonomy is filterable). */
export interface LibraryAssetFilters {
  search?: string;
  assetType?: LibraryAssetType | LibraryAssetType[];
  status?: LibraryAssetStatus;
  usageScope?: LibraryUsageScope;
  linkedModelId?: string;
  linkedItemId?: string;
  linkedEnvironmentId?: string;
  /** Normalized tag name. */
  tag?: string;
  createdBy?: string;
  updatedFrom?: string;
  updatedTo?: string;
  /** Default listings exclude archived; the archived view sets archivedOnly. */
  archivedOnly?: boolean;
  includeArchived?: boolean;
}

/** Prompt 21 — picker context: where the attach will be used. */
export interface LibraryPickerContext {
  usageScope?: LibraryUsageScope;
  linkedModelId?: string;
  linkedItemId?: string;
  linkedEnvironmentId?: string;
  search?: string;
  /** Expand beyond the default active+ready restriction. */
  includeDrafts?: boolean;
}

/** Prompt 21 — structured audit event types. */
export type LibraryEventType =
  | 'library_asset_created'
  | 'library_asset_updated'
  | 'library_asset_archived'
  | 'library_asset_restored'
  | 'library_asset_viewed'
  | 'library_picker_opened'
  | 'library_asset_attached';

export interface LibraryEventRecord {
  id: string;
  workspaceId: string;
  libraryAssetId: string | null;
  actorId: string | null;
  eventType: LibraryEventType;
  message: string;
  metadata: Record<string, string | number | boolean> | null;
  createdAt: string;
}

export interface UpdateLibraryAssetDraftInput {
  name?: string;
  status?: LibraryAssetStatus;
  coverImagePath?: string | null;
  description?: string | null;
}

export interface UpdateAssetVersionDraftInput {
  changeSummary?: string;
  rightsStatus?: AssetRightsStatus;
  structuredDetails?: Record<string, unknown>;
}

export interface CreateAssetVersionInput {
  libraryAssetId: string;
  sourceVersionId: string;
  changeSummary?: string;
}

export interface LockAssetVersionInput {
  versionId: string;
}

export interface AddAssetTagInput {
  libraryAssetId: string;
  /** Display name; normalized (lowercase, hyphenated) for uniqueness. */
  name: string;
}

export interface SetLookItemsInput {
  lookDetailsId: string;
  items: Array<{
    libraryAssetId: string;
    libraryAssetVersionId?: string | null;
    role: LookItemRole;
    sortOrder: number;
  }>;
}

export interface LibraryAssetWithVersion extends LibraryAssetRecord {
  activeVersion: LibraryAssetVersionRecord | null;
}
