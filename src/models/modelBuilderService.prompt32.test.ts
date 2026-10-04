/**
 * Prompt 32 — Model Builder completion: reference import, coverage,
 * lock-and-save and version-safe editing. Service-boundary tests over the
 * existing MockModelsRepository (the same adapter the app runs on):
 *
 *   1. Locked versions are immutable (references, identity, lock).
 *   2. Protected identity changes flow only through draft → lock paths.
 *   3. Styling/supporting changes never mutate protected identity.
 *   4. Coverage is computed honestly (required vs optional slots).
 *   5. Lock readiness blocks incomplete identity/coverage; lock-and-save
 *      captures a snapshot and locks through the existing guards.
 *   6. Workspace boundaries are enforced; the audit trail records the flow.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { ModelsService } from '../services/modelsService';
import { MockModelsRepository } from '../data/mockModelsRepository';
import { getLibraryRepository } from '../data/libraryFactory';
import { LibraryService } from '../services/libraryService';
import { ModelBuilderService, InMemoryModelBuilderAuditStore } from './modelBuilderService';
import {
  COVERAGE_SLOTS,
  evaluateReferenceCoverage,
  roleForReference,
} from './modelBuilderWorkflow';
import type { ModelBuilderAuditRow } from './modelBuilderService';

const WS = 'ws_demo';
const OTHER_WS = 'ws_other';
const USER = 'builder-user';

function makeSheetPatch() {
  return {
    identitySummary: 'Adult woman, early 30s, warm expression',
    faceFeatures: { faceShape: 'oval', eyeColor: 'hazel' },
    hairIdentity: { color: 'dark brown', length: 'shoulder' },
    complexion: { tone: 'medium warm' },
    bodyProportions: { height: '175cm', build: 'athletic' },
    distinctiveDetails: { marks: 'small scar above left brow' },
  };
}

/** Full builder stack per test (fresh mock repo + audit store). */
function makeBuilder() {
  const repo = new MockModelsRepository();
  const models = new ModelsService(repo);
  const audit = new InMemoryModelBuilderAuditStore();
  const library = new LibraryService(getLibraryRepository());
  const deps = {
    getLibraryAsset: async (assetId: string, workspaceId: string) => {
      const asset = await library.getAsset(assetId, workspaceId);
      return { id: asset.id, workspaceId, name: asset.name, storagePath: asset.coverImagePath };
    },
  };
  const builder = new ModelBuilderService(models, repo, deps, audit);
  return { builder, models, repo, audit, library };
}

describe('reference roles and coverage (pure)', () => {
  it('maps roles, honors caption tags and computes coverage honestly', () => {
    const tags = [
      { id: 'r1', caption: '[builder:primary_identity] Front', referenceType: 'portrait' },
      { id: 'r2', caption: '[builder:full_body_posture] Standing', referenceType: 'full_body' },
      { id: 'r3', caption: '[builder:angle_three_quarter] 3/4', referenceType: 'profile' },
      { id: 'r4', caption: '[builder:style_look] Red dress', referenceType: 'other' },
    ] as Array<{ id: string; caption: string; referenceType: 'portrait' | 'full_body' | 'profile' | 'detail' | 'other' }>;

    expect(roleForReference(tags[0] as never)).toBe('primary_identity');
    expect(roleForReference(tags[2] as never)).toBe('angle_three_quarter');

    const report = evaluateReferenceCoverage(tags);
    expect(report.complete).toBe(true);
    expect(report.referenceCompleteness).toBe('core_complete'); // back/360 optional missing
    expect(report.missingRequired).toEqual([]);
    expect(report.missingOptional).toContain('Back / 360°');

    // A caption tag survives even when referenceType suggests otherwise.
    const styleTagged = { id: 'r5', caption: '[builder:style_look] x', referenceType: 'portrait' };
    expect(roleForReference(styleTagged as never)).toBe('style_look');

    // Untagged references fall back to their reference type mapping.
    const untagged = { id: 'r6', caption: 'plain', referenceType: 'portrait' };
    expect(roleForReference(untagged as never)).toBe('primary_identity');

    expect(COVERAGE_SLOTS.filter((slot) => slot.required)).toHaveLength(3);
  });
});

describe('model draft workflow', () => {
  let stack: ReturnType<typeof makeBuilder>;
  beforeEach(() => { stack = makeBuilder(); });

  it('creates a model draft and imports labeled references', async () => {
    const { builder } = stack;
    const { version } = await builder.createModelDraft(WS, { name: 'Ava' }, USER);
    expect(version.status).toBe('draft');

    const view = await builder.attachModelReference(WS, version.id, {
      role: 'primary_identity',
      source: { kind: 'upload', storagePath: 'models/refs/front.png' },
    }, USER);
    expect(view.role).toBe('primary_identity');
    expect(view.identityGoverned).toBe(true);

    const coverage = await builder.validateModelReferenceCoverage(WS, version.id);
    expect(coverage.slots.find((slot) => slot.key === 'primary_identity')?.filled).toBe(true);

    const events = (await stack.audit.list(WS)).map((row) => row.event);
    expect(events).toContain('model_draft_created');
    expect(events).toContain('model_reference_added');
  });

  it('blocks lock readiness until identity and coverage are complete', async () => {
    const { builder } = stack;
    const { version } = await builder.createModelDraft(WS, { name: 'Ava' }, USER);

    // Nothing filled → blocked with honest reasons.
    const early = await builder.validateModelReadinessForLock(WS, version.id);
    expect(early.ok).toBe(false);
    expect(early.blockers.join(' ')).toMatch(/Character Sheet identity is incomplete/i);
    expect(early.blockers.join(' ')).toMatch(/primary identity reference/i);
    expect(early.readiness).toBe('identity_incomplete');

    // Fill identity + primary + full body + 3/4 → ready to lock.
    await builder.updateCharacterSheet(WS, version.id, makeSheetPatch(), USER);
    for (const role of ['primary_identity', 'full_body_posture', 'angle_three_quarter'] as const) {
      await builder.attachModelReference(WS, version.id, {
        role,
        source: { kind: 'upload', storagePath: `models/refs/${role}.png` },
      }, USER);
    }
    const ready = await builder.validateModelReadinessForLock(WS, version.id);
    expect(ready.ok).toBe(true);
    expect(ready.readiness).toBe('ready_to_lock');

    const events = (await stack.audit.list(WS)).map((row) => row.event);
    expect(events).toContain('model_readiness_checked');
  });

  it('lock-and-save captures a snapshot and locked versions are immutable', async () => {
    const { builder } = stack;
    const { version } = await builder.createModelDraft(WS, { name: 'Ava' }, USER);
    await builder.updateCharacterSheet(WS, version.id, makeSheetPatch(), USER);
    for (const role of ['primary_identity', 'full_body_posture', 'angle_three_quarter'] as const) {
      await builder.attachModelReference(WS, version.id, {
        role,
        source: { kind: 'upload', storagePath: `models/refs/${role}.png` },
      }, USER);
    }

    const { version: locked, snapshot } = await builder.lockAndSaveModelVersion(WS, version.id, USER);
    expect(locked.status).toBe('locked');
    expect(snapshot.versionNumber).toBe(1);
    expect(snapshot.coverageSummary.requiredFilled).toBe(3);
    expect(snapshot.references).toHaveLength(3);
    expect(JSON.stringify(snapshot)).not.toContain('models/refs/'); // no storage paths

    // Immutable: references, identity edits and re-locking all refuse.
    await expect(
      builder.attachModelReference(WS, locked.id, {
        role: 'style_look',
        source: { kind: 'upload', storagePath: 'models/refs/style.png' },
      }, USER),
    ).rejects.toThrow(/draft/i);
    await expect(
      builder.updateCharacterSheet(WS, locked.id, { identitySummary: 'changed' }, USER),
    ).rejects.toThrow(/new draft version|locked/i);
    await expect(
      stack.models.lockVersion(locked.id, WS),
    ).rejects.toThrow();

    const blockedEvents = (await stack.audit.list(WS)).map((row) => row.event);
    expect(blockedEvents).toContain('model_version_locked');
    expect(blockedEvents).toContain('model_lock_blocked');
  });

  it('creates a safe draft from a locked version; locked source never mutates', async () => {
    const { builder } = stack;
    const { version } = await builder.createModelDraft(WS, { name: 'Ava' }, USER);
    await builder.updateCharacterSheet(WS, version.id, makeSheetPatch(), USER);
    for (const role of ['primary_identity', 'full_body_posture', 'angle_three_quarter'] as const) {
      await builder.attachModelReference(WS, version.id, {
        role,
        source: { kind: 'upload', storagePath: `models/refs/${role}.png` },
      }, USER);
    }
    const { version: locked } = await builder.lockAndSaveModelVersion(WS, version.id, USER);

    const draft = await builder.createModelDraftFromLockedVersion(WS, locked.id, USER, 'New look');
    expect(draft.status).toBe('draft');
    expect(draft.versionNumber).toBe(2);

    // The locked source is untouched: same identity, same lock state.
    const sourceSheet = await stack.repo.getCharacterSheet(locked.id);
    expect(sourceSheet.identitySummary).toBe(makeSheetPatch().identitySummary);
    expect((await stack.models.getVersion(locked.id, WS)).status).toBe('locked');

    // Styling-only edit on the new draft leaves protected identity alone.
    await builder.attachModelReference(WS, draft.id, {
      role: 'style_look',
      source: { kind: 'upload', storagePath: 'models/refs/summer.png' },
    }, USER);
    const draftSheet = await stack.repo.getCharacterSheet(draft.id);
    expect(draftSheet.identitySummary).toBe(sourceSheet.identitySummary);

    const events = (await stack.audit.list(WS)).map((row) => row.event);
    expect(events).toContain('model_draft_created_from_locked_version');
  });

  it('builder view composes labeled references, coverage and readiness', async () => {
    const { builder } = stack;
    const { version } = await builder.createModelDraft(WS, { name: 'Ava' }, USER);
    await builder.attachModelReference(WS, version.id, {
      role: 'primary_identity',
      source: { kind: 'upload', storagePath: 'models/refs/front.png' },
    }, USER);

    const view = await builder.getModelBuilderView(WS, version.id);
    expect(view.version.id).toBe(version.id);
    expect(view.references).toHaveLength(1);
    expect(view.references[0]?.identityGoverned).toBe(true);
    expect(view.coverage.requiredTotal).toBe(3);
    expect(view.readiness.readiness).toBe('identity_incomplete');
  });
});

describe('workspace security', () => {
  let stack: ReturnType<typeof makeBuilder>;
  beforeEach(() => { stack = makeBuilder(); });

  it('rejects cross-workspace reads, reference edits and lock paths', async () => {
    const { builder } = stack;
    const { version } = await builder.createModelDraft(WS, { name: 'Ava' }, USER);

    await expect(builder.getModelBuilderView(OTHER_WS, version.id)).rejects.toThrow();
    await expect(builder.validateModelReferenceCoverage(OTHER_WS, version.id)).rejects.toThrow();
    await expect(
      builder.attachModelReference(OTHER_WS, version.id, {
        role: 'primary_identity',
        source: { kind: 'upload', storagePath: 'x.png' },
      }, USER),
    ).rejects.toThrow();
    await expect(builder.lockAndSaveModelVersion(OTHER_WS, version.id, USER)).rejects.toThrow();
    const auditRows: ModelBuilderAuditRow[] = await stack.audit.list(OTHER_WS);
    expect(auditRows).toHaveLength(0);
  });

  it('records the audit trail with safe details only', async () => {
    const { builder, audit } = stack;
    const { version } = await builder.createModelDraft(WS, { name: 'Ava' }, USER);
    await builder.updateCharacterSheet(WS, version.id, makeSheetPatch(), USER);
    const rows = await audit.list(WS);
    const details = rows.map((row) => row.detail ?? '').join(' ');
    expect(details).not.toMatch(/storage|path|models\/refs/i);
    expect(rows.every((row) => row.workspaceId === WS)).toBe(true);
  });
});
