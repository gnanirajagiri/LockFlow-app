/**
 * Prompt 34 — StoryboardService: Content Studio scenes/beats/storyboard with
 * locked asset selection and controlled generation handoff.
 *
 * Composes the EXISTING seams only:
 *   * ContentStudioService — project/scene/beat CRUD + draft job requests
 *     (workspace guards stay in the existing service, never re-implemented);
 *   * ModelsService / EnvironmentsService / LibraryService — server-side
 *     ownership validation of every version-pinned binding;
 *   * Generation services (prompts 27/28) — the ONLY path to generation;
 *     results flow to Gallery through their existing ingestion.
 *
 * A handoff preserves a locked snapshot of selected inputs and storyboard
 * state. The prompt bar classifies creative intent but never bypasses
 * Character Sheet or locked-asset validation.
 */
import type {
  ContentBeatRecord,
  ContentProjectRecord,
  ContentSceneRecord,
} from '../domain/content/types';
import type { ContentStudioService } from '../services/contentService';
import type { EnvironmentsService } from '../services/environmentsService';
import type { LibraryService } from '../services/libraryService';
import type { ModelsService } from '../services/modelsService';
import {
  assembleGenerationPrompt,
  classifyPromptIntent,
  validateSceneForGenerationRules,
} from './storyboardWorkflow';
import type {
  SceneAssetBindingRecord,
  SceneBindingKind,
  SceneGenerationSnapshot,
  SceneGenerationType,
  StoryboardBeatType,
} from './storyboardWorkflow';

// ── Stores (in-memory mirrors of the SQL tables; demo mode + tests) ─────────

export class InMemorySceneBindingStore {
  readonly bindings: SceneAssetBindingRecord[] = [];

  async save(record: SceneAssetBindingRecord): Promise<SceneAssetBindingRecord> {
    this.bindings.push({ ...record });
    return { ...record };
  }

  async remove(sceneId: string, bindingId: string): Promise<void> {
    const index = this.bindings.findIndex(
      (binding) => binding.contentSceneId === sceneId && binding.id === bindingId,
    );
    if (index >= 0) this.bindings.splice(index, 1);
  }

  async list(sceneId: string): Promise<SceneAssetBindingRecord[]> {
    return this.bindings.filter((binding) => binding.contentSceneId === sceneId).map((binding) => ({ ...binding }));
  }
}

export interface SceneGenerationHandoffRecord {
  id: string;
  workspaceId: string;
  contentSceneId: string;
  generationType: SceneGenerationType;
  snapshot: SceneGenerationSnapshot;
  contentJobRequestId: string | null;
  status: 'snapshot_created' | 'submitted' | 'failed';
  createdBy: string;
  createdAt: string;
}

export class InMemoryHandoffStore {
  readonly handoffs: SceneGenerationHandoffRecord[] = [];

  async save(record: SceneGenerationHandoffRecord): Promise<SceneGenerationHandoffRecord> {
    this.handoffs.push({ ...record });
    return { ...record };
  }

  async update(handoffId: string, patch: Partial<Pick<SceneGenerationHandoffRecord, 'status' | 'contentJobRequestId'>>): Promise<SceneGenerationHandoffRecord> {
    const handoff = this.handoffs.find((row) => row.id === handoffId);
    if (!handoff) throw new Error(`Handoff not found: ${handoffId}`);
    const next = { ...handoff, ...patch };
    const index = this.handoffs.findIndex((row) => row.id === handoffId);
    this.handoffs[index] = next;
    return { ...next };
  }

  async listForScene(sceneId: string): Promise<SceneGenerationHandoffRecord[]> {
    return this.handoffs.filter((row) => row.contentSceneId === sceneId).map((row) => ({ ...row }));
  }
}

// ── Audit (dedicated vocabulary) ─────────────────────────────────────────────

export type StoryboardAuditEvent =
  | 'content_project_created'
  | 'scene_created'
  | 'scene_reordered'
  | 'beat_created'
  | 'beat_reordered'
  | 'storyboard_updated'
  | 'scene_generation_snapshot_created'
  | 'scene_generation_validation_blocked'
  | 'scene_generation_submitted';

export interface StoryboardAuditRow {
  id: string;
  workspaceId: string;
  contentProjectId: string | null;
  contentSceneId: string | null;
  event: StoryboardAuditEvent;
  detail: string | null;
  createdAt: string;
}

export interface StoryboardAuditStore {
  append(row: Omit<StoryboardAuditRow, 'id' | 'createdAt'>): Promise<void>;
  list(workspaceId: string, filter?: { contentProjectId?: string; contentSceneId?: string; event?: StoryboardAuditEvent }): Promise<StoryboardAuditRow[]>;
}

export class InMemoryStoryboardAuditStore implements StoryboardAuditStore {
  readonly rows: StoryboardAuditRow[] = [];

  async append(row: Omit<StoryboardAuditRow, 'id' | 'createdAt'>): Promise<void> {
    this.rows.push({ ...row, id: `sbaudit_${crypto.randomUUID()}`, createdAt: new Date().toISOString() });
  }

  async list(
    workspaceId: string,
    filter?: { contentProjectId?: string; contentSceneId?: string; event?: StoryboardAuditEvent },
  ): Promise<StoryboardAuditRow[]> {
    return this.rows
      .filter((row) => row.workspaceId === workspaceId)
      .filter((row) => !filter?.contentProjectId || row.contentProjectId === filter.contentProjectId)
      .filter((row) => !filter?.contentSceneId || row.contentSceneId === filter.contentSceneId)
      .filter((row) => !filter?.event || row.event === filter.event)
      .map((row) => ({ ...row }));
  }
}

// ── Dependencies ─────────────────────────────────────────────────────────────

export interface StoryboardDependencies {
  models: Pick<ModelsService, 'getVersion' | 'getActiveCharacterSheet' | 'getProtectedIdentityTraits'>;
  environments: Pick<EnvironmentsService, 'getVersion'>;
  library: Pick<LibraryService, 'getAsset'>;
  /**
   * The EXISTING generation services (prompts 27/28). Bridges receive the
   * created draft job id; results flow to Gallery through their ingestion.
   * identityTraits carry the protected Character Sheet baseline per model id;
   * references/assets feed the image eligibility checks; storyFrames carry
   * the ordered beat plan for grouped story runs.
   */
  submitImage(input: {
    jobId: string;
    workspaceId: string;
    userId: string;
    prompt: string;
    requireIdentityBaseline: Record<string, boolean>;
    identityTraits: Record<string, Record<string, unknown>>;
    references: Array<{ referenceId: string; uploadStatus: string }>;
    assets: Record<string, { id: string; status: string; rightsStatus: string }>;
  }): Promise<{ runId: string | null; eligible: boolean; blocking: string[] }>;
  submitVideo(input: {
    jobId: string;
    workspaceId: string;
    userId: string;
    prompt: string;
    mediaFlavor: 'video' | 'story';
    requireIdentityBaseline: Record<string, boolean>;
    identityTraits: Record<string, Record<string, unknown>>;
    durationSeconds: 4 | 6 | 8;
    aspectRatio: '9:16' | '1:1' | '16:9';
    outputCount: number;
    storyFrames?: Array<{ label: string; actionDescription: string }>;
  }): Promise<{ runId: string | null; eligible: boolean; blocking: string[] }>;
  /**
   * Optional pin persistence (real mode): writes the immutable job pin set
   * derived from the snapshot bindings so the generation services' own
   * loadPinsForJob resolves the locked versions server-side. Tests with
   * stub bridges omit this — eligibility stays stub-side.
   */
  persistJobPins?(input: {
    jobId: string;
    workspaceId: string;
    pins: Array<{
      pinType: 'model' | 'environment' | 'library_asset';
      sourceRecordId: string;
      sourceVersionId: string;
      resolvedDetails: Record<string, unknown>;
      role: 'primary_model' | 'environment' | 'look' | 'product' | 'prop' | 'wardrobe' | 'accessory' | 'creator_tool' | 'brand_asset' | 'reference' | 'other';
      sortOrder: number;
    }>;
  }): Promise<void>;
}

// ── Service ──────────────────────────────────────────────────────────────────

export class StoryboardService {
  constructor(
    private readonly content: ContentStudioService,
    private readonly deps: StoryboardDependencies,
    private readonly audit: StoryboardAuditStore,
    private readonly bindings: InMemorySceneBindingStore,
    private readonly handoffs: InMemoryHandoffStore,
  ) {}

  // ── Projects ───────────────────────────────────────────────────────────────

  async createContentProject(
    workspaceId: string,
    input: { name: string; brief?: string; objective?: string },
    actorId: string,
  ): Promise<ContentProjectRecord> {
    const project = await this.content.createProject(
      { workspaceId, name: input.name, ...(input.brief ? { campaignBrief: input.brief } : {}), ...(input.objective ? { objective: input.objective } : {}) },
      actorId,
    );
    await this.appendAudit(workspaceId, project.id, null, 'content_project_created', `Project "${project.name}" created.`);
    return project;
  }

  async updateContentProject(
    workspaceId: string,
    projectId: string,
    input: { name?: string; brief?: string; creativeDirection?: string },
    actorId: string,
  ): Promise<ContentProjectRecord> {
    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.brief !== undefined) patch.campaignBrief = input.brief;
    if (input.creativeDirection !== undefined) {
      // Prompt-bar input: classified but never validation-bypassing.
      patch.creativeDirection = classifyPromptIntent(input.creativeDirection).trimmed;
    }
    const updated = await this.content.updateProjectDraft(projectId, patch, workspaceId);
    await this.appendAudit(workspaceId, projectId, null, 'storyboard_updated', 'Project brief/direction updated.');
    void actorId;
    return updated;
  }

  // ── Scenes ─────────────────────────────────────────────────────────────────

  async createScene(
    workspaceId: string,
    projectId: string,
    input: { title: string; purpose?: string; settingNotes?: string; shotNotes?: string },
    actorId: string,
  ): Promise<ContentSceneRecord> {
    const scene = await this.content.createScene({ contentProjectId: projectId, ...input }, workspaceId);
    await this.appendAudit(workspaceId, projectId, scene.id, 'scene_created', `Scene "${scene.title}" added.`);
    void actorId;
    return scene;
  }

  async updateScene(
    workspaceId: string,
    sceneId: string,
    input: { title?: string; purpose?: string; settingNotes?: string; shotNotes?: string },
    actorId: string,
  ): Promise<ContentSceneRecord> {
    const updated = await this.content.updateScene(sceneId, input, workspaceId);
    await this.appendAudit(workspaceId, updated.contentProjectId, sceneId, 'storyboard_updated', `Scene "${updated.title}" updated.`);
    void actorId;
    return updated;
  }

  async deleteScene(workspaceId: string, sceneId: string, actorId: string): Promise<void> {
    const scene = await this.content.getScene(sceneId, workspaceId);
    await this.content.deleteScene(sceneId, workspaceId);
    await this.appendAudit(workspaceId, scene.contentProjectId, sceneId, 'storyboard_updated', `Scene "${scene.title}" removed (with its beats).`);
    void actorId;
  }

  async reorderScenes(
    workspaceId: string,
    projectId: string,
    orderedSceneIds: string[],
    actorId: string,
  ): Promise<void> {
    await this.content.reorderScenes(projectId, orderedSceneIds, workspaceId);
    await this.appendAudit(workspaceId, projectId, null, 'scene_reordered', `Scenes reordered (${orderedSceneIds.length}).`);
    void actorId;
  }

  // ── Beats ──────────────────────────────────────────────────────────────────

  async createBeat(
    workspaceId: string,
    sceneId: string,
    input: {
      title: string;
      actionDescription?: string;
      cameraDirection?: string;
      beatType?: StoryboardBeatType;
      motionConfig?: Record<string, unknown> | null;
      durationSeconds?: number;
    },
    actorId: string,
  ): Promise<ContentBeatRecord> {
    const beat = await this.content.createBeat({ contentSceneId: sceneId, ...input }, workspaceId);
    const scene = await this.content.getScene(sceneId, workspaceId);
    await this.appendAudit(workspaceId, scene.contentProjectId, sceneId, 'beat_created', `Beat "${beat.title}" added.`);
    void actorId;
    return beat;
  }

  async updateBeat(
    workspaceId: string,
    beatId: string,
    input: { title?: string; actionDescription?: string; cameraDirection?: string; beatType?: StoryboardBeatType; motionConfig?: Record<string, unknown> | null },
    actorId: string,
  ): Promise<ContentBeatRecord> {
    const updated = await this.content.updateBeat(beatId, input, workspaceId);
    const scene = await this.content.getScene(updated.contentSceneId, workspaceId);
    await this.appendAudit(workspaceId, scene.contentProjectId, scene.id, 'storyboard_updated', `Beat "${updated.title}" updated.`);
    void actorId;
    return updated;
  }

  async deleteBeat(workspaceId: string, beatId: string, actorId: string): Promise<void> {
    const beat = await this.content.getBeat(beatId, workspaceId);
    await this.content.deleteBeat(beatId, workspaceId);
    const scene = await this.content.getScene(beat.contentSceneId, workspaceId);
    await this.appendAudit(workspaceId, scene.contentProjectId, scene.id, 'storyboard_updated', `Beat "${beat.title}" removed.`);
    void actorId;
  }

  async reorderBeats(
    workspaceId: string,
    sceneId: string,
    orderedBeatIds: string[],
    actorId: string,
  ): Promise<void> {
    await this.content.reorderBeats(sceneId, orderedBeatIds, workspaceId);
    const scene = await this.content.getScene(sceneId, workspaceId);
    await this.appendAudit(workspaceId, scene.contentProjectId, sceneId, 'beat_reordered', `Beats reordered (${orderedBeatIds.length}).`);
    void actorId;
  }

  // ── Version-pinned bindings ────────────────────────────────────────────────

  /**
   * Pins a locked model/environment version or Library asset to a scene.
   * Ownership is validated server-side; cross-workspace refs are rejected.
   */
  async bindSceneAsset(
    workspaceId: string,
    sceneId: string,
    input: { kind: SceneBindingKind; refId: string; role?: string },
    actorId: string,
  ): Promise<SceneAssetBindingRecord> {
    const scene = await this.content.getScene(sceneId, workspaceId);
    let label = '';
    if (input.kind === 'model_version') {
      const version = await this.deps.models.getVersion(input.refId, workspaceId);
      const sheet = await this.deps.models.getActiveCharacterSheet(version.modelId, workspaceId);
      label = `Model v${version.versionNumber}${sheet?.identitySummary ? ' — identity governed' : ''}`;
    } else if (input.kind === 'environment_version') {
      const version = await this.deps.environments.getVersion(input.refId, workspaceId);
      label = `Environment v${version.versionNumber}`;
    } else {
      const asset = await this.deps.library.getAsset(input.refId, workspaceId);
      label = asset.name;
    }
    const record = await this.bindings.save({
      id: `scenebind_${crypto.randomUUID()}`,
      workspaceId,
      contentSceneId: sceneId,
      kind: input.kind,
      refId: input.refId,
      label,
      role: input.role ?? null,
      createdBy: actorId,
      createdAt: new Date().toISOString(),
    });
    await this.appendAudit(workspaceId, scene.contentProjectId, sceneId, 'storyboard_updated', `${record.label} pinned to scene.`);
    return record;
  }

  async unbindSceneAsset(workspaceId: string, sceneId: string, bindingId: string, actorId: string): Promise<void> {
    const scene = await this.content.getScene(sceneId, workspaceId);
    await this.bindings.remove(sceneId, bindingId);
    await this.appendAudit(workspaceId, scene.contentProjectId, sceneId, 'storyboard_updated', 'Scene binding removed.');
    void actorId;
  }

  async listSceneBindings(workspaceId: string, sceneId: string): Promise<SceneAssetBindingRecord[]> {
    await this.content.getScene(sceneId, workspaceId);
    return this.bindings.list(sceneId);
  }

  /** Applies a prompt-bar note to the project direction (safe, classified). */
  async applyPromptBarNote(
    workspaceId: string,
    projectId: string,
    text: string,
    actorId: string,
  ): Promise<{ intent: string; project: ContentProjectRecord }> {
    const classified = classifyPromptIntent(text);
    const project = await this.updateContentProject(
      workspaceId,
      projectId,
      { creativeDirection: `[${classified.intent}] ${classified.trimmed}`.slice(0, 2000) },
      actorId,
    );
    return { intent: classified.intent, project };
  }

  // ── Generation handoff ─────────────────────────────────────────────────────

  /**
   * Builds the locked scene/storyboard snapshot: scene + beats + bindings,
   * every binding re-validated server-side at capture time.
   */
  async buildSceneGenerationSnapshot(
    workspaceId: string,
    sceneId: string,
    generationType: SceneGenerationType,
    actorId: string,
  ): Promise<SceneGenerationSnapshot> {
    const scene = await this.content.getScene(sceneId, workspaceId);
    const beats = await this.content.listBeats(sceneId, workspaceId);
    const bindingRecords = await this.bindings.list(sceneId);
    // Re-resolve labels at capture time (ownership re-checked implicitly —
    // a stale/foreign binding fails resolution and is recorded honestly).
    const bindings: SceneGenerationSnapshot['bindings'] = [];
    for (const binding of bindingRecords) {
      try {
        bindings.push(await this.resolveBinding(workspaceId, binding));
      } catch {
        bindings.push({ kind: binding.kind, refId: binding.refId, label: `${binding.label} (unavailable)`, role: binding.role });
      }
    }

    const snapshot: SceneGenerationSnapshot = {
      scene,
      beats: beats.map((beat) => ({
        id: beat.id,
        title: beat.title,
        beatOrder: beat.beatOrder,
        beatType: beat.beatType,
        cameraDirection: beat.cameraDirection,
        motionConfig: beat.motionConfig,
        durationSeconds: beat.durationSeconds,
      })),
      bindings,
      generationType,
      promptBarNotes: scene ? [] : [],
      assembledPrompt: assembleGenerationPrompt(scene, beats),
      capturedAt: new Date().toISOString(),
    };
    await this.handoffs.save({
      id: `handoff_${crypto.randomUUID()}`,
      workspaceId,
      contentSceneId: sceneId,
      generationType,
      snapshot,
      contentJobRequestId: null,
      status: 'snapshot_created',
      createdBy: actorId,
      createdAt: new Date().toISOString(),
    });
    await this.appendAudit(workspaceId, scene.contentProjectId, sceneId, 'scene_generation_snapshot_created', `Locked storyboard snapshot captured (${generationType}).`);
    return snapshot;
  }

  /**
   * Generation readiness. Model-based scenes require the Character Sheet
   * baseline; blockers are safe, product-friendly strings.
   */
  async validateSceneForGeneration(
    workspaceId: string,
    sceneId: string,
    generationType: SceneGenerationType,
  ): Promise<{ ready: boolean; blockers: string[]; modelGoverned: boolean }> {
    const scene = await this.content.getScene(sceneId, workspaceId);
    const beats = await this.content.listBeats(sceneId, workspaceId);
    const bindingRecords = await this.bindings.list(sceneId);

    let characterSheetOk = true;
    for (const binding of bindingRecords.filter((record) => record.kind === 'model_version')) {
      try {
        const version = await this.deps.models.getVersion(binding.refId, workspaceId);
        const sheet = await this.deps.models.getActiveCharacterSheet(version.modelId, workspaceId);
        const traitGroups = sheet
          ? [sheet.faceFeatures, sheet.hairIdentity, sheet.complexion, sheet.bodyProportions, sheet.distinctiveDetails]
          : [];
        if (!sheet || sheet.identitySummary.trim().length === 0 || traitGroups.every((group) => Object.keys(group ?? {}).length === 0)) {
          characterSheetOk = false;
        }
      } catch {
        characterSheetOk = false;
      }
    }

    const check = validateSceneForGenerationRules({
      scene,
      beats,
      bindings: bindingRecords,
      characterSheetOk,
      generationType,
    });
    if (!check.ready) {
      await this.appendAudit(workspaceId, scene.contentProjectId, sceneId, 'scene_generation_validation_blocked', check.blockers.join(' '));
    }
    return check;
  }

  /**
   * Controlled handoff: validate → snapshot → draft content job → the
   * EXISTING prompt-27/28 generation services. Results flow to Gallery
   * through their ingestion; nothing here publishes or bypasses guards.
   */
  async submitSceneGeneration(
    workspaceId: string,
    sceneId: string,
    generationType: Exclude<SceneGenerationType, 'content_set'>,
    actorId: string,
  ): Promise<{ jobId: string; runId: string | null; eligible: boolean; blocking: string[]; snapshot: SceneGenerationSnapshot }> {
    const check = await this.validateSceneForGeneration(workspaceId, sceneId, generationType);
    if (!check.ready) {
      throw new Error(`Scene is not ready for generation: ${check.blockers[0]}`);
    }
    const snapshot = await this.buildSceneGenerationSnapshot(workspaceId, sceneId, generationType, actorId);

    const job = await this.content.createDraftJobRequest(
      {
        workspaceId,
        name: `Scene — ${snapshot.scene.title}`,
        requestedOutputType: generationType === 'image' ? 'photo' : generationType,
        requestedVariants: 1,
        briefSnapshot: {
          source: 'storyboard_scene_handoff',
          contentSceneId: sceneId,
          generationType,
          capturedAt: snapshot.capturedAt,
          prompt: snapshot.assembledPrompt,
        },
        planSnapshot: {
          scene: snapshot.scene,
          beats: snapshot.beats,
          bindings: snapshot.bindings,
        },
      },
      actorId,
      workspaceId,
    );

    const requireIdentityBaseline: Record<string, boolean> = {};
    const identityTraits: Record<string, Record<string, unknown>> = {};
    let blocking: string[] = [];
    for (const binding of snapshot.bindings) {
      if (binding.kind !== 'model_version') continue;
      // Protected identity baseline (prompt 26) — the authoritative traits
      // the generation service checks the run against. Keyed by MODEL id
      // (the pin's sourceRecordId), resolved through the pinned version.
      const version = await this.deps.models.getVersion(binding.refId, workspaceId).catch(() => null);
      if (!version) continue;
      requireIdentityBaseline[version.modelId] = true;
      const traits = await this.deps.models.getProtectedIdentityTraits(version.modelId, workspaceId).catch(() => []);
      if (traits.length > 0) {
        identityTraits[version.modelId] = Object.fromEntries(traits.map((trait) => [trait.traitKey, trait.traitValue]));
      }
    }
    const prompt = snapshot.assembledPrompt;

    // Persist the immutable job pin set (real mode) BEFORE submission so the
    // generation services resolve the locked versions server-side through
    // their own loadPinsForJob. A pin failure blocks the handoff — never a
    // silent downgrade to unpinned generation.
    if (this.deps.persistJobPins) {
      try {
        await this.deps.persistJobPins({ jobId: job.id, workspaceId, pins: await this.buildJobPins(workspaceId, snapshot) });
      } catch (err) {
        blocking = [err instanceof Error ? err.message : 'Could not pin the locked inputs to the generation job.'];
        await this.appendAudit(workspaceId, snapshot.scene.contentProjectId, sceneId, 'scene_generation_validation_blocked', `Pin persistence failed: ${blocking[0]}`);
        await this.handoffs.update((await this.handoffs.listForScene(sceneId)).slice(-1)[0]?.id ?? '', { status: 'failed', contentJobRequestId: job.id });
        return { jobId: job.id, runId: null, eligible: false, blocking, snapshot };
      }
    }

    let runId: string | null = null;
    let eligible = false;
    try {
      if (generationType === 'image') {
        const result = await this.deps.submitImage({
          jobId: job.id,
          workspaceId,
          userId: actorId,
          prompt,
          requireIdentityBaseline,
          identityTraits,
          references: [],
          assets: {},
        });
        runId = result.runId;
        eligible = result.eligible;
        blocking = result.blocking;
      } else {
        const isStory = generationType === 'story';
        const result = await this.deps.submitVideo({
          jobId: job.id,
          workspaceId,
          userId: actorId,
          prompt,
          mediaFlavor: isStory ? 'story' : 'video',
          requireIdentityBaseline,
          identityTraits,
          durationSeconds: 6,
          aspectRatio: '9:16',
          outputCount: isStory ? Math.max(1, Math.min(snapshot.beats.length, 4)) : 1,
          ...(isStory
            ? {
                storyFrames: snapshot.beats.map((beat, index) => ({
                  label: beat.title || `Frame ${index + 1}`,
                  actionDescription: [beat.cameraDirection, beat.beatType !== 'action' ? beat.beatType : null]
                    .filter((bit): bit is string => Boolean(bit))
                    .join(' — ') || beat.title,
                })),
              }
            : {}),
        });
        runId = result.runId;
        eligible = result.eligible;
        blocking = result.blocking;
      }
    } catch (err) {
      blocking = [err instanceof Error ? err.message : 'Generation submission failed.'];
    }

    // Attach the job to the newest handoff record for traceability.
    const handoffs = await this.handoffs.listForScene(sceneId);
    const handoff = handoffs[handoffs.length - 1];
    if (handoff) {
      await this.handoffs.update(handoff.id, {
        status: eligible ? 'submitted' : 'failed',
        contentJobRequestId: job.id,
      });
    }

    if (eligible) {
      await this.appendAudit(workspaceId, snapshot.scene.contentProjectId, sceneId, 'scene_generation_submitted', `${generationType} generation submitted (job ${job.id.slice(0, 12)}…).`);
    } else {
      await this.appendAudit(workspaceId, snapshot.scene.contentProjectId, sceneId, 'scene_generation_validation_blocked', `Submission blocked: ${blocking[0] ?? 'unknown'}`);
    }
    return { jobId: job.id, runId, eligible, blocking, snapshot };
  }

  async listSceneHandoffs(workspaceId: string, sceneId: string): Promise<SceneGenerationHandoffRecord[]> {
    await this.content.getScene(sceneId, workspaceId);
    return this.handoffs.listForScene(sceneId);
  }

  async listAudit(
    workspaceId: string,
    filter?: { contentProjectId?: string; contentSceneId?: string; event?: StoryboardAuditEvent },
  ): Promise<StoryboardAuditRow[]> {
    return this.audit.list(workspaceId, filter);
  }

  /** Internal: list scenes of a project through the existing service. */
  async listProjectScenes(workspaceId: string, projectId: string): Promise<ContentSceneRecord[]> {
    return this.content.listScenes(projectId, workspaceId);
  }

  /** Internal: list beats of a scene through the existing service. */
  async listSceneBeats(workspaceId: string, sceneId: string): Promise<ContentBeatRecord[]> {
    return this.content.listBeats(sceneId, workspaceId);
  }

  // ── internals ───────────────────────────────────────────────────────────────

  /**
   * Derives the immutable job pin set from the snapshot bindings (same shape
   * the existing createJobPinsFromProject writes: pinType WITHOUT the
   * _version suffix, sourceRecord = parent record, sourceVersion = pinned
   * version, resolvedDetails carries the minimal reproducibility context).
   * Every referenced version must be locked — an unlocked pin is refused.
   */
  private async buildJobPins(
    workspaceId: string,
    snapshot: SceneGenerationSnapshot,
  ): Promise<Array<{
    pinType: 'model' | 'environment' | 'library_asset';
    sourceRecordId: string;
    sourceVersionId: string;
    resolvedDetails: Record<string, unknown>;
    role: 'primary_model' | 'environment' | 'look' | 'product' | 'prop' | 'wardrobe' | 'accessory' | 'creator_tool' | 'brand_asset' | 'reference' | 'other';
    sortOrder: number;
  }>> {
    const pins: Awaited<ReturnType<StoryboardService['buildJobPins']>> = [];
    let sortOrder = 0;
    for (const binding of snapshot.bindings) {
      const role = (binding.role as (typeof pins)[number]['role'] | null) ?? (binding.kind === 'model_version' ? 'primary_model' : binding.kind === 'environment_version' ? 'environment' : 'other');
      if (binding.kind === 'model_version') {
        const version = await this.deps.models.getVersion(binding.refId, workspaceId);
        if (version.status !== 'locked') {
          throw new Error(`Model version v${version.versionNumber} is ${version.status}; only locked versions can be pinned to a generation job.`);
        }
        pins.push({
          pinType: 'model',
          sourceRecordId: version.modelId,
          sourceVersionId: version.id,
          resolvedDetails: { versionNumber: version.versionNumber, versionStatus: version.status, lockedAt: version.lockedAt },
          role,
          sortOrder: sortOrder++,
        });
      } else if (binding.kind === 'environment_version') {
        const version = await this.deps.environments.getVersion(binding.refId, workspaceId);
        if (version.status !== 'locked') {
          throw new Error(`Environment version v${version.versionNumber} is ${version.status}; only locked versions can be pinned to a generation job.`);
        }
        pins.push({
          pinType: 'environment',
          sourceRecordId: version.environmentId,
          sourceVersionId: version.id,
          resolvedDetails: { versionNumber: version.versionNumber, versionStatus: version.status, lockedAt: version.lockedAt },
          role,
          sortOrder: sortOrder++,
        });
      } else {
        const asset = await this.deps.library.getAsset(binding.refId, workspaceId);
        if (asset.status === 'archived') {
          throw new Error(`Library asset "${asset.name}" is archived and cannot be pinned to a generation job.`);
        }
        pins.push({
          pinType: 'library_asset',
          sourceRecordId: asset.id,
          sourceVersionId: asset.activeVersionId ?? asset.id,
          resolvedDetails: { assetName: asset.name, assetType: asset.assetType, rightsStatus: asset.metadata?.rightsStatus ?? 'unknown' },
          role,
          sortOrder: sortOrder++,
        });
      }
    }
    return pins;
  }

  private async resolveBinding(
    workspaceId: string,
    binding: SceneAssetBindingRecord,
  ): Promise<SceneGenerationSnapshot['bindings'][number]> {
    if (binding.kind === 'model_version') {
      const version = await this.deps.models.getVersion(binding.refId, workspaceId);
      const sheet = await this.deps.models.getActiveCharacterSheet(version.modelId, workspaceId);
      const label = `Model v${version.versionNumber}${sheet?.identitySummary ? ' — identity governed' : ''}`;
      return { kind: binding.kind, refId: binding.refId, label, role: binding.role };
    }
    if (binding.kind === 'environment_version') {
      const version = await this.deps.environments.getVersion(binding.refId, workspaceId);
      return { kind: binding.kind, refId: binding.refId, label: `Environment v${version.versionNumber}`, role: binding.role };
    }
    const asset = await this.deps.library.getAsset(binding.refId, workspaceId);
    return { kind: binding.kind, refId: binding.refId, label: asset.name, role: binding.role };
  }

  /** Best-effort audit — never masks the primary operation's outcome. */
  private async appendAudit(
    workspaceId: string,
    contentProjectId: string | null,
    contentSceneId: string | null,
    event: StoryboardAuditEvent,
    detail: string,
  ): Promise<void> {
    try {
      await this.audit.append({ workspaceId, contentProjectId, contentSceneId, event, detail });
    } catch {
      // Audit failure must not break the primary operation.
    }
  }
}


