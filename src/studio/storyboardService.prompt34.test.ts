/**
 * Prompt 34 — Content Studio storyboard: scenes, beats, prompt bar and
 * locked generation handoff. Service-boundary tests over the existing
 * MockContentRepository (scenes/beats CRUD) with stub generation bridges:
 *
 *   1. Scenes/beats can be added, edited, reordered and safely removed.
 *   2. Locked model/environment/Library versions are pinned and preserved in
 *      the generation snapshot.
 *   3. Model-based scenes require the Character Sheet identity baseline —
 *      the prompt bar can never bypass it.
 *   4. Generation handoff creates a snapshot + draft job and submits through
 *      the existing generation bridges (results flow to Gallery there).
 *   5. Cross-workspace project/asset references are rejected; audit is safe.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { ContentStudioService } from '../services/contentService';
import { MockContentRepository } from '../data/mockContentRepository';
import { LibraryService } from '../services/libraryService';
import { getLibraryRepository } from '../data/libraryFactory';
import { ModelsService } from '../services/modelsService';
import { MockModelsRepository } from '../data/mockModelsRepository';
import { EnvironmentsService } from '../services/environmentsService';
import { MockEnvironmentsRepository } from '../data/mockEnvironmentsRepository';
import {
  StoryboardService,
  InMemorySceneBindingStore,
  InMemoryHandoffStore,
  InMemoryStoryboardAuditStore,
} from './storyboardService';
import type { StoryboardDependencies } from './storyboardService';
import {
  assembleGenerationPrompt,
  classifyPromptIntent,
  normalizeOrder,
} from './storyboardWorkflow';

const WS = 'ws_demo';
const OTHER_WS = 'ws_other';
const USER = 'storyboard-user';

function makeDeps(overrides: Partial<StoryboardDependencies> = {}) {
  const models = new ModelsService(new MockModelsRepository());
  const environments = new EnvironmentsService(new MockEnvironmentsRepository());
  const library = new LibraryService(getLibraryRepository());
  const submitted: Array<{ kind: 'image' | 'video' | 'story'; jobId: string; prompt: string }> = [];
  const deps: StoryboardDependencies = {
    models,
    environments,
    library,
    submitImage: async (input) => {
      submitted.push({ kind: 'image', jobId: input.jobId, prompt: input.prompt });
      return { runId: `run_${crypto.randomUUID()}`, eligible: true, blocking: [] };
    },
    submitVideo: async (input) => {
      submitted.push({ kind: input.mediaFlavor, jobId: input.jobId, prompt: input.prompt });
      return { runId: `run_${crypto.randomUUID()}`, eligible: true, blocking: [] };
    },
    ...overrides,
  };
  return { deps, models, environments, library, submitted };
}

function makeStack(overrides: Partial<StoryboardDependencies> = {}) {
  const content = new ContentStudioService(new MockContentRepository(), {
    library: new LibraryService(getLibraryRepository()),
    models: new ModelsService(new MockModelsRepository()),
    environments: new EnvironmentsService(new MockEnvironmentsRepository()),
  });
  const { deps, models, environments, library, submitted } = makeDeps(overrides);
  const audit = new InMemoryStoryboardAuditStore();
  const bindings = new InMemorySceneBindingStore();
  const handoffs = new InMemoryHandoffStore();
  const storyboard = new StoryboardService(content, deps, audit, bindings, handoffs);
  return { storyboard, content, audit, bindings, handoffs, models, environments, library, submitted, deps };
}

/** A project + scene + one beat with a filled model identity. */
async function makeGovernedScene(stack: ReturnType<typeof makeStack>) {
  const { storyboard, models } = stack;
  const project = await storyboard.createContentProject(WS, { name: 'Spring drop' }, USER);
  const scene = await storyboard.createScene(WS, project.id, {
    title: 'Opening frame',
    purpose: 'Introduce the model in the studio',
  }, USER);
  // A model with a full Character Sheet baseline.
  const model = await models.createModel({ workspaceId: WS, name: 'Ava' }, USER);
  const versions = await models.getVersions(model.id, WS);
  const version = versions[versions.length - 1]!;
  await models.updateCharacterSheet(version.id, {
    identitySummary: 'Adult woman, early 30s',
    faceFeatures: { faceShape: 'oval' },
    hairIdentity: { color: 'dark brown' },
    complexion: { tone: 'medium warm' },
    bodyProportions: { height: '175cm' },
    distinctiveDetails: { marks: 'scar above left brow' },
  }, WS);
  await storyboard.bindSceneAsset(WS, scene.id, { kind: 'model_version', refId: version.id, role: 'hero' }, USER);
  await storyboard.createBeat(WS, scene.id, {
    title: 'Turn to camera',
    actionDescription: 'She turns and holds the look',
    cameraDirection: 'Eye level, medium close',
  }, USER);
  return { project, scene, modelVersionId: version.id };
}

describe('prompt bar and ordering (pure)', () => {
  it('classifies prompt-bar intents and normalizes order without collisions', () => {
    expect(classifyPromptIntent('Explain the scene mood').intent).toBe('explain_scene');
    expect(classifyPromptIntent('variation with warmer light').intent).toBe('request_variation');
    expect(classifyPromptIntent('generate the opening frame').intent).toBe('generation_intent');
    expect(classifyPromptIntent('note: keep product centered').intent).toBe('note');

    // Reorders compact positions; unknown ids never collide with existing.
    expect(normalizeOrder(['b', 'a'], ['a', 'b', 'c'])).toEqual([
      { id: 'b', order: 0 },
      { id: 'a', order: 1 },
      { id: 'c', order: 2 },
    ]);
  });

  it('assembles a safe generation prompt from scene + beats', () => {
    const prompt = assembleGenerationPrompt(
      { purpose: 'Introduce the model', settingNotes: 'Studio loft' } as never,
      [{ title: 'Turn', actionDescription: 'holds look', cameraDirection: 'MCU' } as never],
    );
    expect(prompt).toContain('Introduce the model');
    expect(prompt).toContain('Turn');
    expect(prompt.length).toBeLessThanOrEqual(4000);
  });
});

describe('storyboard workflow', () => {
  let stack: ReturnType<typeof makeStack>;
  beforeEach(() => { stack = makeStack(); });

  it('adds, edits, reorders and safely removes scenes and beats', async () => {
    const { storyboard } = stack;
    const project = await storyboard.createContentProject(WS, { name: 'Drop' }, USER);
    const s1 = await storyboard.createScene(WS, project.id, { title: 'One' }, USER);
    const s2 = await storyboard.createScene(WS, project.id, { title: 'Two' }, USER);
    await storyboard.reorderScenes(WS, project.id, [s2.id, s1.id], USER);
    const scenes = await storyboard.listProjectScenes(WS, project.id);
    expect(scenes.map((scene) => scene.id)).toEqual([s2.id, s1.id]);
    expect(scenes.map((scene) => scene.sceneOrder)).toEqual([0, 1]);

    const b1 = await storyboard.createBeat(WS, s1.id, { title: 'A' }, USER);
    const b2 = await storyboard.createBeat(WS, s1.id, { title: 'B', beatType: 'camera', motionConfig: { movement: 'dolly_in' } }, USER);
    await storyboard.reorderBeats(WS, s1.id, [b2.id, b1.id], USER);
    const beats = await storyboard.listSceneBeats(WS, s1.id);
    expect(beats.map((beat) => beat.id)).toEqual([b2.id, b1.id]);
    expect(beats[0]?.beatType).toBe('camera');
    expect(beats[0]?.motionConfig).toEqual({ movement: 'dolly_in' });

    await storyboard.updateBeat(WS, b1.id, { actionDescription: 'Updated action' }, USER);
    await storyboard.deleteBeat(WS, b2.id, USER);
    expect((await storyboard.listSceneBeats(WS, s1.id))).toHaveLength(1);

    // Safe scene removal cascades its beats through the existing service.
    await storyboard.deleteScene(WS, s2.id, USER);
    expect((await storyboard.listProjectScenes(WS, project.id)).map((scene) => scene.id)).toEqual([s1.id]);

    const events = (await stack.audit.list(WS)).map((row) => row.event);
    expect(events).toContain('scene_created');
    expect(events).toContain('scene_reordered');
    expect(events).toContain('beat_created');
    expect(events).toContain('beat_reordered');
    expect(events).toContain('storyboard_updated');
  });

  it('pins locked versions with server-side ownership validation', async () => {
    const { storyboard, models, environments, library } = stack;
    const { scene, modelVersionId } = await makeGovernedScene(stack);

    const environment = await environments.createEnvironment({ workspaceId: WS, name: 'Loft' }, USER);
    const envVersions = await environments.getVersions(environment.id, WS);
    const envBinding = await storyboard.bindSceneAsset(WS, scene.id, {
      kind: 'environment_version', refId: envVersions[envVersions.length - 1]!.id,
    }, USER);
    expect(envBinding.label).toContain('Environment v');

    const libraryAssets = await library.listAssets(WS);
    const assetBinding = await storyboard.bindSceneAsset(WS, scene.id, {
      kind: 'library_asset', refId: libraryAssets[0]!.id, role: 'product',
    }, USER);
    expect(assetBinding.label.length).toBeGreaterThan(0);

    // Cross-workspace model versions are rejected loudly.
    const foreign = await models.createModel({ workspaceId: OTHER_WS, name: 'Foreign' }, USER);
    const foreignVersions = await models.getVersions(foreign.id, OTHER_WS);
    await expect(
      storyboard.bindSceneAsset(WS, scene.id, { kind: 'model_version', refId: foreignVersions[0]!.id }, USER),
    ).rejects.toThrow();

    const bindings = await storyboard.listSceneBindings(WS, scene.id);
    expect(bindings.some((binding) => binding.refId === modelVersionId)).toBe(true);

    // Snapshot preserves the version pins with resolved labels.
    const snapshot = await storyboard.buildSceneGenerationSnapshot(WS, scene.id, 'image', USER);
    expect(snapshot.bindings.some((binding) => binding.kind === 'model_version' && binding.label.includes('identity'))).toBe(true);
    expect(snapshot.bindings.some((binding) => binding.kind === 'environment_version')).toBe(true);
    expect(snapshot.bindings.some((binding) => binding.kind === 'library_asset')).toBe(true);
    expect(JSON.stringify(snapshot)).not.toMatch(/storage|\.png|\.jpg/i);
  });

  it('blocks generation for scenes without an identity baseline; prompt bar cannot bypass', async () => {
    const { storyboard, models } = stack;
    const project = await storyboard.createContentProject(WS, { name: 'Drop' }, USER);
    const scene = await storyboard.createScene(WS, project.id, { title: 'Portrait' }, USER);
    const emptyModel = await models.createModel({ workspaceId: WS, name: 'Empty sheet' }, USER);
    const emptyVersions = await models.getVersions(emptyModel.id, WS);
    const version = emptyVersions[emptyVersions.length - 1]!;
    await storyboard.bindSceneAsset(WS, scene.id, { kind: 'model_version', refId: version.id }, USER);
    await storyboard.createBeat(WS, scene.id, { title: 'Look', actionDescription: 'hold' }, USER);

    // Prompt-bar intent recorded, but the baseline gate still blocks.
    await storyboard.applyPromptBarNote(WS, project.id, 'generate the portrait now', USER);
    const check = await storyboard.validateSceneForGeneration(WS, scene.id, 'image');
    expect(check.ready).toBe(false);
    expect(check.blockers.join(' ')).toMatch(/Character Sheet identity baseline/i);
    await expect(storyboard.submitSceneGeneration(WS, scene.id, 'image', USER)).rejects.toThrow(/not ready/i);

    const events = (await stack.audit.list(WS)).map((row) => row.event);
    expect(events).toContain('scene_generation_validation_blocked');
  });

  it('hands ready scenes off through the existing generation services', async () => {
    const { storyboard, submitted } = stack;
    const { scene, project } = await makeGovernedScene(stack);

    const image = await storyboard.submitSceneGeneration(WS, scene.id, 'image', USER);
    expect(image.eligible).toBe(true);
    expect(image.jobId).toBeTruthy();
    expect(image.runId).toBeTruthy();
    expect(image.snapshot.beats).toHaveLength(1);
    expect(submitted[0]?.kind).toBe('image');
    expect(submitted[0]?.prompt).toContain('Introduce the model');

    const video = await storyboard.submitSceneGeneration(WS, scene.id, 'video', USER);
    expect(video.eligible).toBe(true);
    expect(submitted.some((entry) => entry.kind === 'video')).toBe(true);

    // Full content sets are routed to the campaign orchestrator, refused here.
    await expect(storyboard.validateSceneForGeneration(WS, scene.id, 'content_set')).resolves.toMatchObject({ ready: false });

    const handoffs = await storyboard.listSceneHandoffs(WS, scene.id);
    expect(handoffs.length).toBeGreaterThanOrEqual(2);
    expect(handoffs.every((row) => row.snapshot.scene.id === scene.id)).toBe(true);

    const events = (await stack.audit.list(WS)).map((row) => row.event);
    expect(events).toContain('scene_generation_snapshot_created');
    expect(events).toContain('scene_generation_submitted');
    expect(project.id).toBeTruthy();
  });
});

describe('workspace security', () => {
  let stack: ReturnType<typeof makeStack>;
  beforeEach(() => { stack = makeStack(); });

  it('rejects cross-workspace project access and records a safe audit trail', async () => {
    const { storyboard, audit } = stack;
    const { scene, project } = await makeGovernedScene(stack);

    await expect(storyboard.createScene(OTHER_WS, project.id, { title: 'X' }, USER)).rejects.toThrow();
    await expect(storyboard.validateSceneForGeneration(OTHER_WS, scene.id, 'image')).rejects.toThrow();
    await expect(storyboard.buildSceneGenerationSnapshot(OTHER_WS, scene.id, 'image', USER)).rejects.toThrow();

    const rows = await audit.list(WS);
    const details = rows.map((row) => row.detail ?? '').join(' ');
    expect(details).not.toMatch(/storage|secret|token/i);
    expect(rows.every((row) => row.workspaceId === WS)).toBe(true);
    expect(await audit.list(OTHER_WS)).toHaveLength(0);
  });
});
