/**
 * Models repository contract.
 *
 * UI never calls Supabase directly; it goes through the service layer, which
 * applies domain guards, which then calls one of these adapters.
 */
import type {
  CharacterSheetRecord,
  CreateModelInput,
  CreateVersionInput,
  LockVersionInput,
  ModelRecord,
  ModelReferenceRecord,
  ModelVersionRecord,
  UpdateCharacterSheetInput,
  UpdateModelDraftInput,
} from '../domain/models';

export interface ModelsRepository {
  listModels(workspaceId: string): Promise<ModelRecord[]>;

  getModel(modelId: string): Promise<ModelRecord>;

  getVersions(modelId: string): Promise<ModelVersionRecord[]>;

  getVersion(versionId: string): Promise<ModelVersionRecord>;

  getCharacterSheet(versionId: string): Promise<CharacterSheetRecord>;

  getReferences(versionId: string): Promise<ModelReferenceRecord[]>;

  createModel(input: CreateModelInput, createdBy: string): Promise<ModelRecord>;

  updateModelDraft(
    modelId: string,
    patch: UpdateModelDraftInput,
  ): Promise<ModelRecord>;

  /** Creates the next draft version (copies the source version's sheet). */
  createVersion(input: CreateVersionInput, createdBy: string): Promise<ModelVersionRecord>;

  /** Locks a draft version and sets it as the model's active version. */
  lockVersion(input: LockVersionInput): Promise<ModelVersionRecord>;

  updateCharacterSheet(
    versionId: string,
    patch: UpdateCharacterSheetInput,
  ): Promise<CharacterSheetRecord>;
}
