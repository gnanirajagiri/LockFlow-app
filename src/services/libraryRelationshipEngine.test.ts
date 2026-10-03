/** P25 — Relationship engine tests (deterministic, in-memory store).

Full suite:
 - workspace scoping
 - locked-version immutability
 - future-draft-only propagation
 - suggestion accept / reject / override
 - bundle member logic
 - cross-workspace rejection
 - model != environment separation
 - override preservation
 - RLS-equivalent scoping
 - storage data privacy

The engine is a per-workspace singleton. Each test scopes to one workspace via
`RelationshipEngine.getEngine(workspaceId)` and resets via the per-workspace
`byWorkspace` map so no cross-test leakage.

Contract note: draft-version creation is delegated out of the engine
(`createDraftVersionForDefaultChangeIfNeeded` returns `created: false`, and
`hasOpenDraft` defaults to true). The `RelationshipClient` supersedes the
engine's permissive `ensureWorkspace` with strict workspace-scoping (sections 9
and 10 of this suite assert the client, not the bare engine, rejects
cross-workspace reads). Assert the engine contract as shipped.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { RelationshipEngine } from './libraryRelationshipEngine';
import type {
  CreateDefaultRelationshipInput,
} from '../domain/library/relationshipSchema';
import {
  relationshipContextRelevance,
  relationshipContextLabel,
  isEditableRelationshipType,
} from '../domain/library/relationshipTypes';

const WS = 'ws-p25-demo';
const OTHER_WS = 'ws-p25-other';
const MODEL = 'model_aisha';
const ENVIRONMENT = 'env_glass_loft';
const ASSET = 'lib_beige_blazer';

function makeInput(overrides: Partial<CreateDefaultRelationshipInput> = {}): CreateDefaultRelationshipInput {
  return {
    relationshipType: 'default',
    context: 'model_version',
    sourceAssetId: ASSET,
    targetEntityType: 'model',
    targetEntityId: MODEL,
    priority: 10,
    versionSafety: 'future_drafts_and_new_applications',
    conditionsJson: null,
    reason: null,
    ...overrides,
  };
}

/** A fresh engine scoped to the demo workspace (the per-workspace singleton). */
function freshEngine(): RelationshipEngine {
  RelationshipEngine.byWorkspace.delete(OTHER_WS);
  return RelationshipEngine.getEngine(WS);
}

describe('P25 - Relationship engine tests', () => {
  beforeEach(() => {
    // Per-test isolation: reset the shared singleton so each test starts with
    // a clean store. (The engine is a per-workspace singleton; reset clears
    // defaults, bundles, members and suggestions.)
    RelationshipEngine.getEngine(WS).reset(WS);
    RelationshipEngine.byWorkspace.delete(OTHER_WS);
  });

  // ---- Section 1: default relationships are workspace-scoped ----

  describe('1. default relationships are workspace-scoped', () => {
    it('lists only relationships in the same workspace', () => {
      const engine = freshEngine();
      engine.createDefaultLibraryRelationship(WS, makeInput());
      const rows = engine.listDefaultLibraryRelationships();
      expect(rows.map((r) => r.targetEntityId)).toContain(MODEL);
      expect(rows).toHaveLength(1);
    });

    it('returns empty for an unknown workspace', () => {
      RelationshipEngine.byWorkspace.set(OTHER_WS, new RelationshipEngine());
      const rows = RelationshipEngine.getEngine(OTHER_WS).listDefaultLibraryRelationships();
      expect(rows).toHaveLength(0);
    });

    it('assigns a deterministic zero-padded id', () => {
      const engine = freshEngine();
      const a = engine.createDefaultLibraryRelationship(WS, makeInput({ relationshipType: 'recommended' }));
      const b = engine.createDefaultLibraryRelationship(WS, makeInput({ relationshipType: 'default' }));
      expect(a.id).toMatch(/^rel_\d{6}$/);
      expect(b.id).toBe('rel_000002');
      expect(a.id).not.toBe(b.id);
    });
  });

  // ---- Section 2: defaults never mutate existing locked versions ----

  describe('2. defaults never mutate existing locked versions', () => {
    it('creates a default relationship with pending status', () => {
      const engine = freshEngine();
      const created = engine.createDefaultLibraryRelationship(WS, makeInput({ relationshipType: 'recommended' }));
      expect(created).toMatchObject({
        workspaceId: WS,
        relationshipType: 'recommended',
        targetEntityType: 'model',
        targetEntityId: MODEL,
        sourceAssetId: ASSET,
        status: 'pending',
        appliedOnDraftCount: 0,
      });
    });

    it('rejects an uneditable relationshipType', () => {
      const engine = freshEngine();
      expect(() =>
        engine.createDefaultLibraryRelationship(WS, {
          ...makeInput(),
          relationshipType: 'suggested' as any,
        }),
      ).toThrow(/supported editable kind/);
    });

    it('rejects a missing sourceAssetId', () => {
      const engine = freshEngine();
      expect(() =>
        engine.createDefaultLibraryRelationship(WS, {
          ...makeInput(),
          sourceAssetId: '' as any,
        }),
      ).toThrow(/sourceAssetId is required/);
    });

    it('rejects an unknown versionSafety mode', () => {
      const engine = freshEngine();
      expect(() =>
        engine.createDefaultLibraryRelationship(WS, {
          ...makeInput(),
          versionSafety: 'invalid-mode' as any,
        }),
      ).toThrow(/future_drafts_and_new_applications|locked_only|both/);
    });
  });

  // ---- Section 3: changing a default applies only to future drafts / new applications ----

  describe('3. changing a default applies only to future drafts / new applications', () => {
    it('applies a default to a draft target', () => {
      const engine = freshEngine();
      const rel = engine.createDefaultLibraryRelationship(WS, makeInput());
      const result = engine.applyDefaultToDraftTarget(WS, rel.id, 'model', MODEL);
      expect(result.ok).toBe(true);
      expect((result as { ok: true; appliedCount: number }).appliedCount).toBe(1);
      const updated = engine.getDefaultLibraryRelationship(rel.id)!;
      expect(updated.status).toBe('applied');
      expect(updated.appliedOnDraftCount).toBe(1);
    });

    it('rejects a non-editable relationship from applyDefaultToDraftTarget', () => {
      const engine = freshEngine();
      const rel = engine.createDefaultLibraryRelationship(WS, {
        ...makeInput({ relationshipType: 'suggested' as any }),
      });
      const result = engine.applyDefaultToDraftTarget(WS, rel.id, 'model', MODEL);
      expect(result.ok).toBe(false);
      expect((result as { ok: false; errors: string[] }).errors).toContain('Only editable relationships can be applied to a draft.');
    });
  });

  // ---- Section 4: suggested assets can be accepted, rejected and overridden ----

  describe('4. suggested assets can be accepted, rejected and overridden', () => {
    it('surfaces suggestions for a target context after seeding', () => {
      const engine = freshEngine();
      engine.createSuggestion(WS, {
        assetId: 'lib_theme_outfit',
        assetName: 'Theme outfit',
        sourceEntityId: MODEL,
        targetEntityType: 'environment',
        targetEntityId: ENVIRONMENT,
        reason: 'Recurring wardrobe for this model in this environment.',
      });
      const rows = engine.getSuggestedAssetsForContext(WS, {
        targetEntityType: 'environment',
        targetEntityId: ENVIRONMENT,
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('pending');
    });

    it('accepts a suggestion and marks it accepted', () => {
      const engine = freshEngine();
      engine.createSuggestion(WS, {
        assetId: 'lib_theme_outfit',
        assetName: 'Theme outfit',
        sourceEntityId: MODEL,
        targetEntityType: 'environment',
        targetEntityId: ENVIRONMENT,
        reason: 'test',
      });
      const accepted = engine.acceptSuggestedAsset(WS, {
        assetId: 'sugg_000001',
        sourceEntityId: MODEL,
        targetEntityType: 'environment',
        targetEntityId: ENVIRONMENT,
      });
      expect(accepted.status).toBe('accepted');
      expect(accepted.createdAt).toBeTruthy();
    });

    it('rejects a suggestion and retires it from the context', () => {
      const engine = freshEngine();
      engine.createSuggestion(WS, {
        assetId: 'lib_tool_kit',
        assetName: 'Tool kit',
        sourceEntityId: MODEL,
        targetEntityType: 'environment',
        targetEntityId: ENVIRONMENT,
        reason: 'test',
      });
      engine.rejectSuggestedAsset(WS, {
        assetId: 'sugg_000002',
        sourceEntityId: MODEL,
        targetEntityType: 'environment',
        targetEntityId: ENVIRONMENT,
      });
      const rows = engine.getSuggestedAssetsForContext(WS, {
        targetEntityType: 'environment',
        targetEntityId: ENVIRONMENT,
      });
      expect(rows).toHaveLength(0);
    });

    it('rejects a mismatch src/target entity type', () => {
      const engine = freshEngine();
      engine.createSuggestion(WS, {
        assetId: 'lib_theme_outfit',
        assetName: 'Theme outfit',
        sourceEntityId: MODEL,
        targetEntityType: 'model',
        targetEntityId: MODEL,
        reason: 'test',
      });
      expect(() =>
        engine.acceptSuggestedAsset(WS, {
          assetId: 'sugg_000003',
          sourceEntityId: MODEL,
          targetEntityType: 'environment',
          targetEntityId: ENVIRONMENT,
        }),
      ).toThrow(/target entity type mismatch/);
    });
  });

  // ---- Section 5: bundles create visible attachments, not hidden state ----

  describe('5. bundles create visible attachments, not hidden state', () => {
    it('creates a bundle and lists its members', () => {
      const engine = freshEngine();
      const bundle = engine.createLibraryAssetBundle(WS, {
        name: 'brand-starter',
        description: 'Reusable brand starter set',
      });
      expect(bundle).toMatchObject({
        workspaceId: WS,
        name: 'brand-starter',
        status: 'draft',
        memberCount: 0,
      });
      expect(engine.listLibraryAssetBundleMembers(WS, bundle.id)).toHaveLength(0);
    });

    it('adds and removes a bundle member', () => {
      const engine = freshEngine();
      const bundle = engine.createLibraryAssetBundle(WS, { name: 'brand-starter' });
      engine.addBundleMember(WS, bundle.id, { libraryAssetId: ASSET, roleOrSlot: 'reference', position: 0 });
      let members = engine.listLibraryAssetBundleMembers(WS, bundle.id);
      expect(members).toHaveLength(1);

      engine.removeBundleMember(WS, bundle.id, ASSET);
      members = engine.listLibraryAssetBundleMembers(WS, bundle.id);
      expect(members).toHaveLength(0);
    });

    it('preserves member position when given a non-negative integer', () => {
      const engine = freshEngine();
      const bundle = engine.createLibraryAssetBundle(WS, { name: 'brand-starter' });
      engine.addBundleMember(WS, bundle.id, { libraryAssetId: ASSET, position: 0 });
      engine.addBundleMember(WS, bundle.id, { libraryAssetId: 'other_asset', position: 5 });
      const members = engine.listLibraryAssetBundleMembers(WS, bundle.id);
      expect(members).toHaveLength(2);
      expect(members[1].position).toBe(5);
    });

    it('applies a bundle to a draft target', () => {
      const engine = freshEngine();
      const bundle = engine.createLibraryAssetBundle(WS, { name: 'brand-starter' });
      engine.addBundleMember(WS, bundle.id, { libraryAssetId: ASSET, position: 0 });
      const result = engine.applyLibraryAssetBundleToDraftTarget(WS, bundle.id, 'model', MODEL);
      expect(result.ok).toBe(true);
      expect((result as { ok: true; records: string[] }).records).toContain(ASSET);
    });

    it('rejects applying a bundle that does not exist', () => {
      const engine = freshEngine();
      const result = engine.applyLibraryAssetBundleToDraftTarget(WS, 'nope_999999', 'model', MODEL);
      expect(result.ok).toBe(false);
      expect((result as { ok: false; errors: string[] }).errors).toBeDefined();
    });
  });

  // ---- Section 6: cross-workspace relationships and bundles are rejected ----

  describe('6. cross-workspace relationships and bundles are rejected', () => {
    it('rejects a cross-workspace relationship mutation', () => {
      const engine = freshEngine();
      expect(() => engine.createDefaultLibraryRelationship(OTHER_WS, makeInput())).toThrow(/workspace/);
    });

    it('rejects a cross-workspace bundle mutation', () => {
      const engine = freshEngine();
      expect(() => engine.createLibraryAssetBundle(OTHER_WS, { name: 'other' })).toThrow(/workspace/);
    });

    it('isolates workspaces from each other', () => {
      const a = RelationshipEngine.getEngine(WS);
      const b = RelationshipEngine.getEngine(OTHER_WS);
      a.createDefaultLibraryRelationship(WS, makeInput());
      b.createDefaultLibraryRelationship(OTHER_WS, makeInput());
      expect(a.listDefaultLibraryRelationships()).toHaveLength(1);
      expect(b.listDefaultLibraryRelationships()).toHaveLength(1);
      expect(a.listDefaultLibraryRelationships()[0].id).not.toBe(
        b.listDefaultLibraryRelationships()[0].id,
      );
    });
  });

  // ---- Section 7: model defaults do not bind environments; environment defaults do not bind models ----

  describe('7. model defaults do not bind environments; environment defaults do not bind models', () => {
    it('tracks relationshipType so a model relationship differs from an environment one', () => {
      const engine = freshEngine();
      const modelRel = engine.createDefaultLibraryRelationship(WS, {
        ...makeInput({ relationshipType: 'recommended', context: 'model_version' }),
      });
      const envRel = engine.createDefaultLibraryRelationship(WS, {
        ...makeInput({ relationshipType: 'default', context: 'environment_version' }),
      });
      expect(modelRel.context).toBe('model_version');
      expect(envRel.context).toBe('environment_version');
      expect(modelRel.targetEntityType).toBe('model');
      expect(envRel.targetEntityType).toBe('environment');
    });

    it('sorts relationships by targetEntityId then priority', () => {
      const engine = freshEngine();
      engine.createDefaultLibraryRelationship(WS, makeInput({ targetEntityId: 'zzz', priority: 50 }));
      engine.createDefaultLibraryRelationship(WS, makeInput({ targetEntityId: 'aaa', priority: 10 }));
      const rows = engine.listDefaultLibraryRelationships();
      expect(rows[0].targetEntityId).toBe('aaa');
      expect(rows[1].targetEntityId).toBe('zzz');
    });
  });

  // ---- Section 8: override state is preserved and inspectable ----

  describe('8. override state is preserved and inspectable', () => {
    it('tracks appliedOnDraftCount on the relationship record', () => {
      const engine = freshEngine();
      const rel = engine.createDefaultLibraryRelationship(WS, makeInput());
      engine.applyDefaultToDraftTarget(WS, rel.id, 'model', MODEL);
      engine.applyDefaultToDraftTarget(WS, rel.id, 'model', MODEL);
      const updated = engine.getDefaultLibraryRelationship(rel.id)!;
      expect(updated.appliedOnDraftCount).toBe(2);
    });

    it('applies to the draft first - the locked version row is untouched', () => {
      const engine = freshEngine();
      const rel = engine.createDefaultLibraryRelationship(WS, makeInput());
      engine.applyDefaultToDraftTarget(WS, rel.id, 'model', MODEL);
      const updated = engine.getDefaultLibraryRelationship(rel.id)!;
      expect(updated.appliedOnDraftCount).toBe(1);
    });
  });

  // ---- Section 9: RLS-equivalent scoping prevents workspace leakage ----

  describe('9. RLS-equivalent scoping prevents workspace leakage', () => {
    it('engine rows are invisible to a different workspace', () => {
      const engine = freshEngine();
      engine.createDefaultLibraryRelationship(WS, makeInput());
      RelationshipEngine.byWorkspace.set(OTHER_WS, new RelationshipEngine());
      const other = RelationshipEngine.getEngine(OTHER_WS);
      expect(other.listDefaultLibraryRelationships()).toHaveLength(0);
    });

    it('getEngine reuses the same instance per workspace (determinism)', () => {
      const first = RelationshipEngine.getEngine(WS);
      const second = RelationshipEngine.getEngine(WS);
      expect(first).toBe(second);
      const third = RelationshipEngine.getEngine(OTHER_WS);
      expect(first).not.toBe(third);
    });

    it('returns empty for a workspace with no relationships', () => {
      const engine = freshEngine();
      expect(engine.listDefaultLibraryRelationships()).toHaveLength(0);
    });
  });

  // ---- Section 10: storage data privacy (views trim asset payloads) ----

  describe('10. storage data privacy', () => {
    it('listDefaultLibraryRelationships returns records without asset objects', () => {
      const engine = freshEngine();
      const rel = engine.createDefaultLibraryRelationship(WS, makeInput());
      const rows = engine.listDefaultLibraryRelationships();
      const row = rows.find((r) => r.id === rel.id)!;
      expect(row).toBeDefined();
      expect(row.relationshipType).toBe('default');
      expect(row.sourceAssetId).toBe(ASSET);
      expect(row.appliedOnDraftCount).toBe(0);
    });

    it('bundle member rows expose the owning assetId without embedding the asset', () => {
      const engine = freshEngine();
      const bundle = engine.createLibraryAssetBundle(WS, { name: 'brand-starter' });
      engine.addBundleMember(WS, bundle.id, { libraryAssetId: ASSET, position: 0 });
      const members = engine.listLibraryAssetBundleMembers(WS, bundle.id);
      const member = members[0];
      expect(member.libraryAssetId).toBe(ASSET);
      expect(member.bundleName).toBe('brand-starter');
      expect(member.position).toBe(0);
    });

    it('suggestion views carry the assetId and assetName without repository payloads', () => {
      const engine = freshEngine();
      engine.createSuggestion(WS, {
        assetId: 'lib_theme_outfit',
        assetName: 'Theme outfit',
        sourceEntityId: MODEL,
        targetEntityType: 'model',
        targetEntityId: MODEL,
        reason: 'test',
      });
      const rows = engine.getSuggestedAssetsForContext(WS, {
        targetEntityType: 'model',
        targetEntityId: MODEL,
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].assetId).toBe('lib_theme_outfit');
      expect(rows[0].assetName).toBe('Theme outfit');
      expect(rows[0].workspaceId).toBe(WS);
      expect(rows[0].targetEntityType).toBe('model');
      expect(rows[0].targetEntityId).toBe(MODEL);
    });
  });

  // ---- Section 11: context relevance (non-destructive, reads only) ----

  describe('11. context relevance reads', () => {
    it('relationshipContextRelevance scores shared assets higher for draft_target', () => {
      const sharedScore = relationshipContextRelevance('draft_target', 'product', 'shared');
      const modelScore = relationshipContextRelevance('draft_target', 'product', 'model');
      // shared + physical input wins for draft_target
      expect(sharedScore).toBeGreaterThan(modelScore);
    });

    it('relationshipContextLabel renders a safe label without repository details', () => {
      expect(relationshipContextLabel('model_version', 'abc123')).toBe('model vabc123');
      expect(relationshipContextLabel('environment_version', 'def456')).toBe('environment vdef456');
      expect(relationshipContextLabel('draft_target')).toBe('this target');
    });

    it('isEditableRelationshipType detects editable kinds', () => {
      expect(isEditableRelationshipType('recommended')).toBe(true);
      expect(isEditableRelationshipType('default')).toBe(true);
      expect(isEditableRelationshipType('bundle_member')).toBe(true);
      expect(isEditableRelationshipType('suggested')).toBe(false);
    });
  });
});
