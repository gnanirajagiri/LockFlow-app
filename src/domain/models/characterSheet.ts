/**
 * Character Sheet — prompt 26: protected identity traits & generation hooks.
 *
 * Works over the committed Character Sheet record (identity summary +
 * structured trait groups stored as JSONB per model version). Traits fall
 * into two families:
 *
 *   * Protected — the identity summary plus faceFeatures, hairIdentity,
 *     complexion, bodyProportions and distinctiveDetails. These define WHO
 *     the model is; they survive styling, clothing, props, environment and
 *     camera changes, and they only change through a draft → lock version
 *     flow.
 *   * Supporting — lock rules and reference notes. Editable evidence and
 *     governance metadata, never identity-defining.
 *
 * The replaceable styling layer (clothing, accessories, props, looks,
 * environments, camera) deliberately does NOT live on the sheet at all — it
 * attaches from the shared Library at job time. That separation is what keeps
 * identity stable while scenes change.
 *
 * Everything here is pure, framework-free and deterministic. The service
 * layer composes these helpers with workspace guards; the UI reads the same
 * classification so protected rows render visually distinct.
 */
import type {
  CharacterSheetRecord,
  ModelRecord,
  ModelReferenceRecord,
  ModelVersionRecord,
  ReferenceType,
  SheetTraits,
} from './types';

/**
 * Protection levels, ordered least → most restrictive. `editable` and
 * `derived` are reserved for future trait classes (free-form styling notes,
 * recomputed descriptors); today's sheet only emits `protected` and
 * `supporting` rows, and locked versions refuse edits upstream of this table.
 */
export type ProtectionLevel = 'editable' | 'derived' | 'supporting' | 'protected' | 'locked';

export const PROTECTION_LEVEL_LABELS: Record<ProtectionLevel, string> = {
  editable: 'Editable',
  derived: 'Derived (recomputed from the source identity)',
  supporting: 'Supporting (non-identity metadata)',
  protected: 'Protected (identity-defining)',
  locked: 'Locked (immutable)',
};

/** The structured trait groups on a Character Sheet record. */
export type TraitGroup =
  | 'identity'
  | 'faceFeatures'
  | 'hairIdentity'
  | 'complexion'
  | 'bodyProportions'
  | 'distinctiveDetails'
  | 'lockRules';

/** Groups that constitute protected identity (prompt 26 §2). */
export const PROTECTED_TRAIT_GROUPS: readonly TraitGroup[] = [
  'identity',
  'faceFeatures',
  'hairIdentity',
  'complexion',
  'bodyProportions',
  'distinctiveDetails',
];

const TRAIT_GROUP_FIELDS = [
  'faceFeatures',
  'hairIdentity',
  'complexion',
  'bodyProportions',
  'distinctiveDetails',
  'lockRules',
] as const satisfies readonly TraitGroup[];

/** Protection level for a whole group. */
export function protectionLevelOfGroup(group: TraitGroup): ProtectionLevel {
  return group === 'lockRules' ? 'supporting' : 'protected';
}

/**
 * Flattens a sheet into dot-prefixed trait keys → display strings:
 * `identity.identitySummary`, `faceFeatures.eyes`, `lockRules.note`, …
 */
export function buildTraitMap(sheet: CharacterSheetRecord): Record<string, string> {
  const out: Record<string, string> = {
    'identity.identitySummary': sheet.identitySummary,
  };
  for (const group of TRAIT_GROUP_FIELDS) {
    const source = sheet[group] as SheetTraits;
    if (!source || typeof source !== 'object') continue;
    for (const [key, value] of Object.entries(source)) {
      out[`${group}.${key}`] = typeof value === 'string' ? value : JSON.stringify(value);
    }
  }
  return out;
}

/** Classifies a dot-prefixed trait key to its group (unknown keys → null). */
export function classifyTraitKey(traitKey: string): TraitGroup | null {
  if (traitKey === 'identity.identitySummary') return 'identity';
  const dot = traitKey.indexOf('.');
  if (dot <= 0) return null;
  const group = traitKey.slice(0, dot) as TraitGroup;
  return (TRAIT_GROUP_FIELDS as readonly string[]).includes(group) ? group : null;
}

/** Protection level of a trait key. Unknown keys default to `editable`. */
export function protectionLevelOf(traitKey: string): ProtectionLevel {
  const group = classifyTraitKey(traitKey);
  return group ? protectionLevelOfGroup(group) : 'editable';
}

/** Dot-prefixed keys of every protected trait currently on the sheet. */
export function getProtectedTraitKeys(sheet: CharacterSheetRecord): string[] {
  return Object.entries(buildTraitMap(sheet))
    .filter(([key]) => protectionLevelOf(key) === 'protected')
    .map(([key]) => key);
}

/**
 * May this trait be edited on a version with the given status? Locked and
 * superseded versions refuse every edit — the only identity-change path is a
 * new draft version. Drafts may edit anything; protected keys carry a note so
 * the UI can warn that the edit will become the next locked identity.
 */
export function traitMayBeEdited(
  versionStatus: ModelVersionRecord['status'],
  traitKey: string,
): { allowed: boolean; reason?: string } {
  if (versionStatus !== 'draft') {
    return {
      allowed: false,
      reason: 'Locked versions are immutable — create a new draft version to change this trait.',
    };
  }
  if (protectionLevelOf(traitKey) === 'protected') {
    return {
      allowed: true,
      reason: 'Protected identity trait — this edit becomes part of the next locked identity version.',
    };
  }
  return { allowed: true };
}

/** A derived, explicit row describing one trait of a Character Sheet. */
export interface CharacterSheetTraitRow {
  /** Stable id: `${characterSheetId}:${traitKey}`. */
  id: string;
  characterSheetId: string;
  traitGroup: TraitGroup;
  traitKey: string;
  traitValue: string;
  protectionLevel: ProtectionLevel;
  /**
   * False for protected rows: they cannot be changed by styling/update flows
   * (only via the draft → lock version workflow). Supporting rows are true.
   */
  isEditable: boolean;
}

/**
 * The protected identity traits of a sheet as explicit, inspectable rows.
 * Empty trait values are skipped so generation hooks only see real identity
 * data. This is the projection the generation-time hooks and the Character
 * Sheet UI both read.
 */
export function getProtectedIdentityTraits(sheet: CharacterSheetRecord): CharacterSheetTraitRow[] {
  const rows: CharacterSheetTraitRow[] = [];
  if (sheet.identitySummary.trim() !== '') {
    rows.push({
      id: `${sheet.id}:identity.identitySummary`,
      characterSheetId: sheet.id,
      traitGroup: 'identity',
      traitKey: 'identity.identitySummary',
      traitValue: sheet.identitySummary,
      protectionLevel: 'protected',
      isEditable: false,
    });
  }
  for (const group of TRAIT_GROUP_FIELDS) {
    if (group === 'lockRules') continue;
    const source = sheet[group] as SheetTraits;
    if (!source || typeof source !== 'object') continue;
    for (const [key, value] of Object.entries(source)) {
      rows.push({
        id: `${sheet.id}:${group}.${key}`,
        characterSheetId: sheet.id,
        traitGroup: group,
        traitKey: `${group}.${key}`,
        traitValue: typeof value === 'string' ? value : JSON.stringify(value),
        protectionLevel: 'protected',
        isEditable: false,
      });
    }
  }
  return rows;
}

const REFERENCE_PRIORITY: readonly ReferenceType[] = [
  'portrait',
  'full_body',
  'profile',
  'detail',
  'other',
];

/**
 * Identity references ordered for generation: primary portrait evidence
 * first, then full body, profile, detail shots, and anything else. Ties
 * break by the reference's own sort order.
 */
export function getCharacterSheetReferencesForGeneration(
  references: ModelReferenceRecord[],
): ModelReferenceRecord[] {
  return [...references].sort(
    (a, b) =>
      REFERENCE_PRIORITY.indexOf(a.referenceType) - REFERENCE_PRIORITY.indexOf(b.referenceType) ||
      a.sortOrder - b.sortOrder,
  );
}

/**
 * The version that governs a model's current identity: the model's active
 * (locked) version when set, otherwise the latest locked version, otherwise
 * the newest draft. Null when the model has no versions at all.
 */
export function selectActiveIdentityVersion(
  model: Pick<ModelRecord, 'activeVersionId'>,
  versions: ModelVersionRecord[],
): ModelVersionRecord | null {
  if (versions.length === 0) return null;
  const active = model.activeVersionId
    ? versions.find((version) => version.id === model.activeVersionId)
    : undefined;
  if (active) return active;
  const latestLocked = versions
    .filter((version) => version.status === 'locked')
    .sort((a, b) => b.versionNumber - a.versionNumber)[0];
  if (latestLocked) return latestLocked;
  return (
    versions
      .filter((version) => version.status === 'draft')
      .sort((a, b) => b.versionNumber - a.versionNumber)[0] ?? null
  );
}

/**
 * Compares a candidate's claimed traits against the protected rows.
 * Partial candidates are allowed — only keys the candidate actually provides
 * are checked, and keys outside the protected set are never identity
 * violations. Values are compared as display strings.
 */
export function compareCandidateTraitsToProtectedTraits(
  candidate: Record<string, unknown>,
  protectedRows: CharacterSheetTraitRow[],
): { matches: boolean; mismatches: string[] } {
  const expected = new Map(protectedRows.map((row) => [row.traitKey, row.traitValue]));
  const mismatches: string[] = [];
  for (const [key, value] of Object.entries(candidate)) {
    const expectedValue = expected.get(key);
    if (expectedValue === undefined) continue;
    const candidateValue = typeof value === 'string' ? value : JSON.stringify(value);
    if (candidateValue !== expectedValue) {
      mismatches.push(`${key}: expected "${expectedValue}", candidate "${candidateValue}"`);
    }
  }
  return { matches: mismatches.length === 0, mismatches };
}

/**
 * Generation-time validation: does a candidate generation's claimed identity
 * match the sheet's protected traits? `valid` is false when any provided
 * protected trait disagrees with the sheet.
 */
export function validateModelGenerationAgainstCharacterSheet(
  sheet: CharacterSheetRecord,
  candidateTraits: Record<string, unknown>,
): { valid: boolean; mismatches: string[]; protectedTraitCount: number } {
  const protectedRows = getProtectedIdentityTraits(sheet);
  const { matches, mismatches } = compareCandidateTraitsToProtectedTraits(candidateTraits, protectedRows);
  return { valid: matches, mismatches, protectedTraitCount: protectedRows.length };
}

// ── Audit trail (mirrors the character_sheet_audit table) ────────────────────

/** The structured Character Sheet events recorded in the audit trail. */
export type CharacterSheetAuditEvent =
  | 'character_sheet_created'
  | 'character_sheet_updated'
  | 'character_sheet_locked'
  | 'character_sheet_activated'
  | 'character_sheet_draft_created'
  | 'protected_trait_edit_blocked'
  | 'protected_trait_updated_in_draft'
  | 'character_sheet_reference_added'
  | 'character_sheet_reference_removed';

/** One append-only audit row for a Character Sheet. */
export interface CharacterSheetAuditRow {
  id: string;
  workspaceId: string;
  characterSheetId: string;
  event: CharacterSheetAuditEvent;
  actorId: string | null;
  detail: string | null;
  createdAt: string;
}
