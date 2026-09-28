/**
 * Video generation domain — the Phase-1 product contracts, tested at the
 * service boundary over the in-memory repository (mirrors the SQL semantics).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { VideoGenerationService } from './videoGenerationService';
import type { VideoGenerationDependencies } from './videoGenerationService';
import { MockGenerationRepository } from './mockGenerationRepository';
import { getVideoProvider, registerVideoProvider, listVideoProviders } from './providerRegistry';
import { DevelopmentFakeVideoProvider } from './videoFakeProvider';
import { evaluateVideoJobEligibility } from './videoEligibility';
import type { VideoEligibilityInput } from './videoEligibility';
import { mapVideoProviderError } from './videoErrorMapper';
import { buildVideoOutputMediaPath } from './videoMediaStore';
import { buildVideoProviderRequest } from './videoRequestBuilder';

const WS = '11111111-1111-1111-1111-111111111111';
const JOB = '33333333-3333-3333-3333-333333333333';
const SCENE = '55555555-5555-5555-5555-555555555555';
const BEAT = '66666666-6666-6666-6666-666666666666';
const USER = '44444444-4444-4444-4444-444444444444';

function baseEligibility(overrides: Partial<VideoEligibilityInput> = {}): VideoEligibilityInput {
  return {
    job: { id: JOB, status: 'draft', requestedOutputType: 'video', sceneIds: [SCENE], beatCountForSelectedScene: 2 },
    config: { videoGenerationEnabled: true, videoProviderName: 'development-fake-video' },
    pins: [
      { pinType: 'model', sourceRecordId: 'model-1', sourceVersionId: 'mv-1', resolvedDetails: { versionStatus: 'locked', versionNumber: 1 } },
    ],
    references: [],
    assets: {},
    quotas: {
      maxOutputsPerJob: 2,
      maxJobsPerUserPerPeriod: 3,
      maxJobsPerWorkspacePerPeriod: 10,
      maxSecondsPerUserPerPeriod: 48,
      maxSecondsPerWorkspacePerPeriod: 240,
      userJobsThisPeriod: 0,
      workspaceJobsThisPeriod: 0,
      userSecondsThisPeriod: 0,
      workspaceSecondsThisPeriod: 0,
    },
    selection: { sceneId: SCENE, beatId: BEAT, durationSeconds: 6, aspectRatio: '9:16', outputCount: 1 },
    ...overrides,
  };
}

function makeDeps(overrides: Partial<VideoGenerationDependencies> = {}): {
  deps: VideoGenerationDependencies;
  store: Map<string, { bytes: Uint8Array; contentType: string }>;
  transitions: string[];
} {
  const store = new Map<string, { bytes: Uint8Array; contentType: string }>();
  const transitions: string[] = [];
  const deps: VideoGenerationDependencies = {
    content: {
      getJobRequest: async () => ({
        id: JOB,
        workspaceId: WS,
        status: 'draft',
        requestedOutputType: 'video',
        contentProjectId: 'proj-1',
        name: 'Video job',
      }),
      transitionJobRequest: async (_jobId, to) => {
        transitions.push(to);
      },
      listScenes: async () => [{ id: SCENE }],
      getSceneSnapshot: async (sceneId) => ({
        id: sceneId,
        title: 'Vanity intro',
        purpose: 'Introduce the routine',
        sceneOrder: 1,
        settingNotes: 'Morning light',
        shotNotes: null,
      }),
      getBeatSnapshot: async (beatId) => ({
        id: beatId,
        contentSceneId: SCENE,
        title: 'Reach for the serum',
        beatOrder: 1,
        actionDescription: 'Hand enters frame and lifts the bottle',
        dialogueOrOverlay: 'Step 1: cleanse',
        cameraDirection: 'Slow push-in',
      }),
    },
    gallery: {
      createGeneratedOutput: async () => ({ id: crypto.randomUUID() }),
      attachMedia: async () => undefined,
      appendEvent: async () => undefined,
      nextOutputIndex: async () => 1,
    },
    media: {
      fetchBytes: async (url) => {
        const base64 = url.split(',')[1] ?? '';
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        return { bytes, contentType: url.startsWith('data:image/') ? 'image/svg+xml' : 'video/webm' };
      },
      put: async (bucket, path, bytes, contentType) => {
        store.set(`${bucket}/${path}`, { bytes, contentType });
      },
      resolvePinnedReferences: async () => [],
    },
    loadPinsForJob: async () => [
      { pinType: 'model', sourceRecordId: 'model-1', sourceVersionId: 'mv-1', resolvedDetails: { versionStatus: 'locked', versionNumber: 1 } },
    ],
    actorId: 'test-worker',
    ...overrides,
  };
  return { deps, store, transitions };
}

async function enabledService(overrides: Partial<VideoGenerationDependencies> = {}) {
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
  const { deps, store, transitions } = makeDeps(overrides);
  return { service: new VideoGenerationService(repo, deps), repo, store, transitions };
}

const GOOD = {
  selection: { sceneId: SCENE, beatId: BEAT, durationSeconds: 6 as const, aspectRatio: '9:16' as const, outputCount: 1 },
  prompt: 'test clip',
};

beforeEach(() => {
  if (!getVideoProvider('development-fake-video')) {
    registerVideoProvider(new DevelopmentFakeVideoProvider());
  }
});

describe('phase-1 constraints (spec cases 5, 6)', () => {
  it('accepts exactly 4, 6 or 8 seconds and rejects others', () => {
    for (const duration of [4, 6, 8]) {
      const result = evaluateVideoJobEligibility(baseEligibility({ selection: { sceneId: SCENE, beatId: BEAT, durationSeconds: duration, aspectRatio: '9:16', outputCount: 1 } }));
      expect(result.eligible).toBe(true);
    }
    const bad = evaluateVideoJobEligibility(baseEligibility({ selection: { sceneId: SCENE, beatId: BEAT, durationSeconds: 10, aspectRatio: '9:16', outputCount: 1 } }));
    expect(bad.blocking.join(' ')).toMatch(/4, 6 or 8 seconds/);
  });

  it('accepts only 9:16, 1:1 and 16:9', () => {
    for (const ratio of ['9:16', '1:1', '16:9']) {
      const result = evaluateVideoJobEligibility(baseEligibility({ selection: { sceneId: SCENE, beatId: BEAT, durationSeconds: 6, aspectRatio: ratio, outputCount: 1 } }));
      expect(result.eligible).toBe(true);
    }
    const bad = evaluateVideoJobEligibility(baseEligibility({ selection: { sceneId: SCENE, beatId: BEAT, durationSeconds: 6, aspectRatio: '21:9', outputCount: 1 } }));
    expect(bad.blocking.join(' ')).toMatch(/Aspect ratio/);
  });
});

describe('beat-aware association (spec case 7)', () => {
  it('requires a scene when a beat is selected', () => {
    const result = evaluateVideoJobEligibility(baseEligibility({ selection: { sceneId: null, beatId: BEAT, durationSeconds: 6, aspectRatio: '9:16', outputCount: 1 } }));
    expect(result.blocking.join(' ')).toMatch(/requires selecting its scene/);
  });

  it('rejects a scene outside the plan', () => {
    const result = evaluateVideoJobEligibility(baseEligibility({ selection: { sceneId: 'other-scene', beatId: null, durationSeconds: 6, aspectRatio: '9:16', outputCount: 1 } }));
    expect(result.blocking.join(' ')).toMatch(/does not belong to this plan/);
  });

  it('allows a scene without a beat (single-clip allowance)', () => {
    const result = evaluateVideoJobEligibility(baseEligibility({ selection: { sceneId: SCENE, beatId: null, durationSeconds: 6, aspectRatio: '9:16', outputCount: 1 } }));
    expect(result.eligible).toBe(true);
  });
});

describe('eligibility gating (spec cases 3, 4, 9)', () => {
  it('fails closed when video is unconfigured', () => {
    const result = evaluateVideoJobEligibility(baseEligibility({ config: { videoGenerationEnabled: false, videoProviderName: 'none' } }));
    expect(result.blocking.join(' ')).toMatch(/not configured/);
  });

  it('rejects draft pins with the spec copy', () => {
    const result = evaluateVideoJobEligibility(baseEligibility({
      pins: [{ pinType: 'model', sourceRecordId: 'm', sourceVersionId: 'mv', resolvedDetails: { versionStatus: 'draft' } }],
    }));
    expect(result.blocking.join(' ')).toMatch(/locked Model version/);
  });

  it('rejects pending/failed references with the spec copy', () => {
    const result = evaluateVideoJobEligibility(baseEligibility({ references: [{ referenceId: 'r', uploadStatus: 'pending' }] }));
    expect(result.blocking.join(' ')).toMatch(/has not finished uploading/);
  });

  it('blocks job and seconds quotas separately (jobs first, then seconds)', () => {
    const jobs = evaluateVideoJobEligibility(baseEligibility({
      quotas: {
        maxOutputsPerJob: 2, maxJobsPerUserPerPeriod: 3, maxJobsPerWorkspacePerPeriod: 10,
        maxSecondsPerUserPerPeriod: 48, maxSecondsPerWorkspacePerPeriod: 240,
        userJobsThisPeriod: 3, workspaceJobsThisPeriod: 0, userSecondsThisPeriod: 0, workspaceSecondsThisPeriod: 0,
      },
    }));
    expect(jobs.blocking.join(' ')).toMatch(/video allowance has been reached/);

    const seconds = evaluateVideoJobEligibility(baseEligibility({
      quotas: {
        maxOutputsPerJob: 2, maxJobsPerUserPerPeriod: 3, maxJobsPerWorkspacePerPeriod: 10,
        maxSecondsPerUserPerPeriod: 48, maxSecondsPerWorkspacePerPeriod: 240,
        userJobsThisPeriod: 0, workspaceJobsThisPeriod: 0, userSecondsThisPeriod: 46, workspaceSecondsThisPeriod: 0,
      },
    }));
    expect(seconds.blocking.join(' ')).toMatch(/seconds exceed/);
    expect(seconds.secondsRequested).toBe(6);
  });
});

describe('submission flow (spec cases 2, 8)', () => {
  it('refuses a foreign-workspace job', async () => {
    const { service } = await enabledService();
    await expect(service.submitVideoGeneration(JOB, 'other-ws', USER, GOOD)).rejects.toThrow(/workspace/);
  });

  it('is idempotent: duplicate submission returns the existing run', async () => {
    const { service, repo } = await enabledService();
    const first = await service.submitVideoGeneration(JOB, WS, USER, GOOD);
    expect(first.reused).toBe(false);
    const duplicate = await service.submitVideoGeneration(JOB, WS, USER, GOOD);
    expect(duplicate.reused).toBe(true);
    expect(duplicate.run?.id).toBe(first.run?.id);
    expect((await repo.listRunsForJob(JOB)).length).toBe(1);
  });
});

describe('fake provider + ingestion (spec cases 10, 11, 13)', () => {
  it('completes through guarded transitions and ingests clips privately', async () => {
    const { service, repo, store, transitions } = await enabledService();
    const result = await service.submitVideoGeneration(JOB, WS, USER, GOOD);
    expect(result.run?.status).toBe('completed');
    expect(transitions).toEqual(['queued', 'review']);

    const paths = [...store.keys()];
    expect(paths.length).toBe(2); // clip + provider-supplied thumbnail
    expect(paths.filter((path) => path.includes('/videos/')).length).toBe(1);
    expect(paths.filter((path) => path.includes('/thumbnails/')).length).toBe(1);
    for (const path of paths) {
      expect(path).toContain(`workspaces/${WS}/jobs/${JOB}/runs/`);
      expect(path).not.toContain('http');
    }
    const events = await repo.listAuditEventsForJob(JOB);
    expect(events.map((event) => event.eventType)).toContain('output_created');
    expect(events.map((event) => event.eventType)).toContain('result_ingested');
  });

  it('freezes scene/beat snapshots into the run and output metadata', async () => {
    const { service, repo } = await enabledService();
    const result = await service.submitVideoGeneration(JOB, WS, USER, GOOD);
    const run = await repo.getRun(result.run!.id);
    expect((run?.sceneSnapshot as { title?: string } | null)?.title).toBe('Vanity intro');
    expect((run?.beatSnapshot as { title?: string } | null)?.title).toBe('Reach for the serum');
    // Snapshot immutability: the recorded beat action is from submission time.
    expect((run?.beatSnapshot as { actionDescription?: string } | null)?.actionDescription).toBe(
      'Hand enters frame and lifts the bottle',
    );
  });

  it('keeps signed URLs out of stored snapshots', async () => {
    const { service, repo } = await enabledService();
    const result = await service.submitVideoGeneration(JOB, WS, USER, GOOD);
    const run = await repo.getRun(result.run!.id);
    const serialized = JSON.stringify(run?.requestSnapshot ?? {});
    expect(serialized).not.toContain('http');
    expect(serialized).not.toContain('mock-signed');
  });

  it('rejects unsupported containers at ingestion', async () => {
    const badProvider = {
      providerName: 'development-fake-video',
      isConfigured: async () => true,
      submitVideoGeneration: async () => ({ providerRequestId: 'bad-1', status: 'processing' as const }),
      getVideoGenerationStatus: async () => ({
        status: 'completed' as const,
        results: [{ remoteUrlOrBytes: 'data:video/x-msvideo;base64,AAAA', mimeType: 'video/x-msvideo', durationSeconds: 6 }],
      }),
    };
    registerVideoProvider(badProvider);
    const { service } = await enabledService();
    const result = await service.submitVideoGeneration(JOB, WS, USER, GOOD);
    expect(result.run?.status).toBe('failed');
    expect(result.run?.errorMessage).toMatch(/Unsupported video container/);
    registerVideoProvider(new DevelopmentFakeVideoProvider());
  });
});

describe('retry (spec case 15)', () => {
  it('creates a new attempt preserving pins and snapshots', async () => {
    const failing = {
      providerName: 'development-fake-video',
      isConfigured: async () => true,
      submitVideoGeneration: async () => { throw new Error('network timeout'); },
      getVideoGenerationStatus: async () => ({ status: 'failed' as const }),
    };
    registerVideoProvider(failing);
    const { service, repo } = await enabledService();
    const failed = await service.submitVideoGeneration(JOB, WS, USER, GOOD);
    expect(failed.run?.status).toBe('failed');
    registerVideoProvider(new DevelopmentFakeVideoProvider());

    const retry = await service.retryVideoGeneration(JOB, WS, USER);
    expect(retry.run?.status).toBe('completed');
    expect(retry.run?.attemptNumber).toBe(2);

    const runs = await repo.listRunsForJob(JOB);
    const pinSummaries = runs.map((run) => (run.requestSnapshot as { metadata?: { pinSummary?: unknown } }).metadata?.pinSummary);
    expect(JSON.stringify(pinSummaries[0])).toBe(JSON.stringify(pinSummaries[1]));
    expect((runs[1].sceneSnapshot as { title?: string }).title).toBe('Vanity intro');
  });

  it('refuses retry when the latest video run is not failed', async () => {
    const { service } = await enabledService();
    await service.submitVideoGeneration(JOB, WS, USER, GOOD);
    await expect(service.retryVideoGeneration(JOB, WS, USER)).rejects.toThrow(/only available for failed/);
  });
});

describe('error mapping (spec case 16)', () => {
  it('maps provider errors to safe messages and scrubs secrets', () => {
    const mapped = mapVideoProviderError(new Error('auth failed for sk-secretkeyvalue99'));
    expect(mapped.protectedDetail).not.toContain('sk-secretkeyvalue99');
    expect(mapped.protectedDetail).toContain('sk-***');
    expect(mapped.userMessage).not.toContain('sk-');
  });
});

describe('boundary (spec cases 1, 17)', () => {
  it('registers only the fake video provider', () => {
    expect(listVideoProviders()).toEqual(['development-fake-video']);
  });

  it('no long-form/audio/voice/streaming surface exists', () => {
    const methods = Object.getOwnPropertyNames(VideoGenerationService.prototype);
    expect(methods.filter((name) => /audio|voice|lip|stream|longform|timeline/i.test(name))).toEqual([]);
  });

  it('request builder never stores signed handles', () => {
    const { requestSnapshot } = buildVideoProviderRequest({
      idempotencyKey: 'k', prompt: 'p', aspectRatio: '9:16', durationSeconds: 6, outputCount: 1,
      referenceImages: [{ role: 'model_identity', urlOrSecureHandle: 'mock-signed://x', mimeType: 'image/png' }],
      jobId: 'j', workspaceId: WS, pinSummary: null,
    });
    expect(JSON.stringify(requestSnapshot)).not.toContain('mock-signed');
  });
});

describe('path construction (spec case 13)', () => {
  it('follows the videos/ and thumbnails/ convention', () => {
    const clip = buildVideoOutputMediaPath({
      workspaceId: WS, contentJobRequestId: JOB, providerRunId: 'run-1', galleryOutputId: 'out-1',
      safeFilename: 'clip-1.webm', kind: 'videos',
    });
    const thumb = buildVideoOutputMediaPath({
      workspaceId: WS, contentJobRequestId: JOB, providerRunId: 'run-1', galleryOutputId: 'out-1',
      safeFilename: 'thumb-1.png', kind: 'thumbnails',
    });
    expect(clip).toBe(`workspaces/${WS}/jobs/${JOB}/runs/run-1/videos/out-1/clip-1.webm`);
    expect(thumb).toContain('/thumbnails/');
  });
});
