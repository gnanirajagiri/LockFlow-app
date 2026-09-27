/**
 * Library repository contract.
 *
 * UI never calls Supabase directly; it goes through the LibraryService,
 * which applies domain guards, which then calls one of these adapters.
 */
import type {
  AddAssetTagInput,
  CreateAssetVersionInput,
  CreateLibraryAssetInput,
  LibraryAssetRecord,
  LibraryAssetVersionRecord,
  LibraryReferenceRecord,
  LibraryTagRecord,
  LookAssetItemRecord,
  LookDetailsRecord,
  LockAssetVersionInput,
  SetLookItemsInput,
  UpdateAssetVersionDraftInput,
  UpdateLibraryAssetDraftInput,
} from '../domain/library';

export interface LibraryRepository {
  // Assets
  listAssets(workspaceId: string): Promise<LibraryAssetRecord[]>;
  getAsset(assetId: string): Promise<LibraryAssetRecord>;
  createAsset(input: CreateLibraryAssetInput, createdBy: string): Promise<LibraryAssetRecord>;
  /** Creates the asset's first draft version (v1). */
  createFirstVersion(assetId: string, createdBy: string, changeSummary?: string): Promise<LibraryAssetVersionRecord>;
  updateAssetDraft(assetId: string, patch: UpdateLibraryAssetDraftInput): Promise<LibraryAssetRecord>;

  // Versions
  getVersions(assetId: string): Promise<LibraryAssetVersionRecord[]>;
  getVersion(versionId: string): Promise<LibraryAssetVersionRecord>;
  createVersion(input: CreateAssetVersionInput, createdBy: string): Promise<LibraryAssetVersionRecord>;
  updateVersionDraft(versionId: string, patch: UpdateAssetVersionDraftInput): Promise<LibraryAssetVersionRecord>;
  lockVersion(input: LockAssetVersionInput): Promise<LibraryAssetVersionRecord>;

  // References (metadata only; uploads arrive with secure storage)
  getReferences(versionId: string): Promise<LibraryReferenceRecord[]>;
  addReference(
    versionId: string,
    input: { storagePath: string; referenceType: LibraryReferenceRecord['referenceType']; caption: string },
  ): Promise<LibraryReferenceRecord>;
  updateReference(
    versionId: string,
    referenceId: string,
    patch: { storagePath?: string; referenceType?: LibraryReferenceRecord['referenceType']; caption?: string },
  ): Promise<void>;
  removeReference(versionId: string, referenceId: string): Promise<void>;
  copyReferences(sourceVersionId: string, targetVersionId: string): Promise<void>;

  // Tags (workspace-local vocabulary; get-or-create by normalized name)
  getTagsForAsset(assetId: string): Promise<LibraryTagRecord[]>;
  addTagToAsset(input: AddAssetTagInput & { normalizedName?: string }, workspaceId: string): Promise<LibraryTagRecord>;
  removeTagFromAsset(assetId: string, tagId: string): Promise<void>;

  // Looks
  getLookDetails(versionId: string): Promise<LookDetailsRecord | null>;
  updateLookDetails(versionId: string, patch: { presentationNotes?: string }): Promise<LookDetailsRecord>;
  ensureLookDetails(versionId: string, modelId: string, presentationNotes?: string): Promise<LookDetailsRecord>;
  getLookItems(lookDetailsId: string): Promise<LookAssetItemRecord[]>;
  setLookItems(input: SetLookItemsInput): Promise<LookAssetItemRecord[]>;
}
