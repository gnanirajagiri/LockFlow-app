/**
 * Quality domain — source-change classifier.
 *
 * A TRANSPARENT rule set (no heuristics on media, no provider calls): a
 * correction request may adjust generation direction, framing, camera,
 * composition, lighting mood (without contradicting the locked environment),
 * motion, text-overlay placement and continuity — while retaining the exact
 * pinned source versions. Anything that changes identity, protected traits,
 * environment anchors or reusable asset configuration REQUIRES a new draft
 * version in the relevant source module and a new version-pinned content
 * plan. The classifier only explains and links; it never creates versions.
 */
import type {
  ClassifierTargetInfo,
  PinProjection,
  QualityFindingCategory,
  SourceChangeClassification,
  SourceChangeTarget,
} from './types';

/** Finding categories that change protected identity traits → new Model version. */
const MODEL_IDENTITY_CATEGORIES: ReadonlySet<QualityFindingCategory> = new Set([
  'model_identity',
  'face',
  'hairstyle',
  'skin_tone',
  'body_proportions',
]);

/** Finding categories that change the environment's anchors → new Environment version. */
const ENVIRONMENT_ANCHOR_CATEGORIES: ReadonlySet<QualityFindingCategory> = new Set([
  'environment_layout',
  'furniture_anchor',
]);

/**
 * Asset-config categories are ambiguous by themselves (placement is correctable,
 * design/label/selection is not), so they only trigger when the requested-change
 * text signals an asset redesign/replacement.
 */
const ASSET_CONFIG_CATEGORIES: ReadonlySet<QualityFindingCategory> = new Set([
  'product',
  'wardrobe',
  'accessory',
]);

/**
 * Transparent keyword table for text-signalled source changes (matched rules
 * are shown to the user). Each entry names the module a new version is needed
 * in — the classifier never guesses or auto-creates anything.
 */
const TEXT_SOURCE_CHANGE_PATTERNS: ReadonlyArray<{ pattern: RegExp; rule: string; target: SourceChangeTarget }> = [
  {
    pattern: /\b(redesign|redesigned|relabel|relabelled|new design|different design|change the design|change the label|replace the (product|bottle|packaging|wardrobe|outfit|accessory)|different (product|wardrobe|outfit|accessory)|swap the (product|wardrobe|accessory))\b/i,
    rule: 'requested change replaces a product/wardrobe/accessory design or label',
    target: 'library_asset_or_look',
  },
  {
    pattern: /\b(different|new|changed|swap(?:ped)?) (hairstyle|hair)\b/i,
    rule: 'requested change alters a protected hairstyle',
    target: 'model',
  },
  {
    pattern: /\b(different|new|changed) (room|layout|floor ?plan)\b/i,
    rule: 'requested change alters the room layout',
    target: 'environment',
  },
];

/** Categories that may remain corrections when they retain exact pinned sources. */
const PERMITTED_CATEGORIES: ReadonlySet<QualityFindingCategory> = new Set([
  'prop',
  'lighting',
  'palette_material',
  'camera',
  'composition',
  'text_overlay',
  'motion',
  'continuity',
  'other',
]);

export interface ClassifyCorrectionInput {
  requestedChange: string;
  scope: string;
  /** Categories of findings linked to the correction request (if any). */
  findingCategories: ReadonlyArray<QualityFindingCategory>;
  /** Projections of the parent output's exact pins (for links). */
  pins: ReadonlyArray<PinProjection>;
}

function moduleLabelForPins(
  pins: ReadonlyArray<PinProjection>,
  pinTypes: ReadonlyArray<PinProjection['pinType']>,
  fallback: string,
): Array<{ label: string; href: string }> {
  const links: Array<{ label: string; href: string }> = [];
  for (const pin of pins) {
    if (!pinTypes.includes(pin.pinType)) continue;
    const base =
      pin.pinType === 'model_version'
        ? `/models/${pin.sourceRecordId}`
        : pin.pinType === 'environment_version'
          ? `/environments/${pin.sourceRecordId}`
          : pin.resolvedVia === 'look_version' || pin.pinType === 'look_version'
            ? `/library/looks/${pin.sourceRecordId}`
            : `/library/${pin.sourceRecordId}`;
    links.push({
      label: `${pin.label}${pin.versionNumber != null ? ` v${pin.versionNumber}` : ''}`,
      href: base,
    });
  }
  return links.length > 0 ? links : [{ label: fallback, href: '#' }];
}

function targetInfo(
  target: SourceChangeTarget,
  pins: ReadonlyArray<PinProjection>,
  fallbackLabel: string,
): ClassifierTargetInfo {
  if (target === 'model') {
    return {
      target,
      label: 'Model',
      links: moduleLabelForPins(pins, ['model_version'], fallbackLabel),
    };
  }
  if (target === 'environment') {
    return {
      target,
      label: 'Environment',
      links: moduleLabelForPins(pins, ['environment_version'], fallbackLabel),
    };
  }
  return {
    target,
    label: 'Library Asset / Look',
    links: moduleLabelForPins(pins, ['library_asset_version', 'look_version'], fallbackLabel),
  };
}

/**
 * Classifies a correction request against the transparent rule set. Pure and
 * deterministic: identical inputs always produce identical output.
 */
export function classifyCorrectionRequest(input: ClassifyCorrectionInput): SourceChangeClassification {
  const targets: ClassifierTargetInfo[] = [];
  const rules: string[] = [];

  if (input.findingCategories.some((category) => MODEL_IDENTITY_CATEGORIES.has(category))) {
    targets.push(targetInfo('model', input.pins, 'the pinned model'));
    rules.push('a flagged identity/protected-trait finding requires a new approved Model version');
  }

  if (input.findingCategories.some((category) => ENVIRONMENT_ANCHOR_CATEGORIES.has(category))) {
    targets.push(targetInfo('environment', input.pins, 'the pinned environment'));
    rules.push('a flagged environment-layout/furniture-anchor finding requires a new approved Environment version');
  }

  const text = `${input.requestedChange}`;
  for (const entry of TEXT_SOURCE_CHANGE_PATTERNS) {
    if (!entry.pattern.test(text)) continue;
    if (targets.some((target) => target.target === entry.target)) {
      rules.push(`source change detected: ${entry.rule}`);
      continue;
    }
    targets.push(targetInfo(entry.target, input.pins, 'the pinned source'));
    rules.push(`source change detected: ${entry.rule}`);
  }

  if (targets.length === 0) {
    const permitted =
      PERMITTED_CATEGORIES.has('composition') &&
      (input.findingCategories.length === 0 ||
        input.findingCategories.every((category) => PERMITTED_CATEGORIES.has(category) || ASSET_CONFIG_CATEGORIES.has(category)));
    return {
      sourceChangeRequired: false,
      targets: [],
      explanation: permitted
        ? 'This correction stays within permitted direction/framing/composition/motion-style changes and retains the exact pinned source versions.'
        : 'This correction does not match a source-change rule, so it can proceed as a correction request.',
    };
  }

  const moduleNames = [...new Set(targets.map((target) => target.label))].join(' and ');
  return {
    sourceChangeRequired: true,
    targets,
    explanation:
      `This change requires a new approved ${moduleNames} version. ` +
      `Matched rules: ${rules.join('; ')}. ` +
      'Start a new draft version first, then prepare a new Content Studio job. Locked sources are never edited from the correction screen.',
  };
}
