/**
 * Prompt 29 — campaign brief → multi-format generation orchestration.
 * Service-boundary tests over the in-memory store:
 *
 *   1. Brief normalization + planning are deterministic and inspectable.
 *   2. Child media jobs link to the parent run.
 *   3. The shared locked baseline is created once and governs all children.
 *   4. Model-based runs require the Character Sheet identity baseline.
 *   5. Partial success rolls up correctly; failed children retry in place.
 *   6. Cross-workspace references are rejected.
 *   7. Records carry no secrets.
 */
import { describe, expect, it } from 'vitest';
import {
  normalizeCampaignBrief,
  buildCampaignGenerationPlan,
  rollUpCampaignRunStatus,
  describePlanMix,
} from './campaignOrchestration';
import {
  CampaignRunService,
  InMemoryCampaignRunStore,
} from './campaignRunService';
import type { CampaignRunDependencies } from './campaignRunService';
import type { LockedGenerationInputSnapshot } from './types';

const WS = '11111111-1111-1111-1111-111111111111';
const OTHER_WS = '22222222-2222-2222-2222-222222222222';
const USER = '44444444-4444-4444-4444-444444444444';

// ── 1. Normalization + planning ──────────────────────────────────────────────

describe('brief normalization and planning', () => {
  it('normalizes a structured brief deterministically', () => {
    const input = {
      briefText: 'Launch hero set for the serum line, warm loft, golden hour',
      mediaPlan: { images: 3, videos: 1, stories: 2, storyFrames: 2 },
      placements: ['feed', 'story-slot'],
      toneNotes: 'Premium, calm',
      variations: { allowStyleVariation: true, notes: 'Crop and palette may vary' },
    };
    const first = normalizeCampaignBrief(input);
    const second = normalizeCampaignBrief(input);
    // Deterministic modulo the capture timestamp.
    const { normalizedAt: _a, ...firstRest } = first;
    const { normalizedAt: _b, ...secondRest } = second;
    expect(firstRest).toEqual(secondRest);
    expect(first.mediaPlan).toEqual({ images: 3, videos: 1, stories: 2, storyFrames: 2 });
    expect(first.rulesApplied).toContain('images:3');
    expect(first.variations.allowStyleVariation).toBe(true);
  });

  it('clamps counts and records warnings', () => {
    const brief = normalizeCampaignBrief({
      briefText: 'huge set',
      mediaPlan: { images: 9, videos: 2, stories: 1, storyFrames: 8 },
    });
    expect(brief.mediaPlan.images).toBe(4);
    expect(brief.mediaPlan.storyFrames).toBe(4);
    expect(brief.warnings.join(' ')).toMatch(/max 4/);
  });

  it('plans images → videos → stories with explicit variation flags', () => {
    const plan = buildCampaignGenerationPlan(
      normalizeCampaignBrief({
        briefText: 'multi-format set',
        mediaPlan: { images: 2, videos: 1, stories: 1, storyFrames: 3 },
        placements: ['feed', 'story-slot'],
        variations: { allowPlacementVariation: true },
      }),
    );
    expect(plan.jobs.map((job) => job.mediaType)).toEqual(['image', 'image', 'video', 'story']);
    expect(plan.totals).toEqual({ images: 2, videos: 1, stories: 1, jobs: 4 });
    expect(plan.sharedBaseline).toBe(true);
    // Placement variation allowed → placements rotate; style stays locked.
    expect(plan.jobs[3]?.placement).toBe('story-slot');
    expect(plan.jobs.every((job) => !job.controlledVariation)).toBe(true);
    expect(plan.jobs[3]?.storyFrames).toBe(3);
    expect(describePlanMix(plan)).toBe('2 Images, 1 Video, 1 Story');
  });

  it('rolls up child outcomes into honest parent statuses', () => {
    expect(rollUpCampaignRunStatus([])).toBe('draft');
    expect(rollUpCampaignRunStatus([{ status: 'completed' }, { status: 'completed' }])).toBe('completed');
    expect(rollUpCampaignRunStatus([{ status: 'completed' }, { status: 'failed' }])).toBe('partially_completed');
    expect(rollUpCampaignRunStatus([{ status: 'failed' }, { status: 'failed' }])).toBe('failed');
    expect(rollUpCampaignRunStatus([{ status: 'completed' }, { status: 'running' }])).toBe('running');
  });
});

// ── 2–7. Service behavior ────────────────────────────────────────────────────

function testSnapshot(): LockedGenerationInputSnapshot {
  return {
    prompt: { userPrompt: 'b', cleanedPrompt: 'b' },
    aspectRatio: '1:1',
    outputCount: 6,
    lockedInputs: [
      { kind: 'model_version', id: 'mv-1', label: 'Aisha v1', versionNumber: 1, resolvedVia: 'model.activeVersionId' },
      { kind: 'environment_version', id: 'env-1', label: 'Loft v1', versionNumber: 1, resolvedVia: 'environment.activeVersionId' },
    ],
    characterSheetConstraints: [
      {
        modelId: 'model-1',
        modelVersionId: 'mv-1',
        characterSheetId: 'cs-1',
        protectedTraitKeys: ['faceFeatures.eyes'],
        protectedTraitCount: 5,
      },
    ],
    referencePlan: [],
    assembledAt: new Date().toISOString(),
  };
}

interface HarnessOptions {
  resolveBaseline?: boolean;
  failMediaTypes?: Array<'image' | 'video' | 'story'>;
}

function makeDeps(options: HarnessOptions = {}): {
  deps: CampaignRunDependencies;
  submitted: Array<{ jobId: string; mediaType: string }>;
  contentJobs: string[];
} {
  const submitted: Array<{ jobId: string; mediaType: string }> = [];
  const contentJobs: string[] = [];
  const deps: CampaignRunDependencies = {
    content: {
      createDraftJobRequest: async (input) => {
        contentJobs.push(String((input as { name?: string }).name));
        return { id: `cjob-${contentJobs.length}` };
      },
    },
    submitImageRun: async ({ jobId }) => {
      submitted.push({ jobId, mediaType: 'image' });
      if (options.failMediaTypes?.includes('image')) {
        return { run: null, eligible: false, blocking: ['image blocked by eligibility'] };
      }
      return {
        run: {
          id: `img-run-${submitted.length}`,
          workspaceId: WS,
          contentJobRequestId: jobId,
          createdBy: USER,
          providerName: 'development-fake',
          providerRequestId: null,
          idempotencyKey: `k-${submitted.length}`,
          status: 'completed',
          requestSnapshot: {},
          responseSnapshot: null,
          providerCostMetadata: null,
          errorCode: null,
          errorMessage: null,
          attemptNumber: 1,
          startedAt: null,
          completedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        eligible: true,
        blocking: [],
      };
    },
    submitVideoRun: async ({ jobId }) => {
      submitted.push({ jobId, mediaType: 'video-or-story' });
      if (options.failMediaTypes?.includes('video') || options.failMediaTypes?.includes('story')) {
        return { run: null, eligible: false, blocking: ['video/story blocked by eligibility'] };
      }
      return {
        run: {
          id: `vid-run-${submitted.length}`,
          workspaceId: WS,
          contentJobRequestId: jobId,
          createdBy: USER,
          providerName: 'development-fake-video',
          providerRequestId: null,
          idempotencyKey: `k-${submitted.length}`,
          status: 'completed',
          requestSnapshot: {},
          responseSnapshot: null,
          providerCostMetadata: null,
          errorCode: null,
          errorMessage: null,
          attemptNumber: 1,
          startedAt: null,
          completedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        eligible: true,
        blocking: [],
      };
    },
    resolveBaseline: async () => {
      if (options.resolveBaseline === false) return null;
      return {
        source: { model: null, characterSheet: null, environment: null, assets: [], references: [] },
        snapshot: testSnapshot(),
        identityTraits: {},
        modelPinIds: ['model-1'],
      };
    },
  };
  return { deps, submitted, contentJobs };
}

async function makeService(options: HarnessOptions = {}) {
  const store = new InMemoryCampaignRunStore();
  const { deps, submitted, contentJobs } = makeDeps(options);
  const service = new CampaignRunService(store, deps);
  return { service, store, submitted, contentJobs };
}

const BRIEF = {
  briefText: 'Launch set for the serum line in the warm loft, golden hour, premium calm tone',
  mediaPlan: { images: 2, videos: 1, stories: 1, storyFrames: 2 },
  modelId: 'model-1',
  modelVersionId: 'mv-1',
};

describe('campaign run creation and child linkage', () => {
  it('creates a parent run with linked child jobs and a shared baseline', async () => {
    const { service, store } = await makeService();
    const result = await service.createCampaignGenerationRun(WS, USER, BRIEF);
    expect(result.eligible).toBe(true);
    expect(result.run.totalJobsCount).toBe(4);
    expect(result.jobs.map((job) => job.mediaType)).toEqual(['image', 'image', 'video', 'story']);
    expect(result.jobs.every((job) => job.campaignGenerationRunId === result.run.id)).toBe(true);
    // Shared baseline is stored on the parent and carries sheet constraints.
    expect(result.run.lockedBaselineSnapshot?.characterSheetConstraints).toHaveLength(1);

    const audit = await store.listAudit(result.run.id);
    const events = audit.map((row) => row.event);
    expect(events).toContain('campaign_generation_plan_created');
    expect(events).toContain('campaign_generation_locked_baseline_created');
    expect(events).toContain('campaign_generation_run_validated');
    expect(events.filter((event) => event === 'campaign_generation_child_job_created')).toHaveLength(4);
  });

  it('blocks model-based runs without a Character Sheet baseline', async () => {
    const { service } = await makeService({ resolveBaseline: false });
    const result = await service.createCampaignGenerationRun(WS, USER, BRIEF);
    expect(result.eligible).toBe(false);
    expect(result.run.status).toBe('blocked');
    expect(result.blocking.join(' ')).toMatch(/no Character Sheet identity baseline/i);
  });

  it('rejects briefs that plan no outputs', async () => {
    const { service } = await makeService();
    const result = await service.createCampaignGenerationRun(WS, USER, {
      briefText: 'empty set',
      mediaPlan: {},
    });
    expect(result.eligible).toBe(false);
    expect(result.blocking.join(' ')).toMatch(/plans no outputs/i);
  });
});

describe('submission, partial success and retry continuity', () => {
  it('submits all children through the media services and completes the run', async () => {
    const { service, store, submitted, contentJobs } = await makeService();
    const created = await service.createCampaignGenerationRun(WS, USER, BRIEF);
    const result = await service.submitCampaignGenerationRun(created.run.id, WS, USER);

    expect(result.eligible).toBe(true);
    expect(submitted).toHaveLength(4);
    expect(contentJobs).toHaveLength(4); // one draft content job per child
    expect(result.run.status).toBe('completed');
    expect(result.run.completedJobsCount).toBe(4);
    expect(result.run.failedJobsCount).toBe(0);

    const audit = await store.listAudit(created.run.id);
    const events = audit.map((row) => row.event);
    expect(events).toContain('campaign_generation_run_submitted');
    expect(events).toContain('campaign_generation_run_completed');
  });

  it('represents partial success and retries failed children in place', async () => {
    // One-shot failure: the video/story bridge fails only on its FIRST call
    // (the initial submission), then succeeds on retry — mirroring a
    // transient provider failure with safe retry.
    let videoFailuresLeft = 1;
    const store = new InMemoryCampaignRunStore();
    const { deps, contentJobs } = makeDeps();
    const originalVideoSubmit = deps.submitVideoRun;
    const service = new CampaignRunService(store, {
      ...deps,
      submitVideoRun: async (input) => {
        if (videoFailuresLeft > 0) {
          videoFailuresLeft -= 1;
          return { run: null, eligible: false, blocking: ['video/story blocked by eligibility'] };
        }
        return originalVideoSubmit(input);
      },
    });
    void contentJobs;
    const created = await service.createCampaignGenerationRun(WS, USER, BRIEF);
    const first = await service.submitCampaignGenerationRun(created.run.id, WS, USER);

    // One transient video-bridge failure → exactly one failed child; the
    // service surfaces honest per-child outcomes.
    expect(first.run.status).toBe('partially_completed');
    expect(first.run.completedJobsCount).toBe(3);
    expect(first.run.failedJobsCount).toBe(1);
    expect(first.blocking.join(' ')).toMatch(/video\/story/);

    const auditAfterFirst = await store.listAudit(created.run.id);
    expect(auditAfterFirst.map((row) => row.event)).toContain('campaign_generation_run_partially_completed');

    // Retry: same parent, same baseline, only the failed children resubmit.
    const retry = await service.retryFailedRunJobs(WS, created.run.id, USER);
    expect(retry.run.status).toBe('completed');
    expect(retry.run.completedJobsCount).toBe(4);

    const auditAfterRetry = await store.listAudit(created.run.id);
    const events = auditAfterRetry.map((row) => row.event);
    expect(events).toContain('campaign_generation_run_retry_requested');
    // Parent id unchanged — traceability preserved across the retry.
    expect(retry.run.id).toBe(created.run.id);
  });

  it('refuses duplicate submission of a running/completed run', async () => {
    const { service } = await makeService();
    const created = await service.createCampaignGenerationRun(WS, USER, BRIEF);
    await service.submitCampaignGenerationRun(created.run.id, WS, USER);
    await expect(
      service.submitCampaignGenerationRun(created.run.id, WS, USER),
    ).rejects.toThrow(/already been submitted/);
  });
});

describe('workspace security and secrets hygiene', () => {
  it('refuses cross-workspace reads and submissions', async () => {
    const { service } = await makeService();
    const created = await service.createCampaignGenerationRun(WS, USER, BRIEF);
    await expect(
      service.getCampaignGenerationRunDetail(OTHER_WS, created.run.id),
    ).rejects.toThrow(/access to this workspace/);
    await expect(
      service.submitCampaignGenerationRun(created.run.id, OTHER_WS, USER),
    ).rejects.toThrow(/access to this workspace/);
  });

  it('run and baseline records carry no secrets or storage internals', async () => {
    const { service } = await makeService();
    const created = await service.createCampaignGenerationRun(WS, USER, BRIEF);
    await service.submitCampaignGenerationRun(created.run.id, WS, USER);
    const detail = await service.getCampaignGenerationRunDetail(WS, created.run.id);
    const serialized = JSON.stringify(detail);
    expect(serialized).not.toMatch(/signed|signature|token|X-Amz|storagePath|storageBucket|api[_-]?key/i);
  });
});
