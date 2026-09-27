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
