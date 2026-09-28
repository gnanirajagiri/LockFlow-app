/**
 * Content Studio service rules — the product contracts, tested at the service
 * boundary over fresh mock repositories (reset per test for isolation).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { ContentStudioService } from './contentService';
import type { ContentStudioBridges } from './contentService';
import { LibraryService } from './libraryService';
import { ModelsService } from './modelsService';
import { EnvironmentsService } from './environmentsService';
import {
  getContentRepository,
  resetContentRepository,
} from '../data/contentFactory';
import { getLibraryRepository, resetLibraryRepository } from '../data/libraryFactory';
import { getModelsRepository, resetModelsRepository } from '../data';
import { getEnvironmentsRepository, resetEnvironmentsRepository } from '../data/environmentsFactory';
import { CONTENT_JOB_REQUEST_ID, CONTENT_PROJECT_ID } from '../mock/contentSeed';
import { SEED_LIBRARY_OTHER_WORKSPACE_ID, SEED_LIBRARY_WORKSPACE_ID } from '../mock/librarySeed';

let service: ContentStudioService;
let workspaceId: string;

beforeEach(() => {
  resetContentRepository();
  resetLibraryRepository();
  resetModelsRepository();
  resetEnvironmentsRepository();

  const bridges: ContentStudioBridges = {
    library: new LibraryService(getLibraryRepository()),
    models: new ModelsService(getModelsRepository()),
    environments: new EnvironmentsService(getEnvironmentsRepository()),
  };
  service = new ContentStudioService(getContentRepository(), bridges);
  workspaceId = SEED_LIBRARY_WORKSPACE_ID;
});

describe('rule 1 — cross-workspace records cannot be selected', () => {
  it('refuses a project input pointing at another workspace\u2019s Library asset', async () => {
    await expect(
      service.addProjectInput(
        {
          contentProjectId: CONTENT_PROJECT_ID,
          inputType: 'library_asset',
          libraryAssetId: 'lib_other_ws_prop',
          libraryAssetVersionId: 'libver_other_v1',
          role: 'prop',
        },
        workspaceId,
      ),
    ).rejects.toThrow(/Cross-workspace access denied/);
  });

  it('refuses creating a project from another workspace via workspace checks', async () => {
    const project = await service.createProject(
      { workspaceId: SEED_LIBRARY_OTHER_WORKSPACE_ID, name: 'Other ws plan' },
      'tester',
    );
    await expect(service.getProject(project.id, workspaceId)).rejects.toThrow(
      /Cross-workspace access denied/,
    );
  });

  it('records the exact selected version, validating it belongs to the record', async () => {
    // A model version id that does not exist must be refused outright.
    await expect(
      service.addProjectInput(
        {
          contentProjectId: CONTENT_PROJECT_ID,
          inputType: 'model',
          modelId: 'model_aisha',
          modelVersionId: 'mv_does_not_exist',
          role: 'primary_model',
        },
        workspaceId,
      ),
    ).rejects.toThrow(/not found/i);
  });
});

describe('rule 2 — scene and beat order is maintained safely', () => {
  it('appends scenes in order and reorders by explicit id list', async () => {
    const scenes = await service.listScenes(CONTENT_PROJECT_ID, workspaceId);
    expect(scenes.map((scene) => scene.sceneOrder)).toEqual([0, 1, 2]);

    const reversed = [...scenes].reverse().map((scene) => scene.id);
    await service.reorderScenes(CONTENT_PROJECT_ID, reversed, workspaceId);
    const after = await service.listScenes(CONTENT_PROJECT_ID, workspaceId);
    expect(after.map((scene) => scene.title)).toEqual(['Routine wrap-up', 'Product moment', 'Morning setup']);
    expect(after.map((scene) => scene.sceneOrder)).toEqual([0, 1, 2]);
  });

  it('compacts beat order after a delete and refuses incomplete reorder lists', async () => {
    const sceneId = 'scene_morning_setup';
    const beats = await service.listBeats(sceneId, workspaceId);
    expect(beats.map((beat) => beat.beatOrder)).toEqual([0, 1]);

    await service.deleteBeat(beats[0].id, workspaceId);
    const remaining = await service.listBeats(sceneId, workspaceId);
    expect(remaining.map((beat) => ({ title: beat.title, order: beat.beatOrder }))).toEqual([
      { title: 'Morning greeting', order: 0 },
    ]);

    await expect(
      service.reorderBeats(sceneId, ['beat_product_1'], workspaceId),
    ).rejects.toThrow(/missing|unknown|complete/i);
  });

  it('cascades beats when a scene is deleted and compacts scene order', async () => {
    await service.deleteScene('scene_product_moment', workspaceId);
    const scenes = await service.listScenes(CONTENT_PROJECT_ID, workspaceId);
    expect(scenes.map((scene) => scene.title)).toEqual(['Morning setup', 'Routine wrap-up']);
    expect(scenes.map((scene) => scene.sceneOrder)).toEqual([0, 1]);
    await expect(service.listBeats('scene_product_moment', workspaceId)).rejects.toThrow(/not found/i);
  });
});

describe('rule 3 — draft projects are editable; non-draft projects are not', () => {
  it('allows scene/beat/input edits while the project is draft', async () => {
    const scene = await service.createScene(
      { contentProjectId: CONTENT_PROJECT_ID, title: 'Bonus scene' },
      workspaceId,
    );
    expect(scene.sceneOrder).toBe(3);

    const beat = await service.createBeat(
      { contentSceneId: scene.id, title: 'Bonus beat' },
      workspaceId,
    );
    expect(beat.beatOrder).toBe(0);
  });

  it('refuses structural edits once the project is archived', async () => {
    await service.archiveProject(CONTENT_PROJECT_ID, workspaceId);

    await expect(
      service.createScene({ contentProjectId: CONTENT_PROJECT_ID, title: 'Late scene' }, workspaceId),
    ).rejects.toThrow(/cannot be structurally edited/);
    await expect(
      service.updateProjectDraft(CONTENT_PROJECT_ID, { objective: 'New objective' }, workspaceId),
    ).rejects.toThrow(/cannot be structurally edited/);
    await expect(
      service.reorderScenes(CONTENT_PROJECT_ID, ['scene_morning_setup', 'scene_product_moment', 'scene_routine_wrapup'], workspaceId),
    ).rejects.toThrow(/cannot be structurally edited/);
  });
});

describe('rule 4 — execution readiness requires locked versions', () => {
  it('reports a human-readable problem when a model version is not locked', async () => {
    // Move the primary model input to Aisha's draft v2.
    await service.removeProjectInput('cinput_aisha_v1', workspaceId);
    // mv_aisha_v2 is draft (seeded); adding it must pass draft-phase rules…
    await service.addProjectInput(
      {
        contentProjectId: CONTENT_PROJECT_ID,
        inputType: 'model',
        modelId: 'model_aisha',
        modelVersionId: 'mv_aisha_v2',
        role: 'primary_model',
      },
      workspaceId,
    );

    const problems = await service.validateExecutionReadiness(CONTENT_PROJECT_ID, workspaceId);
    expect(problems.some((message) => /Select a locked Model version/i.test(message))).toBe(true);
  });

  it('reports a human-readable problem for a draft environment version', async () => {
    // env_ver_wbs_v2 is a seeded draft version of Warm Bedroom Studio.
    await service.removeProjectInput('cinput_wbs_v1', workspaceId);
    await service.addProjectInput(
      {
        contentProjectId: CONTENT_PROJECT_ID,
        inputType: 'environment',
        environmentId: 'env_warm_bedroom_studio',
        environmentVersionId: 'env_ver_wbs_v2',
        role: 'environment',
      },
      workspaceId,
    );

    const problems = await service.validateExecutionReadiness(CONTENT_PROJECT_ID, workspaceId);
    expect(problems.some((message) => /Environment version is still a draft/i.test(message))).toBe(true);
  });

  it('is clean for the fully locked seed selection', async () => {
    const problems = await service.validateExecutionReadiness(CONTENT_PROJECT_ID, workspaceId);
    expect(problems).toEqual([]);
  });
});

describe('rule 5 — job pins cannot change after a non-draft submission state', () => {
  it('refuses pin writes while the job is not draft', async () => {
    const repo = getContentRepository();
    // Simulate the (future, provider-bound) queued state at the repo layer.
    await repo.updateJobRequestStatus(CONTENT_JOB_REQUEST_ID, 'queued');

    await expect(
      service.createJobPinsFromProject(CONTENT_JOB_REQUEST_ID, CONTENT_PROJECT_ID, workspaceId),
    ).rejects.toThrow(/immutable while the job is queued/);
    await expect(repo.removeJobPins(CONTENT_JOB_REQUEST_ID)).rejects.toThrow(/immutable while the job is queued/);
  });

  it('refuses UI-reachable transitions into provider-bound states', async () => {
    await expect(
      service.transitionJobRequest(CONTENT_JOB_REQUEST_ID, 'queued', workspaceId),
    ).rejects.toThrow(/No provider integration exists/);
    await expect(
      service.transitionJobRequest(CONTENT_JOB_REQUEST_ID, 'processing', workspaceId),
    ).rejects.toThrow(/cannot move from draft to processing/);
  });
});

describe('rule 6 — the pin resolver records exact versions, never newer actives', () => {
  it('pins the exact selected model version (v1) even though v2 exists', async () => {
    const pins = await service.createJobPinsFromProject(CONTENT_JOB_REQUEST_ID, CONTENT_PROJECT_ID, workspaceId);
    const modelPin = pins.find((pin) => pin.pinType === 'model_version');
    expect(modelPin?.sourceVersionId).toBe('mv_aisha_v1'); // the selected version
    expect(modelPin?.resolvedDetails).toMatchObject({ versionNumber: 1, versionStatus: 'locked' });
  });

  it('resolves look item versions and pins them at job-creation time', async () => {
    const pins = await service.createJobPinsFromProject(CONTENT_JOB_REQUEST_ID, CONTENT_PROJECT_ID, workspaceId);
    const lookPin = pins.find((pin) => pin.pinType === 'look_version');
    expect(lookPin?.sourceVersionId).toBe('libver_look_v2'); // the LOCKED look version
    expect((lookPin?.resolvedDetails as { lookItems?: unknown[] }).lookItems).toHaveLength(2);

    // Look items become canonical library_asset_version pins.
    const itemPins = pins.filter(
      (pin) => pin.pinType === 'library_asset_version' && (pin.resolvedDetails as { resolvedVia?: string }).resolvedVia === 'look_version',
    );
    expect(itemPins.map((pin) => pin.sourceVersionId).sort()).toEqual(['libver_blazer_v1', 'libver_earrings_v1'].sort());
  });

  it('keeps resolved_details minimal — no duplicated structured details', async () => {
    const pins = await service.createJobPinsFromProject(CONTENT_JOB_REQUEST_ID, CONTENT_PROJECT_ID, workspaceId);
    for (const pin of pins) {
      const keys = Object.keys(pin.resolvedDetails);
      expect(keys).not.toContain('structuredDetails');
      expect(keys).not.toContain('identitySummary');
      expect(Object.keys(pin)).not.toContain('name');
    }
  });

  it('refuses to prepare pins while any selected input is unlocked', async () => {
    await service.removeProjectInput('cinput_serum_v1', workspaceId);
    // A hypothetical draft serum version doesn't exist in the seed; use the
    // draft look v1 instead to trigger the refusal.
    await service.removeProjectInput('cinput_look_v2', workspaceId);
    await service.addProjectInput(
      {
        contentProjectId: CONTENT_PROJECT_ID,
        inputType: 'look',
        libraryAssetId: 'lib_neutral_creator_outfit',
        libraryAssetVersionId: 'libver_look_v1', // draft look version
        role: 'look',
      },
      workspaceId,
    );

    await expect(
      service.createJobPinsFromProject(CONTENT_JOB_REQUEST_ID, CONTENT_PROJECT_ID, workspaceId),
    ).rejects.toThrow(/not ready to prepare/);
  });
});

describe('rule 7 — a Look resolves canonical item versions without duplicating data', () => {
  it('resolves the pinned blazer version and the active-version earrings separately', async () => {
    const resolved = await service.resolveProjectInputs(CONTENT_PROJECT_ID, workspaceId);
    const look = resolved.find((entry) => entry.input.inputType === 'look');
    expect(look?.lookItems).toEqual([
      { libraryAssetId: 'lib_beige_blazer', libraryAssetVersionId: 'libver_blazer_v1', role: 'wardrobe', sortOrder: 0 },
      { libraryAssetId: 'lib_gold_hoops', libraryAssetVersionId: 'libver_earrings_v1', role: 'accessory', sortOrder: 1 },
    ]);
  });

  it('refuses look inputs that are not look-type assets', async () => {
    await expect(
      service.addProjectInput(
        {
          contentProjectId: CONTENT_PROJECT_ID,
          inputType: 'look',
          libraryAssetId: 'lib_luma_serum', // a product, not a look
          libraryAssetVersionId: 'libver_serum_v1',
          role: 'look',
        },
        workspaceId,
      ),
    ).rejects.toThrow(/Look inputs must select a look-type Library asset/);
  });
});

describe('rule 8 — no provider call, queue submission or media output exists', () => {
  it('only creates draft job requests with draft-created events', async () => {
    const job = await service.createDraftJobRequest(
      {
        workspaceId,
        contentProjectId: CONTENT_PROJECT_ID,
        name: 'Fresh draft job',
        requestedOutputType: 'photo',
        requestedVariants: 2,
      },
      'tester',
      workspaceId,
    );
    expect(job.status).toBe('draft');
    expect(job.providerName).toBeNull();
    expect(job.providerRequestId).toBeNull();
    expect(job.submittedAt).toBeNull();

    const events = await service.listJobEvents(job.id, workspaceId);
    expect(events.map((event) => event.eventType)).toEqual(['draft_created']);
  });

  it('exposes no generation/provider APIs on the service', async () => {
    const prototype = Object.getOwnPropertyNames(Object.getPrototypeOf(service));
    const banned = prototype.filter((name) =>
      /generate|render|submit|enqueue|providerRequest|upload|output/i.test(name),
    );
    expect(banned).toEqual([]);
  });

  it('holds a strict, documented state machine with a provider boundary', () => {
    const transitions = ContentStudioService.jobStatusTransitions();
    expect(transitions.draft).toEqual(['queued', 'cancelled']);
    expect(transitions.completed).toEqual([]);
    expect(ContentStudioService.canTransitionJobStatus('completed', 'draft')).toBe(false);
    expect(ContentStudioService.canTransitionJobStatus('failed', 'draft')).toBe(true); // future retry path
  });
});
