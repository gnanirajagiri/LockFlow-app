/**
 * Content Studio service layer.
 *
 * The single entry point the UI uses for the Content Studio feature. It
 * assembles approved reusable inputs into content plans and future
 * generation job requests — it owns nothing:
 *
 *   * Models, Environments, Library assets and Looks stay canonical and
 *     independently reusable; a project records selections with roles.
 *   * Version pinning is mandatory for execution-ready jobs: a locked model
 *     version, a locked environment version, exact locked Library asset
 *     versions, and a locked Look version whose item versions are resolved
 *     and pinned at job-creation time. Newer versions are never silently
 *     substituted after a brief or job is created.
 *   * No generation happens here: no provider keys, no queue submission, no
 *     media outputs. Generated work belongs in Gallery (future).
 */
import {
  assertProjectDraftEditable,
  inputTargetProblem,
  refuseJobStatusWithoutProvider,
  refuseInvalidJobTransition,
  JOB_STATUS_TRANSITIONS,
  canTransitionJobStatus,
} from '../domain/content';
import type {
  ContentBeatRecord,
  ContentInputRole,
  ContentJobPinRecord,
  ContentJobRequestRecord,
  ContentJobStatus,
  ContentProjectInputRecord,
  ContentProjectRecord,
  ContentSceneRecord,
  ResolvedProjectInput,
} from '../domain/content';
import {
  validateCreateContentBeat,
  validateCreateContentJobRequest,
  validateCreateContentProject,
  validateCreateContentScene,
  validateCreateProjectInputPayload,
  validateReorder,
  validateUpdateContentBeat,
  validateUpdateContentProjectDraft,
  validateUpdateContentScene,
} from '../domain/content';
import { LibraryService } from './libraryService';
import { ModelsService } from './modelsService';
import { EnvironmentsService } from './environmentsService';
import type { ContentRepository } from '../data/contentRepository';
import type {
  LibraryAssetRecord,
  LibraryAssetVersionRecord,
} from '../domain/library';
import type { ModelRecord } from '../domain/models';
import type { EnvironmentRecord } from '../domain/environments';

/** Minimal workspace bridges so the service can verify cross-domain selections. */
export interface ContentStudioBridges {
  library: LibraryService;
  models: ModelsService;
  environments: EnvironmentsService;
}

export class ContentStudioService {
  constructor(
    private readonly repo: ContentRepository,
    private readonly bridges: ContentStudioBridges,
  ) {}

  // ── Projects ───────────────────────────────────────────────────────────────

  async listProjects(workspaceId: string): Promise<ContentProjectRecord[]> {
    return this.repo.listProjects(workspaceId);
  }

  async getProject(projectId: string, activeWorkspaceId: string): Promise<ContentProjectRecord> {
    const project = await this.repo.getProject(projectId);
    this.assertProjectWorkspace(project, activeWorkspaceId);
    return project;
  }

  async createProject(input: unknown, createdBy: string): Promise<ContentProjectRecord> {
    const result = validateCreateContentProject(input);
    if (!result.ok) throw new Error(`Invalid content project: ${result.errors.join('; ')}`);
    return this.repo.createProject(result.value, createdBy);
  }

  /** Draft projects are editable; non-draft projects reject structural edits. */
  async updateProjectDraft(
    projectId: string,
    patch: unknown,
    activeWorkspaceId: string,
  ): Promise<ContentProjectRecord> {
    const project = await this.getProject(projectId, activeWorkspaceId);
    assertProjectDraftEditable(project);

    const result = validateUpdateContentProjectDraft(patch);
    if (!result.ok) throw new Error(`Invalid project update: ${result.errors.join('; ')}`);
    return this.repo.updateProjectDraft(projectId, result.value);
  }

  /** Soft archive: status-only; inputs/scenes/beats are preserved. */
  async archiveProject(projectId: string, activeWorkspaceId: string): Promise<ContentProjectRecord> {
    await this.getProject(projectId, activeWorkspaceId);
    return this.repo.archiveProject(projectId);
  }

  // ── Project inputs ─────────────────────────────────────────────────────────

  async listProjectInputs(
    projectId: string,
    activeWorkspaceId: string,
  ): Promise<ContentProjectInputRecord[]> {
    await this.getProject(projectId, activeWorkspaceId);
    return this.repo.listInputs(projectId);
  }

  /**
   * Adds a planned selection. Cross-workspace records are refused and the
   * exact version supplied is recorded — drafts may experiment with draft
   * versions; execution readiness is checked separately by the resolver.
   */
  async addProjectInput(
    payload: unknown,
    activeWorkspaceId: string,
  ): Promise<ContentProjectInputRecord> {
    const result = validateCreateProjectInputPayload(payload);
    if (!result.ok) throw new Error(`Invalid project input: ${result.errors.join('; ')}`);
    const value = result.value;

    const project = await this.getProject(value.contentProjectId, activeWorkspaceId);
    assertProjectDraftEditable(project);

    // Canonical-record checks: same workspace, exact versions recorded.
    if (value.inputType === 'model') {
      const model = await this.bridges.models.getModel(value.modelId!, activeWorkspaceId);
      await this.assertModelVersion(value.modelId!, value.modelVersionId!, model);
    } else if (value.inputType === 'environment') {
      const environment = await this.bridges.environments.getEnvironment(value.environmentId!, activeWorkspaceId);
      await this.assertEnvironmentVersion(value.environmentId!, value.environmentVersionId!, environment);
    } else {
      const asset = await this.bridges.library.getAsset(value.libraryAssetId!, activeWorkspaceId);
      if (value.inputType === 'look' && asset.assetType !== 'look') {
        throw new Error('Look inputs must select a look-type Library asset.');
      }
      await this.assertLibraryVersion(asset, value.libraryAssetVersionId!);
    }

    const existing = await this.repo.listInputs(value.contentProjectId);
    const input: Omit<ContentProjectInputRecord, 'id' | 'createdAt' | 'updatedAt'> = {
      contentProjectId: value.contentProjectId,
      inputType: value.inputType,
      modelId: value.modelId ?? null,
      modelVersionId: value.modelVersionId ?? null,
      environmentId: value.environmentId ?? null,
      environmentVersionId: value.environmentVersionId ?? null,
      libraryAssetId: value.libraryAssetId ?? null,
      libraryAssetVersionId: value.libraryAssetVersionId ?? null,
      role: value.role,
      sortOrder: existing.length,
      notes: value.notes ?? null,
    };
    const problem = inputTargetProblem(input);
    if (problem) throw new Error(`Invalid project input: ${problem}`);

    return this.repo.addInput(input);
  }

  async removeProjectInput(inputId: string, activeWorkspaceId: string): Promise<void> {
    const input = await this.repo.getInput(inputId);
    const project = await this.getProject(input.contentProjectId, activeWorkspaceId);
    assertProjectDraftEditable(project);
    return this.repo.removeInput(inputId);
  }

  async reorderProjectInputs(
    projectId: string,
    order: unknown,
    activeWorkspaceId: string,
  ): Promise<void> {
    const project = await this.getProject(projectId, activeWorkspaceId);
    assertProjectDraftEditable(project);
    const result = validateReorder(order);
    if (!result.ok) throw new Error(`Invalid input reorder: ${result.errors.join('; ')}`);
    return this.repo.reorderInputs(projectId, result.value);
  }

  // ── Scenes ─────────────────────────────────────────────────────────────────

  async listScenes(projectId: string, activeWorkspaceId: string): Promise<ContentSceneRecord[]> {
    await this.getProject(projectId, activeWorkspaceId);
    return this.repo.listScenes(projectId);
  }

  async createScene(input: unknown, activeWorkspaceId: string): Promise<ContentSceneRecord> {
    const result = validateCreateContentScene(input);
    if (!result.ok) throw new Error(`Invalid scene: ${result.errors.join('; ')}`);

    const project = await this.getProject(result.value.contentProjectId, activeWorkspaceId);
    assertProjectDraftEditable(project);

    return this.repo.addScene({
      contentProjectId: result.value.contentProjectId,
      title: result.value.title,
      purpose: result.value.purpose ?? null,
      // Appended last; rewrites are compacted through reorderScenes.
      sceneOrder: (await this.repo.listScenes(result.value.contentProjectId)).length,
      settingNotes: result.value.settingNotes ?? null,
      shotNotes: result.value.shotNotes ?? null,
    });
  }

  async updateScene(sceneId: string, patch: unknown, activeWorkspaceId: string): Promise<ContentSceneRecord> {
    const scene = await this.repo.getScene(sceneId);
    const project = await this.getProject(scene.contentProjectId, activeWorkspaceId);
    assertProjectDraftEditable(project);

    const result = validateUpdateContentScene(patch);
    if (!result.ok) throw new Error(`Invalid scene update: ${result.errors.join('; ')}`);
    return this.repo.updateScene(sceneId, result.value as unknown as Record<string, unknown>);
  }

  async deleteScene(sceneId: string, activeWorkspaceId: string): Promise<void> {
    const scene = await this.repo.getScene(sceneId);
    const project = await this.getProject(scene.contentProjectId, activeWorkspaceId);
    assertProjectDraftEditable(project);
    return this.repo.deleteScene(sceneId); // beats cascade; sibling order compacts
  }

  async reorderScenes(projectId: string, order: unknown, activeWorkspaceId: string): Promise<void> {
    const project = await this.getProject(projectId, activeWorkspaceId);
    assertProjectDraftEditable(project);
    const result = validateReorder(order);
    if (!result.ok) throw new Error(`Invalid scene reorder: ${result.errors.join('; ')}`);
    return this.repo.reorderScenes(projectId, result.value);
  }

  // ── Beats ──────────────────────────────────────────────────────────────────

  async listBeats(sceneId: string, activeWorkspaceId: string): Promise<ContentBeatRecord[]> {
    const scene = await this.repo.getScene(sceneId);
    await this.getProject(scene.contentProjectId, activeWorkspaceId);
    return this.repo.listBeats(sceneId);
  }

  async createBeat(input: unknown, activeWorkspaceId: string): Promise<ContentBeatRecord> {
    const result = validateCreateContentBeat(input);
    if (!result.ok) throw new Error(`Invalid beat: ${result.errors.join('; ')}`);

    const scene = await this.repo.getScene(result.value.contentSceneId);
    const project = await this.getProject(scene.contentProjectId, activeWorkspaceId);
    assertProjectDraftEditable(project); // a Beat is editable only while its project is draft

    return this.repo.addBeat({
      contentSceneId: result.value.contentSceneId,
      title: result.value.title,
      beatOrder: (await this.repo.listBeats(result.value.contentSceneId)).length,
      actionDescription: result.value.actionDescription ?? null,
      dialogueOrOverlay: result.value.dialogueOrOverlay ?? null,
      cameraDirection: result.value.cameraDirection ?? null,
      durationSeconds: result.value.durationSeconds ?? null,
    });
  }

  async updateBeat(beatId: string, patch: unknown, activeWorkspaceId: string): Promise<ContentBeatRecord> {
    const beat = await this.repo.getBeat(beatId);
    const scene = await this.repo.getScene(beat.contentSceneId);
    const project = await this.getProject(scene.contentProjectId, activeWorkspaceId);
    assertProjectDraftEditable(project);

    const result = validateUpdateContentBeat(patch);
    if (!result.ok) throw new Error(`Invalid beat update: ${result.errors.join('; ')}`);
    return this.repo.updateBeat(beatId, result.value as unknown as Record<string, unknown>);
  }

  async deleteBeat(beatId: string, activeWorkspaceId: string): Promise<void> {
    const beat = await this.repo.getBeat(beatId);
    const scene = await this.repo.getScene(beat.contentSceneId);
    const project = await this.getProject(scene.contentProjectId, activeWorkspaceId);
    assertProjectDraftEditable(project);
    return this.repo.deleteBeat(beatId);
  }

  async reorderBeats(sceneId: string, order: unknown, activeWorkspaceId: string): Promise<void> {
    const scene = await this.repo.getScene(sceneId);
    const project = await this.getProject(scene.contentProjectId, activeWorkspaceId);
    assertProjectDraftEditable(project);
    const result = validateReorder(order);
    if (!result.ok) throw new Error(`Invalid beat reorder: ${result.errors.join('; ')}`);
    return this.repo.reorderBeats(sceneId, result.value);
  }

  // ── Job requests ───────────────────────────────────────────────────────────

  async listJobRequests(workspaceId: string): Promise<ContentJobRequestRecord[]> {
    return this.repo.listJobRequests(workspaceId);
  }

  async getJobRequest(jobRequestId: string, activeWorkspaceId: string): Promise<ContentJobRequestRecord> {
    const job = await this.repo.getJobRequest(jobRequestId);
    isInWorkspace(job.workspaceId, activeWorkspaceId);
    return job;
  }

  async listJobEvents(jobRequestId: string, activeWorkspaceId: string) {
    await this.getJobRequest(jobRequestId, activeWorkspaceId);
    return this.repo.listJobEvents(jobRequestId);
  }

  /**
   * Creates a DRAFT job request from a project: brief + plan snapshots are
   * captured at creation time and never rewritten by later project edits.
   * No pins are created here (that is the explicit resolver), no provider is
   * contacted and no output is produced.
   */
  async createDraftJobRequest(
    input: unknown,
    createdBy: string,
    activeWorkspaceId: string,
  ): Promise<ContentJobRequestRecord> {
    const result = validateCreateContentJobRequest(input);
    if (!result.ok) throw new Error(`Invalid job request: ${result.errors.join('; ')}`);
    const value = result.value;

    let project: ContentProjectRecord | null = null;
    if (value.contentProjectId) {
      project = await this.getProject(value.contentProjectId, activeWorkspaceId);
    }

    const briefSnapshot = value.briefSnapshot ?? {
      ...(project?.campaignBrief ? { campaignBrief: project.campaignBrief } : {}),
      ...(project?.objective ? { objective: project.objective } : {}),
      ...(project?.audience ? { audience: project.audience } : {}),
      ...(project?.brandVoice ? { brandVoice: project.brandVoice } : {}),
      capturedAt: new Date().toISOString(),
    };

    let planSnapshot = value.planSnapshot;
    if (!planSnapshot && project) {
      const [scenes, inputs] = await Promise.all([
        this.repo.listScenes(project.id),
        this.repo.listInputs(project.id),
      ]);
      planSnapshot = {
        capturedAt: new Date().toISOString(),
        projectName: project.name,
        inputCount: inputs.length,
        sceneCount: scenes.length,
        scenes: scenes.map((scene) => ({ title: scene.title, order: scene.sceneOrder })),
      };
    }

    const created = await this.repo.createJobRequest({
      workspaceId: value.workspaceId,
      contentProjectId: value.contentProjectId ?? null,
      name: value.name,
      requestedOutputType: value.requestedOutputType,
      status: 'draft',
      briefSnapshot,
      planSnapshot: planSnapshot ?? {},
      requestedVariants: value.requestedVariants ?? 1,
      providerName: null,
      providerRequestId: null,
      errorCode: null,
      errorMessage: null,
      submittedAt: null,
      completedAt: null,
      createdBy,
    });

    await this.repo.appendJobEvent({
      contentJobRequestId: created.id,
      eventType: 'draft_created',
      message: `Job request created as a draft${project ? ` from the ${project.name} plan` : ''}.`,
      metadata: { requestedOutputType: value.requestedOutputType, requestedVariants: value.requestedVariants },
    });

    return created;
  }

  /**
   * Rule: strict state machine + provider boundary. `queued`/`processing`/
   * `review` are refused while no provider integration exists; `draft` jobs
   * can only be cancelled (or queued once a provider lands).
   */
  async transitionJobRequest(
    jobRequestId: string,
    to: ContentJobStatus,
    activeWorkspaceId: string,
    options: { hasProvider?: boolean } = {},
  ): Promise<ContentJobRequestRecord> {
    const job = await this.getJobRequest(jobRequestId, activeWorkspaceId);
    refuseInvalidJobTransition(job.status, to);
    refuseJobStatusWithoutProvider(to, { hasProvider: options.hasProvider ?? false });

    const updated = await this.repo.updateJobRequestStatus(jobRequestId, to);
    await this.repo.appendJobEvent({
      contentJobRequestId: jobRequestId,
      eventType: `status_${to}`,
      message: `Status moved from ${job.status} to ${to}.`,
      metadata: { from: job.status, to },
    });
    return updated;
  }

  /** Exposed for tests/documentation: the permitted transition map. */
  static jobStatusTransitions(): Record<ContentJobStatus, ContentJobStatus[]> {
    return JOB_STATUS_TRANSITIONS;
  }

  static canTransitionJobStatus(from: ContentJobStatus, to: ContentJobStatus): boolean {
    return canTransitionJobStatus(from, to);
  }

  // ── Pin resolver ───────────────────────────────────────────────────────────

  /**
   * Resolves every project input to its exact selected version (plus the
   * Look's linked item versions). Draft versions are allowed while planning —
   * they simply fail execution readiness. Never substitutes the active or
   * newer version for the one selected.
   */
  async resolveProjectInputs(
    projectId: string,
    activeWorkspaceId: string,
  ): Promise<ResolvedProjectInput[]> {
    const inputs = await this.repo.listInputs(projectId);
    await this.getProject(projectId, activeWorkspaceId); // workspace check

    const resolved: ResolvedProjectInput[] = [];
    for (const input of inputs) {
      if (input.inputType === 'model') {
        const version = await this.bridges.models.getVersion(input.modelVersionId!, activeWorkspaceId);
        if (version.modelId !== input.modelId) {
          throw new Error('The selected Model version belongs to a different model.');
        }
        resolved.push({
          input,
          versionId: version.id,
          versionStatus: version.status,
          versionNumber: version.versionNumber,
        });
      } else if (input.inputType === 'environment') {
        const version = await this.bridges.environments.getVersion(input.environmentVersionId!, activeWorkspaceId);
        if (version.environmentId !== input.environmentId) {
          throw new Error('The selected Environment version belongs to a different environment.');
        }
        resolved.push({
          input,
          versionId: version.id,
          versionStatus: version.status,
          versionNumber: version.versionNumber,
        });
      } else if (input.inputType === 'library_asset') {
        const asset = await this.bridges.library.getAsset(input.libraryAssetId!, activeWorkspaceId);
        const version = await this.bridges.library.getVersion(input.libraryAssetVersionId!, activeWorkspaceId);
        await this.assertLibraryVersion(asset, version.id);
        resolved.push({
          input,
          versionId: version.id,
          versionStatus: version.status,
          versionNumber: version.versionNumber,
        });
      } else {
        // Look: the locked Look version plus its linked item versions.
        const asset = await this.bridges.library.getAsset(input.libraryAssetId!, activeWorkspaceId);
        if (asset.assetType !== 'look') {
          throw new Error('Look inputs must select a look-type Library asset.');
        }
        const lookVersion = await this.bridges.library.getVersion(input.libraryAssetVersionId!, activeWorkspaceId);
        await this.assertLibraryVersion(asset, lookVersion.id);

        const lookItems: ResolvedProjectInput['lookItems'] = [];
        const details = await this.bridges.library.getLookDetails(lookVersion.id, activeWorkspaceId);
        if (details) {
          const items = await this.bridges.library.getLookItems(details.id, activeWorkspaceId);
          for (const item of items.sort((a, b) => a.sortOrder - b.sortOrder)) {
            // Resolve the item's exact version: the pinned one, else the
            // asset's current locked active version — never a draft guess.
            const itemAsset = await this.bridges.library.getAsset(item.libraryAssetId, activeWorkspaceId);
            let itemVersionId = item.libraryAssetVersionId;
            let itemVersion: LibraryAssetVersionRecord | null = null;
            if (itemVersionId) {
              itemVersion = await this.bridges.library.getVersion(itemVersionId, activeWorkspaceId).catch(() => null);
              if (itemVersion && itemVersion.libraryAssetId !== itemAsset.id) {
                throw new Error('A Look contains an unavailable asset version.');
              }
            } else {
              itemVersion = itemAsset.activeVersionId
                ? await this.bridges.library.getVersion(itemAsset.activeVersionId, activeWorkspaceId).catch(() => null)
                : null;
              itemVersionId = itemVersion?.id ?? null;
            }
            lookItems.push({
              libraryAssetId: item.libraryAssetId,
              libraryAssetVersionId: itemVersionId!,
              role: item.role as ContentInputRole,
              sortOrder: item.sortOrder,
            });
            void itemVersion;
          }
        }
        resolved.push({
          input,
          versionId: lookVersion.id,
          versionStatus: lookVersion.status,
          versionNumber: lookVersion.versionNumber,
          lookItems,
        });
      }
    }
    return resolved;
  }

  /**
   * Execution-readiness check with human-readable failures. Returns the list
   * of problems (empty when ready). A job cannot become execution-ready if a
   * selected input uses a draft or missing version.
   */
  async validateExecutionReadiness(
    projectId: string,
    activeWorkspaceId: string,
  ): Promise<string[]> {
    const problems: string[] = [];
    let resolved: ResolvedProjectInput[];
    try {
      resolved = await this.resolveProjectInputs(projectId, activeWorkspaceId);
    } catch (err) {
      return [err instanceof Error ? err.message : 'Could not resolve the project inputs.'];
    }

    for (const entry of resolved) {
      const { input } = entry;
      if (input.inputType === 'model' && entry.versionStatus !== 'locked') {
        problems.push('Select a locked Model version before preparing this job.');
      } else if (input.inputType === 'environment' && entry.versionStatus !== 'locked') {
        problems.push(`The selected Environment version is still a ${entry.versionStatus}.`);
      } else if (input.inputType === 'library_asset' && entry.versionStatus !== 'locked') {
        problems.push(`The selected Library asset version is still a ${entry.versionStatus}.`);
      } else if (input.inputType === 'look') {
        if (entry.versionStatus !== 'locked') {
          problems.push(`The selected Look version is still a ${entry.versionStatus}.`);
        }
        for (const item of entry.lookItems ?? []) {
          const version = await this.bridges.library.getVersion(item.libraryAssetVersionId, activeWorkspaceId).catch(() => null);
          if (!version) {
            problems.push('A Look contains an unavailable asset version.');
          } else if (version.status !== 'locked') {
            problems.push(
              `A Look item version is still a ${version.status} — lock the item's approved version first.`,
            );
          }
        }
      }
    }
    return problems;
  }

  /**
   * Creates the immutable pin set for a job request from the project's
   * inputs. Every pin references a LOCKED version (draft inputs are refused
   * with human-readable errors), `resolved_details` holds a minimal
   * reproducibility snapshot (not a duplicate record), and Look items are
   * resolved and pinned at job-creation time.
   */
  async createJobPinsFromProject(
    jobRequestId: string,
    projectId: string,
    activeWorkspaceId: string,
  ): Promise<ContentJobPinRecord[]> {
    const job = await this.getJobRequest(jobRequestId, activeWorkspaceId);
    if (job.status !== 'draft') {
      throw new Error(`Job pins are immutable while the job is ${job.status}.`);
    }
    await this.getProject(projectId, activeWorkspaceId);
    const resolved = await this.resolveProjectInputs(projectId, activeWorkspaceId);
    // Rule: refuse to prepare an execution-ready preview with unlocked inputs.
    const problems = await this.collectPinProblems(resolved, activeWorkspaceId);
    if (problems.length > 0) {
      throw new Error(`This job is not ready to prepare: ${problems.join(' ')}`);
    }

    const pins: Array<Omit<ContentJobPinRecord, 'id' | 'createdAt'>> = [];
    for (const entry of resolved) {
      const { input } = entry;
      if (input.inputType === 'model') {
        const version = await this.bridges.models.getVersion(input.modelVersionId!, activeWorkspaceId);
        const model = await this.bridges.models.getModel(input.modelId!, activeWorkspaceId);
        pins.push({
          contentJobRequestId: jobRequestId,
          pinType: 'model_version',
          sourceRecordId: input.modelId!,
          sourceVersionId: version.id,
          resolvedDetails: {
            modelName: model.name,
            versionNumber: version.versionNumber,
            versionStatus: version.status,
            lockedAt: version.lockedAt,
          },
          role: input.role,
          sortOrder: input.sortOrder,
        });
      } else if (input.inputType === 'environment') {
        const version = await this.bridges.environments.getVersion(input.environmentVersionId!, activeWorkspaceId);
        const environment = await this.bridges.environments.getEnvironment(input.environmentId!, activeWorkspaceId);
        pins.push({
          contentJobRequestId: jobRequestId,
          pinType: 'environment_version',
          sourceRecordId: input.environmentId!,
          sourceVersionId: version.id,
          resolvedDetails: {
            environmentName: environment.name,
            versionNumber: version.versionNumber,
            versionStatus: version.status,
            lockedAt: version.lockedAt,
          },
          role: input.role,
          sortOrder: input.sortOrder,
        });
      } else if (input.inputType === 'library_asset') {
        const version = await this.bridges.library.getVersion(input.libraryAssetVersionId!, activeWorkspaceId);
        const asset = await this.bridges.library.getAsset(input.libraryAssetId!, activeWorkspaceId);
        pins.push({
          contentJobRequestId: jobRequestId,
          pinType: 'library_asset_version',
          sourceRecordId: input.libraryAssetId!,
          sourceVersionId: version.id,
          resolvedDetails: {
            assetName: asset.name,
            assetType: asset.assetType,
            versionNumber: version.versionNumber,
            versionStatus: version.status,
            lockedAt: version.lockedAt,
          },
          role: input.role,
          sortOrder: input.sortOrder,
        });
      } else {
        const version = await this.bridges.library.getVersion(input.libraryAssetVersionId!, activeWorkspaceId);
        const asset = await this.bridges.library.getAsset(input.libraryAssetId!, activeWorkspaceId);
        pins.push({
          contentJobRequestId: jobRequestId,
          pinType: 'look_version',
          sourceRecordId: input.libraryAssetId!,
          sourceVersionId: version.id,
          resolvedDetails: {
            assetName: asset.name,
            versionNumber: version.versionNumber,
            versionStatus: version.status,
            lockedAt: version.lockedAt,
            lookItems: entry.lookItems ?? [],
          },
          role: input.role,
          sortOrder: input.sortOrder,
        });
        // Look items become their own canonical library_asset_version pins.
        for (const item of entry.lookItems ?? []) {
          const itemVersion = await this.bridges.library.getVersion(item.libraryAssetVersionId, activeWorkspaceId);
          const itemAsset = await this.bridges.library.getAsset(item.libraryAssetId, activeWorkspaceId);
          pins.push({
            contentJobRequestId: jobRequestId,
            pinType: 'library_asset_version',
            sourceRecordId: item.libraryAssetId,
            sourceVersionId: itemVersion.id,
            resolvedDetails: {
              assetName: itemAsset.name,
              assetType: itemAsset.assetType,
              versionNumber: itemVersion.versionNumber,
              versionStatus: itemVersion.status,
              lockedAt: itemVersion.lockedAt,
              resolvedVia: 'look_version',
            },
            role: item.role,
            sortOrder: item.sortOrder,
          });
        }
      }
    }

    return this.repo.createJobPins(pins);
  }

  /** Rule 5 — pins cannot change once the job leaves draft. */
  async listJobPins(jobRequestId: string, activeWorkspaceId: string): Promise<ContentJobPinRecord[]> {
    await this.getJobRequest(jobRequestId, activeWorkspaceId);
    return this.repo.listJobPins(jobRequestId);
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private assertProjectWorkspace(project: ContentProjectRecord, activeWorkspaceId: string): void {
    isInWorkspace(project.workspaceId, activeWorkspaceId);
  }

  private async assertModelVersion(modelId: string, versionId: string, model: ModelRecord): Promise<void> {
    const version = await this.bridges.models.getVersion(versionId, model.workspaceId);
    if (version.modelId !== modelId) {
      throw new Error('The selected Model version belongs to a different model.');
    }
  }

  private async assertEnvironmentVersion(
    environmentId: string,
    versionId: string,
    environment: EnvironmentRecord,
  ): Promise<void> {
    const version = await this.bridges.environments.getVersion(versionId, environment.workspaceId);
    if (version.environmentId !== environmentId) {
      throw new Error('The selected Environment version belongs to a different environment.');
    }
  }

  private async assertLibraryVersion(asset: LibraryAssetRecord, versionId: string): Promise<void> {
    const version = await this.bridges.library.getVersion(versionId, asset.workspaceId);
    if (version.libraryAssetId !== asset.id) {
      throw new Error('The selected Library asset version belongs to a different asset.');
    }
  }

  private async collectPinProblems(
    resolved: ResolvedProjectInput[],
    activeWorkspaceId: string,
  ): Promise<string[]> {
    const problems: string[] = [];
    for (const entry of resolved) {
      // Primary pinned versions must be locked for execution readiness.
      if (entry.versionStatus !== 'locked') {
        const label =
          entry.input.inputType === 'model'
            ? 'Select a locked Model version before preparing this job.'
            : entry.input.inputType === 'environment'
              ? `The selected Environment version is still a ${entry.versionStatus}.`
              : entry.input.inputType === 'look'
                ? `The selected Look version is still a ${entry.versionStatus}.`
                : `The selected Library asset version is still a ${entry.versionStatus}.`;
        problems.push(label);
      }
      // Look item versions must also resolve to locked versions.
      if (entry.input.inputType === 'look') {
        for (const item of entry.lookItems ?? []) {
          const version = await this.bridges.library.getVersion(item.libraryAssetVersionId, activeWorkspaceId).catch(() => null);
          if (!version || version.status !== 'locked') {
            problems.push('A Look contains an unavailable asset version.');
            break;
          }
        }
      }
    }
    return problems;
  }
}

function isInWorkspace(recordWorkspaceId: string, activeWorkspaceId: string): void {
  if (recordWorkspaceId !== activeWorkspaceId) {
    throw new Error('Cross-workspace access denied.');
  }
}
