/**
 * Continuity Quality Review & Correction Workflow — product contracts,
 * tested at the service boundary over the in-memory repository (mirrors the
 * SQL semantics). Maps to the 14 required test cases.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { GalleryService } from '../services/galleryService';
import type { ContentStudioBridges } from '../services/contentService';
import { ContentStudioService } from '../services/contentService';
import { LibraryService } from '../services/libraryService';
import { ModelsService } from '../services/modelsService';
import { EnvironmentsService } from '../services/environmentsService';
import { getGalleryRepository, resetGalleryRepository } from '../data/galleryFactory';
import { getContentRepository, resetContentRepository } from '../data/contentFactory';
import { getLibraryRepository, resetLibraryRepository } from '../data/libraryFactory';
import { getModelsRepository, resetModelsRepository } from '../data';
import { getEnvironmentsRepository, resetEnvironmentsRepository } from '../data/environmentsFactory';
import { CONTENT_JOB_REQUEST_ID, CONTENT_PROJECT_ID } from '../mock/contentSeed';
import { GALLERY_OUTPUT_SEED_IDS, SEED_GALLERY_WORKSPACE_ID } from '../mock/gallerySeed';
import { SEED_LIBRARY_OTHER_WORKSPACE_ID } from '../mock/librarySeed';
import { classifyCorrectionRequest } from './classifier';
import { computeIssueKey, computeSourceContextHash, escalationLevelFor, recommendationFor } from './escalation';
import { buildPinSnapshot, buildSourceSnapshot, projectPins } from './provenanceSnapshotBuilder';
import { MockQualityRepository } from './mockQualityRepository';
import { QualityReviewService } from './qualityReviewService';
import {
  CORRECTION_SUBMISSION_UNAVAILABLE,
  CorrectionRequestService,
} from './correctionRequestService';
import type { CorrectionGenerationBoundary } from './correctionRequestService';
import type { PinProjection } from './types';

const WS = SEED_GALLERY_WORKSPACE_ID;
const OTHER_WS = SEED_LIBRARY_OTHER_WORKSPACE_ID;

let gallery: GalleryService;
let content: ContentStudioService;
let reviews: QualityReviewService;
let corrections: CorrectionRequestService;
let repo: MockQualityRepository;

beforeEach(async () => {
  resetGalleryRepository();
  resetContentRepository();
  resetLibraryRepository();
  resetModelsRepository();
  resetEnvironmentsRepository();

  const bridges: ContentStudioBridges = {
    library: new LibraryService(getLibraryRepository()),
    models: new ModelsService(getModelsRepository()),
    environments: new EnvironmentsService(getEnvironmentsRepository()),
  };
  content = new ContentStudioService(getContentRepository(), bridges);
  gallery = new GalleryService(getGalleryRepository(), content, WS);
  // The seeded job starts as a draft without pins — prepare the immutable
  // pin set so provenance (and therefore expected context) exists.
  await content.createJobPinsFromProject(CONTENT_JOB_REQUEST_ID, CONTENT_PROJECT_ID, WS);

  repo = new MockQualityRepository();
  const resolveProvenance = (outputId: string, workspaceId: string) =>
    gallery.resolveProvenance(outputId, workspaceId);
  reviews = new QualityReviewService(repo, repo, repo, resolveProvenance);
  corrections = new CorrectionRequestService(repo, repo, repo, resolveProvenance, null);
});

const OUTPUT = GALLERY_OUTPUT_SEED_IDS.vanity;

async function newDraftReview(outputId = OUTPUT) {
  return reviews.createDraftReview(outputId, WS);
}

async function completeReviewWithFinding(
  category: Parameters<QualityReviewService['addFinding']>[1] extends never ? never : Record<string, unknown>,
) {
  const review = await newDraftReview();
  await reviews.addFinding(review.id, category, WS);
  return reviews.completeReview(review.id, WS);
}

// ── 1. Expected context resolves exact pins, not newer versions ─────────────
describe('case 1 — expected context resolves exact immutable pins', () => {
  it('captures pinned version ids from job pins at review creation', async () => {
    const provenance = await gallery.resolveProvenance(OUTPUT, WS);
    const review = await newDraftReview();
    const finding = await reviews.addFinding(
      review.id,
      { category: 'face', result: 'warning', severity: 'medium', observedNote: 'Looks slightly different.' },
      WS,
    );
    const pinnedVersions = (finding.expectedContext.pinned_versions ?? []) as Array<Record<string, unknown>>;
    expect(pinnedVersions.length).toBeGreaterThan(0);
    // Category scoping: a face finding expects exactly the MODEL pins.
    const modelPinIds = provenance.pins.filter((pin) => pin.pinType === 'model_version').map((pin) => pin.sourceVersionId).sort();
    expect(pinnedVersions.map((p) => p.source_version_id).sort()).toEqual(modelPinIds);
    expect(modelPinIds.length).toBeGreaterThan(0);
    // A different category scopes to different pins (product → library pins).
    const productFinding = await reviews.addFinding(
      review.id,
      { category: 'product', result: 'pass' },
      WS,
    );
    const productPins = (productFinding.expectedContext.pinned_versions ?? []) as Array<Record<string, unknown>>;
    const libraryPinIds = provenance.pins
      .filter((pin) => pin.pinType === 'library_asset_version' || pin.pinType === 'look_version')
      .map((pin) => pin.sourceVersionId)
      .sort();
    expect(productPins.map((p) => p.source_version_id).sort()).toEqual(libraryPinIds);
  });

  it('pin snapshot freezes exact version ids and stays stable', () => {
    const pins = [
      {
        id: 'pin-1',
        contentJobRequestId: 'job-1',
        pinType: 'model_version' as const,
        sourceRecordId: 'model-1',
        sourceVersionId: 'mv-1',
        resolvedDetails: { modelName: 'Ava', versionNumber: 2, versionStatus: 'locked', lockedAt: '2026-09-27' },
        role: 'primary' as never,
        sortOrder: 0,
        createdAt: '2026-09-27',
      },
    ];
    const snapshot = buildPinSnapshot(pins);
    expect((snapshot.pins as Array<Record<string, unknown>>)[0].source_version_id).toBe('mv-1');
    expect((snapshot.pins as Array<Record<string, unknown>>)[0].version_number).toBe(2);
    // A "newer" version elsewhere never appears: the snapshot only has what
    // was pinned.
    expect(JSON.stringify(snapshot)).not.toContain('mv-2');
  });

  it('source snapshot carries output/job identity without media or URLs', async () => {
    const provenance = await gallery.resolveProvenance(OUTPUT, WS);
    const snapshot = buildSourceSnapshot({
      job: {
        id: provenance.job.id,
        name: provenance.job.name,
        contentProjectId: provenance.job.contentProjectId,
        requestedOutputType: String(provenance.job.requestedOutputType),
      },
      project: provenance.project ? { id: provenance.project.id, name: provenance.project.name } : null,
      pins: provenance.pins,
      outputMetadata: {},
      output: { id: OUTPUT, title: 'Morning Vanity Setup', outputType: 'image', outputIndex: 1 },
    });
    const text = JSON.stringify(snapshot).toLowerCase();
    expect(text).not.toContain('http');
    expect(text).not.toContain('bearer');
    expect((snapshot.gallery_output as Record<string, unknown>).id).toBe(OUTPUT);
  });
});

// ── 2/12. Findings never mutate sources; Gallery vs Library separation ──────
describe('cases 2+12 — findings cannot mutate sources; Gallery vs Library separation', () => {
  it('quality repositories expose no source/library mutation operations', () => {
    const qualityKeys = Object.getOwnPropertyNames(MockQualityRepository.prototype);
    for (const key of qualityKeys) {
      expect(/model|environment|library|asset|look|pin|output|media|storage/i.test(key) && !/get|list|expectedContext|snapshot|resolve/i.test(key)).toBe(false);
    }
    // The service constructors take only quality repos + a read-only resolver.
    expect(typeof reviews.addFinding).toBe('function');
    expect(typeof reviews.updateFinding).toBe('function');
  });

  it('library assets are untouched by a full review+correction cycle', async () => {
    const library = new LibraryService(getLibraryRepository());
    const assetsBefore = JSON.stringify(await library.listAssets(WS)).length;
    const review = await newDraftReview();
    await reviews.addFinding(review.id, { category: 'product', result: 'warning' }, WS);
    await reviews.completeReview(review.id, WS);
    await corrections.createDraftCorrection(
      { workspaceId: WS, sourceGalleryOutputId: OUTPUT, title: 'Shift product left', requestedChange: 'Move the serum bottle toward the left third.', scope: 'product_framing' },
      WS,
    );
    expect(JSON.stringify(await library.listAssets(WS)).length).toBe(assetsBefore);
  });
});

// ── 3. Completed reviews are read-only ──────────────────────────────────────
describe('case 3 — completed quality reviews are read-only', () => {
  it('findings and summary cannot change after completion', async () => {
    const review = await newDraftReview();
    await reviews.addFinding(review.id, { category: 'camera', result: 'pass' }, WS);
    await reviews.completeReview(review.id, WS);
    await expect(reviews.addFinding(review.id, { category: 'camera', result: 'fail' }, WS)).rejects.toThrow(/read-only/i);
    await expect(reviews.updateSummary(review.id, 'late edit', WS)).rejects.toThrow(/read-only/i);
    const finding = (await reviews.listFindings(review.id, WS))[0];
    await expect(reviews.updateFinding(finding.id, { result: 'fail' }, WS)).rejects.toThrow(/read-only/i);
  });

  it('deleting a finding after completion is refused', async () => {
    const review = await newDraftReview();
    const finding = await reviews.addFinding(review.id, { category: 'lighting', result: 'warning' }, WS);
    await reviews.completeReview(review.id, WS);
    await expect(reviews.deleteFinding(finding.id, WS)).rejects.toThrow(/read-only/i);
  });
});

// ── 4/5. Provenance preserved; snapshots freeze; no newer substitution ──────
describe('cases 4+5 — provenance preserved and frozen; no newer-version substitution', () => {
  it('snapshots freeze on readiness and cannot be edited afterwards', async () => {
    const created = await corrections.createDraftCorrection(
      { workspaceId: WS, sourceGalleryOutputId: OUTPUT, title: 'Tighter crop', requestedChange: 'Crop tighter on the vanity surface.', scope: 'framing' },
      WS,
    );
    await expect(corrections.updateDraftCorrection(created.id, { title: 'Renamed' }, WS)).resolves.toBeTruthy();
    const ready = await corrections.markReady(created.id, WS);
    expect(ready).toHaveProperty('request');
    if (!('blocked' in ready)) {
      await expect(
        corrections.updateDraftCorrection(created.id, { title: 'After ready' }, WS),
      ).rejects.toThrow();
    }
    // Repository has no snapshot update path at all.
    const keys = Object.getOwnPropertyNames(MockQualityRepository.prototype);
    expect(keys.some((key) => /updateSnap|rewriteSnap/i.test(key))).toBe(false);
  });

  it('pin snapshot retains original version ids on ready/submission path', async () => {
    const created = await corrections.createDraftCorrection(
      { workspaceId: WS, sourceGalleryOutputId: OUTPUT, title: 'Prompt clarity pass', requestedChange: 'Clarify the overlay wording direction.', scope: 'prompt_direction' },
      WS,
    );
    const pinned = (created.pinSnapshot.pins as Array<Record<string, unknown>>).map((p) => p.source_version_id);
    expect(pinned.length).toBeGreaterThan(0);
    const ready = await corrections.markReady(created.id, WS);
    if (!('blocked' in ready)) {
      expect((ready.request.pinSnapshot.pins as Array<Record<string, unknown>>).map((p) => p.source_version_id)).toEqual(pinned);
    }
  });
});

// ── 6/7. Classifier blocks source changes; permitted scopes are limited ─────
describe('cases 6+7 — source-change classifier and scope limits', () => {
  const pins: PinProjection[] = [
    { pinType: 'model_version', sourceRecordId: 'model-1', sourceVersionId: 'mv-1', label: 'Ava v1', versionNumber: 1, role: 'primary', resolvedVia: null },
    { pinType: 'environment_version', sourceRecordId: 'env-1', sourceVersionId: 'ev-1', label: 'Warm Bedroom Studio v1', versionNumber: 1, role: 'primary', resolvedVia: null },
    { pinType: 'library_asset_version', sourceRecordId: 'asset-1', sourceVersionId: 'av-1', label: 'Serum Bottle v1', versionNumber: 1, role: 'primary', resolvedVia: null },
  ];

  it('blocks identity/protected-trait findings as requiring a new Model version', () => {
    for (const category of ['model_identity', 'face', 'hairstyle', 'skin_tone', 'body_proportions'] as const) {
      const result = classifyCorrectionRequest({
        requestedChange: 'Make the face match the approved reference.',
        scope: 'other',
        findingCategories: [category],
        pins,
      });
      expect(result.sourceChangeRequired).toBe(true);
      expect(result.targets.map((t) => t.target)).toContain('model');
      expect(result.explanation).toMatch(/new approved Model version/i);
      expect(result.targets[0].links[0].href).toBe('/models/model-1');
    }
  });

  it('blocks environment-anchor findings as requiring a new Environment version', () => {
    for (const category of ['environment_layout', 'furniture_anchor'] as const) {
      const result = classifyCorrectionRequest({
        requestedChange: 'Move the bed to the other wall.',
        scope: 'other',
        findingCategories: [category],
        pins,
      });
      expect(result.sourceChangeRequired).toBe(true);
      expect(result.targets.map((t) => t.target)).toContain('environment');
      expect(result.targets[0].links[0].href).toBe('/environments/env-1');
    }
  });

  it('blocks product/wardrobe redesign requests as asset-configuration changes', () => {
    const result = classifyCorrectionRequest({
      requestedChange: 'Replace the product bottle with a redesigned label.',
      scope: 'other',
      findingCategories: ['product'],
      pins,
    });
    expect(result.sourceChangeRequired).toBe(true);
    expect(result.targets.map((t) => t.target)).toContain('library_asset_or_look');
  });

  it('permits direction/framing/composition/motion-style corrections', () => {
    const permitted: Array<{ requestedChange: string; scope: string; categories: Parameters<typeof classifyCorrectionRequest>[0]['findingCategories'] }> = [
      { requestedChange: 'Crop tighter on the vanity.', scope: 'framing', categories: ['composition'] },
      { requestedChange: 'Push the camera slightly left.', scope: 'camera', categories: ['camera'] },
      { requestedChange: 'Soften the lighting mood.', scope: 'lighting', categories: ['lighting'] },
      { requestedChange: 'Slow the motion direction.', scope: 'motion', categories: ['motion'] },
      { requestedChange: 'Clarify the overlay wording.', scope: 'prompt_direction', categories: ['text_overlay'] },
    ];
    for (const entry of permitted) {
      const result = classifyCorrectionRequest({
        requestedChange: entry.requestedChange,
        scope: entry.scope,
        findingCategories: entry.categories,
        pins,
      });
      expect(result.sourceChangeRequired).toBe(false);
    }
  });

  it('scope enum is limited to the permitted correction scopes', async () => {
    await expect(
      corrections.createDraftCorrection(
        { workspaceId: WS, sourceGalleryOutputId: OUTPUT, title: 'Bad scope', requestedChange: 'x'.repeat(10), scope: 'identity_surgery' },
        WS,
      ),
    ).rejects.toThrow(/scope/i);
  });
});

// ── 8. Cross-workspace access denied everywhere ──────────────────────────────
describe('case 8 — cross-workspace reviews, findings, corrections, issues denied', () => {
  it('reviews and corrections from another workspace are invisible and refused', async () => {
    await expect(reviews.createDraftReview(OUTPUT, OTHER_WS)).rejects.toThrow();
    const created = await corrections.createDraftCorrection(
      { workspaceId: WS, sourceGalleryOutputId: OUTPUT, title: 'WS-bound', requestedChange: 'Shift composition right.', scope: 'composition' },
      WS,
    );
    await expect(corrections.getCorrectionRequest(created.id, OTHER_WS)).rejects.toThrow(/Cross-workspace|not found/i);
    await expect(reviews.listReviewsForOutput(OUTPUT, OTHER_WS)).rejects.toThrow();
  });

  it('recurring issue aggregates never leak across workspaces', async () => {
    await repo.recordOccurrence({ workspaceId: WS, issueKey: 'k1', category: 'face', sourceContextHash: 'h1' });
    const other = await repo.getIssue('k1', OTHER_WS);
    expect(other).toBeNull();
  });
});

// ── 9. Escalation levels advance without leaks ───────────────────────────────
describe('case 9 — recurring escalation advances correctly', () => {
  it('advances first_notice → strengthen_references → constrain_prompt → provider_review', async () => {
    const first = await repo.recordOccurrence({ workspaceId: WS, issueKey: 'k2', category: 'lighting', sourceContextHash: 'h2' });
    expect(first.escalationLevel).toBe('first_notice');
    expect(recommendationFor(first.escalationLevel)).toMatch(/clearer direction/i);
    const second = await repo.recordOccurrence({ workspaceId: WS, issueKey: 'k2', category: 'lighting', sourceContextHash: 'h2' });
    expect(second.escalationLevel).toBe('strengthen_references');
    expect(recommendationFor(second.escalationLevel)).toMatch(/stronger|more specific approved references/i);
    const third = await repo.recordOccurrence({ workspaceId: WS, issueKey: 'k2', category: 'lighting', sourceContextHash: 'h2' });
    expect(third.escalationLevel).toBe('constrain_prompt');
    const fourth = await repo.recordOccurrence({ workspaceId: WS, issueKey: 'k2', category: 'lighting', sourceContextHash: 'h2' });
    expect(fourth.escalationLevel).toBe('provider_review');
    expect(recommendationFor(fourth.escalationLevel)).toMatch(/recurring/i);
  });

  it('completing reviews with warnings records occurrences per category+pin hash', async () => {
    const provenance = await gallery.resolveProvenance(OUTPUT, WS);
    const hash = computeSourceContextHash(projectPins(provenance.pins));
    await completeReviewWithFinding({ category: 'composition', result: 'warning', severity: 'low' });
    await completeReviewWithFinding({ category: 'composition', result: 'warning', severity: 'low' });
    const issue = await repo.getIssue(computeIssueKey('composition', hash), WS);
    expect(issue?.occurrenceCount).toBe(2);
    expect(issue?.escalationLevel).toBe('strengthen_references');
  });

  it('issue keys differ for different pin contexts', () => {
    const a = computeIssueKey('face', 'aaaa1111');
    const b = computeIssueKey('face', 'bbbb2222');
    expect(a).not.toBe(b);
  });

  it('escalation level function matches the documented thresholds', () => {
    expect(escalationLevelFor(1)).toBe('first_notice');
    expect(escalationLevelFor(2)).toBe('strengthen_references');
    expect(escalationLevelFor(3)).toBe('constrain_prompt');
    expect(escalationLevelFor(4)).toBe('provider_review');
    expect(escalationLevelFor(9)).toBe('provider_review');
  });
});

// ── 10/11. Generation boundary: quality never calls providers directly ──────
describe('cases 10+11 — provider boundary and derivative outputs', () => {
  it('submission is refused with honest copy while the boundary is unwired', async () => {
    const created = await corrections.createDraftCorrection(
      { workspaceId: WS, sourceGalleryOutputId: OUTPUT, title: 'Nudge framing', requestedChange: 'Reframe slightly left.', scope: 'framing' },
      WS,
    );
    const ready = await corrections.markReady(created.id, WS);
    if ('blocked' in ready) throw new Error('unexpected source-change block');
    const submitted = await corrections.submitCorrection(created.id, WS);
    expect(submitted.status).toBe('unavailable');
    if (submitted.status === 'unavailable') {
      expect(submitted.message).toBe(CORRECTION_SUBMISSION_UNAVAILABLE);
      expect(submitted.request.status).toBe('ready');
    }
    const events = await corrections.listEvents(created.id, WS);
    expect(events.some((event) => event.eventType === 'validation_failed')).toBe(true);
  });

  it('only the injected boundary can create runs; derivative outputs carry parent + pins', async () => {
    const created: string[] = [];
    const boundary: CorrectionGenerationBoundary = {
      submitCorrection: async () => {
        created.push('run');
        return { providerRunId: 'run-1', galleryOutputId: 'out-1' };
      },
    };
    const wired = new CorrectionRequestService(repo, repo, repo, (outputId, workspaceId) => gallery.resolveProvenance(outputId, workspaceId), boundary);
    const draft = await corrections.createDraftCorrection(
      { workspaceId: WS, sourceGalleryOutputId: OUTPUT, title: 'Boundary test', requestedChange: 'Slight camera shift.', scope: 'camera' },
      WS,
    );
    const ready = await wired.markReady(draft.id, WS);
    if ('blocked' in ready) throw new Error('unexpected source-change block');
    const submitted = await wired.submitCorrection(draft.id, WS);
    expect(submitted.status).toBe('submitted');
    if (submitted.status === 'submitted') {
      expect(submitted.providerRunId).toBe('run-1');
      expect(submitted.galleryOutputId).toBe('out-1');
    }
    expect(created).toEqual(['run']);
    // Events show the full chain without any secret material.
    const events = await wired.listEvents(draft.id, WS);
    expect(events.map((event) => event.eventType)).toEqual(
      expect.arrayContaining(['submitted', 'provider_accepted', 'output_created']),
    );
    const serialized = JSON.stringify(events).toLowerCase();
    expect(serialized).not.toContain('http');
    expect(serialized).not.toContain('bearer');
  });

  it('cannot submit a draft correction (must be marked ready first)', async () => {
    const created = await corrections.createDraftCorrection(
      { workspaceId: WS, sourceGalleryOutputId: OUTPUT, title: 'Draft submit refused', requestedChange: 'Adjust crop.', scope: 'framing' },
      WS,
    );
    await expect(corrections.submitCorrection(created.id, WS)).rejects.toThrow(/cannot be submitted/i);
  });
});

// ── 13. No secrets/URLs/raw media in snapshots or events ─────────────────────
describe('case 13 — no secrets, signed URLs or raw media in records', () => {
  it('snapshots, expected context and events never contain URL/secret markers', async () => {
    const review = await newDraftReview();
    await reviews.addFinding(review.id, { category: 'skin_tone', result: 'pass' }, WS);
    const completed = await reviews.completeReview(review.id, WS);
    const created = await corrections.createDraftCorrection(
      { workspaceId: WS, sourceGalleryOutputId: OUTPUT, title: 'Clean records', requestedChange: 'Slight exposure mood.', scope: 'lighting' },
      WS,
    );
    const ready = await corrections.markReady(created.id, WS);
    void ready;
    const events = await corrections.listEvents(created.id, WS);
    const bundles = [
      JSON.stringify(completed.findings),
      JSON.stringify(completed.review),
      JSON.stringify(created.sourceSnapshot),
      JSON.stringify(created.pinSnapshot),
      JSON.stringify(events),
      JSON.stringify(completed.escalations),
    ];
    for (const bundle of bundles) {
      const text = bundle.toLowerCase();
      expect(text).not.toContain('http');
      expect(text).not.toContain('signed');
      expect(text).not.toContain('bearer');
      expect(text).not.toContain('apikey');
      expect(text).not.toContain('data:image');
      expect(text).not.toContain('data:video');
    }
  });
});

// ── 14. Archive/restore is soft-state ────────────────────────────────────────
describe('case 14 — archive/restore is soft-state only', () => {
  it('archives a ready correction and restores it to the prior status', async () => {
    const created = await corrections.createDraftCorrection(
      { workspaceId: WS, sourceGalleryOutputId: OUTPUT, title: 'Archive me', requestedChange: 'Minor continuity touch-up retaining exact pins.', scope: 'continuity' },
      WS,
    );
    const ready = await corrections.markReady(created.id, WS);
    if ('blocked' in ready) throw new Error('unexpected source-change block');
    const archived = await corrections.archive(created.id, WS);
    expect(archived.status).toBe('archived');
    const restored = await corrections.restore(created.id, WS);
    expect(restored.status).toBe('ready');
    const events = await corrections.listEvents(created.id, WS);
    expect(events.map((event) => event.eventType)).toContain('restored');
  });

  it('archives a completed review without deleting its findings', async () => {
    const review = await newDraftReview();
    await reviews.addFinding(review.id, { category: 'continuity', result: 'pass' }, WS);
    await reviews.completeReview(review.id, WS);
    const archived = await reviews.archiveReview(review.id, WS);
    expect(archived.status).toBe('archived');
    const findings = await reviews.listFindings(review.id, WS);
    expect(findings.length).toBe(1);
  });
});
