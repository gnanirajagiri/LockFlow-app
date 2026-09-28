/**
 * Models domain — types.
 *
 * A Model is independently reusable and never tied to an environment,
 * wardrobe item, prop, Look or content job. Identity lives in a versioned
 * Character Sheet (face/hair/complexion/body/distinctive details only);
 * non-identity items attach later from the shared Library.
 */
export type ModelStatus = 'draft' | 'ready' | 'archived';
export type ModelVersionStatus = 'draft' | 'locked' | 'superseded';
export type ReferenceType = 'portrait' | 'full_body' | 'profile' | 'detail' | 'other';
export type AssetShortcutCategory =
  | 'wardrobe'
  | 'accessory'
  | 'personal_item'
  | 'product'
  | 'creator_tool'
  | 'other';

export interface ModelRecord {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  status: ModelStatus;
  activeVersionId: string | null;
  coverImagePath: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ModelVersionRecord {
  id: string;
  modelId: string;
  versionNumber: number;
  status: ModelVersionStatus;
  changeSummary: string;
  coverImagePath: string | null;
  lockedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** Identity-only structured traits (JSONB in Postgres). */
export type SheetTraits = Record<string, unknown>;

export interface CharacterSheetRecord {
  id: string;
  modelVersionId: string;
  identitySummary: string;
  faceFeatures: SheetTraits;
  hairIdentity: SheetTraits;
  complexion: SheetTraits;
  bodyProportions: SheetTraits;
  distinctiveDetails: SheetTraits;
  lockRules: SheetTraits;
  referenceNotes: string;
  createdAt: string;
  updatedAt: string;
}

export interface ModelReferenceRecord {
  id: string;
  modelVersionId: string;
  storagePath: string;
  referenceType: ReferenceType;
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

/**
 * Shortcut into the ONE unified shared Library. Pointers only — must never
 * duplicate or replace Library assets. `libraryAssetId` is nullable until the
 * shared Library migration exists (no FK yet, by design).
 */
export interface ModelAssetShortcutRecord {
  id: string;
  modelId: string;
  libraryAssetId: string | null;
  category: AssetShortcutCategory;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

// ── Input payloads ──────────────────────────────────────────────────────────

export interface CreateModelInput {
  workspaceId: string;
  name: string;
  slug?: string;
}

export interface UpdateModelDraftInput {
  name?: string;
  status?: ModelStatus;
  coverImagePath?: string | null;
}

export interface UpdateCharacterSheetInput {
  identitySummary?: string;
  faceFeatures?: SheetTraits;
  hairIdentity?: SheetTraits;
  complexion?: SheetTraits;
  bodyProportions?: SheetTraits;
  distinctiveDetails?: SheetTraits;
  lockRules?: SheetTraits;
  referenceNotes?: string;
}

export interface CreateVersionInput {
  modelId: string;
  sourceVersionId: string;
  changeSummary?: string;
}

export interface LockVersionInput {
  versionId: string;
}

export interface ModelWithVersion extends ModelRecord {
  activeVersion: ModelVersionRecord | null;
}
