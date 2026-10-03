/**
 * Relationship schema - Prompt 25 record & input types, validated with the
 * domain convention (pure validators, no framework).
 *
 * These mirror the engine's in-memory model and the Supabase views. The UI
 * and tests import from here; the engine imports this too.
 */
import {
  RELATIONSHIP_TYPE_ORDER,
  RELATIONSHIP_VARIANT_LABELS,
  relationshipContextRelevance,
  type RelationshipContext,
  type RelationshipType,
} from './relationshipTypes';
import type {
  LibraryAssetRecord,
  LibraryAssetType,
  LibraryUsageScope,
} from './types';

export interface DefaultRelationshipRecord {
  id: string;
  workspaceId: string;
  relationshipType: RelationshipType;
  context: RelationshipContext;
  sourceAssetId: string;
  targetEntityType: string;
  targetEntityId: string;
  sourceAsset?: LibraryAssetRecord;
  priority: number;
  versionSafety: string;
  conditionsJson: string | null;
  reason: string | null;
  status: string;
  appliedOnDraftCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface LibraryAssetBundleRecord {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  sourceEntityType: string | null;
  sourceEntityId: string | null;
  memberCount: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface LibraryAssetBundleMemberRecord {
  id: string;
  workspaceId: string;
  libraryAssetId: string;
  libraryAsset?: LibraryAssetRecord;
  bundleId: string;
  bundleName: string;
  position: number;
  roleOrSlot: string | null;
  createdAt: string;
}

export interface LibrarySuggestedAssetView {
  id: string;
  workspaceId: string;
  sourceEntityId: string;
  sourceAssetId?: string;
  sourceAssetName?: string;
  targetEntityType: string;
  targetEntityId: string;
  relationshipType: RelationshipType;
  assetId: string;
  assetName: string;
  priority: number | null;
  reason: string;
  status: string;
  relationshipId?: string;
  createdAt: string;
}

/**
 * Input for creating a default/recommended relationship. The engine enforces
 * workspace ownership + entity existence; this payload only carries what the
 * UI collected from the user.
 */
export interface CreateDefaultRelationshipInput {
  relationshipType: RelationshipType;
  context: RelationshipContext;
  sourceAssetId: string;
  targetEntityType: string;
  targetEntityId: string;
  priority?: number;
  versionSafety?: string;
  conditionsJson?: string | null;
  reason?: string | null;
}

/**
 * Input for creating a bundle. `sourceEntityType`/`sourceEntityId` are the
 * workspace-scope entity the set was authored against (null = global). The
 * engine enforces workspace ownership on members.
 */
export interface CreateLibraryAssetBundleInput {
  name: string;
  description?: string | null;
  sourceEntityType?: string | null;
  sourceEntityId?: string | null;
}

export interface UpdateLibraryAssetBundleInput {
  name?: string;
  description?: string | null;
  sourceEntityType?: string | null;
  sourceEntityId?: string | null;
}

export interface AddBundleMemberInput {
  libraryAssetId: string;
  roleOrSlot?: string | null;
  position?: number | null;
}

/**
 * Input for applying a bundle to a draft target. `targetType`/`targetId` are
 * the draft version's entity (model_version or environment_version).
 */
export interface ApplyBundleToTargetInput {
  targetType: string;
  targetId: string;
}

/**
 * Input for accepting a suggestion. The engine verifies the suggestion
 * belongs to this target and that no conflicting accepted suggestion
 * occupies the same slot.
 */
export interface AcceptSuggestedAssetInput {
  sourceEntityId: string;
  targetEntityType: string;
  targetEntityId: string;
  assetId: string;
}

export interface RejectSuggestedAssetInput {
  sourceEntityId: string;
  targetEntityType: string;
  targetEntityId: string;
  assetId: string;
}

export interface CreateDraftVersionForDefaultChangeIfNeededInput {
  sourceEntityType: string;
  sourceEntityId: string;
  changeSummary?: string;
}

/**
 * Engine-consistent IDs. The engine stores these as strings; the views carry
 * them as-is so tests and the UI stay row-based, not row+version-based.
 */
export interface LibraryDefaultRelationshipView {
  id: string;
  relationshipType: RelationshipType;
  context: RelationshipContext;
  sourceAssetId: string;
  sourceAssetName?: string;
  targetEntityType: string;
  targetEntityId: string;
  priority: number;
  versionSafety: string;
  conditionsJson: string | null;
  reason: string | null;
  status: string;
  appliedOnDraftCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface LibraryDefaultRelationshipInput {
  id: string;
  relationshipType: RelationshipType;
  context: RelationshipContext;
  sourceAssetId: string;
  targetEntityType: string;
  targetEntityId: string;
  priority: number;
  versionSafety: string;
  conditionsJson: string | null;
  reason: string | null;
  status: string;
  appliedOnDraftCount: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Stability priority for sorting. Lower = appears first in the default
 * roster for a slot. The engine never re-priorities; the UI uses this for
 * ordering only.
 */
export function defaultRelationshipPriority(
  relationshipType: RelationshipType,
  customPriority: number | null,
): number {
  return RELATIONSHIP_TYPE_ORDER[relationshipType] * 1000 + (customPriority ?? 0);
}

/**
 * Validates a create-default-relationship payload. Pure: no storage reads;
 * the engine re-checks ownership/existence server-side.
 */
export function validateCreateDefaultRelationship(
  input: unknown,
): { ok: true; value: CreateDefaultRelationshipInput } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const raw = input as Record<string, unknown>;

  const relationshipType = raw.relationshipType;
  if (relationshipType !== 'recommended' && relationshipType !== 'default') {
    errors.push('relationshipType must be recommended or default');
  }

  const context = raw.context;
  if (context !== 'model_version' && context !== 'environment_version' && context !== 'content_job') {
    errors.push('context must be model_version, environment_version or content_job');
  }

  if (typeof raw.sourceAssetId !== 'string' || !raw.sourceAssetId) {
    errors.push('sourceAssetId is required');
  }

  if (typeof raw.targetEntityType !== 'string' || !raw.targetEntityType) {
    errors.push('targetEntityType is required');
  }
  if (typeof raw.targetEntityId !== 'string' || !raw.targetEntityId) {
    errors.push('targetEntityId is required');
  }

  const priority = raw.priority ?? 0;
  if (!Number.isInteger(priority)) errors.push('priority must be an integer');

  const versionSafety = raw.versionSafety ?? 'future_drafts_and_new_applications';
  if (
    versionSafety !== 'future_drafts_and_new_applications' &&
    versionSafety !== 'locked_only' &&
    versionSafety !== 'both'
  ) {
    errors.push('versionSafety must be future_drafts_and_new_applications, locked_only or both');
  }

  if (raw.conditionsJson !== undefined && raw.conditionsJson !== null && typeof raw.conditionsJson !== 'string') {
    errors.push('conditionsJson must be a string or null');
  }
  if (raw.reason !== undefined && raw.reason !== null && typeof raw.reason !== 'string') {
    errors.push('reason must be a string or null');
  }

  return errors.length
    ? { ok: false, errors }
    : {
        ok: true,
        value: {
          relationshipType: relationshipType as RelationshipType,
          context: context as RelationshipContext,
          sourceAssetId: raw.sourceAssetId as string,
          targetEntityType: raw.targetEntityType as string,
          targetEntityId: raw.targetEntityId as string,
          priority: priority as number,
          versionSafety: versionSafety as string,
          conditionsJson: raw.conditionsJson ?? null,
          reason: raw.reason ?? null,
        },
      };
}

/**
 * Normalizes a bundle member position. Positions are 0-based, contiguous;
 * the caller decides where to insert (engine handles ordering + uniqueness).
 */
export function normalizeBundleMemberPosition(
  list: Array<{ position?: number | null }>,
  position: number | null,
): number {
  if (position !== null && Number.isInteger(position) && position >= 0) return position;
  return list.length;
}
