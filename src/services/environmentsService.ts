/**
 * Environments service layer.
 *
 * The single entry point the UI uses for the Environments feature. Every
 * mutating call passes domain guards first — a locked version is refused
 * before any repository touch, in demo mode or against Supabase alike.
 *
 * Product rules enforced here:
 *   * Environments are standalone: nothing in this API accepts or returns a
 *     model id, and there is no global-vs-model-specific classification.
 *   * Archive is a soft status change only; nothing is ever deleted.
 *   * Draft-from-locked copies the spec and reference metadata without
 *     mutating the source version.
 */
import {
  assertEnvironmentInWorkspace,
  refuseEnvironmentLocked,
  validateCreateEnvironment,
  validateCreateEnvironmentVersion,
  validateUpdateEnvironmentDraft,
  validateUpdateEnvironmentSpec,
  validateUpdateEnvironmentVersionDraft,
} from '../domain/environments';
import type {
  EnvironmentAssetShortcutRecord,
  EnvironmentRecord,
  EnvironmentReferenceRecord,
  EnvironmentSpecRecord,
  EnvironmentVersionRecord,
} from '../domain/environments';
import type { EnvironmentsRepository } from '../data/environmentsRepository';

export class EnvironmentsService {
  constructor(private readonly repo: EnvironmentsRepository) {}

  listEnvironments(workspaceId: string): Promise<EnvironmentRecord[]> {
    return this.repo.listEnvironments(workspaceId);
  }

  async getEnvironment(environmentId: string, activeWorkspaceId: string): Promise<EnvironmentRecord> {
    const record = await this.repo.getEnvironment(environmentId);
    assertEnvironmentInWorkspace(record, activeWorkspaceId);
    return record;
  }

  async getVersions(
    environmentId: string,
    activeWorkspaceId: string,
  ): Promise<EnvironmentVersionRecord[]> {
    const record = await this.repo.getEnvironment(environmentId);
    assertEnvironmentInWorkspace(record, activeWorkspaceId);
    return this.repo.getVersions(environmentId);
  }

  async getVersion(
    versionId: string,
    activeWorkspaceId: string,
  ): Promise<EnvironmentVersionRecord> {
    const version = await this.repo.getVersion(versionId);
    const environment = await this.repo.getEnvironment(version.environmentId);
    assertEnvironmentInWorkspace(environment, activeWorkspaceId);
    return version;
  }

  async getSpec(
    versionId: string,
    activeWorkspaceId: string,
  ): Promise<EnvironmentSpecRecord> {
    await this.getVersion(versionId, activeWorkspaceId);
    return this.repo.getSpec(versionId);
  }

  async getReferences(
    versionId: string,
    activeWorkspaceId: string,
  ): Promise<EnvironmentReferenceRecord[]> {
    await this.getVersion(versionId, activeWorkspaceId);
    return this.repo.getReferences(versionId);
  }

  /** Library shortcut pointers for this environment (ids only; resolve via LibraryService). */
  async listAssetShortcuts(
    environmentId: string,
    activeWorkspaceId: string,
  ): Promise<EnvironmentAssetShortcutRecord[]> {
    const record = await this.repo.getEnvironment(environmentId);
    assertEnvironmentInWorkspace(record, activeWorkspaceId);
    return this.repo.listAssetShortcuts(environmentId);
  }

  /** Adds reference metadata to a draft version (guard-checked). */
  async addReference(
    versionId: string,
    input: { storagePath: string; referenceType: EnvironmentReferenceRecord['referenceType']; caption: string },
    activeWorkspaceId: string,
  ): Promise<EnvironmentReferenceRecord> {
    const version = await this.getVersion(versionId, activeWorkspaceId);
    refuseEnvironmentLocked(version);
    if (version.status !== 'draft') {
      throw new Error(`Only draft versions can modify references (status: ${version.status}).`);
    }
    return this.repo.addReference(versionId, input);
  }

  /** Updates reference metadata on a draft version (guard-checked). */
  async updateReference(
    versionId: string,
    referenceId: string,
    patch: { storagePath?: string; referenceType?: EnvironmentReferenceRecord['referenceType']; caption?: string },
    activeWorkspaceId: string,
  ): Promise<void> {
    const version = await this.getVersion(versionId, activeWorkspaceId);
    refuseEnvironmentLocked(version);
    if (version.status !== 'draft') {
      throw new Error(`Only draft versions can modify references (status: ${version.status}).`);
    }
    return this.repo.updateReference(versionId, referenceId, patch);
  }

  /** Removes reference metadata from a draft version (guard-checked). */
  async removeReference(
    versionId: string,
    referenceId: string,
    activeWorkspaceId: string,
  ): Promise<void> {
    const version = await this.getVersion(versionId, activeWorkspaceId);
    refuseEnvironmentLocked(version);
    if (version.status !== 'draft') {
      throw new Error(`Only draft versions can modify references (status: ${version.status}).`);
    }
    return this.repo.removeReference(versionId, referenceId);
  }

  async createEnvironment(input: unknown, createdBy: string): Promise<EnvironmentRecord> {
    const result = validateCreateEnvironment(input);
    if (!result.ok) throw new Error(`Invalid environment: ${result.errors.join('; ')}`);

    // Every environment is born with a first draft version (v1) and its empty
    // Environment Spec — a specification record ready to edit.
    const record = await this.repo.createEnvironment(result.value, createdBy);
    await this.repo.createFirstVersion(record.id, createdBy).catch((err) => {
      // The environment record exists; surface the partial-failure honestly.
      throw new Error(
        `Environment "${record.name}" was created but its first draft version failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    });
    return record;
  }

  /**
   * Soft-archive: status-only transition (draft|ready → archived). LockFlow
   * never deletes environments — history is preserved — so this is the only
   * archive path in the service layer, and it can never remove records.
   */
  async archiveEnvironment(
    environmentId: string,
    activeWorkspaceId: string,
  ): Promise<EnvironmentRecord> {
    const record = await this.repo.getEnvironment(environmentId);
    assertEnvironmentInWorkspace(record, activeWorkspaceId);

    if (record.status === 'archived') return record; // idempotent

    // Soft-archive guard: refuse anything that is not a plain status change.
    if (record.status !== 'draft' && record.status !== 'ready') {
      throw new Error(`Archive is a soft status change only (current status: ${record.status}).`);
    }
    return this.repo.updateEnvironmentDraft(environmentId, { status: 'archived' });
  }

  async updateEnvironmentDraft(
    environmentId: string,
    patch: unknown,
    activeWorkspaceId: string,
  ): Promise<EnvironmentRecord> {
    const record = await this.repo.getEnvironment(environmentId);
    assertEnvironmentInWorkspace(record, activeWorkspaceId);

    const result = validateUpdateEnvironmentDraft(patch);
    if (!result.ok) throw new Error(`Invalid environment update: ${result.errors.join('; ')}`);
    return this.repo.updateEnvironmentDraft(environmentId, result.value);
  }

  async createVersion(
    input: unknown,
    createdBy: string,
    activeWorkspaceId: string,
  ): Promise<EnvironmentVersionRecord> {
    const result = validateCreateEnvironmentVersion(input);
    if (!result.ok) throw new Error(`Invalid version creation: ${result.errors.join('; ')}`);

    const environment = await this.repo.getEnvironment(result.value.environmentId);
    assertEnvironmentInWorkspace(environment, activeWorkspaceId);

    // Versions (locked or superseded) may be copied; only one draft may exist.
    await this.repo.getVersion(result.value.sourceVersionId);
    const version = await this.repo.createVersion(result.value, createdBy);
    // Duplicate the source version's reference metadata into the new draft.
    // The source version itself is never modified.
    await this.repo.copyReferences(result.value.sourceVersionId, version.id);
    return version;
  }

  async lockVersion(
    versionId: string,
    activeWorkspaceId: string,
  ): Promise<EnvironmentVersionRecord> {
    const version = await this.repo.getVersion(versionId);
    const environment = await this.repo.getEnvironment(version.environmentId);
    assertEnvironmentInWorkspace(environment, activeWorkspaceId);

    refuseEnvironmentLocked(version); // locked → error; draft → proceeds
    return this.repo.lockVersion({ versionId });
  }

  /** Draft-only: update a version's lock level / change summary. */
  async updateVersionDraft(
    versionId: string,
    patch: unknown,
    activeWorkspaceId: string,
  ): Promise<EnvironmentVersionRecord> {
    const version = await this.repo.getVersion(versionId);
    const environment = await this.repo.getEnvironment(version.environmentId);
    assertEnvironmentInWorkspace(environment, activeWorkspaceId);

    refuseEnvironmentLocked(version);
    if (version.status !== 'draft') {
      throw new Error(`Only draft versions can be updated (status: ${version.status}).`);
    }

    const result = validateUpdateEnvironmentVersionDraft(patch);
    if (!result.ok) {
      throw new Error(`Invalid version update: ${result.errors.join('; ')}`);
    }
    return this.repo.updateVersionDraft(versionId, result.value);
  }

  async updateSpec(
    versionId: string,
    patch: unknown,
    activeWorkspaceId: string,
  ): Promise<EnvironmentSpecRecord> {
    const version = await this.repo.getVersion(versionId);
    const environment = await this.repo.getEnvironment(version.environmentId);
    assertEnvironmentInWorkspace(environment, activeWorkspaceId);

    refuseEnvironmentLocked(version); // guard before repository write

    const result = validateUpdateEnvironmentSpec(patch);
    if (!result.ok) throw new Error(`Invalid environment spec update: ${result.errors.join('; ')}`);
    return this.repo.updateSpec(versionId, result.value);
  }
}
