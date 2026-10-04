/**
 * Prompt 27 — deterministic locked generation input assembly.
 *
 * Gathers everything a generation runs under — the normalized prompt, the
 * pinned model/environment versions, the active Character Sheet's protected
 * identity constraints, and the reference plan — into one inspectable
 * snapshot. Deterministic: the same resolved inputs always produce the same
 * snapshot, so variants can inherit it verbatim and audits can compare
 * baselines across runs.
 *
 * The assembly itself performs NO provider calls and NO writes; the service
 * resolves the raw records (workspace-checked) and passes them in. The
 * snapshot stores identifiers, labels and trait keys only — never secrets,
 * never signed URLs, never provider payloads.
 */
import type {
  LockedGenerationInputSnapshot,
  LockedInputLine,
  NormalizedPromptRecord,
  SnapshotVersionRef,
} from './types';
import { getProtectedIdentityTraits } from '../domain/models';
import type { CharacterSheetRecord, ModelReferenceRecord } from '../domain/models';

/** The resolved inputs the service hands to the assembler. */
export interface LockedInputSource {
  normalizedPrompt: NormalizedPromptRecord;
  aspectRatio: string;
  outputCount: number;
  /** The model version pinned for this generation, if any. */
  model: {
    modelId: string;
    modelName: string;
    version: SnapshotVersionRef;
  } | null;
  /** The active/selected Character Sheet for the pinned model, if any. */
  characterSheet: CharacterSheetRecord | null;
  /** The environment version pinned for this generation, if any. */
  environment: {
    environmentId: string;
    environmentName: string;
    version: SnapshotVersionRef;
  } | null;
  /** Library assets / looks pinned for this generation. */
  assets: Array<{ assetId: string; label: string; kind: 'library_asset' | 'look' }>;
  /** The pinned model version's identity references (portrait evidence). */
  references: ModelReferenceRecord[];
}

/**
 * Assembles the locked input snapshot. Pure and deterministic — same inputs,
 * same snapshot, byte-for-byte (timestamps aside, which the caller may pin).
 */
export function buildLockedGenerationInputSnapshot(
  source: LockedInputSource,
): LockedGenerationInputSnapshot {
  const lockedInputs: LockedInputLine[] = [];

  if (source.model) {
    lockedInputs.push({
      kind: 'model_version',
      id: source.model.version.id,
      label: `${source.model.modelName} v${source.model.version.versionNumber}`,
      versionNumber: source.model.version.versionNumber,
      resolvedVia: source.model.version.status === 'locked' ? 'model.activeVersionId' : 'model.draftVersion',
    });
  }

  if (source.model && source.characterSheet) {
    lockedInputs.push({
      kind: 'character_sheet',
      id: source.characterSheet.id,
      label: `Character Sheet for ${source.model.modelName} v${source.model.version.versionNumber}`,
      versionNumber: source.model.version.versionNumber,
      resolvedVia: 'character_sheets.modelVersionId',
    });
  }

  if (source.environment) {
    lockedInputs.push({
      kind: 'environment_version',
      id: source.environment.version.id,
      label: `${source.environment.environmentName} v${source.environment.version.versionNumber}`,
      versionNumber: source.environment.version.versionNumber,
      resolvedVia: source.environment.version.status === 'locked' ? 'environment.activeVersionId' : 'environment.draftVersion',
    });
  }

  for (const asset of source.assets) {
    lockedInputs.push({
      kind: asset.kind,
      id: asset.assetId,
      label: asset.label,
      versionNumber: null,
      resolvedVia: 'library.pinnedAsset',
    });
  }

  // Protected identity constraints: the prompt-26 projection of the active
  // sheet. Empty sheets produce an empty constraint entry — the enforcement
  // gate decides whether that blocks the generation.
  const characterSheetConstraints = source.model && source.characterSheet
    ? [
        {
          modelId: source.model.modelId,
          modelVersionId: source.model.version.id,
          characterSheetId: source.characterSheet.id,
          protectedTraitKeys: getProtectedIdentityTraits(source.characterSheet).map((row) => row.traitKey),
          protectedTraitCount: getProtectedIdentityTraits(source.characterSheet).length,
        },
      ]
    : [];

  // Reference plan: roles + counts only — no paths, no URLs.
  const roleCounts = new Map<string, number>();
  for (const reference of source.references) {
    roleCounts.set(reference.referenceType, (roleCounts.get(reference.referenceType) ?? 0) + 1);
  }

  return {
    prompt: {
      userPrompt: source.normalizedPrompt.userPrompt,
      cleanedPrompt: source.normalizedPrompt.cleanedPrompt,
    },
    aspectRatio: source.aspectRatio,
    outputCount: source.outputCount,
    lockedInputs,
    characterSheetConstraints,
    referencePlan: [...roleCounts.entries()].map(([role, count]) => ({ role, count })),
    assembledAt: new Date().toISOString(),
  };
}
