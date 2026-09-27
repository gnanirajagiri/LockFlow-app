/**
 * In-memory Library repository — demo mode.
 *
 * Runs on the development seed data and enforces the same domain rules
 * (locked immutability, safe increments, copy-to-draft, workspace scoping,
 * look-type validation, canonical look items) so UI behaviour matches the
 * Supabase-backed path.
 */
import {
  assertLookAssetType,
  nextVersionNumber,
  refuseAssetLocked,
} from '../domain/library';
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
import {
  LIBRARY_REFERENCES,
  LIBRARY_SEED,
  LIBRARY_TAG_LINKS,
  TAGS,
} from '../mock/librarySeed';
import type { LibraryRepository } from './libraryRepository';

const now = () => new Date().toISOString();

function notFound(what: string, id: string): never {
  throw new Error(`${what} not found: ${id}`);
}

export class MockLibraryRepository implements LibraryRepository {
  private assets = new Map<string, LibraryAssetRecord>();
  private versions = new Map<string, LibraryAssetVersionRecord>();
  private references = new Map<string, LibraryReferenceRecord[]>(); // key: versionId
  private tags = new Map<string, LibraryTagRecord>(TAGS.map((tag) => [tag.id, tag]));
  private tagLinks = new Set<string>(LIBRARY_TAG_LINKS.map((link) => `${link.libraryAssetId}:${link.tagId}`)); // `${assetId}:${tagId}`
  private lookDetails = new Map<string, LookDetailsRecord>(); // key: versionId
  private lookItems = new Map<string, LookAssetItemRecord[]>(); // key: lookDetailsId

  constructor() {
    for (const seed of LIBRARY_SEED) {
      this.assets.set(seed.asset.id, seed.asset);
      for (const version of seed.versions) {
        this.versions.set(version.id, version);
        this.references.set(version.id, LIBRARY_REFERENCES[version.id] ?? []);
      }
      if (seed.look) {
        this.lookDetails.set(seed.look.details.libraryAssetVersionId, seed.look.details);
        this.lookItems.set(seed.look.details.id, seed.look.items);
      }
    }
  }

  private linkKey(assetId: string, tagId: string): string {
    return `${assetId}:${tagId}`;
  }

  async listAssets(workspaceId: string): Promise<LibraryAssetRecord[]> {
    return [...this.assets.values()]
      .filter((asset) => asset.workspaceId === workspaceId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getAsset(assetId: string): Promise<LibraryAssetRecord> {
    const asset = this.assets.get(assetId);
    if (!asset) notFound('Library asset', assetId);
    return structuredClone(asset);
  }

  async createAsset(input: CreateLibraryAssetInput, createdBy: string): Promise<LibraryAssetRecord> {
    const stamp = now();
    const record: LibraryAssetRecord = {
      id: crypto.randomUUID(),
      workspaceId: input.workspaceId,
      name: input.name,
      slug: input.slug ?? input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      assetType: input.assetType,
      status: 'draft',
      activeVersionId: null,
      coverImagePath: null,
      description: input.description ?? null,
      createdBy,
      createdAt: stamp,
      updatedAt: stamp,
    };
    this.assets.set(record.id, record);
    return structuredClone(record);
  }

  async createFirstVersion(
    assetId: string,
    createdBy: string,
    changeSummary = 'Initial asset draft',
  ): Promise<LibraryAssetVersionRecord> {
    const asset = await this.getAsset(assetId);
    const existing = await this.getVersions(assetId);
    if (existing.length > 0) {
      throw new Error('createFirstVersion is only valid for assets without versions.');
    }

    const stamp = now();
    const created: LibraryAssetVersionRecord = {
      id: crypto.randomUUID(),
      libraryAssetId: assetId,
      versionNumber: 1,
      status: 'draft',
      changeSummary,
      coverImagePath: null,
      structuredDetails: {},
      rightsStatus: 'unknown',
      lockedAt: null,
      createdBy,
      createdAt: stamp,
      updatedAt: stamp,
    };
    this.versions.set(created.id, created);
    this.references.set(created.id, []);

    // A first draft is the only version, so it is the active one.
    this.assets.set(assetId, { ...asset, activeVersionId: created.id, updatedAt: now() });
    return structuredClone(created);
  }

  async updateAssetDraft(assetId: string, patch: UpdateLibraryAssetDraftInput): Promise<LibraryAssetRecord> {
    const asset = await this.getAsset(assetId);
    const next = { ...asset, ...patch, updatedAt: now() };
    this.assets.set(assetId, next);
    return structuredClone(next);
  }

  async getVersions(assetId: string): Promise<LibraryAssetVersionRecord[]> {
    return [...this.versions.values()]
      .filter((version) => version.libraryAssetId === assetId)
      .sort((a, b) => a.versionNumber - b.versionNumber)
      .map((version) => structuredClone(version));
  }

  async getVersion(versionId: string): Promise<LibraryAssetVersionRecord> {
    const version = this.versions.get(versionId);
    if (!version) notFound('Library asset version', versionId);
    return structuredClone(version);
  }

  async createVersion(
    input: CreateAssetVersionInput,
    createdBy: string,
  ): Promise<LibraryAssetVersionRecord> {
    await this.getAsset(input.libraryAssetId); // existence check

    const existing = await this.getVersions(input.libraryAssetId);
    if (existing.some((version) => version.status === 'draft')) {
      throw new Error('A draft version already exists for this asset.');
    }
    const source = await this.getVersion(input.sourceVersionId);
    if (source.libraryAssetId !== input.libraryAssetId) {
      throw new Error('Source version belongs to a different asset.');
    }

    const stamp = now();
    const created: LibraryAssetVersionRecord = {
      id: crypto.randomUUID(),
      libraryAssetId: input.libraryAssetId,
      versionNumber: nextVersionNumber(existing.map((version) => version.versionNumber)),
      status: 'draft',
      changeSummary: input.changeSummary ?? '',
      coverImagePath: null,
      // Copy the approved configuration; never mutate the source.
      structuredDetails: structuredClone(source.structuredDetails),
      rightsStatus: source.rightsStatus,
      lockedAt: null,
      createdBy,
      createdAt: stamp,
      updatedAt: stamp,
    };
    this.versions.set(created.id, created);
    this.references.set(created.id, []);

    return structuredClone(created);
  }

  async updateVersionDraft(
    versionId: string,
    patch: UpdateAssetVersionDraftInput,
  ): Promise<LibraryAssetVersionRecord> {
    const version = await this.getVersion(versionId);
    refuseAssetLocked(version);
    if (version.status !== 'draft') {
      throw new Error(`Only draft versions can be updated (status: ${version.status}).`);
    }
    const next = { ...version, ...patch, updatedAt: now() };
    this.versions.set(versionId, next);
    return structuredClone(next);
  }

  async lockVersion(input: LockAssetVersionInput): Promise<LibraryAssetVersionRecord> {
    const version = await this.getVersion(input.versionId);
    refuseAssetLocked(version);
    if (version.status !== 'draft') {
      throw new Error(`Only draft versions can be locked (status: ${version.status}).`);
    }

    const locked: LibraryAssetVersionRecord = {
      ...version,
      status: 'locked',
      lockedAt: now(),
      updatedAt: now(),
    };
    this.versions.set(version.id, locked);

    // Supersede older locked versions — preserved forever.
    for (const [id, other] of this.versions) {
      if (
        other.libraryAssetId === version.libraryAssetId &&
        other.status === 'locked' &&
        id !== version.id
      ) {
        this.versions.set(id, { ...other, status: 'superseded' });
      }
    }

    const asset = await this.getAsset(version.libraryAssetId);
    this.assets.set(asset.id, {
      ...asset,
      activeVersionId: version.id,
      status: asset.status === 'draft' ? 'ready' : asset.status,
      updatedAt: now(),
    });

    return structuredClone(locked);
  }

  async getReferences(versionId: string): Promise<LibraryReferenceRecord[]> {
    return structuredClone(this.references.get(versionId) ?? []);
  }

  async addReference(
    versionId: string,
    input: { storagePath: string; referenceType: LibraryReferenceRecord['referenceType']; caption: string },
  ): Promise<LibraryReferenceRecord> {
    const version = await this.getVersion(versionId);
    refuseAssetLocked(version);
    if (version.status !== 'draft') {
      throw new Error(`Only draft versions can modify references (status: ${version.status}).`);
    }
    const stamp = now();
    const row: LibraryReferenceRecord = {
      id: crypto.randomUUID(),
      libraryAssetVersionId: versionId,
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
    patch: { storagePath?: string; referenceType?: LibraryReferenceRecord['referenceType']; caption?: string },
  ): Promise<void> {
    const version = await this.getVersion(versionId);
    refuseAssetLocked(version);
    const rows = this.references.get(versionId) ?? [];
    this.references.set(
      versionId,
      rows.map((row) => (row.id === referenceId ? { ...row, ...patch, updatedAt: now() } : row)),
    );
  }

  async removeReference(versionId: string, referenceId: string): Promise<void> {
    const version = await this.getVersion(versionId);
    refuseAssetLocked(version);
    const rows = this.references.get(versionId) ?? [];
    this.references.set(versionId, rows.filter((row) => row.id !== referenceId));
  }

  /** Copies reference metadata rows into the target draft. */
  async copyReferences(sourceVersionId: string, targetVersionId: string): Promise<void> {
    const source = this.references.get(sourceVersionId) ?? [];
    const copies = source.map((reference, index) => ({
      ...reference,
      id: crypto.randomUUID(),
      libraryAssetVersionId: targetVersionId,
      sortOrder: index,
      createdAt: now(),
      updatedAt: now(),
    }));
    this.references.set(targetVersionId, copies);
  }

  async getTagsForAsset(assetId: string): Promise<LibraryTagRecord[]> {
    const tagIds = new Set(
      [...this.tagLinks]
        .filter((key) => key.startsWith(`${assetId}:`))
        .map((key) => key.split(':')[1]),
    );
    return [...this.tags.values()].filter((tag) => tagIds.has(tag.id));
  }

  async addTagToAsset(
    input: AddAssetTagInput & { normalizedName?: string },
    workspaceId: string,
  ): Promise<LibraryTagRecord> {
    const asset = await this.getAsset(input.libraryAssetId);
    const normalized = input.normalizedName ?? input.name.toLowerCase().replace(/\s+/g, '-');

    // Get-or-create within the asset's workspace vocabulary.
    const existing = [...this.tags.values()].find(
      (tag) => tag.workspaceId === asset.workspaceId && tag.normalizedName === normalized,
    );
    const tag = existing ?? {
      id: crypto.randomUUID(),
      workspaceId: asset.workspaceId,
      name: input.name,
      normalizedName: normalized,
      createdAt: now(),
    };
    if (!existing) this.tags.set(tag.id, tag);
    this.tagLinks.add(this.linkKey(asset.id, tag.id));
    void workspaceId; // workspace is derived from the asset (consistency)
    return structuredClone(tag);
  }

  async removeTagFromAsset(assetId: string, tagId: string): Promise<void> {
    this.tagLinks.delete(this.linkKey(assetId, tagId));
  }

  async getLookDetails(versionId: string): Promise<LookDetailsRecord | null> {
    const details = this.lookDetails.get(versionId);
    return details ? structuredClone(details) : null;
  }

  async updateLookDetails(versionId: string, patch: { presentationNotes?: string }): Promise<LookDetailsRecord> {
    const version = await this.getVersion(versionId);
    refuseAssetLocked(version);
    const existing = this.lookDetails.get(versionId);
    if (!existing) notFound('Look details', versionId);
    const next = { ...existing, ...patch, updatedAt: now() };
    this.lookDetails.set(versionId, next);
    return structuredClone(next);
  }

  async ensureLookDetails(versionId: string, modelId: string, presentationNotes = ''): Promise<LookDetailsRecord> {
    const existing = this.lookDetails.get(versionId);
    if (existing) return structuredClone(existing);

    const version = await this.getVersion(versionId);
    refuseAssetLocked(version);
    const asset = await this.getAsset(version.libraryAssetId);
    assertLookAssetType(asset); // rule: look_details only on look-type assets

    const stamp = now();
    const created: LookDetailsRecord = {
      id: crypto.randomUUID(),
      libraryAssetVersionId: versionId,
      modelId,
      presentationNotes,
      createdAt: stamp,
      updatedAt: stamp,
    };
    this.lookDetails.set(versionId, created);
    this.lookItems.set(created.id, []);
    return structuredClone(created);
  }

  async getLookItems(lookDetailsId: string): Promise<LookAssetItemRecord[]> {
    return structuredClone(this.lookItems.get(lookDetailsId) ?? []);
  }

  async setLookItems(input: SetLookItemsInput): Promise<LookAssetItemRecord[]> {
    const detailsRecord = [...this.lookDetails.values()].find(
      (value) => value.id === input.lookDetailsId,
    );
    if (!detailsRecord) notFound('Look details', input.lookDetailsId);

    const version = await this.getVersion(detailsRecord.libraryAssetVersionId);
    refuseAssetLocked(version); // a locked look version cannot be restyled

    const stamp = now();
    const items: LookAssetItemRecord[] = [];
    for (const entry of input.items) {
      const asset = await this.getAsset(entry.libraryAssetId); // canonical record must exist
      if (entry.libraryAssetVersionId) {
        const pinned = await this.getVersion(entry.libraryAssetVersionId);
        if (pinned.libraryAssetId !== asset.id) {
          throw new Error('Pinned version belongs to a different asset.');
        }
      }
      items.push({
        id: crypto.randomUUID(),
        lookDetailsId: input.lookDetailsId,
        libraryAssetId: asset.id,
        libraryAssetVersionId: entry.libraryAssetVersionId ?? null,
        role: entry.role,
        sortOrder: entry.sortOrder,
        createdAt: stamp,
        updatedAt: stamp,
      });
    }
    this.lookItems.set(input.lookDetailsId, items);
    return structuredClone(items);
  }
}
