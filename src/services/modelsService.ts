/**
 * Models service layer.
 *
 * The single entry point the UI uses for the Models feature. Every mutating
 * call passes domain guards first — a locked version is refused before any
 * repository touch, in demo mode or against Supabase alike.
 */
import {
  compareCandidateTraitsToProtectedTraits,
  getCharacterSheetReferencesForGeneration,
  getProtectedIdentityTraits,
  isInWorkspaceStrict,
  LockedVersionError,
  refuseIfLocked,
  selectActiveIdentityVersion,
  validateCreateModel,
  validateCreateVersion,
  validateModelGenerationAgainstCharacterSheet,
  validateUpdateCharacterSheet,
  validateUpdateModelDraft,
} from '../domain/models';
import type {
  CharacterSheetAuditRow,
  CharacterSheetRecord,
  CharacterSheetTraitRow,
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

    // Guard before repository write. A refusal is audited best-effort so the
    // trail shows every blocked attempt to touch a locked identity — the
    // audit failure itself must never mask the guard error.
    try {
      refuseIfLocked(version);
    } catch (err) {
      if (err instanceof LockedVersionError) {
        await this.repo
          .appendCharacterSheetAudit(
            versionId,
            'protected_trait_edit_blocked',
            `Refused Character Sheet edit on locked version ${versionId} (workspace ${activeWorkspaceId}).`,
          )
          .catch(() => undefined);
      }
      throw err;
    }

    const result = validateUpdateCharacterSheet(patch);
    if (!result.ok) throw new Error(`Invalid character sheet update: ${result.errors.join('; ')}`);
    return this.repo.updateCharacterSheet(versionId, result.value);
  }

  // ── Prompt 26: generation-time Character Sheet hooks ────────────────────
  // Every hook re-checks workspace ownership before reading; consumers can
  // never see another workspace's identity data through these paths.

  /**
   * The Character Sheet of the version that governs the model's current
   * identity (active locked version, else latest locked, else newest draft).
   * Null when the model has no version with a sheet.
   */
  async getActiveCharacterSheet(
    modelId: string,
    activeWorkspaceId: string,
  ): Promise<CharacterSheetRecord | null> {
    const model = await this.repo.getModel(modelId);
    isInWorkspaceStrict(model.workspaceId, activeWorkspaceId);
    const versions = await this.repo.getVersions(modelId);
    const version = selectActiveIdentityVersion(model, versions);
    if (!version) return null;
    try {
      return await this.repo.getCharacterSheet(version.id);
    } catch {
      return null;
    }
  }

  /** Protected identity traits of the active sheet, as explicit rows. */
  async getProtectedIdentityTraits(
    modelId: string,
    activeWorkspaceId: string,
  ): Promise<CharacterSheetTraitRow[]> {
    const sheet = await this.getActiveCharacterSheet(modelId, activeWorkspaceId);
    return sheet ? getProtectedIdentityTraits(sheet) : [];
  }

  /**
   * The active identity version's references, ordered for generation
   * (portrait evidence first).
   */
  async getCharacterSheetReferencesForGeneration(
    modelId: string,
    activeWorkspaceId: string,
  ): Promise<ModelReferenceRecord[]> {
    const model = await this.repo.getModel(modelId);
    isInWorkspaceStrict(model.workspaceId, activeWorkspaceId);
    const versions = await this.repo.getVersions(modelId);
    const version = selectActiveIdentityVersion(model, versions);
    if (!version) return [];
    return getCharacterSheetReferencesForGeneration(await this.repo.getReferences(version.id));
  }

  /**
   * Validates a candidate generation's claimed identity against the active
   * sheet's protected traits. Invalid when any provided protected trait
   * disagrees with the sheet.
   */
  async validateModelGenerationAgainstCharacterSheet(
    modelId: string,
    candidateTraits: Record<string, unknown>,
    activeWorkspaceId: string,
  ): Promise<{ valid: boolean; mismatches: string[]; protectedTraitCount: number }> {
    const sheet = await this.getActiveCharacterSheet(modelId, activeWorkspaceId);
    if (!sheet) {
      return {
        valid: false,
        mismatches: ['No active Character Sheet exists for this model.'],
        protectedTraitCount: 0,
      };
    }
    return validateModelGenerationAgainstCharacterSheet(sheet, candidateTraits);
  }

  /** Pure comparison seam for callers holding their own protected rows. */
  compareCandidateTraitsToProtectedTraits(
    candidateTraits: Record<string, unknown>,
    protectedTraits: CharacterSheetTraitRow[],
  ): { matches: boolean; mismatches: string[] } {
    return compareCandidateTraitsToProtectedTraits(candidateTraits, protectedTraits);
  }

  /** Audit trail of a version's Character Sheet, oldest first. */
  async getCharacterSheetAudit(
    versionId: string,
    activeWorkspaceId: string,
  ): Promise<CharacterSheetAuditRow[]> {
    const version = await this.repo.getVersion(versionId);
    const model = await this.repo.getModel(version.modelId);
    isInWorkspaceStrict(model.workspaceId, activeWorkspaceId);
    return this.repo.listCharacterSheetAudit(versionId);
  }
}
