/**
 * Library domain — Prompt 21 unified-taxonomy helpers.
 *
 * Pure, framework-free and unit-tested. These encode the product rule that
 * the Library is organized by WHERE an asset is used (model / item /
 * environment / shared) — never by ownership-style library concepts.
 * The Gallery stays the home of generated outputs; nothing here reads or
 * writes Gallery records.
 */
import type {
  LibraryAssetRecord,
  LibraryAssetType,
  LibraryAssetStatus,
  LibraryEventType,
  LibraryPickerContext,
  LibraryUsageScope,
  LibrarySourceKind,
} from './types';

/** Scopes where a specific entity link is required. */
export const SCOPED_USAGES: LibraryUsageScope[] = ['model', 'item', 'environment'];

/** All usage scopes (shared = broadly reusable, no entity link required). */
export const USAGE_SCOPES: LibraryUsageScope[] = ['model', 'item', 'environment', 'shared'];

/** Suggested scope per asset type (advisory, not enforced). */
export const TYPE_SCOPE_HINT: Record<LibraryAssetType, LibraryUsageScope> = {
  product: 'item',
  prop: 'item',
  wardrobe: 'model',
  accessory: 'model',
  personal_item: 'model',
  creator_tool: 'item',
  brand_asset: 'shared',
  reference: 'shared',
  scene: 'environment',
  look: 'model',
  other: 'shared',
};

export const USAGE_SCOPE_LABELS: Record<LibraryUsageScope, string> = {
  model: 'Used on a model',
  item: 'Used on an item',
  environment: 'Used in an environment',
  shared: 'Shared across the workspace',
};

export const SOURCE_KIND_LABELS: Record<LibrarySourceKind, string> = {
  manual: 'Created manually',
  reference_upload: 'Reference upload',
  generated_derivative: 'Derived from generated output',
  import: 'Imported',
};

/** Picker default: active + approved (ready). Drafts need explicit opt-in. */
export function pickerDefaultReadyOnly(context: LibraryPickerContext): boolean {
  return !context.includeDrafts;
}

/**
 * Validates scope/link consistency. Rules:
 *   * usageScope must be a known scope;
 *   * a scoped usage requires its specific link;
 *   * a link implies its scope;
 *   * multiple entity links require scope 'shared' (a shared asset can
 *     additionally point at a primary context) — otherwise ambiguous.
 */
export function scopeConsistencyProblem(
  input: {
    usageScope: LibraryUsageScope | null;
    linkedModelId?: string | null;
    linkedItemId?: string | null;
    linkedEnvironmentId?: string | null;
  },
): string | null {
  const scope = input.usageScope;
  if (scope === null) return null; // legacy rows are allowed to be unset
  if (!USAGE_SCOPES.includes(scope)) return `Unknown usage scope: ${String(scope)}.`;

  const links = {
    model: input.linkedModelId ?? null,
    item: input.linkedItemId ?? null,
    environment: input.linkedEnvironmentId ?? null,
  };
  const setLinks = (Object.keys(links) as Array<keyof typeof links>).filter((k) => links[k]);

  if (scope === 'shared') {
    if (setLinks.length > 1) {
      return 'A shared asset can point at one primary context, not several.';
    }
    return null;
  }
  if (!links[scope]) {
    return `Scope "${scope}" requires a linked ${scope}.`;
  }
  for (const key of setLinks) {
    if (key !== scope) {
      return `A ${scope}-scoped asset cannot also link a ${key}.`;
    }
  }
  return null;
}

/** Legal status transitions for the asset lifecycle. */
const STATUS_TRANSITIONS: Record<LibraryAssetStatus, LibraryAssetStatus[]> = {
  draft: ['ready', 'archived'],
  ready: ['draft', 'archived'],
  archived: ['draft', 'ready'],
};

export function canTransitionLibraryAssetStatus(
  from: LibraryAssetStatus,
  to: LibraryAssetStatus,
): boolean {
  return STATUS_TRANSITIONS[from].includes(to);
}

/** Whether an asset is considered active (not archived). */
export function isActiveLibraryAsset(asset: Pick<LibraryAssetRecord, 'archivedAt' | 'status'>): boolean {
  return asset.archivedAt === null && asset.status !== 'archived';
}

/** Safe audit metadata key allowlist — keeps events small and secret-free. */
export function sanitizeLibraryEventMetadata(
  metadata: Record<string, unknown> | null | undefined,
): Record<string, string | number | boolean> | null {
  if (!metadata) return null;
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
    }
  }
  return Object.keys(out).length ? out : null;
}

/** Event catalogue (typed) so UI/tests can assert on names. */
export const LIBRARY_EVENT_TYPES: LibraryEventType[] = [
  'library_asset_created',
  'library_asset_updated',
  'library_asset_archived',
  'library_asset_restored',
  'library_asset_viewed',
  'library_picker_opened',
  'library_asset_attached',
];
