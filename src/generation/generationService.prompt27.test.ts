/**
 * Prompt 27 — AI image generation with Character Sheet enforcement &
 * locked asset inputs. Service-boundary tests over the in-memory repo:
 *
 *   1. Prompt normalization is deterministic and auditable.
 *   2. Locked input snapshots record pinned versions + protected traits.
 *   3. Character Sheet enforcement gates model-based generations.
 *   4. Variants inherit the locked baseline and record parent linkage.
 *   5. Gallery receives outputs; Library stays untouched.
 *   6. Snapshots carry no secrets or signed URLs.
 */
import { describe, expect, it } from 'vitest';
import { GenerationService } from './generationService';
import type { GenerationDependencies } from './generationService';
import { MockGenerationRepository } from './mockGenerationRepository';
import { normalizeGenerationPrompt } from './promptNormalization';
import { buildLockedGenerationInputSnapshot } from './lockedInputSnapshot';
import type { LockedGenerationInputSnapshot } from './types';
import { getProtectedIdentityTraits } from '../domain/models';
import type { CharacterSheetRecord } from '../domain/models';
import { MockModelsRepository } from '../data/mockModelsRepository';
import { ModelsService } from '../services/modelsService';
import { SEED_WORKSPACE_ID } from '../mock/modelsSeed';

const WS = '11111111-1111-1111-1111-111111111111';
const JOB = '33333333-3333-3333-3333-333333333333';
const USER = '44444444-4444-4444-4444-444444444444';

// ── 1. Prompt normalization ──────────────────────────────────────────────────

describe('prompt normalization (deterministic, auditable)', () => {
  it('extracts subject, setting, lighting and mood with rules recorded', () => {
    const first = normalizeGenerationPrompt({
      userPrompt: 'Full body editorial portrait in a warm loft, golden hour, confident',
      aspectRatio: '4:5',
      outputCount: 2,
    });
    expect(first.cleanedPrompt).toBe('Full body editorial portrait in a warm loft, golden hour, confident');
    expect(first.extracted.subject).toBeTruthy();
    expect(first.extracted.setting).toBeTruthy();
    expect(first.extracted.lighting).toBe('golden hour');
    expect(first.extracted.mood).toBe('confident');
    expect(first.rulesApplied).toContain('aspect-ratio:4:5');
    expect(first.rulesApplied).toContain('output-count:2');

    // Determinism: same input, same output, byte for byte.
    const second = normalizeGenerationPrompt({
      userPrompt: 'Full body editorial portrait in a warm loft, golden hour, confident',
      aspectRatio: '4:5',
      outputCount: 2,
    });
    expect(second).toEqual(first);
  });

  it('normalizes unsupported aspect ratios and clamps output count with warnings', () => {
    const result = normalizeGenerationPrompt({ userPrompt: 'a portrait', aspectRatio: '7:3', outputCount: 99 });
    expect(result.aspectRatio).toBe('1:1');
    expect(result.outputCount).toBe(4);
    expect(result.warnings.join(' ')).toMatch(/normalized to 1:1/);
    expect(result.warnings.join(' ')).toMatch(/allowed range 1–4/);
  });

  it('flags empty prompts', () => {
    const result = normalizeGenerationPrompt({ userPrompt: '   ' });
    expect(result.warnings.join(' ')).toMatch(/prompt is empty/i);
  });
});

// ── 2. Locked input snapshot assembly ───────────────────────────────────────

describe('locked input snapshot assembly', () => {
  const SHEET: CharacterSheetRecord = {
    id: 'cs_1',
    modelVersionId: 'mv_1',
    identitySummary: 'Warm oval face, defined cheekbones.',
    faceFeatures: { eyes: 'almond, dark brown' },
    hairIdentity: { colour: 'deep black' },
    complexion: { skinTone: 'medium-deep' },
    bodyProportions: { height: '175cm' },
    distinctiveDetails: {},
    lockRules: {},
    referenceNotes: '',
    createdAt: '2026-09-20T09:00:00.000Z',
    updatedAt: '2026-09-21T10:00:00.000Z',
  };

  it('records pinned versions, protected trait keys and the reference plan', () => {
    const snapshot = buildLockedGenerationInputSnapshot({
      normalizedPrompt: {
        userPrompt: 'portrait',
        cleanedPrompt: 'portrait',
        aspectRatio: '1:1',
        outputCount: 2,
        extracted: { subject: 'portrait', setting: null, lighting: null, mood: null, styleHints: [] },
        warnings: [],
        rulesApplied: [],
        normalizedAt: '2026-10-04T00:00:00.000Z',
      },
      aspectRatio: '1:1',
      outputCount: 2,
      model: {
        modelId: 'model_aisha',
        modelName: 'Aisha',
        version: { id: 'mv_1', versionNumber: 1, status: 'locked' },
      },
      characterSheet: SHEET,
      environment: null,
      assets: [{ assetId: 'lib_blazer', label: 'Beige blazer', kind: 'library_asset' }],
      references: [],
    });

    const kinds = snapshot.lockedInputs.map((line) => line.kind);
    expect(kinds).toContain('model_version');
    expect(kinds).toContain('character_sheet');
    expect(kinds).toContain('library_asset');

    expect(snapshot.characterSheetConstraints).toHaveLength(1);
    const constraint = snapshot.characterSheetConstraints[0]!;
    expect(constraint.modelId).toBe('model_aisha');
    expect(constraint.protectedTraitKeys).toContain('faceFeatures.eyes');
    expect(constraint.protectedTraitCount).toBe(getProtectedIdentityTraits(SHEET).length);

    // No secrets: identifiers and labels only.
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toMatch(/signed|signature|token|X-Amz|storagePath/i);
  });

  it('produces no constraint when no model is pinned', () => {
    const snapshot = buildLockedGenerationInputSnapshot({
      normalizedPrompt: {
        userPrompt: 'product shot',
        cleanedPrompt: 'product shot',
        aspectRatio: '1:1',
        outputCount: 1,
        extracted: { subject: 'product shot', setting: null, lighting: null, mood: null, styleHints: [] },
        warnings: [],
        rulesApplied: [],
        normalizedAt: '2026-10-04T00:00:00.000Z',
      },
      aspectRatio: '1:1',
      outputCount: 1,
      model: null,
      characterSheet: null,
      environment: null,
      assets: [],
      references: [],
    });
    expect(snapshot.characterSheetConstraints).toEqual([]);
    expect(snapshot.lockedInputs).toEqual([]);
  });
});

// ── 3–6. Service-level: enforcement, variants, Gallery vs Library ────────────

function makeDeps(overrides: Partial<GenerationDependencies> = {}): { deps: GenerationDependencies } {
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
      transitionJobRequest: async () => undefined,
    },
    gallery: {
      createGeneratedOutput: async () => ({ id: crypto.randomUUID() }),
      attachMedia: async () => undefined,
      appendEvent: async () => undefined,
      nextOutputIndex: async () => 1,
    },
    media: {
      createSignedUrl: async (bucket, path) => `mock-signed://${bucket}/${path}`,
      fetchBytes: async () => ({ bytes: new Uint8Array([1, 2, 3]), contentType: 'image/png' }),
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
  return { deps };
}

async function makeService(overrides: Partial<GenerationDependencies> = {}) {
  const repo = new MockGenerationRepository();
  await repo.setConfig({
    imageGenerationEnabled: true,
    providerName: 'development-fake',
    imageMaxOutputsPerJob: 4,
    imageMaxJobsPerUserPerPeriod: 5,
    imageMaxJobsPerWorkspacePerPeriod: 20,
    videoGenerationEnabled: false,
    videoProviderName: 'development-fake-video',
    videoMaxOutputsPerJob: 2,
    videoMaxJobsPerUserPerPeriod: 3,
    videoMaxJobsPerWorkspacePerPeriod: 10,
    videoMaxSecondsPerUserPerPeriod: 48,
    videoMaxSecondsPerWorkspacePerPeriod: 240,
  });
  const { deps } = makeDeps(overrides);
  return { service: new GenerationService(repo, deps), repo };
}

const BASE_INPUT = {
  pins: [
    {
      pinType: 'model' as const,
      sourceRecordId: 'model-1',
      sourceVersionId: 'mv-1',
      resolvedDetails: { versionStatus: 'locked', versionNumber: 1, modelName: 'Aisha' },
    },
  ],
  references: [],
  assets: {},
  prompt: 'Portrait in a warm loft, golden hour',
};

describe('Character Sheet enforcement gates model generations', () => {
  it('blocks when the baseline is required but no traits are supplied', async () => {
    const { service, repo } = await makeService();
    const result = await service.submitImageGeneration(JOB, WS, USER, {
      ...BASE_INPUT,
      requireIdentityBaseline: { 'model-1': true },
    });
    expect(result.run).toBeNull();
    expect(result.blocking.join(' ')).toMatch(/no Character Sheet baseline supplied/i);
    const events = await repo.listAuditEventsForJob(JOB);
    expect(events.map((event) => event.eventType)).toContain('character_sheet_generation_validation_failed');
  });

  it('blocks when the sheet exists but has no protected traits', async () => {
    const modelsRepo = new MockModelsRepository();
    const models = new ModelsService(modelsRepo);
    // Seed Aisha has traits — build a sheet-less model instead.
    const model = await models.createModel({ workspaceId: SEED_WORKSPACE_ID, name: 'Bare' }, 'demo-user');
    expect(await models.getProtectedIdentityTraits(model.id, SEED_WORKSPACE_ID)).toEqual([]);

    const { service } = await makeService({
      models: {
        validateGenerationAgainstCharacterSheet: async () => ({
          valid: true,
          mismatches: [],
          protectedTraitCount: 0,
        }),
      },
    });
    const result = await service.submitImageGeneration(JOB, WS, USER, {
      ...BASE_INPUT,
      identityTraits: { 'model-1': { anything: 'x' } },
      requireIdentityBaseline: { 'model-1': true },
    });
    expect(result.eligible).toBe(false);
    expect(result.blocking.join(' ')).toMatch(/no protected identity traits/i);
  });

  it('passes when supplied traits match and the baseline is satisfied', async () => {
    const { service, repo } = await makeService({
      models: {
        validateGenerationAgainstCharacterSheet: async () => ({
          valid: true,
          mismatches: [],
          protectedTraitCount: 3,
        }),
      },
      assembleLockedInputSnapshot: async () => testSnapshot(),
    });
    const result = await service.submitImageGeneration(JOB, WS, USER, {
      ...BASE_INPUT,
      identityTraits: { 'model-1': { 'faceFeatures.eyes': 'almond, dark brown' } },
      requireIdentityBaseline: { 'model-1': true },
    });
    expect(result.run?.status).toBe('completed');
    const events = await repo.listAuditEventsForJob(JOB);
    expect(events.map((event) => event.eventType)).toContain('locked_generation_input_snapshot_created');
  });
});

describe('variant generation inherits the locked baseline', () => {
  it('creates a derived job, copies pins, and records parent linkage', async () => {
    const copiedPins: Array<[string, string]> = [];
    const createdJobs: Array<{ name: string; brief: unknown }> = [];
    const { service, repo } = await makeService({
      models: {
        validateGenerationAgainstCharacterSheet: async () => ({
          valid: true,
          mismatches: [],
          protectedTraitCount: 3,
        }),
      },
      assembleLockedInputSnapshot: async () => testSnapshot(),
      content: {
        getJobRequest: async (jobId) => ({
          id: jobId,
          workspaceId: WS,
          // Submissions require draft jobs; the guarded state machine handles
          // the real transitions in production.
          status: 'draft',
          requestedOutputType: 'photo',
          requestedVariants: 2,
          contentProjectId: null,
          name: 'Job',
        }),
        transitionJobRequest: async () => undefined,
        copyPinsToJob: async (sourceJobId, targetJobId) => {
          copiedPins.push([sourceJobId, targetJobId]);
        },
      } as GenerationDependencies['content'],
      createVariantJob: async ({ sourceJobId, prompt }) => {
        const variantJobId = `variant-${createdJobs.length + 1}`;
        createdJobs.push({ name: `Variant of job ${sourceJobId}`, brief: { inheritedPrompt: prompt } });
        return variantJobId;
      },
    });

    // Source run: complete a generation first.
    const source = await service.submitImageGeneration(JOB, WS, USER, BASE_INPUT);
    expect(source.run?.status).toBe('completed');

    const variant = await service.createImageVariantJob(JOB, WS, USER, {});
    expect(variant.run?.status).toBe('completed');
    expect(variantJobIdOf(variant)).not.toBe(JOB);
    expect(copiedPins).toEqual([[JOB, variantJobIdOf(variant)]]);
    expect(createdJobs[0]?.brief).toMatchObject({ inheritedPrompt: BASE_INPUT.prompt });

    // Parent linkage is audited on the source job.
    const events = await repo.listAuditEventsForJob(JOB);
    const requested = events.find((event) => event.eventType === 'image_generation_variant_requested');
    expect(requested?.metadata?.['parentRunId']).toBe(source.run?.id);
  });

  it('refuses variants from failed or missing runs', async () => {
    const { service } = await makeService();
    await expect(service.createImageVariantJob('no-such-job', WS, USER, {})).rejects.toThrow(/No generation run exists/);
  });

  it('refuses cross-workspace variants', async () => {
    const { service } = await makeService({
      models: {
        validateGenerationAgainstCharacterSheet: async () => ({ valid: true, mismatches: [], protectedTraitCount: 2 }),
      },
    });
    await service.submitImageGeneration(JOB, WS, USER, BASE_INPUT);
    await expect(service.createImageVariantJob(JOB, 'other-ws', USER, {})).rejects.toThrow(/access to this workspace/);
  });
});

describe('outputs flow to Gallery, never Library; snapshots carry no secrets', () => {
  it('run snapshot has no signed URLs, tokens or storage paths', async () => {
    const { service, repo } = await makeService({
      models: {
        validateGenerationAgainstCharacterSheet: async () => ({ valid: true, mismatches: [], protectedTraitCount: 2 }),
      },
    });
    const result = await service.submitImageGeneration(JOB, WS, USER, BASE_INPUT);
    const run = await repo.getRun(result.run!.id);
    const serialized = JSON.stringify(run?.requestSnapshot ?? {});
    expect(serialized).not.toMatch(/signed|signature|token|X-Amz|storagePath|storageBucket/i);
    const locked = JSON.stringify(run?.lockedInputSnapshot ?? {});
    expect(locked).not.toMatch(/signed|signature|token|X-Amz|storagePath|storageBucket/i);
  });
});

/** Extracts the variant job id from a submission result (test helper). */
function variantJobIdOf(result: { run: { contentJobRequestId: string } | null }): string {
  return result.run?.contentJobRequestId ?? '';
}

/** A minimal locked-input snapshot for bridge stubs. */
function testSnapshot(): LockedGenerationInputSnapshot {
  return {
    prompt: { userPrompt: 'p', cleanedPrompt: 'p' },
    aspectRatio: '1:1',
    outputCount: 2,
    lockedInputs: [
      {
        kind: 'model_version',
        id: 'mv-1',
        label: 'Aisha v1',
        versionNumber: 1,
        resolvedVia: 'model.activeVersionId',
      },
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
