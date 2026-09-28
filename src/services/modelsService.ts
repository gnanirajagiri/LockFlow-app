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
  ModelAssetShortcutRecord,
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

  /** Adds reference metadata to a draft version (guard-checked). */
  async addReference(
    versionId: string,
    input: { storagePath: string; referenceType: ModelReferenceRecord['referenceType']; caption: string },
    activeWorkspaceId: string,
  ): Promise<ModelReferenceRecord> {
    const version = await this.getVersion(versionId, activeWorkspaceId);
    refuseIfLocked(version);
    if (version.status !== 'draft') {
      throw new Error(`Only draft versions can modify references (status: ${version.status}).`);
    }
    return this.repo.addReference(versionId, input);
  }

  /** Updates reference metadata on a draft version (guard-checked). */
  async updateReference(
    versionId: string,
    referenceId: string,
    patch: { storagePath?: string; referenceType?: ModelReferenceRecord['referenceType']; caption?: string },
    activeWorkspaceId: string,
  ): Promise<void> {
    const version = await this.getVersion(versionId, activeWorkspaceId);
    refuseIfLocked(version);
    if (version.status !== 'draft') {
      throw new Error(`Only draft versions can modify references (status: ${version.status}).`);
    }
    return this.repo.updateReference(versionId, referenceId, patch);
  }

  /** Removes a draft version's reference metadata row (guard-checked). */
  async removeReference(
    versionId: string,
    referenceId: string,
    activeWorkspaceId: string,
  ): Promise<void> {
    const version = await this.getVersion(versionId, activeWorkspaceId);
    refuseIfLocked(version);
    if (version.status !== 'draft') {
      throw new Error(`Only draft versions can modify references (status: ${version.status}).`);
    }
    return this.repo.removeReference(versionId, referenceId);
  }

  /** Library shortcut pointers for this model (ids only; resolve via LibraryService). */
  async listAssetShortcuts(
    modelId: string,
    activeWorkspaceId: string,
  ): Promise<ModelAssetShortcutRecord[]> {
    const model = await this.repo.getModel(modelId);
    isInWorkspaceStrict(model.workspaceId, activeWorkspaceId);
    return this.repo.listAssetShortcuts(modelId);
  }

  async createModel(input: unknown, createdBy: string): Promise<ModelRecord> {
    const result = validateCreateModel(input);
    if (!result.ok) throw new Error(`Invalid model: ${result.errors.join('; ')}`);

    // Every model is born with a first draft version (v1) and its empty
    // Character Sheet — a protected identity record ready to edit.
    const model = await this.repo.createModel(result.value, createdBy);
    await this.repo
      .createFirstVersion(model.id, createdBy)
      .catch((err) => {
        // The model record exists; surface the partial-failure honestly.
        throw new Error(
          `Model "${model.name}" was created but its first draft version failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
    return model;
  }

  /**
   * Soft-archive: status-only transition (draft|ready → archived). LockFlow
   * never deletes models — history is preserved — so this is the only
   * archive path in the service layer, and it can never remove records.
   */
  async archiveModel(modelId: string, activeWorkspaceId: string): Promise<ModelRecord> {
    const model = await this.repo.getModel(modelId);
    isInWorkspaceStrict(model.workspaceId, activeWorkspaceId);

    if (model.status === 'archived') return model; // idempotent

    // Soft-archive guard: refuse anything that is not a plain status change.
    if (model.status !== 'draft' && model.status !== 'ready') {
      throw new Error(`Archive is a soft status change only (current status: ${model.status}).`);
    }
    return this.repo.updateModelDraft(modelId, { status: 'archived' });
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
    const version = await this.repo.createVersion(result.value, createdBy);
    // Duplicate the source version's reference metadata into the new draft.
    await this.repo.copyReferences(result.value.sourceVersionId, version.id);
    return version;
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
