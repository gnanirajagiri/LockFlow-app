/**
 * Prompt 33 — EnvironmentBuilderService: the complete Environment Builder
 * workflow over the EXISTING environments repository/service. Adds labeled
 * reference roles, Library-asset attachment, environment-specific camera
 * views, readiness validation, immutable lock-and-save with a safe snapshot
 * and draft-from-locked paths. Environments stay independent from models;
 * locked versions remain visually stable across every generation set.
 *
 * Security: every method re-resolves the version → environment → workspace
 * chain through the existing EnvironmentsService guards, so cross-workspace
 * references, assets and reads fail loudly. Private storage paths never
 * appear in audit details or returned snapshots.
 */
import type { EnvironmentsRepository } from '../data/environmentsRepository';
import type {
  EnvironmentAssetShortcutRecord,
  EnvironmentRecord,
  EnvironmentReferenceRecord,
  EnvironmentSpecRecord,
  EnvironmentVersionRecord,
} from '../domain/environments/types';
import { EnvironmentsService } from '../services/environmentsService';
import {
  ENVIRONMENT_REFERENCE_ROLE_LABELS,
  evaluateEnvironmentReferenceCoverage,
  roleForEnvironmentReference,
  validateCameraViewInput,
  validateEnvironmentReadinessForLock,
} from './environmentBuilderWorkflow';
import type {
  EnvironmentBuilderReferenceRole,
  EnvironmentCameraViewRecord,
  EnvironmentCoverageReport,
  EnvironmentReadinessCheck,
  EnvironmentReadinessState,
} from './environmentBuilderWorkflow';

/** Re-exported so the UI imports one module. */
export { ENVIRONMENT_REFERENCE_ROLE_LABELS };
export type {
  EnvironmentBuilderReferenceRole,
  EnvironmentCameraViewRecord,
  EnvironmentCoverageReport,
  EnvironmentReadinessCheck,
  EnvironmentReadinessState,
};

// ── Audit (dedicated vocabulary) ─────────────────────────────────────────────

export type EnvironmentBuilderAuditEvent =
  | 'environment_draft_created'
  | 'environment_reference_added'
  | 'environment_asset_attached'
  | 'environment_camera_view_saved'
  | 'environment_readiness_checked'
  | 'environment_lock_blocked'
  | 'environment_version_locked'
  | 'environment_draft_created_from_locked_version';

export interface EnvironmentBuilderAuditRow {
  id: string;
  workspaceId: string;
  environmentVersionId: string;
  event: EnvironmentBuilderAuditEvent;
  detail: string | null;
  createdAt: string;
}

export interface EnvironmentBuilderAuditStore {
  append(row: Omit<EnvironmentBuilderAuditRow, 'id' | 'createdAt'>): Promise<void>;
  list(workspaceId: string, filter?: { environmentVersionId?: string; event?: EnvironmentBuilderAuditEvent }): Promise<EnvironmentBuilderAuditRow[]>;
}

/** In-memory audit store mirroring the SQL shape (demo mode + tests). */
export class InMemoryEnvironmentBuilderAuditStore implements EnvironmentBuilderAuditStore {
  readonly rows: EnvironmentBuilderAuditRow[] = [];

  async append(row: Omit<EnvironmentBuilderAuditRow, 'id' | 'createdAt'>): Promise<void> {
    this.rows.push({ ...row, id: `envaudit_${crypto.randomUUID()}`, createdAt: new Date().toISOString() });
  }

  async list(
    workspaceId: string,
    filter?: { environmentVersionId?: string; event?: EnvironmentBuilderAuditEvent },
  ): Promise<EnvironmentBuilderAuditRow[]> {
    return this.rows
      .filter((row) => row.workspaceId === workspaceId)
      .filter((row) => !filter?.environmentVersionId || row.environmentVersionId === filter.environmentVersionId)
      .filter((row) => !filter?.event || row.event === filter.event)
      .map((row) => ({ ...row }));
  }
}

// ── Views & records ──────────────────────────────────────────────────────────

/** One labeled reference in the builder view. */
export interface BuilderEnvironmentReferenceView {
  reference: EnvironmentReferenceRecord;
  role: EnvironmentBuilderReferenceRole;
  roleLabel: string;
  /** Defining references are the environment's definition evidence. */
  defining: boolean;
}

/** The Environment Builder workspace view for one version. */
export interface EnvironmentBuilderView {
  environment: EnvironmentRecord;
  version: EnvironmentVersionRecord;
  spec: EnvironmentSpecRecord | null;
  references: BuilderEnvironmentReferenceView[];
  assets: EnvironmentAssetLinkRecord[];
  cameraViews: EnvironmentCameraViewRecord[];
  coverage: EnvironmentCoverageReport;
  readiness: EnvironmentReadinessCheck;
}

/** Safe immutable snapshot of an environment version at lock time. */
export interface EnvironmentVersionSnapshot {
  versionId: string;
  environmentId: string;
  versionNumber: number;
  lockLevel: string;
  capturedAt: string;
  spec: EnvironmentSpecRecord | null;
  references: Array<{
    id: string;
    role: EnvironmentBuilderReferenceRole;
    roleLabel: string;
    referenceType: string;
    caption: string;
  }>;
  assets: Array<{ id: string; libraryAssetId: string; category: string }>;
  cameraViews: Array<{
    name: string;
    angle: string | null;
    movement: EnvironmentCameraViewRecord['movement'];
  }>;
  coverageSummary: {
    referenceCompleteness: EnvironmentCoverageReport['referenceCompleteness'];
    requiredFilled: number;
    requiredTotal: number;
  };
}

/** Library-backed reference/asset import (ownership validated server-side). */
export interface EnvironmentBuilderDependencies {
  /** Resolves a Library asset the user is importing/attaching. */
  getLibraryAsset(assetId: string, workspaceId: string): Promise<{
    id: string;
    workspaceId: string;
    name: string;
    storagePath: string | null;
  }>;
}

function roleToEnvironmentReferenceType(
  role: EnvironmentBuilderReferenceRole,
): EnvironmentReferenceRecord['referenceType'] {
  switch (role) {
    case 'primary_environment':
      return 'wide';
    case 'layout':
      return 'layout';
    case 'lighting_mood':
      return 'lighting';
    case 'material_color':
      return 'detail';
    case 'prop_furnishing':
      return 'product_zone';
    case 'camera_view':
      return 'hero_angle';
    case 'supporting_inspiration':
      return 'other';
  }
}

/** In-memory camera-view table (demo mode + tests); mirrors the SQL shape. */
export class InMemoryEnvironmentCameraViewStore {
  readonly views: EnvironmentCameraViewRecord[] = [];

  async save(record: EnvironmentCameraViewRecord): Promise<void> {
    this.views.push({ ...record });
  }

  async list(environmentVersionId: string): Promise<EnvironmentCameraViewRecord[]> {
    return this.views
      .filter((view) => view.environmentVersionId === environmentVersionId)
      .map((view) => ({ ...view }));
  }
}

/** A version-scoped Library asset pointer (explicit, inspectable, reversible). */
export interface EnvironmentAssetLinkRecord {
  id: string;
  workspaceId: string;
  environmentVersionId: string;
  libraryAssetId: string;
  /** Prop/furniture/lighting/decor role of the asset in this environment. */
  category: EnvironmentAssetShortcutRecord['category'];
  addedBy: string;
  createdAt: string;
}

/**
 * In-memory version-asset link table (demo mode + tests); mirrors the SQL
 * shape. Version-scoped by design — the existing environment-level shortcut
 * table stays untouched, and attachments are reversible per version.
 */
export class InMemoryEnvironmentAssetLinkStore {
  readonly links: EnvironmentAssetLinkRecord[] = [];

  async save(record: EnvironmentAssetLinkRecord): Promise<EnvironmentAssetLinkRecord> {
    this.links.push({ ...record });
    return { ...record };
  }

  async remove(environmentVersionId: string, linkId: string): Promise<void> {
    const index = this.links.findIndex(
      (link) => link.environmentVersionId === environmentVersionId && link.id === linkId,
    );
    if (index >= 0) this.links.splice(index, 1);
  }

  async list(environmentVersionId: string): Promise<EnvironmentAssetLinkRecord[]> {
    return this.links
      .filter((link) => link.environmentVersionId === environmentVersionId)
      .map((link) => ({ ...link }));
  }
}

// ── Service ──────────────────────────────────────────────────────────────────

export class EnvironmentBuilderService {
  constructor(
    private readonly environments: EnvironmentsService,
    private readonly repo: EnvironmentsRepository,
    private readonly deps: EnvironmentBuilderDependencies,
    private readonly audit: EnvironmentBuilderAuditStore,
    private readonly cameraViews: InMemoryEnvironmentCameraViewStore,
    private readonly assetLinks: InMemoryEnvironmentAssetLinkStore = new InMemoryEnvironmentAssetLinkStore(),
  ) {}

  /** Creates an environment with its first draft version (existing seam). */
  async createEnvironmentDraft(
    workspaceId: string,
    input: { name: string; slug?: string },
    actorId: string,
  ): Promise<{ environment: EnvironmentRecord; version: EnvironmentVersionRecord }> {
    const environment = await this.environments.createEnvironment(
      { workspaceId, name: input.name, ...(input.slug ? { slug: input.slug } : {}) },
      actorId,
    );
    const versions = await this.environments.getVersions(environment.id, workspaceId);
    const version = versions[versions.length - 1];
    if (!version) throw new Error('Environment was created but no draft version is available.');
    await this.appendAudit(workspaceId, version.id, 'environment_draft_created', `Draft v${version.versionNumber} created for "${environment.name}".`);
    return { environment, version };
  }

  /** Edits a draft environment's metadata (existing draft path). */
  async updateEnvironmentDraft(
    workspaceId: string,
    environmentId: string,
    input: { name?: string; coverImagePath?: string | null },
  ): Promise<EnvironmentRecord> {
    await this.environments.getEnvironment(environmentId, workspaceId);
    if (input.name !== undefined || input.coverImagePath !== undefined) {
      return this.repo.updateEnvironmentDraft(environmentId, {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.coverImagePath !== undefined ? { coverImagePath: input.coverImagePath } : {}),
      });
    }
    return this.environments.getEnvironment(environmentId, workspaceId);
  }

  /**
   * Attaches a labeled reference to a DRAFT version (Library or secured
   * upload). The role is stored as a caption tag — no schema change.
   */
  async attachEnvironmentReference(
    workspaceId: string,
    environmentVersionId: string,
    input: {
      role: EnvironmentBuilderReferenceRole;
      source: { kind: 'library_asset'; libraryAssetId: string } | { kind: 'upload'; storagePath: string };
      caption?: string;
    },
    actorId: string,
  ): Promise<BuilderEnvironmentReferenceView> {
    const version = await this.environments.getVersion(environmentVersionId, workspaceId);
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

    const caption = `[envbuilder:${input.role}] ${captionBase}`.slice(0, 400);
    const reference = await this.repo.addReference(environmentVersionId, {
      storagePath,
      referenceType: roleToEnvironmentReferenceType(input.role),
      caption,
    });
    await this.appendAudit(workspaceId, environmentVersionId, 'environment_reference_added', `${ENVIRONMENT_REFERENCE_ROLE_LABELS[input.role]} reference added.`);
    void actorId;
    return {
      reference,
      role: input.role,
      roleLabel: ENVIRONMENT_REFERENCE_ROLE_LABELS[input.role],
      defining: isDefining(input.role),
    };
  }

  /** Removes a labeled reference from a draft version (reversible). */
  async removeEnvironmentReference(
    workspaceId: string,
    environmentVersionId: string,
    referenceId: string,
  ): Promise<void> {
    const version = await this.environments.getVersion(environmentVersionId, workspaceId);
    if (version.status !== 'draft') {
      throw new Error('References can only change on a draft version — create a draft from the locked version first.');
    }
    const references = await this.repo.getReferences(environmentVersionId);
    const reference = references.find((row) => row.id === referenceId);
    if (!reference) throw new Error(`Reference not found: ${referenceId}`);
    await this.repo.removeReference(environmentVersionId, referenceId);
    await this.appendAudit(workspaceId, environmentVersionId, 'environment_reference_added', `Reference removed (${ENVIRONMENT_REFERENCE_ROLE_LABELS[roleForEnvironmentReference(reference)]}).`);
  }

  /**
   * Attaches a Library asset (prop/furniture/lighting) to a DRAFT version.
   * Pointers only — the Library asset is never copied or modified, and the
   * attachment is reversible (removeEnvironmentAsset).
   */
  async attachEnvironmentAsset(
    workspaceId: string,
    environmentVersionId: string,
    input: {
      libraryAssetId: string;
      category: EnvironmentAssetShortcutRecord['category'];
    },
    actorId: string,
  ): Promise<EnvironmentAssetLinkRecord> {
    const version = await this.environments.getVersion(environmentVersionId, workspaceId);
    if (version.status !== 'draft') {
      throw new Error('Assets can only change on a draft version — create a draft from the locked version first.');
    }
    const asset = await this.deps.getLibraryAsset(input.libraryAssetId, workspaceId);
    if (asset.workspaceId !== workspaceId) {
      throw new Error('You do not have access to this workspace.');
    }

    const existing = await this.assetLinks.list(environmentVersionId);
    const duplicate = existing.find(
      (link) => link.libraryAssetId === input.libraryAssetId && link.category === input.category,
    );
    if (duplicate) return duplicate;

    const link = await this.assetLinks.save({
      id: `envasset_${crypto.randomUUID()}`,
      workspaceId,
      environmentVersionId,
      libraryAssetId: input.libraryAssetId,
      category: input.category,
      addedBy: actorId,
      createdAt: new Date().toISOString(),
    });
    await this.appendAudit(workspaceId, environmentVersionId, 'environment_asset_attached', `${input.category} asset attached (Library pointer, reversible).`);
    return link;
  }

  /** Removes a Library asset pointer from the version (reversible). */
  async removeEnvironmentAsset(
    workspaceId: string,
    environmentVersionId: string,
    linkId: string,
  ): Promise<void> {
    const version = await this.environments.getVersion(environmentVersionId, workspaceId);
    if (version.status !== 'draft') {
      throw new Error('Assets can only change on a draft version — create a draft from the locked version first.');
    }
    await this.assetLinks.remove(environmentVersionId, linkId);
    await this.appendAudit(workspaceId, environmentVersionId, 'environment_asset_attached', 'Asset pointer removed (Library unchanged).');
  }

  /**
   * Saves a reusable camera/view for this environment version. Camera data
   * is environment-specific staging metadata — never a model identity trait.
   */
  async saveEnvironmentCameraView(
    workspaceId: string,
    environmentVersionId: string,
    input: {
      name: string;
      angle?: string | null;
      movement?: EnvironmentCameraViewRecord['movement'];
      configuration?: Record<string, unknown>;
    },
    actorId: string,
  ): Promise<EnvironmentCameraViewRecord> {
    await this.environments.getVersion(environmentVersionId, workspaceId);
    const validation = validateCameraViewInput(input);
    if (!validation.ok) throw new Error(validation.errors.join(' '));

    const record: EnvironmentCameraViewRecord = {
      id: `envview_${crypto.randomUUID()}`,
      workspaceId,
      environmentVersionId,
      name: input.name.trim(),
      angle: input.angle?.trim() || null,
      movement: input.movement ?? null,
      configuration: input.configuration ?? null,
      createdBy: actorId,
      createdAt: new Date().toISOString(),
    };
    await this.cameraViews.save(record);
    await this.appendAudit(workspaceId, environmentVersionId, 'environment_camera_view_saved', `Camera view "${record.name}" saved.`);
    return record;
  }

  /** The coordinated builder view for one version. */
  async getEnvironmentBuilderView(workspaceId: string, environmentVersionId: string): Promise<EnvironmentBuilderView> {
    const version = await this.environments.getVersion(environmentVersionId, workspaceId);
    const [spec, references, assets, views] = await Promise.all([
      this.repo.getSpec(environmentVersionId).catch(() => null),
      this.repo.getReferences(environmentVersionId),
      this.assetLinks.list(environmentVersionId),
      this.cameraViews.list(environmentVersionId),
    ]);
    const referenceViews: BuilderEnvironmentReferenceView[] = references.map((reference) => {
      const role = roleForEnvironmentReference(reference);
      return {
        reference,
        role,
        roleLabel: ENVIRONMENT_REFERENCE_ROLE_LABELS[role],
        defining: isDefining(role),
      };
    });
    const coverage = evaluateEnvironmentReferenceCoverage(references);
    const readiness = validateEnvironmentReadinessForLock({ version, spec, references });
    const environment = await this.environments.getEnvironment(version.environmentId, workspaceId);
    return {
      environment,
      version,
      spec,
      references: referenceViews,
      assets,
      cameraViews: views,
      coverage,
      readiness,
    };
  }

  /** Reference coverage status (honest about missing views). */
  async validateEnvironmentReferenceCoverage(
    workspaceId: string,
    environmentVersionId: string,
  ): Promise<EnvironmentCoverageReport> {
    await this.environments.getVersion(environmentVersionId, workspaceId);
    return evaluateEnvironmentReferenceCoverage(await this.repo.getReferences(environmentVersionId));
  }

  /** Lock readiness: draft + spec anchors + core coverage (safe blockers). */
  async validateEnvironmentReadinessForLock(
    workspaceId: string,
    environmentVersionId: string,
  ): Promise<EnvironmentReadinessCheck> {
    const version = await this.environments.getVersion(environmentVersionId, workspaceId);
    const [spec, references] = await Promise.all([
      this.repo.getSpec(environmentVersionId).catch(() => null),
      this.repo.getReferences(environmentVersionId),
    ]);
    const check = validateEnvironmentReadinessForLock({ version, spec, references });
    await this.appendAudit(
      workspaceId,
      environmentVersionId,
      'environment_readiness_checked',
      check.ok ? 'Ready to lock.' : `Blocked: ${check.blockers.length} issue(s).`,
    );
    return check;
  }

  /** Creates a NEW draft from any version — the locked source never mutates. */
  async createEnvironmentDraftFromLockedVersion(
    workspaceId: string,
    environmentVersionId: string,
    actorId: string,
    changeSummary?: string,
  ): Promise<EnvironmentVersionRecord> {
    const source = await this.environments.getVersion(environmentVersionId, workspaceId);
    const version = await this.environments.createVersion(
      {
        environmentId: source.environmentId,
        sourceVersionId: source.id,
        changeSummary: changeSummary ?? `Draft from locked v${source.versionNumber}`,
      },
      actorId,
      workspaceId,
    );
    await this.appendAudit(workspaceId, environmentVersionId, 'environment_draft_created_from_locked_version', `New draft v${version.versionNumber} created from v${source.versionNumber} (${source.status}).`);
    return version;
  }

  /**
   * Lock-and-save: validates readiness, refuses anything incomplete, then
   * captures the immutable snapshot BEFORE locking through the existing
   * guard path. The locked version cannot be destructively edited afterwards.
   */
  async lockAndSaveEnvironmentVersion(
    workspaceId: string,
    environmentVersionId: string,
    actorId: string,
  ): Promise<{ version: EnvironmentVersionRecord; snapshot: EnvironmentVersionSnapshot }> {
    const check = await this.validateEnvironmentReadinessForLock(workspaceId, environmentVersionId);
    if (!check.ok) {
      await this.appendAudit(workspaceId, environmentVersionId, 'environment_lock_blocked', check.blockers.join(' '));
      throw new Error(`Cannot lock yet: ${check.blockers[0]}`);
    }
    const snapshot = await this.getEnvironmentVersionSnapshot(workspaceId, environmentVersionId);
    const version = await this.environments.lockVersion(environmentVersionId, workspaceId);
    await this.appendAudit(workspaceId, environmentVersionId, 'environment_version_locked', `v${version.versionNumber} locked; environment snapshot captured.`);
    void actorId;
    return { version, snapshot };
  }

  /** The safe immutable snapshot (ids/labels only — no storage paths). */
  async getEnvironmentVersionSnapshot(
    workspaceId: string,
    environmentVersionId: string,
  ): Promise<EnvironmentVersionSnapshot> {
    const version = await this.environments.getVersion(environmentVersionId, workspaceId);
    const [spec, references, assets, views] = await Promise.all([
      this.repo.getSpec(environmentVersionId).catch(() => null),
      this.repo.getReferences(environmentVersionId),
      this.assetLinks.list(environmentVersionId),
      this.cameraViews.list(environmentVersionId),
    ]);
    const coverage = evaluateEnvironmentReferenceCoverage(references);
    return {
      versionId: version.id,
      environmentId: version.environmentId,
      versionNumber: version.versionNumber,
      lockLevel: version.lockLevel,
      capturedAt: new Date().toISOString(),
      spec,
      references: references.map((reference) => {
        const role = roleForEnvironmentReference(reference);
        return {
          id: reference.id,
          role,
          roleLabel: ENVIRONMENT_REFERENCE_ROLE_LABELS[role],
          referenceType: reference.referenceType,
          caption: reference.caption.replace(/^\[envbuilder:[a-z_]+\]\s*/, ''),
        };
      }),
      assets: assets.map((link) => ({
        id: link.id,
        libraryAssetId: link.libraryAssetId,
        category: link.category,
      })),
      cameraViews: views.map((view) => ({
        name: view.name,
        angle: view.angle,
        movement: view.movement,
      })),
      coverageSummary: {
        referenceCompleteness: coverage.referenceCompleteness,
        requiredFilled: coverage.requiredFilled,
        requiredTotal: coverage.requiredTotal,
      },
    };
  }

  async listAudit(
    workspaceId: string,
    filter?: { environmentVersionId?: string; event?: EnvironmentBuilderAuditEvent },
  ): Promise<EnvironmentBuilderAuditRow[]> {
    return this.audit.list(workspaceId, filter);
  }

  // ── internals ───────────────────────────────────────────────────────────────

  // The pure `isDefining` helper is used directly at call sites (same as the
  // model builder's isIdentityRole import); no method wrapper is needed.

  /** Best-effort audit — never masks the primary operation's outcome. */
  private async appendAudit(
    workspaceId: string,
    environmentVersionId: string,
    event: EnvironmentBuilderAuditEvent,
    detail: string,
  ): Promise<void> {
    try {
      await this.audit.append({ workspaceId, environmentVersionId, event, detail });
    } catch {
      // Audit failure must not break the primary operation.
    }
  }
}

// Shared role helper (the pure predicate from the workflow module).
import { isDefiningRole as isDefining } from './environmentBuilderWorkflow';
