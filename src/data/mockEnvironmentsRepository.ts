/**
 * In-memory Environments repository — demo mode.
 *
 * Runs on the development seed data and enforces the same domain rules
 * (locked immutability, sequential versions, spec copying, workspace
 * isolation) so UI behaviour matches the Supabase-backed path.
 */
import {
  LockedEnvironmentVersionError,
  copyEnvironmentSpec,
  nextVersionNumber,
  refuseEnvironmentLocked,
} from '../domain/environments';
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
import { ENVIRONMENTS_SEED } from '../mock/environmentsSeed';
import type { EnvironmentsRepository } from './environmentsRepository';

const now = () => new Date().toISOString();

function notFound(what: string, id: string): never {
  throw new Error(`${what} not found: ${id}`);
}

export class MockEnvironmentsRepository implements EnvironmentsRepository {
  private environments = new Map<string, EnvironmentRecord>();
  private versions = new Map<string, EnvironmentVersionRecord>();
  private specs = new Map<string, EnvironmentSpecRecord>(); // key: versionId
  private references = new Map<string, EnvironmentReferenceRecord[]>(); // key: versionId

  constructor() {
    for (const seed of ENVIRONMENTS_SEED) {
      this.environments.set(seed.environment.id, seed.environment);
      for (const version of seed.versions) {
        this.versions.set(version.id, version);
        this.specs.set(version.id, seed.specs[version.id]);
        this.references.set(version.id, seed.references[version.id] ?? []);
      }
    }
  }

  async listEnvironments(workspaceId: string): Promise<EnvironmentRecord[]> {
    return [...this.environments.values()]
      .filter((e) => e.workspaceId === workspaceId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getEnvironment(environmentId: string): Promise<EnvironmentRecord> {
    const record = this.environments.get(environmentId);
    if (!record) notFound('Environment', environmentId);
    return structuredClone(record);
  }

  async getVersions(environmentId: string): Promise<EnvironmentVersionRecord[]> {
    return [...this.versions.values()]
      .filter((v) => v.environmentId === environmentId)
      .sort((a, b) => a.versionNumber - b.versionNumber)
      .map((v) => structuredClone(v));
  }

  async getVersion(versionId: string): Promise<EnvironmentVersionRecord> {
    const version = this.versions.get(versionId);
    if (!version) notFound('Environment version', versionId);
    return structuredClone(version);
  }

  async getSpec(versionId: string): Promise<EnvironmentSpecRecord> {
    const spec = this.specs.get(versionId);
    if (!spec) notFound('Environment spec', versionId);
    return structuredClone(spec);
  }

  async getReferences(versionId: string): Promise<EnvironmentReferenceRecord[]> {
    return structuredClone(this.references.get(versionId) ?? []);
  }

  /** Adds a reference-metadata row (draft versions only). */
  async addReference(
    versionId: string,
    input: { storagePath: string; referenceType: EnvironmentReferenceRecord['referenceType']; caption: string },
  ): Promise<EnvironmentReferenceRecord> {
    const version = await this.getVersion(versionId);
    if (version.status === 'locked') throw new LockedEnvironmentVersionError(versionId);
    if (version.status !== 'draft') {
      throw new Error(`Only draft versions can modify references (status: ${version.status}).`);
    }
    const stamp = now();
    const row: EnvironmentReferenceRecord = {
      id: crypto.randomUUID(),
      environmentVersionId: versionId,
      storagePath: input.storagePath,
      referenceType: input.referenceType,
      caption: input.caption,
      sortOrder: (this.references.get(versionId) ?? []).length,
      createdAt: stamp,
      updatedAt: stamp,
    };
    this.references.set(versionId, [...(this.references.get(versionId) ?? []), row]);
    return structuredClone(row);
  }

  async updateReference(
    versionId: string,
    referenceId: string,
    patch: { storagePath?: string; referenceType?: EnvironmentReferenceRecord['referenceType']; caption?: string },
  ): Promise<void> {
    const version = await this.getVersion(versionId);
    if (version.status === 'locked') throw new LockedEnvironmentVersionError(versionId);
    const rows = this.references.get(versionId) ?? [];
    this.references.set(
      versionId,
      rows.map((row) => (row.id === referenceId ? { ...row, ...patch, updatedAt: now() } : row)),
    );
  }

  async removeReference(versionId: string, referenceId: string): Promise<void> {
    const version = await this.getVersion(versionId);
    if (version.status === 'locked') throw new LockedEnvironmentVersionError(versionId);
    const rows = this.references.get(versionId) ?? [];
    this.references.set(versionId, rows.filter((row) => row.id !== referenceId));
  }

  async createEnvironment(input: CreateEnvironmentInput, createdBy: string): Promise<EnvironmentRecord> {
    const stamp = now();
    const record: EnvironmentRecord = {
      id: crypto.randomUUID(),
      workspaceId: input.workspaceId,
      name: input.name,
      slug: input.slug ?? input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      status: 'draft',
      activeVersionId: null,
      coverImagePath: null,
      createdBy,
      createdAt: stamp,
      updatedAt: stamp,
    };
    this.environments.set(record.id, record);
    return structuredClone(record);
  }

  /** First draft version (v1) + empty Environment Spec for a new environment. */
  async createFirstVersion(
    environmentId: string,
    createdBy: string,
    changeSummary = 'Initial environment draft',
  ): Promise<EnvironmentVersionRecord> {
    const environment = await this.getEnvironment(environmentId);
    const existing = await this.getVersions(environmentId);
    if (existing.length > 0) {
      throw new Error('createFirstVersion is only valid for environments without versions.');
    }

    const stamp = now();
    const created: EnvironmentVersionRecord = {
      id: crypto.randomUUID(),
      environmentId,
      versionNumber: 1,
      status: 'draft',
      changeSummary,
      coverImagePath: null,
      lockLevel: 'balanced',
      lockedAt: null,
      createdBy,
      createdAt: stamp,
      updatedAt: stamp,
    };
    this.versions.set(created.id, created);

    const stamp2 = now();
    this.specs.set(created.id, {
      id: crypto.randomUUID(),
      environmentVersionId: created.id,
      roomType: '',
      layoutFeel: '',
      heroAngle: '',
      lightingStyle: '',
      furnitureAnchors: {},
      signatureProps: {},
      paletteMaterials: {},
      productZone: null,
      continuityNotes: '',
      lockRules: {},
      createdAt: stamp2,
      updatedAt: stamp2,
    });
    this.references.set(created.id, []);

    // A first draft is the only version, so it is the active one.
    this.environments.set(environmentId, {
      ...environment,
      activeVersionId: created.id,
      updatedAt: now(),
    });
    return structuredClone(created);
  }

  async updateEnvironmentDraft(
    environmentId: string,
    patch: UpdateEnvironmentDraftInput,
  ): Promise<EnvironmentRecord> {
    const environment = await this.getEnvironment(environmentId);
    const next = { ...environment, ...patch, updatedAt: now() };
    this.environments.set(environmentId, next);
    return structuredClone(next);
  }

  async createVersion(
    input: CreateEnvironmentVersionInput,
    createdBy: string,
  ): Promise<EnvironmentVersionRecord> {
    await this.getEnvironment(input.environmentId); // existence check

    const existing = await this.getVersions(input.environmentId);
    if (existing.some((v) => v.status === 'draft')) {
      throw new Error('A draft version already exists for this environment.');
    }
    const source = await this.getVersion(input.sourceVersionId);
    if (source.environmentId !== input.environmentId) {
      throw new Error('Source version belongs to a different environment.');
    }

    const stamp = now();
    const created: EnvironmentVersionRecord = {
      id: crypto.randomUUID(),
      environmentId: input.environmentId,
      versionNumber: nextVersionNumber(existing.map((v) => v.versionNumber)),
      status: 'draft',
      changeSummary: input.changeSummary ?? '',
      coverImagePath: null,
      // The draft inherits the source version's lock level until edited.
      lockLevel: source.lockLevel,
      lockedAt: null,
      createdBy,
      createdAt: stamp,
      updatedAt: stamp,
    };
    this.versions.set(created.id, created);

    const sourceSpec = await this.getSpec(source.id);
    const copied = copyEnvironmentSpec(sourceSpec, created.id);
    const stamp2 = now();
    this.specs.set(created.id, {
      ...copied,
      id: crypto.randomUUID(),
      createdAt: stamp2,
      updatedAt: stamp2,
    });
    this.references.set(created.id, []);

    return structuredClone(created);
  }

  /** Copies reference metadata rows (storage paths etc.) into the target draft. */
  async copyReferences(sourceVersionId: string, targetVersionId: string): Promise<void> {
    const source = this.references.get(sourceVersionId) ?? [];
    const copies = source.map((reference, index) => ({
      ...reference,
      id: crypto.randomUUID(),
      environmentVersionId: targetVersionId,
      sortOrder: index,
      createdAt: now(),
      updatedAt: now(),
    }));
    this.references.set(targetVersionId, copies);
  }

  async lockVersion(input: LockEnvironmentVersionInput): Promise<EnvironmentVersionRecord> {
    const version = await this.getVersion(input.versionId);
    refuseEnvironmentLocked(version); // no-op for drafts; error for locked
    if (version.status !== 'draft') {
      throw new Error(`Only draft versions can be locked (status: ${version.status}).`);
    }

    const locked: EnvironmentVersionRecord = {
      ...version,
      status: 'locked',
      lockedAt: now(),
      updatedAt: now(),
    };
    this.versions.set(version.id, locked);

    // Supersede older locked versions — preserved forever, never deleted.
    for (const [id, v] of this.versions) {
      if (v.environmentId === version.environmentId && v.status === 'locked' && id !== version.id) {
        this.versions.set(id, { ...v, status: 'superseded' });
      }
    }

    const environment = await this.getEnvironment(version.environmentId);
    this.environments.set(environment.id, {
      ...environment,
      activeVersionId: version.id,
      // Locking the first version marks the environment Ready. Archived
      // environments stay archived — soft-archive is never auto-reversed.
      status: environment.status === 'draft' ? 'ready' : environment.status,
      updatedAt: now(),
    });

    return structuredClone(locked);
  }

  /** Draft-only: update a version's own fields (lock level, change summary). */
  async updateVersionDraft(
    versionId: string,
    patch: UpdateEnvironmentVersionDraftInput,
  ): Promise<EnvironmentVersionRecord> {
    const version = await this.getVersion(versionId);
    if (version.status === 'locked') throw new LockedEnvironmentVersionError(versionId);
    if (version.status !== 'draft') {
      throw new Error(`Only draft versions can be updated (status: ${version.status}).`);
    }

    const next: EnvironmentVersionRecord = { ...version, ...patch, updatedAt: now() };
    this.versions.set(versionId, next);
    return structuredClone(next);
  }

  async updateSpec(
    versionId: string,
    patch: UpdateEnvironmentSpecInput,
  ): Promise<EnvironmentSpecRecord> {
    const version = await this.getVersion(versionId);
    if (version.status === 'locked') throw new LockedEnvironmentVersionError(versionId);

    const spec = await this.getSpec(versionId);
    const next: EnvironmentSpecRecord = {
      ...spec,
      ...patch,
      updatedAt: now(),
    };
    this.specs.set(versionId, next);
    return structuredClone(next);
  }
}
