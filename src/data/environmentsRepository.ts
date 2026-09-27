/**
 * Environments repository contract.
 *
 * UI never calls Supabase directly; it goes through the service layer, which
 * applies domain guards, which then calls one of these adapters.
 */
import type {
  CreateEnvironmentInput,
  CreateEnvironmentVersionInput,
  EnvironmentRecord,
  EnvironmentReferenceRecord,
  EnvironmentSpecRecord,
  EnvironmentVersionRecord,
  LockEnvironmentVersionInput,
  UpdateEnvironmentDraftInput,
  UpdateEnvironmentSpecInput,
  UpdateEnvironmentVersionDraftInput,
} from '../domain/environments';

export interface EnvironmentsRepository {
  listEnvironments(workspaceId: string): Promise<EnvironmentRecord[]>;

  getEnvironment(environmentId: string): Promise<EnvironmentRecord>;

  getVersions(environmentId: string): Promise<EnvironmentVersionRecord[]>;

  getVersion(versionId: string): Promise<EnvironmentVersionRecord>;

  getSpec(versionId: string): Promise<EnvironmentSpecRecord>;

  getReferences(versionId: string): Promise<EnvironmentReferenceRecord[]>;

  /** Adds a reference-metadata row to a draft version. */
  addReference(
    versionId: string,
    input: { storagePath: string; referenceType: EnvironmentReferenceRecord['referenceType']; caption: string },
  ): Promise<EnvironmentReferenceRecord>;

  /** Updates a reference-metadata row (draft versions only). */
  updateReference(
    versionId: string,
    referenceId: string,
    patch: { storagePath?: string; referenceType?: EnvironmentReferenceRecord['referenceType']; caption?: string },
  ): Promise<void>;

  /** Removes a reference-metadata row (draft versions only). */
  removeReference(versionId: string, referenceId: string): Promise<void>;

  createEnvironment(input: CreateEnvironmentInput, createdBy: string): Promise<EnvironmentRecord>;

  /**
   * Creates an environment's first draft version (v1) with its empty
   * Environment Spec. Called immediately after `createEnvironment` so every
   * environment is born with an editable specification record.
   */
  createFirstVersion(
    environmentId: string,
    createdBy: string,
    changeSummary?: string,
  ): Promise<EnvironmentVersionRecord>;

  updateEnvironmentDraft(
    environmentId: string,
    patch: UpdateEnvironmentDraftInput,
  ): Promise<EnvironmentRecord>;

  /** Creates the next draft version (copies the source version's spec). */
  createVersion(
    input: CreateEnvironmentVersionInput,
    createdBy: string,
  ): Promise<EnvironmentVersionRecord>;

  /** Copies reference metadata rows from a source version into a target draft. */
  copyReferences(sourceVersionId: string, targetVersionId: string): Promise<void>;

  /** Locks a draft version and sets it as the environment's active version. */
  lockVersion(input: LockEnvironmentVersionInput): Promise<EnvironmentVersionRecord>;

  /**
   * Updates a draft version's own fields (lock level, change summary). Only
   * valid for drafts — implementations must refuse locked/superseded
   * versions, mirroring the spec guard.
   */
  updateVersionDraft(
    versionId: string,
    patch: UpdateEnvironmentVersionDraftInput,
  ): Promise<EnvironmentVersionRecord>;

  updateSpec(versionId: string, patch: UpdateEnvironmentSpecInput): Promise<EnvironmentSpecRecord>;
}
