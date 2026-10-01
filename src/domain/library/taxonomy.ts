/**
 * Library domain — Prompt 21 unified-taxonomy helpers.
 *
 * Pure, framework-free and unit-tested. These encode the product rule that
 * the Library is organized by WHERE an asset is used (model / item /
 * environment / shared) — never by ownership-style library concepts.
 * The Gallery stays the home of generated outputs; nothing here reads or
 * writes Gallery records.
 */
import { normalizeTagName } from './schemas';
import type {
  LibraryAssetRecord,
  LibraryAssetType,
  LibraryAssetStatus,
  LibraryEventType,
  LibraryIntakeMethod,
  LibraryAttachmentTargetType,
  LibraryPickerContext,
  LibraryUsageScope,
  LibrarySourceKind,
  LibraryAssetSuggestion,
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
  'library_asset_add_started',
  'library_asset_parse_suggested',
  'library_asset_detached',
  'library_inline_add_started',
];

// ═══ Prompt 22: ingestion, attachment & picker helpers ══════════════════════

export const INTAKE_METHOD_LABELS: Record<LibraryIntakeMethod, string> = {
  upload: 'Upload a file',
  import_scan: 'Import / scan an image',
  image_url: 'Paste an image URL',
  manual: 'Create manually',
  prompt_assisted: 'Describe it — LockFlow suggests',
};

/** Intake method → safe provenance label on the asset record. */
export const INTAKE_METHOD_SOURCE_KIND: Record<LibraryIntakeMethod, LibrarySourceKind> = {
  upload: 'reference_upload',
  import_scan: 'reference_upload',
  image_url: 'import',
  manual: 'manual',
  prompt_assisted: 'manual',
};

export const ATTACHMENT_TARGET_LABELS: Record<LibraryAttachmentTargetType, string> = {
  content_scene: 'content scene',
  content_job: 'content studio job',
  campaign: 'campaign',
  model: 'model',
  environment: 'environment',
};

/**
 * Role/slot normalization: lowercase kebab, ≤ 60 chars, default 'reference'.
 * The DB stores this text verbatim — normalization keeps slots comparable.
 */
export function normalizeRoleOrSlot(role: string | null | undefined): string {
  const cleaned = (role ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-_]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return cleaned || 'reference';
}

export function attachmentRoleProblems(roleOrSlot: string | null | undefined): string[] {
  const problems: string[] = [];
  const raw = roleOrSlot ?? '';
  if (raw.trim().length === 0) {
    problems.push('A role/slot is required (e.g. "prop", "hero", "reference").');
  } else if (raw.length > 60) {
    problems.push('Role/slot must be 60 characters or fewer.');
  }
  return problems;
}

/**
 * Context warnings for a candidate attachment. Archived assets only ever
 * appear when the user explicitly opted in — and then with this warning.
 */
export function libraryAttachmentWarnings(
  asset: Pick<LibraryAssetRecord, 'archivedAt' | 'status' | 'name'>,
  opts: { archivedSelectedExplicitly?: boolean } = {},
): string[] {
  const warnings: string[] = [];
  if (asset.archivedAt || asset.status === 'archived') {
    warnings.push(
      opts.archivedSelectedExplicitly
        ? `“${asset.name}” is archived — you explicitly included it.`
        : `“${asset.name}” is archived.`,
    );
  } else if (asset.status === 'draft') {
    warnings.push(`“${asset.name}” is still a draft — approve it before relying on it.`);
  }
  return warnings;
}

const PRIVATE_HOST_PATTERN =
  /^(localhost|127\.\d|0\.0\.0\.0|10\.\d|192\.168\.\d|169\.254\.\d|172\.(1[6-9]|2\d|3[01])\.)/i;

/**
 * Validates a user-pasted image URL: absolute http(s), no embedded
 * credentials, no private/loopback hosts, ≤ 1000 chars. Returns the
 * normalized URL or null. This is a metadata reference — never fetched.
 */
export function sanitizeExternalImageUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value || value.length > 1000) return null;
  if (!/^https?:\/\//i.test(value)) return null;
  if (value.includes('@')) return null; // userinfo credentials are never allowed
  try {
    const url = new URL(value);
    if (url.username || url.password) return null;
    if (PRIVATE_HOST_PATTERN.test(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Deterministic asset-type keyword map for the prompt-assisted parser. */
const TYPE_KEYWORDS: Array<[RegExp, LibraryAssetType]> = [
  // 'product shots/photo' is phrasing, not an asset type — only the noun counts.
  [/(serum|moisturi[sz]er|bottle|jar|tube|cleanser|packaging)|\bproduct\b(?!\s+(shots?|photos?|photography|videos?))/i, 'product'],
  [/(chair|table|vase|cup|mug|bowl|book|prop|candle|frame)/i, 'prop'],
  [/(blazer|jacket|dress|shirt|coat|sweater|wardrobe|clothing)/i, 'wardrobe'],
  [/(earring|necklace|ring|watch|bracelet|glasses|sunglasses|accessory)/i, 'accessory'],
  [/(laptop|camera|phone|microphone|headphones|ring light|tripod|gear|tool)/i, 'creator_tool'],
  [/(backdrop|wall|room|corner|kitchen|bathroom|setting|set)/i, 'scene'],
  [/(outfit|look|styling|ensemble)/i, 'look'],
  [/(logo|brand|wordmark|palette|guideline)/i, 'brand_asset'],
];

/** Deterministic usage-scope keyword map ("where it is used"). */
const SCOPE_KEYWORDS: Array<[RegExp, LibraryUsageScope]> = [
  [/(worn by|worn on|on the model|on a model|with the model)/i, 'model'],
  [/(on the desk|on the table|on the counter|in hand|held|on the item|with the product)/i, 'item'],
  [/(in the room|in the background|in the environment|in the corner|room setting)/i, 'environment'],
];

const RIGHTS_KEYWORDS = /(licensed|client[- ]provided|rights|permission|usage approved|stock photo)/i;

/**
 * Prompt-assisted metadata suggestion — pure, deterministic, offline.
 * Always returns `needsConfirmation: true`; the service logs the suggestion
 * and the UI forces an explicit review step. Entity links are NEVER guessed.
 */
export function parseLibraryAssetDescription(text: string): LibraryAssetSuggestion {
  const trimmed = (text ?? '').trim();
  const lines = trimmed.split(/\n+/).map((line) => line.trim()).filter(Boolean);

  // Name: first meaningful line, bullets stripped, capped at 80 chars.
  let name = (lines[0] ?? '').replace(/^[-*•\d.]+\s*/, '').trim().slice(0, 80);
  const description = (lines.length > 1 ? lines.slice(1).join(' ') : lines[0] ?? '')
    .slice(0, 2000);
  if (!name) name = 'Untitled asset';

  // Tags: #hashtags plus an explicit "tags: …" phrase.
  const tags = new Set<string>();
  for (const match of trimmed.matchAll(/#([a-z0-9][a-z0-9-]{1,29})/gi)) {
    tags.add(normalizeTagName(match[1]));
  }
  const tagLine = /tags?\s*[:\-]\s*([^.!\n]+)/i.exec(trimmed);
  if (tagLine) {
    for (const part of tagLine[1].split(/[,;/]/)) {
      const normalized = normalizeTagName(part);
      if (normalized) tags.add(normalized);
    }
  }

  // Asset type: first keyword hit; default 'other'.
  let assetType: LibraryAssetType = 'other';
  for (const [pattern, type] of TYPE_KEYWORDS) {
    if (pattern.test(trimmed)) {
      assetType = type;
      break;
    }
  }

  // Usage scope: explicit keyword wins; otherwise the type's hint.
  let usageScope: LibraryUsageScope | null = null;
  for (const [pattern, scope] of SCOPE_KEYWORDS) {
    if (pattern.test(trimmed)) {
      usageScope = scope;
      break;
    }
  }
  if (!usageScope) usageScope = TYPE_SCOPE_HINT[assetType];

  // Rights/usage note: flagged, never silently trusted.
  const rightsOrUsageNote = RIGHTS_KEYWORDS.test(trimmed)
    ? 'The description mentions rights or usage terms — confirm them before using this asset.'
    : null;

  return {
    name,
    description,
    assetType,
    usageScope,
    tags: [...tags].slice(0, 8),
    rightsOrUsageNote,
    linkedModelId: null,
    linkedItemId: null,
    linkedEnvironmentId: null,
    warnings: [
      'Suggested from your description — review and edit every field before saving.',
    ],
    needsConfirmation: true,
  };
}

/**
 * Picker selection toggle — single-select replaces the selection,
 * multi-select toggles. Pure so the drawer and tests share one behavior.
 */
export function togglePickerSelection(
  selectedIds: Set<string>,
  id: string,
  multiSelect: boolean,
): Set<string> {
  const next = new Set(multiSelect ? selectedIds : []);
  if (selectedIds.has(id)) next.delete(id);
  else next.add(id);
  return next;
}
