/**
 * Relationship types - Prompt 25 domain vocabulary.
 *
 * A relationship links one canonical Library asset to another entity
 * (a model version, an environment version, a content job, or a draft
 * target) as a recommended default, a forced default, or a rule-based
 * suggestion. The UI renders these labels verbatim from the registry so
 * the product decision lives in the schema, never scattered through
 * components.
 */
import type { LibraryAssetType, LibraryUsageScope } from './types';

/**
 * The kind of relationship a row carries. `bundle_member` is a member of a
 * reusable default set, not a separate top-level relationship.
 */
export type RelationshipType =
  | 'recommended'
  | 'default'
  | 'suggested'
  | 'bundle_member';

/** The relationship kinds that the service treats as editable defaults. */
export const RELATIONSHIP_EDITABLE: RelationshipType[] = [
  'recommended',
  'default',
  'bundle_member',
];

/** The relationship kinds the UI treats as suggestions (accept/reject). */
export const RELATIONSHIP_SUGGESTION: RelationshipType[] = ['suggested'];

/**
 * What a relationship is for. A default/recommended relationship is scoped
 * by the entity it points at: a model version, an environment version, a
 * content job, or a generic draft target.
 */
export type RelationshipContext =
  | 'model_version'
  | 'environment_version'
  | 'content_job'
  | 'draft_target';

/** Map of a relationship type to the context scope it is normally used in. */
export const TYPE_CONTEXT_HINT: Record<RelationshipType, RelationshipContext> = {
  recommended: 'model_version',
  default: 'environment_version',
  suggested: 'draft_target',
  bundle_member: 'draft_target',
};

/** Human-readable label for a relationship type. Used verbatim by the UI. */
export const RELATIONSHIP_VARIANT_LABELS: Record<RelationshipType, string> = {
  recommended: 'Recommended default',
  default: 'Default',
  suggested: 'Suggested asset',
  bundle_member: 'Bundle member',
};

/** Short badge label (used where space is tight). */
export const RELATIONSHIP_BADGE_LABELS: Record<RelationshipType, string> = {
  recommended: 'default',
  default: 'default',
  suggested: 'suggestion',
  bundle_member: 'bundle',
};

/**
 * Stable ordering. Defaults render before suggestions, and the `asset`
 * default always outranks `recommended` for the same slot.
 */
export const RELATIONSHIP_TYPE_ORDER: Record<RelationshipType, number> = {
  default: 0,
  recommended: 1,
  suggested: 2,
  bundle_member: 3,
};

/**
 * Context label for a target entity without leaking repository details.
 * The host resolves the human name.
 */
export function relationshipContextLabel(
  context: RelationshipContext,
  sourceEntityId?: string,
  sourceEntityName?: string,
): string {
  if (!sourceEntityId) return 'this target';
  if (context === 'model_version') return `model v${sourceEntityId}`;
  if (context === 'environment_version') return `environment v${sourceEntityId}`;
  if (context === 'content_job') return `content job ${sourceEntityId}`;
  return `draft target ${sourceEntityId}`;
}

/** Returns the relevance of a candidate default for a given target context. */
export function relationshipContextRelevance(
  context: RelationshipContext,
  assetType: LibraryAssetType,
  usageScope: LibraryUsageScope | null,
): number {
  let score = 0;
  if (context === 'model_version') {
    score += usageScope === 'model' ? 3 : 0;
    score += ['wardrobe', 'accessory', 'personal_item', 'product'].includes(assetType) ? 2 : 0;
    score += ['look', 'product'].includes(assetType) ? 1 : 0;
  } else if (context === 'environment_version') {
    score += usageScope === 'environment' ? 3 : 0;
    score += ['scene', 'product', 'prop', 'brand_asset', 'other'].includes(assetType) ? 2 : 0;
    score += ['reference'].includes(assetType) ? 1 : 0;
  } else if (context === 'content_job') {
    score += usageScope === 'shared' ? 3 : 0;
    score += ['reference', 'brand_asset', 'creator_tool'].includes(assetType) ? 2 : 0;
  } else {
    // draft_target: any usable asset is relevant; shared + physical inputs
    // win.
    score += usageScope === 'shared' ? 2 : 0;
    score += isPhysicalAssetType(assetType) ? 1 : 0;
  }
  return score;
}

/** Convenience: is this relationship type one of the user-manipulable kinds? */
export function isEditableRelationshipType(type: RelationshipType): boolean {
  return RELATIONSHIP_EDITABLE.includes(type);
}

/** Convenience: is this relationship type a suggestion the user can accept? */
export function isSuggestionRelationshipType(type: RelationshipType): boolean {
  return RELATIONSHIP_SUGGESTION.includes(type);
}

/** Convenience: does this asset type physically belong in a bundle? */
export function isPhysicalAssetType(assetType: LibraryAssetType): boolean {
  return ['product', 'prop', 'wardrobe', 'accessory', 'personal_item', 'creator_tool'].includes(assetType);
}
