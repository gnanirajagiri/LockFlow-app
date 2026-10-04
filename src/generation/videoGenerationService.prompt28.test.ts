/**
 * Prompt 28 — video & story generation with locked inputs, Character Sheet
 * enforcement and media job orchestration. Service-boundary tests over the
 * in-memory repo:
 *
 *   1. Video/story jobs are workspace-scoped.
 *   2. Model-based media generation enforces the Character Sheet baseline.
 *   3. Locked inputs are preserved in the media run snapshot.
 *   4. Gallery receives outputs; Library stays untouched.
 *   5. Story outputs remain grouped and ordered under one run.
 *   6. Media variants inherit the baseline and record parent linkage.
 *   7. Snapshots carry no secrets.
 */
import { describe, expect, it } from 'vitest';
import { VideoGenerationService } from './videoGenerationService';
import type { VideoGenerationDependencies, VideoSelection } from './videoGenerationService';
import { MockGenerationRepository } from './mockGenerationRepository';
import type { LockedGenerationInputSnapshot } from './types';

const WS = '11111111-1111-1111-1111-111111111111';
const OTHER_WS = '22222222-2222-2222-2222-222222222222';
const JOB = '33333333-3333-3333-3333-333333333333';
const USER = '44444444-4444-4444-4444-444444444444';

function makeDeps(overrides: Partial<VideoGenerationDependencies> = {}): { deps: VideoGenerationDependencies; transitions: string[] } {
  const transitions: string[] = [];
  const deps: VideoGenerationDependencies = {
    content: {
      getJobRequest: async () => ({
        id: JOB,
        workspaceId: WS,
        status: 'draft',
        requestedOutputType: 'video',
        contentProjectId: null,
        name: 'Test video job',
      }),
      transitionJobRequest: async (_jobId, to) => {
        transitions.push(to);
      },
      listScenes: async () => [],
      getSceneSnapshot: async () => null,
      getBeatSnapshot: async () => null,
    },
    gallery: {
      createGeneratedOutput: async (input) => ({ id: `out-${input.outputIndex ?? 1}` }),
      attachMedia: async () => undefined,
      appendEvent: async () => undefined,
      nextOutputIndex: async () => 1,
    },
    media: {
      fetchBytes: async () => ({ bytes: new Uint8Array([1, 2, 3]), contentType: 'video/mp4' }),
      put: async () => undefined,
      resolvePinnedReferences: async () => [],
    },
    loadPinsForJob: async () => [
      {
        pinType: 'model' as const,
        sourceRecordId: 'model-1',
        sourceVersionId: 'mv-1',
        resolvedDetails: { versionStatus: 'locked', versionNumber: 1, modelName: 'Aisha' },
      },
    ],
    actorId: 'test-worker',
    ...overrides,
  };
  return { deps, transitions };
}

async function makeService(overrides: Partial<VideoGenerationDependencies> = {}) {
  const repo = new MockGenerationRepository();
  await repo.setConfig({
    imageGenerationEnabled: false,
    providerName: 'none',
    imageMaxOutputsPerJob: 4,
    imageMaxJobsPerUserPerPeriod: 5,
    imageMaxJobsPerWorkspacePerPeriod: 20,
    videoGenerationEnabled: true,
    videoProviderName: 'development-fake-video',
    videoMaxOutputsPerJob: 2,
    videoMaxJobsPerUserPerPeriod: 3,
    videoMaxJobsPerWorkspacePerPeriod: 10,
    videoMaxSecondsPerUserPerPeriod: 48,
    videoMaxSecondsPerWorkspacePerPeriod: 240,
  });
  const { deps, transitions } = makeDeps(overrides);
  return { service: new VideoGenerationService(repo, deps), repo, transitions };
}

function testSnapshot(): LockedGenerationInputSnapshot {
  return {
    prompt: { userPrompt: 'p', cleanedPrompt: 'p' },
    aspectRatio: '9:16',
    outputCount: 2,
    lockedInputs: [
      { kind: 'model_version', id: 'mv-1', label: 'Aisha v1', versionNumber: 1, resolvedVia: 'model.activeVersionId' },
    ],
    characterSheetConstraints: [
      {
        modelId: 'model-1',
        modelVersionId: 'mv-1',
        characterSheetId: 'cs-1',
        protectedTraitKeys: ['faceFeatures.eyes'],
        protectedTraitCount: 1,
      },
    ],
    referencePlan: [],
    assembledAt: new Date().toISOString(),
  };
}

const passingModels = {
  models: {
    validateGenerationAgainstCharacterSheet: async () => ({ valid: true, mismatches: [], protectedTraitCount: 3 }),
  },
};

const VIDEO_SELECTION: VideoSelection = {
  sceneId: null,
  beatId: null,
  durationSeconds: 4,
  aspectRatio: '9:16',
  outputCount: 1,
};

const BASE_INPUT = {
  selection: VIDEO_SELECTION,
  references: [],
  assets: {},
  prompt: 'Clip of the model walking through a loft, golden hour',
};

describe('video generation is workspace-scoped', () => {
  it('refuses cross-workspace submissions', async () => {
    const { service } = await makeService(passingModels);
    await expect(
      service.submitVideoGeneration(JOB, OTHER_WS, USER, BASE_INPUT),
    ).rejects.toThrow(/access to this workspace/);
  });
});

describe('Character Sheet enforcement gates model-based media generation', () => {
  it('blocks when the baseline is required but no traits are supplied', async () => {
    const { service, repo } = await makeService();
    const result = await service.submitVideoGeneration(JOB, WS, USER, {
      ...BASE_INPUT,
      requireIdentityBaseline: { 'model-1': true },
    });
    expect(result.run).toBeNull();
    expect(result.blocking.join(' ')).toMatch(/no Character Sheet baseline supplied/i);
    const events = await repo.listAuditEventsForJob(JOB);
    expect(events.map((event) => event.eventType)).toContain('character_sheet_media_generation_validation_failed');
  });

  it('blocks mismatching protected traits', async () => {
    const { service, repo } = await makeService({
      models: {
        validateGenerationAgainstCharacterSheet: async () => ({
          valid: false,
          mismatches: ['faceFeatures.eyes: expected "almond, dark brown", candidate "round, green"'],
          protectedTraitCount: 3,
        }),
      },
    });
    const result = await service.submitVideoGeneration(JOB, WS, USER, {
      ...BASE_INPUT,
      identityTraits: { 'model-1': { 'faceFeatures.eyes': 'round, green' } },
    });
    expect(result.eligible).toBe(false);
    expect(result.blocking.join(' ')).toMatch(/identity mismatch/);
    const events = await repo.listAuditEventsForJob(JOB);
    expect(events.map((event) => event.eventType)).toContain('character_sheet_media_generation_validation_failed');
  });

  it('completes when traits match and records the requested + validated events', async () => {
    const { service, repo } = await makeService({
      ...passingModels,
      assembleLockedInputSnapshot: async () => testSnapshot(),
    });
    const result = await service.submitVideoGeneration(JOB, WS, USER, {
      ...BASE_INPUT,
      identityTraits: { 'model-1': { 'faceFeatures.eyes': 'almond, dark brown' } },
      requireIdentityBaseline: { 'model-1': true },
    });
    expect(result.run?.status).toBe('completed');
    const events = await repo.listAuditEventsForJob(JOB).then((rows) => rows.map((row) => row.eventType));
    expect(events).toContain('video_generation_requested');
    expect(events).toContain('locked_media_input_snapshot_created');
    expect(events).toContain('media_generation_submitted');
    expect(events).toContain('media_generation_completed');
  });
});

describe('locked inputs are preserved in the media snapshot', () => {
  it('stores the assembled baseline with protected trait keys, secrets-free', async () => {
    const { service, repo } = await makeService({
      ...passingModels,
      assembleLockedInputSnapshot: async () => testSnapshot(),
    });
    const result = await service.submitVideoGeneration(JOB, WS, USER, BASE_INPUT);
    const run = await repo.getRun(result.run!.id);
    const locked = run?.lockedInputSnapshot as LockedGenerationInputSnapshot | null;
    expect(locked).not.toBeNull();
    expect(locked?.lockedInputs[0]?.id).toBe('mv-1');
    expect(locked?.characterSheetConstraints[0]?.protectedTraitKeys).toContain('faceFeatures.eyes');
    const serialized = JSON.stringify(run?.requestSnapshot ?? {});
    expect(serialized).not.toMatch(/signed|signature|token|X-Amz|storagePath|storageBucket/i);
  });
});

describe('story generation keeps outputs grouped and ordered', () => {
  it('creates one story group with sequential outputs and per-frame intent', async () => {
    const createdOutputs: Array<{ title: string; outputType: string; metadata: Record<string, unknown> }> = [];
    const { service, repo } = await makeService({
      ...passingModels,
      assembleLockedInputSnapshot: async () => testSnapshot(),
      gallery: {
        createGeneratedOutput: async (input) => {
          createdOutputs.push({ title: input.title, outputType: input.outputType, metadata: input.metadata });
          return { id: `out-${createdOutputs.length}` };
        },
        attachMedia: async () => undefined,
        appendEvent: async () => undefined,
        nextOutputIndex: async () => createdOutputs.length + 1,
      },
    });

    const result = await service.submitVideoGeneration(JOB, WS, USER, {
      selection: {
        ...VIDEO_SELECTION,
        mediaFlavor: 'story',
        outputCount: 2,
        storyFrames: [
          { label: 'Opening', actionDescription: 'Model enters the loft' },
          { label: 'Reveal', actionDescription: 'Turn to camera, smile' },
        ],
      },
      prompt: 'A two-frame story in a warm loft',
    });
    expect(result.run?.status).toBe('completed');

    expect(createdOutputs).toHaveLength(2);
    const groupKeys = new Set(createdOutputs.map((output) => output.metadata['story_group_key']));
    expect(groupKeys.size).toBe(1); // one coherent story group

    const sequences = createdOutputs.map((output) => output.metadata['story_sequence']);
    expect(sequences).toEqual([1, 2]);
    expect(createdOutputs.every((output) => output.outputType === 'story')).toBe(true);
    expect(createdOutputs[0]?.metadata['story_frame_label']).toBe('Opening');
    expect(createdOutputs[1]?.metadata['story_frame_label']).toBe('Reveal');
    expect(createdOutputs[0]?.title).toContain('Story frame 1');

    const events = await repo.listAuditEventsForJob(JOB).then((rows) => rows.map((row) => row.eventType));
    expect(events).toContain('story_generation_requested');
  });
});

describe('media variants inherit the locked baseline', () => {
  it('creates a derived job, copies pins, inherits flavor/plan, records the parent', async () => {
    const copiedPins: Array<[string, string]> = [];
    const variantJobs: Array<{ mediaFlavor: string }> = [];
    const { service, repo } = await makeService({
      ...passingModels,
      assembleLockedInputSnapshot: async () => testSnapshot(),
      content: {
        getJobRequest: async () => ({
          id: JOB,
          workspaceId: WS,
          status: 'draft',
          requestedOutputType: 'video',
          contentProjectId: null,
          name: 'Job',
        }),
        transitionJobRequest: async () => undefined,
        listScenes: async () => [],
        getSceneSnapshot: async () => null,
        getBeatSnapshot: async () => null,
        copyPinsToJob: async (sourceJobId, targetJobId) => {
          copiedPins.push([sourceJobId, targetJobId]);
        },
      },
      createVariantJob: async ({ mediaFlavor }) => {
        const id = `variant-${variantJobs.length + 1}`;
        variantJobs.push({ mediaFlavor });
        return id;
      },
    });

    const source = await service.submitVideoGeneration(JOB, WS, USER, {
      selection: {
        ...VIDEO_SELECTION,
        mediaFlavor: 'story',
        outputCount: 2,
        storyFrames: [
          { label: 'Opening', actionDescription: 'Enter' },
          { label: 'Reveal', actionDescription: 'Smile' },
        ],
      },
      prompt: 'Story baseline prompt',
    });
    expect(source.run?.status).toBe('completed');

    const variant = await service.createMediaVariantJob(JOB, WS, USER, {});
    expect(variant.run?.status).toBe('completed');
    expect(variant.run?.contentJobRequestId).not.toBe(JOB);
    expect(copiedPins).toEqual([[JOB, variant.run!.contentJobRequestId]]);
    expect(variantJobs[0]?.mediaFlavor).toBe('story');

    // The variant inherited the ordered story plan verbatim.
    const variantSnapshot = variant.run?.requestSnapshot as { storyFrames?: unknown[] };
    expect(variantSnapshot.storyFrames).toHaveLength(2);

    const events = await repo.listAuditEventsForJob(JOB).then((rows) => rows.map((row) => row.eventType));
    expect(events).toContain('media_generation_variant_requested');
  });

  it('refuses variants from failed or missing runs', async () => {
    const { service } = await makeService();
    await expect(service.createMediaVariantJob('no-such-job', WS, USER, {})).rejects.toThrow(/No media generation run exists/);
  });

  it('refuses cross-workspace variants', async () => {
    const { service } = await makeService({ ...passingModels, assembleLockedInputSnapshot: async () => testSnapshot() });
    await service.submitVideoGeneration(JOB, WS, USER, BASE_INPUT);
    await expect(service.createMediaVariantJob(JOB, OTHER_WS, USER, {})).rejects.toThrow(/access to this workspace/);
  });
});
