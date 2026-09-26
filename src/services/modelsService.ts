/**
 * Models service layer.
 *
 * The single entry point the UI uses for the Models feature. Every mutating
 * call passes domain guards first — a locked version is refused before any
 * repository touch, in demo mode or against Supabase alike.
 */
import {
  isInWorkspaceStrict,
  refuseIfLocked,
  validateCreateModel,
  validateCreateVersion,
  validateUpdateCharacterSheet,
  validateUpdateModelDraft,
} from '../domain/models';
import type {
  CharacterSheetRecord,
  ModelRecord,
  ModelReferenceRecord,
  ModelVersionRecord,
} from '../domain/models';
import type { ModelsRepository } from '../data/modelsRepository';

export class ModelsService {
  constructor(private readonly repo: ModelsRepository) {}

  listModels(workspaceId: string): Promise<ModelRecord[]> {
    return this.repo.listModels(workspaceId);
  }

  async getModel(modelId: string, activeWorkspaceId: string): Promise<ModelRecord> {
    const model = await this.repo.getModel(modelId);
    isInWorkspaceStrict(model.workspaceId, activeWorkspaceId);
    return model;
  }

  async getVersions(modelId: string, activeWorkspaceId: string): Promise<ModelVersionRecord[]> {
    const model = await this.repo.getModel(modelId);
    isInWorkspaceStrict(model.workspaceId, activeWorkspaceId);
    return this.repo.getVersions(modelId);
  }

  async getVersion(versionId: string, activeWorkspaceId: string): Promise<ModelVersionRecord> {
    const version = await this.repo.getVersion(versionId);
    const model = await this.repo.getModel(version.modelId);
    isInWorkspaceStrict(model.workspaceId, activeWorkspaceId);
    return version;
  }

  async getCharacterSheet(versionId: string, activeWorkspaceId: string): Promise<CharacterSheetRecord> {
    await this.getVersion(versionId, activeWorkspaceId);
    return this.repo.getCharacterSheet(versionId);
  }

  async getReferences(versionId: string, activeWorkspaceId: string): Promise<ModelReferenceRecord[]> {
    await this.getVersion(versionId, activeWorkspaceId);
    return this.repo.getReferences(versionId);
  }

  async createModel(input: unknown, createdBy: string): Promise<ModelRecord> {
    const result = validateCreateModel(input);
    if (!result.ok) throw new Error(`Invalid model: ${result.errors.join('; ')}`);
    return this.repo.createModel(result.value, createdBy);
  }

  async updateModelDraft(
    modelId: string,
    patch: unknown,
    activeWorkspaceId: string,
  ): Promise<ModelRecord> {
    const model = await this.repo.getModel(modelId);
    isInWorkspaceStrict(model.workspaceId, activeWorkspaceId);

    const result = validateUpdateModelDraft(patch);
    if (!result.ok) throw new Error(`Invalid model update: ${result.errors.join('; ')}`);
    return this.repo.updateModelDraft(modelId, result.value);
  }

  async createVersion(input: unknown, createdBy: string, activeWorkspaceId: string): Promise<ModelVersionRecord> {
    const result = validateCreateVersion(input);
    if (!result.ok) throw new Error(`Invalid version creation: ${result.errors.join('; ')}`);

    const model = await this.repo.getModel(result.value.modelId);
    isInWorkspaceStrict(model.workspaceId, activeWorkspaceId);

    // Versions (locked or draft) may be copied; only the newest is a draft.
    await this.repo.getVersion(result.value.sourceVersionId);
    return this.repo.createVersion(result.value, createdBy);
  }

  async lockVersion(versionId: string, activeWorkspaceId: string): Promise<ModelVersionRecord> {
    const version = await this.repo.getVersion(versionId);
    const model = await this.repo.getModel(version.modelId);
    isInWorkspaceStrict(model.workspaceId, activeWorkspaceId);

    refuseIfLocked(version); // locked → LockedVersionError; draft → proceeds
    return this.repo.lockVersion({ versionId });
  }

  async updateCharacterSheet(
    versionId: string,
    patch: unknown,
    activeWorkspaceId: string,
  ): Promise<CharacterSheetRecord> {
    const version = await this.repo.getVersion(versionId);
    const model = await this.repo.getModel(version.modelId);
    isInWorkspaceStrict(model.workspaceId, activeWorkspaceId);

    refuseIfLocked(version); // guard before repository write

    const result = validateUpdateCharacterSheet(patch);
    if (!result.ok) throw new Error(`Invalid character sheet update: ${result.errors.join('; ')}`);
    return this.repo.updateCharacterSheet(versionId, result.value);
  }
}
