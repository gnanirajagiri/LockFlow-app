/**
 * In-memory Models repository — demo mode.
 *
 * Runs on the development seed data and enforces the same domain rules
 * (locked immutability, sequential versions, sheet copying, workspace
 * isolation) so UI behaviour matches the Supabase-backed path.
 */
import {
  LockedVersionError,
  copyCharacterSheet,
  nextVersionNumber,
  refuseIfLocked,
} from '../domain/models';
import type {
  CharacterSheetAuditEvent,
  CharacterSheetAuditRow,
  CharacterSheetRecord,
  CreateModelInput,
  CreateVersionInput,
  LockVersionInput,
  ModelAssetShortcutRecord,
  ModelRecord,
  ModelReferenceRecord,
  ModelVersionRecord,
  UpdateCharacterSheetInput,
  UpdateModelDraftInput,
} from '../domain/models';
import { MODELS_SEED } from '../mock/modelsSeed';
import type { ModelsRepository } from './modelsRepository';

const now = () => new Date().toISOString();

function notFound(what: string, id: string): never {
  throw new Error(`${what} not found: ${id}`);
}

export class MockModelsRepository implements ModelsRepository {
  private models = new Map<string, ModelRecord>();
  private versions = new Map<string, ModelVersionRecord>();
  private sheets = new Map<string, CharacterSheetRecord>(); // key: versionId
  private references = new Map<string, ModelReferenceRecord[]>(); // key: versionId
  private sheetAudit: CharacterSheetAuditRow[] = [];
  private shortcuts: ModelAssetShortcutRecord[] = MODELS_SEED.flatMap((seed) => seed.shortcuts ?? []);

  /** Resolves a version's sheet id + workspace id for audit attribution. */
  private sheetContextForVersion(versionId: string): { sheetId: string; workspaceId: string } | null {
    const sheet = this.sheets.get(versionId);
    if (!sheet) return null;
    const version = this.versions.get(versionId);
    const model = version ? this.models.get(version.modelId) : undefined;
    return { sheetId: sheet.id, workspaceId: model?.workspaceId ?? '' };
  }

  /** Appends one Character Sheet audit row (append-only, like the DB table). */
  private appendSheetAudit(versionId: string, event: CharacterSheetAuditEvent, detail: string | null): void {
    const context = this.sheetContextForVersion(versionId);
    if (!context) return; // sheet already gone — nothing to attribute
    this.sheetAudit.push({
      id: `audit_${crypto.randomUUID()}`,
      workspaceId: context.workspaceId,
      characterSheetId: context.sheetId,
      event,
      actorId: null, // repo layer has no actor; Supabase triggers record auth.uid()
      detail,
      createdAt: now(),
    });
  }

  constructor() {
    for (const seed of MODELS_SEED) {
      this.models.set(seed.model.id, seed.model);
      for (const version of seed.versions) {
        this.versions.set(version.id, version);
        this.sheets.set(version.id, seed.sheets[version.id]);
        this.references.set(version.id, seed.references[version.id] ?? []);
      }
    }
  }

  async listModels(workspaceId: string): Promise<ModelRecord[]> {
    return [...this.models.values()]
      .filter((m) => m.workspaceId === workspaceId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getModel(modelId: string): Promise<ModelRecord> {
    const model = this.models.get(modelId);
    if (!model) notFound('Model', modelId);
    return structuredClone(model);
  }

  async getVersions(modelId: string): Promise<ModelVersionRecord[]> {
    return [...this.versions.values()]
      .filter((v) => v.modelId === modelId)
      .sort((a, b) => a.versionNumber - b.versionNumber)
      .map((v) => structuredClone(v));
  }

  async getVersion(versionId: string): Promise<ModelVersionRecord> {
    const version = this.versions.get(versionId);
    if (!version) notFound('Version', versionId);
    return structuredClone(version);
  }

  async getCharacterSheet(versionId: string): Promise<CharacterSheetRecord> {
    const sheet = this.sheets.get(versionId);
    if (!sheet) notFound('Character sheet', versionId);
    return structuredClone(sheet);
  }

  async getReferences(versionId: string): Promise<ModelReferenceRecord[]> {
    return structuredClone(this.references.get(versionId) ?? []);
  }

  /** Adds reference metadata to a draft version (guard-checked upstream). */
  async addReference(
    versionId: string,
    input: { storagePath: string; referenceType: ModelReferenceRecord['referenceType']; caption: string },
  ): Promise<ModelReferenceRecord> {
    const version = await this.getVersion(versionId);
    refuseIfLocked(version);
    if (version.status !== 'draft') {
      throw new Error(`Only draft versions can modify references (status: ${version.status}).`);
    }
    const stamp = now();
    const row: ModelReferenceRecord = {
      id: crypto.randomUUID(),
      modelVersionId: versionId,
      storagePath: input.storagePath,
      referenceType: input.referenceType,
      caption: input.caption,
      sortOrder: (this.references.get(versionId) ?? []).length,
      createdAt: stamp,
      updatedAt: stamp,
    };
    this.references.set(versionId, [...(this.references.get(versionId) ?? []), row]);
    this.appendSheetAudit(versionId, 'character_sheet_reference_added', `Reference added: ${input.caption || input.referenceType}`);
    return structuredClone(row);
  }

  /** Updates reference metadata on a draft version (guard-checked upstream). */
  async updateReference(
    versionId: string,
    referenceId: string,
    patch: { storagePath?: string; referenceType?: ModelReferenceRecord['referenceType']; caption?: string },
  ): Promise<void> {
    const version = await this.getVersion(versionId);
    refuseIfLocked(version);
    const rows = this.references.get(versionId) ?? [];
    this.references.set(
      versionId,
      rows.map((row) => (row.id === referenceId ? { ...row, ...patch, updatedAt: now() } : row)),
    );
  }

  /** Removes a draft version's reference metadata row (guard-checked upstream). */
  async removeReference(versionId: string, referenceId: string): Promise<void> {
    const version = await this.getVersion(versionId);
    refuseIfLocked(version);
    const rows = this.references.get(versionId) ?? [];
    const removed = rows.find((row) => row.id === referenceId);
    this.references.set(versionId, rows.filter((row) => row.id !== referenceId));
    if (removed) {
      this.appendSheetAudit(versionId, 'character_sheet_reference_removed', `Reference removed: ${removed.caption || removed.referenceType}`);
    }
  }

  /** Library shortcut pointers for this model (pointers only — canonical records live in the Library). */
  async listAssetShortcuts(modelId: string): Promise<ModelAssetShortcutRecord[]> {
    return structuredClone(this.shortcuts.filter((shortcut) => shortcut.modelId === modelId));
  }

  async createModel(input: CreateModelInput, createdBy: string): Promise<ModelRecord> {
    const stamp = now();
    const record: ModelRecord = {
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
    this.models.set(record.id, record);
    return structuredClone(record);
  }

  /** First draft version (v1) + empty Character Sheet for a new model. */
  async createFirstVersion(
    modelId: string,
    createdBy: string,
    changeSummary = 'Initial identity draft',
  ): Promise<ModelVersionRecord> {
    const model = await this.getModel(modelId);
    const existing = await this.getVersions(modelId);
    if (existing.length > 0) {
      throw new Error('createFirstVersion is only valid for models without versions.');
    }

    const stamp = now();
    const created: ModelVersionRecord = {
      id: crypto.randomUUID(),
      modelId,
      versionNumber: 1,
      status: 'draft',
      changeSummary,
      coverImagePath: null,
      lockedAt: null,
      createdBy,
      createdAt: stamp,
      updatedAt: stamp,
    };
    this.versions.set(created.id, created);

    const stamp2 = now();
    this.sheets.set(created.id, {
      id: crypto.randomUUID(),
      modelVersionId: created.id,
      identitySummary: '',
      faceFeatures: {},
      hairIdentity: {},
      complexion: {},
      bodyProportions: {},
      distinctiveDetails: {},
      lockRules: {},
      referenceNotes: '',
      createdAt: stamp2,
      updatedAt: stamp2,
    });
    this.references.set(created.id, []);
    this.appendSheetAudit(created.id, 'character_sheet_created', `Character Sheet created for v${created.versionNumber} (first draft).`);

    // A first draft is the only version, so it is the active one.
    this.models.set(modelId, { ...model, activeVersionId: created.id, updatedAt: now() });
    return structuredClone(created);
  }

  async updateModelDraft(modelId: string, patch: UpdateModelDraftInput): Promise<ModelRecord> {
    const model = await this.getModel(modelId);
    const next = { ...model, ...patch, updatedAt: now() };
    this.models.set(modelId, next);
    return structuredClone(next);
  }

  async createVersion(input: CreateVersionInput, createdBy: string): Promise<ModelVersionRecord> {
    await this.getModel(input.modelId); // existence check

    const existing = await this.getVersions(input.modelId);
    if (existing.some((v) => v.status === 'draft')) {
      throw new Error('A draft version already exists for this model.');
    }
    const source = await this.getVersion(input.sourceVersionId);
    if (source.modelId !== input.modelId) {
      throw new Error('Source version belongs to a different model.');
    }

    const stamp = now();
    const created: ModelVersionRecord = {
      id: crypto.randomUUID(),
      modelId: input.modelId,
      versionNumber: nextVersionNumber(existing.map((v) => v.versionNumber)),
      status: 'draft',
      changeSummary: input.changeSummary ?? '',
      coverImagePath: null,
      lockedAt: null,
      createdBy,
      createdAt: stamp,
      updatedAt: stamp,
    };
    this.versions.set(created.id, created);

    const sourceSheet = await this.getCharacterSheet(source.id);
    const copied = copyCharacterSheet(sourceSheet, created.id);
    const stamp2 = now();
    this.sheets.set(created.id, {
      ...copied,
      id: crypto.randomUUID(),
      createdAt: stamp2,
      updatedAt: stamp2,
    });
    this.references.set(created.id, []);
    this.appendSheetAudit(created.id, 'character_sheet_draft_created', `Draft v${created.versionNumber} created from source version ${source.id}.`);

    return structuredClone(created);
  }

  /** Copies reference metadata rows (storage paths etc.) into the target draft. */
  async copyReferences(sourceVersionId: string, targetVersionId: string): Promise<void> {
    const source = this.references.get(sourceVersionId) ?? [];
    const copies = source.map((reference, index) => ({
      ...reference,
      id: crypto.randomUUID(),
      modelVersionId: targetVersionId,
      sortOrder: index,
      createdAt: now(),
      updatedAt: now(),
    }));
    this.references.set(targetVersionId, copies);
  }

  async lockVersion(input: LockVersionInput): Promise<ModelVersionRecord> {
    const version = await this.getVersion(input.versionId);
    refuseIfLocked(version); // no-op for drafts; LockedVersionError for locked
    if (version.status !== 'draft') {
      throw new Error(`Only draft versions can be locked (status: ${version.status}).`);
    }

    const locked: ModelVersionRecord = {
      ...version,
      status: 'locked',
      lockedAt: now(),
      updatedAt: now(),
    };
    this.versions.set(version.id, locked);

    // Supersede older locked versions.
    for (const [id, v] of this.versions) {
      if (v.modelId === version.modelId && v.status === 'locked' && id !== version.id) {
        this.versions.set(id, { ...v, status: 'superseded' });
      }
    }

    const model = await this.getModel(version.modelId);
    this.models.set(model.id, {
      ...model,
      activeVersionId: version.id,
      // Locking the first version marks the model Ready. Archived models stay
      // archived — soft-archive is never auto-reversed.
      status: model.status === 'draft' ? 'ready' : model.status,
      updatedAt: now(),
    });

    this.appendSheetAudit(version.id, 'character_sheet_locked', `Version v${version.versionNumber} locked — protected identity is now immutable.`);
    this.appendSheetAudit(version.id, 'character_sheet_activated', `Version v${version.versionNumber} set as the model's active identity.`);

    return structuredClone(locked);
  }

  async updateCharacterSheet(
    versionId: string,
    patch: UpdateCharacterSheetInput,
  ): Promise<CharacterSheetRecord> {
    const version = await this.getVersion(versionId);
    if (version.status === 'locked') {
      this.appendSheetAudit(versionId, 'protected_trait_edit_blocked', `Refused Character Sheet edit on locked version ${versionId}.`);
      throw new LockedVersionError(versionId);
    }

    const sheet = await this.getCharacterSheet(versionId);
    const next: CharacterSheetRecord = {
      ...sheet,
      ...patch,
      updatedAt: now(),
    };
    this.sheets.set(versionId, next);

    const touchedGroups = (
      ['faceFeatures', 'hairIdentity', 'complexion', 'bodyProportions', 'distinctiveDetails'] as const
    ).filter((group) => patch[group] !== undefined);
    if (touchedGroups.length > 0) {
      this.appendSheetAudit(
        versionId,
        'protected_trait_updated_in_draft',
        `Draft edit touched protected trait groups: ${touchedGroups.join(', ')}.`,
      );
    }
    this.appendSheetAudit(versionId, 'character_sheet_updated', `Draft v${version.versionNumber} Character Sheet updated.`);
    return structuredClone(next);
  }

  /** Audit trail for a version's Character Sheet, oldest first. */
  async listCharacterSheetAudit(versionId: string): Promise<CharacterSheetAuditRow[]> {
    const context = this.sheetContextForVersion(versionId);
    if (!context) notFound('Character sheet', versionId);
    return structuredClone(
      this.sheetAudit
        .filter((row) => row.characterSheetId === context.sheetId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    );
  }

  /** Appends one audit event to a version's Character Sheet trail. */
  async appendCharacterSheetAudit(
    versionId: string,
    event: CharacterSheetAuditEvent,
    detail: string | null,
    actorId: string | null = null,
  ): Promise<void> {
    const context = this.sheetContextForVersion(versionId);
    if (!context) notFound('Character sheet', versionId);
    this.sheetAudit.push({
      id: `audit_${crypto.randomUUID()}`,
      workspaceId: context.workspaceId,
      characterSheetId: context.sheetId,
      event,
      actorId,
      detail,
      createdAt: now(),
    });
  }
}
