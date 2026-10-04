/**
 * Generation domain — the product contracts, tested at the service boundary
 * over the in-memory repository (mirrors the SQL semantics). Spec cases:
 * submission gating (workspace, pins, rights, quota, config), idempotency,
 * fake-provider flow through the guarded state machine, error mapping,
 * ingestion provenance (Gallery yes, Library never), private paths, retry
 * semantics and the image-only boundary.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { GenerationService } from './generationService';
import type { GenerationDependencies } from './generationService';
import { MockGenerationRepository } from './mockGenerationRepository';
import { getImageProvider, registerImageProvider, listImageProviders } from './providerRegistry';
import { DevelopmentFakeImageProvider } from './fakeProvider';
import { evaluateImageJobEligibility } from './eligibility';
import type { EligibilityInput } from './eligibility';
import { mapProviderError } from './errorMapper';
import { buildOutputMediaPath, GALLERY_MEDIA_BUCKET, InMemoryGeneratedMediaStore } from './mediaStore';

// ── Test doubles ─────────────────────────────────────────────────────────────

const WS = '11111111-1111-1111-1111-111111111111';
const OTHER_WS = '22222222-2222-2222-2222-222222222222';
const JOB = '33333333-3333-3333-3333-333333333333';
const USER = '44444444-4444-4444-4444-444444444444';

function baseEligibility(overrides: Partial<EligibilityInput> = {}): EligibilityInput {
  return {
    job: { id: JOB, status: 'draft', requestedOutputType: 'photo', requestedVariants: 2 },
    config: { imageGenerationEnabled: true, providerName: 'development-fake' },
    pins: [
      {
        pinType: 'model',
        sourceRecordId: 'model-1',
        sourceVersionId: 'mv-1',
        resolvedDetails: { versionStatus: 'locked', versionNumber: 1 },
      },
    ],
    references: [],
    assets: {},
    quotas: {
      maxOutputsPerJob: 4,
      maxJobsPerUserPerPeriod: 5,
      maxJobsPerWorkspacePerPeriod: 20,
      userJobsThisPeriod: 0,
      workspaceJobsThisPeriod: 0,
    },
    ...overrides,
  };
}

function makeDeps(overrides: Partial<GenerationDependencies> = {}): { deps: GenerationDependencies; store: InMemoryGeneratedMediaStore; transitions: string[] } {
  const store = new InMemoryGeneratedMediaStore();
  const transitions: string[] = [];
  const deps: GenerationDependencies = {
    content: {
      getJobRequest: async () => ({
        id: JOB,
        workspaceId: WS,
        status: 'draft',
        requestedOutputType: 'photo',
        requestedVariants: 2,
        contentProjectId: null,
        name: 'Test job',
      }),
      transitionJobRequest: async (_jobId, to) => {
        transitions.push(to);
      },
    },
    gallery: {
      createGeneratedOutput: async () => ({ id: crypto.randomUUID() }),
      attachMedia: async () => undefined,
      appendEvent: async () => undefined,
      nextOutputIndex: async () => 1,
    },
    media: {
      createSignedUrl: async (bucket, path) => `mock-signed://${bucket}/${path}`,
      fetchBytes: async (url) => {
        if (url.startsWith('data:')) {
          const base64 = url.split(',')[1] ?? '';
          const binary = atob(base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
          return { bytes, contentType: 'image/svg+xml' };
        }
        return { bytes: new Uint8Array([1, 2, 3]), contentType: 'image/png' };
      },
      put: async (bucket, path, bytes, contentType) => {
        await store.put(bucket, path, bytes, contentType);
      },
      resolvePinnedReferences: async () => [],
    },
    loadPinsForJob: async () => [
      {
        pinType: 'model' as const,
        sourceRecordId: 'model-1',
        sourceVersionId: 'mv-1',
        resolvedDetails: { versionStatus: 'locked', versionNumber: 1 },
      },
    ],
    actorId: 'test-worker',
    ...overrides,
  };
  return { deps, store, transitions };
}

function enabledRepo() {
  const repo = new MockGenerationRepository();
  return repo;
}

async function enabledService(overrides: Partial<GenerationDependencies> = {}) {
  const repo = enabledRepo();
  await repo.setConfig({
    imageGenerationEnabled: true,
    providerName: 'development-fake',
    imageMaxOutputsPerJob: 4,
    imageMaxJobsPerUserPerPeriod: 5,
    imageMaxJobsPerWorkspacePerPeriod: 20,
    videoGenerationEnabled: false,
    videoProviderName: 'none',
    videoMaxOutputsPerJob: 2,
    videoMaxJobsPerUserPerPeriod: 3,
    videoMaxJobsPerWorkspacePerPeriod: 10,
    videoMaxSecondsPerUserPerPeriod: 48,
    videoMaxSecondsPerWorkspacePerPeriod: 240,
  });
  const { deps, store, transitions } = makeDeps(overrides);
  return { service: new GenerationService(repo, deps), repo, store, transitions };
}

const GOOD_INPUT = {
  pins: [
    {
      pinType: 'model' as const,
      sourceRecordId: 'model-1',
      sourceVersionId: 'mv-1',
      resolvedDetails: { versionStatus: 'locked', versionNumber: 1 },
    },
  ],
  references: [],
  assets: {},
  prompt: 'test',
};

beforeEach(() => {
  // Ensure the fake provider is registered for every test (registry is module-scoped).
  if (!getImageProvider('development-fake')) {
    registerImageProvider(new DevelopmentFakeImageProvider());
  }
});

// ── Eligibility (pure) ──────────────────────────────────────────────────────

describe('eligibility evaluation (spec cases 3, 4, 5, 7)', () => {
  it('passes a fully-locked draft photo job with quotas available', () => {
    const result = evaluateImageJobEligibility(baseEligibility());
    expect(result.eligible).toBe(true);
    expect(result.blocking).toEqual([]);
  });

  it('blocks a disabled or unconfigured provider (fail closed)', () => {
    expect(
      evaluateImageJobEligibility(baseEligibility({ config: { imageGenerationEnabled: false, providerName: 'development-fake' } })).eligible,
    ).toBe(false);
    expect(
      evaluateImageJobEligibility(baseEligibility({ config: { imageGenerationEnabled: true, providerName: 'none' } })).eligible,
    ).toBe(false);
  });

  it('blocks non-draft jobs and non-image output types', () => {
    expect(
      evaluateImageJobEligibility(baseEligibility({ job: { id: JOB, status: 'queued', requestedOutputType: 'photo', requestedVariants: 1 } })).eligible,
    ).toBe(false);
    expect(
      evaluateImageJobEligibility(baseEligibility({ job: { id: JOB, status: 'draft', requestedOutputType: 'video', requestedVariants: 1 } })).eligible,
    ).toBe(false);
  });

  it('blocks draft/missing pinned versions (never substitute)', () => {
    const result = evaluateImageJobEligibility(
      baseEligibility({
        pins: [
          { pinType: 'model', sourceRecordId: 'm', sourceVersionId: 'mv', resolvedDetails: { versionStatus: 'draft' } },
        ],
      }),
    );
    expect(result.blocking.join(' ')).toMatch(/locked/);
  });

  it('blocks pending/failed/deleted model references', () => {
    const result = evaluateImageJobEligibility(
      baseEligibility({
        references: [{ referenceId: 'r1', uploadStatus: 'failed' }],
      }),
    );
    expect(result.blocking.join(' ')).toMatch(/pending, failed or removed/);
  });

  it('blocks archived or rights-unknown library assets', () => {
    const result = evaluateImageJobEligibility(
      baseEligibility({
        pins: [
          { pinType: 'library_asset', sourceRecordId: 'asset-1', sourceVersionId: 'v1', resolvedDetails: { versionStatus: 'locked' } },
        ],
        assets: { 'asset-1': { id: 'asset-1', status: 'archived', rightsStatus: 'confirmed' } },
      }),
    );
    expect(result.blocking.join(' ')).toMatch(/archived/);

    const rights = evaluateImageJobEligibility(
      baseEligibility({
        pins: [
          { pinType: 'library_asset', sourceRecordId: 'asset-1', sourceVersionId: 'v1', resolvedDetails: { versionStatus: 'locked' } },
        ],
        assets: { 'asset-1': { id: 'asset-1', status: 'ready', rightsStatus: 'unknown' } },
      }),
    );
    expect(rights.blocking.join(' ')).toMatch(/rights/);
  });

  it('blocks excessive per-job outputs and exhausted quotas', () => {
    const variants = evaluateImageJobEligibility(
      baseEligibility({ job: { id: JOB, status: 'draft', requestedOutputType: 'photo', requestedVariants: 99 } }),
    );
    expect(variants.blocking.join(' ')).toMatch(/per-job limit/);

    const quota = evaluateImageJobEligibility(
      baseEligibility({
        quotas: {
          maxOutputsPerJob: 4,
          maxJobsPerUserPerPeriod: 5,
          maxJobsPerWorkspacePerPeriod: 20,
          userJobsThisPeriod: 5,
          workspaceJobsThisPeriod: 0,
        },
      }),
    );
    expect(quota.blocking.join(' ')).toMatch(/allowance/);
  });
});

// ── Submission flow (spec cases 2, 5, 6, 8, 9) ──────────────────────────────

describe('submission flow', () => {
  it('fails closed when the provider is not configured', async () => {
    const repo = new MockGenerationRepository(); // defaults to disabled
    const { deps } = makeDeps();
    const service = new GenerationService(repo, deps);

    const result = await service.submitImageGeneration(JOB, WS, USER, GOOD_INPUT);
    expect(result.eligible).toBe(false);
    expect(result.blocking.join(' ')).toMatch(/not enabled/);
    expect(result.run).toBeNull();
  });

  it('is idempotent: a duplicate submission reuses the active run', async () => {
    const { service, repo } = await enabledService();
    const first = await service.submitImageGeneration(JOB, WS, USER, GOOD_INPUT);
    expect(first.reused).toBe(false);
    expect(first.run).toBeTruthy();

    const duplicate = await service.submitImageGeneration(JOB, WS, USER, GOOD_INPUT);
    expect(duplicate.reused).toBe(true);
    expect(duplicate.run?.id).toBe(first.run?.id);

    const runs = await repo.listRunsForJob(JOB);
    expect(runs).toHaveLength(1); // no duplicate billable attempt
  });

  it('records an audit trail for created runs and duplicates', async () => {
    const { service, repo } = await enabledService();
    await service.submitImageGeneration(JOB, WS, USER, GOOD_INPUT);
    await service.submitImageGeneration(JOB, WS, USER, GOOD_INPUT);

    const events = await repo.listAuditEventsForJob(JOB);
    const types = events.map((event) => event.eventType);
    expect(types).toContain('provider_run_created');
    expect(types).toContain('submission_requested');
    expect(types).toContain('provider_request_accepted');
    expect(types).toContain('status_update_received');
    expect(types).toContain('result_ingested');
    expect(types).toContain('output_created');
  });

  it('refuses a foreign-workspace job (rule 2)', async () => {
    const { deps } = makeDeps();
    const repo = new MockGenerationRepository();
    const service = new GenerationService(repo, deps);
    await expect(service.submitImageGeneration(JOB, OTHER_WS, USER, GOOD_INPUT)).rejects.toThrow(/workspace/);
  });
});

// ── Fake provider + ingestion (spec cases 9, 10, 11) ────────────────────────

describe('fake provider + ingestion', () => {
  it('completes through the guarded transitions and creates Gallery outputs', async () => {
    const { service, repo, store, transitions } = await enabledService();
    const result = await service.submitImageGeneration(JOB, WS, USER, GOOD_INPUT);
    expect(result.run?.status).toBe('completed');

    // Job path: draft → queued → review (provider boundary satisfied).
    expect(transitions).toEqual(['queued', 'review']);

    const events = await repo.listAuditEventsForJob(JOB);
    const outputEvents = events.filter((event) => event.eventType === 'output_created');
    expect(outputEvents.length).toBe(2); // requestedVariants = 2

    // Private media was stored under the canonical path pattern.
    const paths = [...store.objects.keys()];
    expect(paths.length).toBe(2);
    for (const path of paths) {
      expect(path.startsWith(`${GALLERY_MEDIA_BUCKET}/workspaces/${WS}/jobs/${JOB}/runs/`)).toBe(true);
      expect(path).toContain('/outputs/');
    }
  });

  it('keeps signed URLs out of stored snapshots', async () => {
    const { service, repo } = await enabledService();
    const result = await service.submitImageGeneration(JOB, WS, USER, {
      ...GOOD_INPUT,
      prompt: 'check-snapshots',
    });
    const run = await repo.getRun(result.run!.id);
    const serialized = JSON.stringify(run?.requestSnapshot ?? {});
    expect(serialized).not.toContain('mock-signed://');
    expect(serialized).not.toContain('http');
  });

  it('stores no Library assets anywhere in the ingestion path', async () => {
    const { service, store } = await enabledService();
    await service.submitImageGeneration(JOB, WS, USER, GOOD_INPUT);
    for (const key of store.objects.keys()) {
      expect(key.startsWith('library/') || key.includes('/library/')).toBe(false);
    }
  });
});

// ── Failure + retry (spec cases 8, 13, 14) ──────────────────────────────────

describe('failure handling + retry', () => {
  it('marks the run failed and preserves technical detail for audit only', async () => {
    const failing = {
      providerName: 'development-fake',
      isConfigured: async () => true,
      submitImageGeneration: async () => {
        throw new Error('provider 401 unauthorized');
      },
      getImageGenerationStatus: async () => ({ status: 'failed' as const }),
    };
    registerImageProvider(failing);

    const repo = new MockGenerationRepository();
    await repo.setConfig({
      imageGenerationEnabled: true,
      providerName: 'development-fake',
      imageMaxOutputsPerJob: 4,
      imageMaxJobsPerUserPerPeriod: 5,
      imageMaxJobsPerWorkspacePerPeriod: 20,
      videoGenerationEnabled: false,
      videoProviderName: 'none',
      videoMaxOutputsPerJob: 2,
      videoMaxJobsPerUserPerPeriod: 3,
      videoMaxJobsPerWorkspacePerPeriod: 10,
      videoMaxSecondsPerUserPerPeriod: 48,
      videoMaxSecondsPerWorkspacePerPeriod: 240,
    });
    const { deps } = makeDeps();
    const service = new GenerationService(repo, deps);
    const result = await service.submitImageGeneration(JOB, WS, USER, GOOD_INPUT);
    expect(result.run?.status).toBe('failed');
    expect(result.run?.errorCode).toBe('provider_auth');
    expect(result.run?.errorMessage).toContain('401');

    // Restore the deterministic fake for other tests.
    registerImageProvider(new DevelopmentFakeImageProvider());
  });

  it('retry appends a new attempt and reuses the same pins', async () => {
    // Force a failure first.
    const failing = {
      providerName: 'development-fake',
      isConfigured: async () => true,
      submitImageGeneration: async () => {
        throw new Error('network timeout');
      },
      getImageGenerationStatus: async () => ({ status: 'failed' as const }),
    };
    registerImageProvider(failing);
    const { service, repo } = await enabledService();
    const failed = await service.submitImageGeneration(JOB, WS, USER, GOOD_INPUT);
    expect(failed.run?.status).toBe('failed');
    registerImageProvider(new DevelopmentFakeImageProvider());

    const retry = await service.retryImageGeneration(JOB, WS, USER, GOOD_INPUT);
    expect(retry.run?.status).toBe('completed');
    expect(retry.run?.attemptNumber).toBe(2);

    const runs = await repo.listRunsForJob(JOB);
    expect(runs).toHaveLength(2);
    // Immutable pins: both attempts carry the same pin summary in snapshots.
    const pinSummaries = runs.map(
      (run) => (run.requestSnapshot as { metadata?: { pinSummary?: unknown } }).metadata?.pinSummary,
    );
    expect(JSON.stringify(pinSummaries[0])).toBe(JSON.stringify(pinSummaries[1]));
  });

  it('refuses retry when the latest run is not failed', async () => {
    const { service } = await enabledService();
    await service.submitImageGeneration(JOB, WS, USER, GOOD_INPUT); // completes
    await expect(service.retryImageGeneration(JOB, WS, USER, GOOD_INPUT)).rejects.toThrow(/only available for failed/);
  });
});

// ── Error mapping (spec case 8) ─────────────────────────────────────────────

describe('provider error mapping', () => {
  it('maps provider errors to safe messages with protected detail', () => {
    const mapped = mapProviderError(new Error('HTTP 429 rate limit exceeded'));
    expect(mapped.userMessage).toMatch(/rate limit/i);
    expect(mapped.protectedDetail).toContain('429');
    expect(mapped.userMessage).not.toContain('429');

    const secret = mapProviderError(new Error('auth failed for sk-verysecretkey123'));
    expect(secret.protectedDetail).not.toContain('sk-verysecretkey123');
    expect(secret.protectedDetail).toContain('sk-***');
  });
});

// ── Provider boundary (spec cases 1, 15) ────────────────────────────────────

describe('provider boundary', () => {
  it('registers only the fake provider (no real adapter ships yet)', () => {
    expect(listImageProviders()).toEqual(['development-fake']);
  });

  it('the fake provider is configured and never uses the network', async () => {
    const fake = new DevelopmentFakeImageProvider();
    expect(await fake.isConfigured()).toBe(true);
    const submitted = await fake.submitImageGeneration({
      idempotencyKey: 'k1',
      prompt: 'p',
      outputCount: 1,
      referenceImages: [],
      metadata: { lockflowJobId: 'j', workspaceId: WS, pinSummary: null },
    });
    expect(submitted.status).toBe('processing');
    const status = await fake.getImageGenerationStatus(submitted.providerRequestId);
    expect(status.status).toBe('completed');
    expect(status.results?.[0]?.mimeType).toBe('image/svg+xml');
    expect(status.providerMetadata).toMatchObject({ placeholder: true });
  });

  it('image-only: no video/story generation surface exists in the domain', () => {
    const serviceMethods = Object.getOwnPropertyNames(GenerationService.prototype);
    expect(serviceMethods.filter((name) => /video|story|publish/i.test(name))).toEqual([]);
  });
});

// ── Path construction (spec case 11) ────────────────────────────────────────

describe('private media paths', () => {
  it('follows the canonical pattern and is not a public URL', () => {
    const path = buildOutputMediaPath({
      workspaceId: WS,
      contentJobRequestId: JOB,
      providerRunId: 'run-1',
      galleryOutputId: 'out-1',
      safeFilename: 'Generated Image 1.png',
    });
    expect(path).toBe(`workspaces/${WS}/jobs/${JOB}/runs/run-1/outputs/out-1/generated-image-1.png`);
    expect(path.startsWith('http')).toBe(false);
  });
});

// ── Prompt 26: identity validation against protected Character Sheets ────────

describe('prompt 26 — identity validation against Character Sheets', () => {
  const mismatchingTraits = { 'faceFeatures.eyes': 'round, green' };

  function modelBridge(
    result: { valid: boolean; mismatches: string[]; protectedTraitCount: number } | null,
  ): Partial<GenerationDependencies> {
    return {
      models: {
        validateGenerationAgainstCharacterSheet: async () => result,
      },
    };
  }

  it('blocks submission when candidate traits mismatch the pinned model sheet', async () => {
    const { service, repo } = await enabledService(
      modelBridge({
        valid: false,
        mismatches: ['faceFeatures.eyes: expected "almond, dark brown", candidate "round, green"'],
        protectedTraitCount: 3,
      }),
    );
    const result = await service.submitImageGeneration(JOB, WS, USER, {
      ...GOOD_INPUT,
      identityTraits: { 'model-1': mismatchingTraits },
    });
    expect(result.run).toBeNull();
    expect(result.reused).toBe(false);
    expect(result.eligible).toBe(false);
    expect(result.blocking.join(' ')).toMatch(/identity mismatch/i);

    const events = await repo.listAuditEventsForJob(JOB);
    expect(events.map((event) => event.eventType)).toContain('character_sheet_generation_validation_failed');
  });

  it('passes matching traits and records the check in the run snapshot', async () => {
    const { service, repo } = await enabledService(
      modelBridge({ valid: true, mismatches: [], protectedTraitCount: 3 }),
    );
    const result = await service.submitImageGeneration(JOB, WS, USER, {
      ...GOOD_INPUT,
      identityTraits: { 'model-1': { 'faceFeatures.eyes': 'almond, dark brown' } },
    });
    expect(result.run?.status).toBe('completed');
    const run = await repo.getRun(result.run!.id);
    const checks = (
      run?.requestSnapshot as {
        identityValidation?: Array<{ status: string; protectedTraitCount: number }>;
      }
    ).identityValidation;
    expect(checks).toHaveLength(1);
    expect(checks?.[0]?.status).toBe('passed');
    expect(checks?.[0]?.protectedTraitCount).toBe(3);
  });

  it('records skipped — never guessed — when no candidate traits are supplied', async () => {
    const { service, repo } = await enabledService(
      modelBridge({ valid: true, mismatches: [], protectedTraitCount: 3 }),
    );
    const result = await service.submitImageGeneration(JOB, WS, USER, GOOD_INPUT);
    expect(result.run?.status).toBe('completed');
    const run = await repo.getRun(result.run!.id);
    const checks = (
      run?.requestSnapshot as { identityValidation?: Array<{ status: string }> }
    ).identityValidation;
    expect(checks?.[0]?.status).toBe('skipped');
  });

  it('blocks when the model has no active Character Sheet', async () => {
    const { service } = await enabledService(modelBridge(null));
    const result = await service.submitImageGeneration(JOB, WS, USER, {
      ...GOOD_INPUT,
      identityTraits: { 'model-1': mismatchingTraits },
    });
    expect(result.eligible).toBe(false);
    expect(result.blocking.join(' ')).toMatch(/no active Character Sheet/i);
  });

  it('skips identity validation entirely when the models bridge is absent', async () => {
    const { service, repo } = await enabledService();
    const result = await service.submitImageGeneration(JOB, WS, USER, {
      ...GOOD_INPUT,
      identityTraits: { 'model-1': mismatchingTraits },
    });
    expect(result.run?.status).toBe('completed');
    const run = await repo.getRun(result.run!.id);
    const checks = (
      run?.requestSnapshot as { identityValidation?: Array<{ status: string }> }
    ).identityValidation;
    expect(checks?.[0]?.status).toBe('skipped');
  });
});
