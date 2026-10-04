/**
 * Prompt 32 — ModelBuilderService: the complete Model Builder workflow over
 * the EXISTING models repository (prompts 5/24/26). Adds reference roles,
 * coverage evaluation, readiness validation, immutable lock-and-save with a
 * safe snapshot, and draft-from-locked version paths. Nothing here replaces
 * the Character Sheet, Library or Gallery schemas; models stay independent
 * of environments, props and campaigns by construction.
 *
 * Security: every method re-resolves the version → model → workspace chain
 * through the existing ModelsService guards, so cross-workspace references,
 * links and reads fail loudly. Private storage paths never appear in audit
 * details or returned views (ids and labels only).
 */
import type { ModelsRepository } from '../data/modelsRepository';
import type {
  CharacterSheetRecord,
  ModelRecord,
  ModelReferenceRecord,
  ModelVersionRecord,
} from '../domain/models/types';
import type { CharacterSheetAuditRow } from '../domain/models/characterSheet';
import { LockedVersionError } from '../domain/models/guards';
import { ModelsService } from '../services/modelsService';
import {
  REFERENCE_ROLE_LABELS,
  classifyCharacterSheetPatch,
  evaluateReferenceCoverage,
  isIdentityRole,
  roleForReference,
  validateModelReadinessForLock,
} from './modelBuilderWorkflow';
import type {
  CoverageReport,
  ModelBuilderReferenceRole,
  ModelReadinessState,
  ReadinessCheck,
} from './modelBuilderWorkflow';

/** Re-exported so the UI imports one module. */
export { REFERENCE_ROLE_LABELS };
export type { ModelBuilderReferenceRole, ModelReadinessState, CoverageReport, ReadinessCheck };

// ── Audit (dedicated vocabulary — the Character Sheet audit stays untouched) ─

export type ModelBuilderAuditEvent =
  | 'model_draft_created'
  | 'model_reference_added'
  | 'model_reference_removed'
  | 'model_readiness_checked'
  | 'model_lock_blocked'
  | 'model_version_locked'
  | 'model_draft_created_from_locked_version'
  | 'model_character_sheet_linked';

export interface ModelBuilderAuditRow {
  id: string;
  workspaceId: string;
  modelVersionId: string;
  event: ModelBuilderAuditEvent;
  detail: string | null;
  createdAt: string;
}

export interface ModelBuilderAuditStore {
  append(row: Omit<ModelBuilderAuditRow, 'id' | 'createdAt'>): Promise<void>;
  list(workspaceId: string, filter?: { modelVersionId?: string; event?: ModelBuilderAuditEvent }): Promise<ModelBuilderAuditRow[]>;
}

/** In-memory audit store mirroring the SQL shape (demo mode + tests). */
export class InMemoryModelBuilderAuditStore implements ModelBuilderAuditStore {
  readonly rows: ModelBuilderAuditRow[] = [];

  async append(row: Omit<ModelBuilderAuditRow, 'id' | 'createdAt'>): Promise<void> {
    this.rows.push({ ...row, id: `mbaudit_${crypto.randomUUID()}`, createdAt: new Date().toISOString() });
  }

  async list(workspaceId: string, filter?: { modelVersionId?: string; event?: ModelBuilderAuditEvent }): Promise<ModelBuilderAuditRow[]> {
    return this.rows
      .filter((row) => row.workspaceId === workspaceId)
      .filter((row) => !filter?.modelVersionId || row.modelVersionId === filter.modelVersionId)
      .filter((row) => !filter?.event || row.event === filter.event)
      .map((row) => ({ ...row }));
  }
}

// ── Views ────────────────────────────────────────────────────────────────────

/** One labeled reference in the builder view. */
export interface BuilderReferenceView {
  reference: ModelReferenceRecord;
  role: ModelBuilderReferenceRole;
  roleLabel: string;
  /** Identity-governed references are the Character Sheet's evidence. */
  identityGoverned: boolean;
}

/** The Model Builder workspace view for one version. */
export interface ModelBuilderView {
  model: ModelRecord;
  version: ModelVersionRecord;
  sheet: CharacterSheetRecord | null;
  references: BuilderReferenceView[];
  coverage: CoverageReport;
  readiness: ReadinessCheck;
}

/** Safe immutable snapshot of a version at lock time. */
export interface ModelVersionSnapshot {
  versionId: string;
  modelId: string;
  versionNumber: number;
  capturedAt: string;
  sheet: CharacterSheetRecord | null;
  references: Array<{
    id: string;
    role: ModelBuilderReferenceRole;
    roleLabel: string;
    referenceType: string;
    caption: string;
  }>;
  coverageSummary: {
    referenceCompleteness: CoverageReport['referenceCompleteness'];
    filledCount: number;
    requiredFilled: number;
    requiredTotal: number;
  };
}

/** Library-backed reference import (ownership validated server-side). */
export interface ModelBuilderDependencies {
  /** Resolves a Library asset the user is importing as a reference. */
  getLibraryAsset(assetId: string, workspaceId: string): Promise<{
    id: string;
    workspaceId: string;
    name: string;
    storagePath: string | null;
  }>;
}

function roleToReferenceType(role: ModelBuilderReferenceRole): ModelReferenceRecord['referenceType'] {
  switch (role) {
    case 'primary_identity':
    case 'supporting_face':
      return 'portrait';
    case 'full_body_posture':
      return 'full_body';
    case 'angle_left':
    case 'angle_right':
    case 'angle_three_quarter':
      return 'profile';
    case 'back_360':
    case 'style_look':
    case 'non_identity_supporting':
      return 'other';
  }
}

// ── Service ──────────────────────────────────────────────────────────────────

export class ModelBuilderService {
  constructor(
    private readonly models: ModelsService,
    private readonly repo: ModelsRepository,
    private readonly deps: ModelBuilderDependencies,
    private readonly audit: ModelBuilderAuditStore,
  ) {}

  /** Creates a model with its first draft version (existing seam). */
  async createModelDraft(
    workspaceId: string,
    input: { name: string; slug?: string },
    actorId: string,
  ): Promise<{ model: ModelRecord; version: ModelVersionRecord }> {
    const model = await this.models.createModel(
      { workspaceId, name: input.name, ...(input.slug ? { slug: input.slug } : {}) },
      actorId,
    );
    const versions = await this.models.getVersions(model.id, workspaceId);
    const version = versions[versions.length - 1];
    if (!version) throw new Error('Model was created but no draft version is available.');
    await this.appendAudit(workspaceId, version.id, 'model_draft_created', `Draft v${version.versionNumber} created for "${model.name}".`);
    return { model, version };
  }

  /** Edits a draft model's metadata (name/cover only — never identity). */
  async updateModelDraft(
    workspaceId: string,
    modelId: string,
    input: { name?: string; coverImagePath?: string | null },
  ): Promise<ModelRecord> {
    const model = await this.models.getModel(modelId, workspaceId);
    if (model.status === 'archived') {
      throw new Error('Archived models cannot be edited.');
    }
    return this.models.updateModelDraft(modelId, input, workspaceId);
  }

  /**
   * Attaches a labeled reference to a DRAFT version. Two import paths:
   * a Library asset (ownership checked through the LibraryService seam) or
   * an existing secured upload path. The role is stored as a caption tag so
   * the existing repository needs no schema change.
   */
  async attachModelReference(
    workspaceId: string,
    modelVersionId: string,
    input: {
      role: ModelBuilderReferenceRole;
      source: { kind: 'library_asset'; libraryAssetId: string } | { kind: 'upload'; storagePath: string };
      caption?: string;
    },
    actorId: string,
  ): Promise<BuilderReferenceView> {
    const version = await this.models.getVersion(modelVersionId, workspaceId);
    if (version.status !== 'draft') {
      throw new Error('References can only change on a draft version — create a draft from the locked version first.');
    }

    let storagePath: string;
    let captionBase: string;
    if (input.source.kind === 'library_asset') {
      const asset = await this.deps.getLibraryAsset(input.source.libraryAssetId, workspaceId);
      if (asset.workspaceId !== workspaceId) {
        throw new Error('You do not have access to this workspace.');
      }
      if (!asset.storagePath) {
        throw new Error('That Library asset has no stored media to reference.');
      }
      storagePath = asset.storagePath;
      captionBase = asset.name;
    } else {
      if (!input.source.storagePath || input.source.storagePath.includes('..')) {
        throw new Error('A valid secured upload path is required.');
      }
      storagePath = input.source.storagePath;
      captionBase = input.caption ?? 'Uploaded reference';
    }

    // Role tag prefix keeps the labeled role durable without schema changes.
    const caption = `[builder:${input.role}] ${captionBase}`.slice(0, 400);
    const reference = await this.repo.addReference(modelVersionId, {
      storagePath,
      referenceType: roleToReferenceType(input.role),
      caption,
    });
    await this.appendAudit(workspaceId, modelVersionId, 'model_reference_added', `${REFERENCE_ROLE_LABELS[input.role]} reference added.`);
    void actorId;
    return {
      reference,
      role: input.role,
      roleLabel: REFERENCE_ROLE_LABELS[input.role],
      identityGoverned: isIdentityRole(input.role),
    };
  }

  /** Removes a labeled reference from a draft version. */
  async removeModelReference(
    workspaceId: string,
    modelVersionId: string,
    referenceId: string,
  ): Promise<void> {
    const version = await this.models.getVersion(modelVersionId, workspaceId);
    if (version.status !== 'draft') {
      throw new Error('References can only change on a draft version — create a draft from the locked version first.');
    }
    const references = await this.repo.getReferences(modelVersionId);
    const reference = references.find((row) => row.id === referenceId);
    if (!reference) throw new Error(`Reference not found: ${referenceId}`);
    await this.repo.removeReference(modelVersionId, referenceId);
    await this.appendAudit(workspaceId, modelVersionId, 'model_reference_removed', `${REFERENCE_ROLE_LABELS[roleForReference(reference)]} reference removed.`);
  }

  /** The coordinated builder view: labeled references + coverage + readiness. */
  async getModelBuilderView(workspaceId: string, modelVersionId: string): Promise<ModelBuilderView> {
    const version = await this.models.getVersion(modelVersionId, workspaceId);
    const [sheet, references] = await Promise.all([
      this.repo.getCharacterSheet(modelVersionId).catch(() => null),
      this.repo.getReferences(modelVersionId),
    ]);
    const views: BuilderReferenceView[] = references.map((reference) => {
      const role = roleForReference(reference);
      return {
        reference,
        role,
        roleLabel: REFERENCE_ROLE_LABELS[role],
        identityGoverned: isIdentityRole(role),
      };
    });
    const coverage = evaluateReferenceCoverage(references);
    const readiness = validateModelReadinessForLock({ version, sheet, references });
    const model = await this.models.getModel(version.modelId, workspaceId);
    return { model, version, sheet, references: views, coverage, readiness };
  }

  /** Reference coverage status (honest about missing views). */
  async validateModelReferenceCoverage(
    workspaceId: string,
    modelVersionId: string,
  ): Promise<CoverageReport> {
    await this.models.getVersion(modelVersionId, workspaceId);
    return evaluateReferenceCoverage(await this.repo.getReferences(modelVersionId));
  }

  /** Lock readiness: draft + identity + coverage (blockers are safe strings). */
  async validateModelReadinessForLock(
    workspaceId: string,
    modelVersionId: string,
  ): Promise<ReadinessCheck> {
    const version = await this.models.getVersion(modelVersionId, workspaceId);
    const [sheet, references] = await Promise.all([
      this.repo.getCharacterSheet(modelVersionId).catch(() => null),
      this.repo.getReferences(modelVersionId),
    ]);
    const check = validateModelReadinessForLock({ version, sheet, references });
    await this.appendAudit(
      workspaceId,
      modelVersionId,
      'model_readiness_checked',
      check.ok ? 'Ready to lock.' : `Blocked: ${check.blockers.length} issue(s).`,
    );
    return check;
  }

  /**
   * Character Sheet edit gate: protected identity only changes on drafts.
   * The service records `model_character_sheet_linked` when a draft's sheet
   * is first populated (identity governance linkage), and refuses locked
   * versions through the existing guard (audited as model_lock_blocked).
   */
  async updateCharacterSheet(
    workspaceId: string,
    modelVersionId: string,
    patch: Record<string, unknown>,
    actorId: string,
  ): Promise<CharacterSheetRecord> {
    await this.models.getVersion(modelVersionId, workspaceId);
    const classification = classifyCharacterSheetPatch(patch);
    try {
      const updated = await this.models.updateCharacterSheet(modelVersionId, patch, workspaceId);
      if (classification.touchesProtectedIdentity) {
        await this.appendAudit(workspaceId, modelVersionId, 'model_character_sheet_linked', `Protected trait group(s) updated in draft: ${classification.touchedGroups.join(', ')}.`);
      }
      void actorId;
      return updated;
    } catch (err) {
      if (err instanceof LockedVersionError) {
        await this.appendAudit(workspaceId, modelVersionId, 'model_lock_blocked', 'Protected identity edit refused on a locked version.');
      }
      throw err;
    }
  }

  /**
   * Creates a NEW draft version from a locked (or any) version through the
   * existing createVersion path — the locked source never mutates.
   */
  async createModelDraftFromLockedVersion(
    workspaceId: string,
    modelVersionId: string,
    actorId: string,
    changeSummary?: string,
  ): Promise<ModelVersionRecord> {
    const source = await this.models.getVersion(modelVersionId, workspaceId);
    const model = await this.models.getModel(source.modelId, workspaceId);
    const version = await this.models.createVersion(
      { modelId: model.id, sourceVersionId: source.id, changeSummary: changeSummary ?? `Draft from locked v${source.versionNumber}` },
      actorId,
      workspaceId,
    );
    await this.appendAudit(workspaceId, modelVersionId, 'model_draft_created_from_locked_version', `New draft v${version.versionNumber} created from v${source.versionNumber} (${source.status}).`);
    return version;
  }

  /**
   * Lock-and-save: validates readiness, refuses anything incomplete, then
   * captures the immutable snapshot BEFORE locking and locks through the
   * existing guard path. The locked version cannot be destructively edited
   * afterwards (repository + service guards both refuse).
   */
  async lockAndSaveModelVersion(
    workspaceId: string,
    modelVersionId: string,
    actorId: string,
  ): Promise<{ version: ModelVersionRecord; snapshot: ModelVersionSnapshot }> {
    const check = await this.validateModelReadinessForLock(workspaceId, modelVersionId);
    if (!check.ok) {
      await this.appendAudit(workspaceId, modelVersionId, 'model_lock_blocked', check.blockers.join(' '));
      throw new Error(`Cannot lock yet: ${check.blockers[0]}`);
    }

    // Capture the safe snapshot first (pre-lock state, immutable by contract).
    const snapshot = await this.getModelVersionSnapshot(workspaceId, modelVersionId);

    // Lock through the existing service (refuseIfLocked + repository guard).
    const version = await this.models.lockVersion(modelVersionId, workspaceId);

    await this.appendAudit(workspaceId, modelVersionId, 'model_version_locked', `v${version.versionNumber} locked; identity snapshot captured.`);
    void actorId;
    return { version, snapshot };
  }

  /** The safe immutable snapshot (ids/labels only — no storage paths). */
  async getModelVersionSnapshot(workspaceId: string, modelVersionId: string): Promise<ModelVersionSnapshot> {
    const version = await this.models.getVersion(modelVersionId, workspaceId);
    const [sheet, references] = await Promise.all([
      this.repo.getCharacterSheet(modelVersionId).catch(() => null),
      this.repo.getReferences(modelVersionId),
    ]);
    const coverage = evaluateReferenceCoverage(references);
    return {
      versionId: version.id,
      modelId: version.modelId,
      versionNumber: version.versionNumber,
      capturedAt: new Date().toISOString(),
      sheet,
      references: references.map((reference) => {
        const role = roleForReference(reference);
        return {
          id: reference.id,
          role,
          roleLabel: REFERENCE_ROLE_LABELS[role],
          referenceType: reference.referenceType,
          caption: reference.caption.replace(/^\[builder:[a-z_]+\]\s*/, ''),
        };
      }),
      coverageSummary: {
        referenceCompleteness: coverage.referenceCompleteness,
        filledCount: coverage.filledCount,
        requiredFilled: coverage.requiredFilled,
        requiredTotal: coverage.requiredTotal,
      },
    };
  }

  async listAudit(
    workspaceId: string,
    filter?: { modelVersionId?: string; event?: ModelBuilderAuditEvent },
  ): Promise<ModelBuilderAuditRow[]> {
    return this.audit.list(workspaceId, filter);
  }

  /** Prompt-26 Character Sheet audit for this version (unchanged vocabulary). */
  async getCharacterSheetAudit(workspaceId: string, modelVersionId: string): Promise<CharacterSheetAuditRow[]> {
    await this.models.getVersion(modelVersionId, workspaceId);
    return this.repo.listCharacterSheetAudit(modelVersionId);
  }

  // ── internals ───────────────────────────────────────────────────────────────

  /** Best-effort audit — never masks the primary operation's outcome. */
  private async appendAudit(
    workspaceId: string,
    modelVersionId: string,
    event: ModelBuilderAuditEvent,
    detail: string,
  ): Promise<void> {
    try {
      await this.audit.append({ workspaceId, modelVersionId, event, detail });
    } catch {
      // Audit failure must not break the primary operation.
    }
  }
}
