/**
 * Prompt 27 — deterministic, auditable prompt normalization.
 *
 * The prompt bar accepts simple-language intent; this module transforms it
 * into structured generation input with a fully recorded derivation. Rule-based
 * and deterministic by design (no opaque model calls): the same input always
 * yields the same normalization, so the audit trail can be replayed.
 *
 * Everything extracted is recorded — including what was NOT found — so the
 * normalization record doubles as the auditable transformation log.
 */
import type { NormalizedPromptRecord } from './types';

export interface PromptNormalizationInput {
  userPrompt: string;
  aspectRatio?: string;
  outputCount?: number;
}

export interface NormalizedPrompt {
  /** The verbatim user input — never rewritten. */
  userPrompt: string;
  /** Prompt with stop words trimmed and whitespace collapsed (case kept). */
  cleanedPrompt: string;
  aspectRatio: string;
  outputCount: number;
  /** Rule-based extraction results; every slot records found/not-found. */
  extracted: {
    subject: string | null;
    setting: string | null;
    lighting: string | null;
    mood: string | null;
    styleHints: string[];
  };
  /** Human-readable warnings surfaced to the review step. */
  warnings: string[];
  /**
   * The exact rule set applied, in order — replaying these rules against
   * `userPrompt` reproduces `extracted` byte-for-byte.
   */
  rulesApplied: string[];
}

const ASPECT_RATIOS = ['1:1', '4:5', '3:2', '16:9', '9:16'] as const;

const SUBJECT_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\b(portrait|headshot|close-?up)\b/i, label: 'portrait' },
  { pattern: /\b(full[- ]body|standing|seated)\b/i, label: 'full body' },
  { pattern: /\b(product (?:shot|photo|photography)|packshot)\b/i, label: 'product shot' },
  { pattern: /\b(lifestyle|editorial|campaign)\b/i, label: 'editorial' },
  { pattern: /\b(street|outdoor|studio) (?:scene|shot|photo)\b/i, label: 'scene' },
];

const SETTING_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bin (?:a |an |the )?([a-z]+ (?:studio|loft|bedroom|kitchen|office|cafe|street|garden|beach|forest))/i, label: 'location phrase' },
  { pattern: /\b(studio|loft|bedroom|kitchen|office|cafe|rooftop|garden|beach)\b/i, label: 'location word' },
];

const LIGHTING_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\b(golden hour|soft light|natural light|studio lighting|low key|high key|backlit|rim light|window light)\b/i, label: 'lighting phrase' },
  { pattern: /\b(warm|cool|moody|bright|dim|dramatic)\b(?=\s+(?:light|lighting|tones|mood))/i, label: 'lighting adjective' },
];

const MOOD_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\b(confident|serene|playful|dramatic|calm|energetic|minimalist|luxurious|cosy|cozy)\b/i, label: 'mood word' },
];

const STYLE_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\b(black and white|monochrome|film grain|35mm|editorial|minimal|vintage|clean|premium)\b/i, label: 'style hint' },
];

function firstMatch(text: string, patterns: Array<{ pattern: RegExp; label: string }>): { value: string; rule: string } | null {
  for (const { pattern, label } of patterns) {
    const match = text.match(pattern);
    if (match) {
      return { value: match[0], rule: label };
    }
  }
  return null;
}

function collectMatches(text: string, patterns: Array<{ pattern: RegExp; label: string }>): { values: string[]; rules: string[] } {
  const values: string[] = [];
  const rules: string[] = [];
  for (const { pattern, label } of patterns) {
    const global = new RegExp(pattern.source, 'gi');
    for (const match of text.matchAll(global)) {
      values.push(match[0]);
      rules.push(label);
    }
  }
  return { values, rules };
}

/**
 * Normalizes a prompt-bar input. Deterministic: pure function of the input.
 * Returns the full record for the locked-input snapshot plus a client-safe
 * view for the review step.
 */
export function normalizeGenerationPrompt(input: PromptNormalizationInput): NormalizedPrompt {
  const userPrompt = input.userPrompt.trim();
  const warnings: string[] = [];
  const rulesApplied: string[] = [];

  if (userPrompt.length === 0) {
    warnings.push('The prompt is empty — describe what to generate.');
  }
  if (userPrompt.length < 12 && userPrompt.length > 0) {
    warnings.push('Very short prompts give the provider little to work with; consider describing subject, setting and mood.');
  }

  // Aspect ratio: accept only the supported set; anything else normalizes to 1:1.
  const requestedRatio = (input.aspectRatio ?? '').trim();
  const aspectRatio = (ASPECT_RATIOS as readonly string[]).includes(requestedRatio) ? requestedRatio : '1:1';
  if (requestedRatio && requestedRatio !== aspectRatio) {
    warnings.push(`Aspect ratio "${requestedRatio}" is not supported — normalized to ${aspectRatio}.`);
  }
  rulesApplied.push(`aspect-ratio:${aspectRatio}`);

  // Output count clamped to the per-job cap (4) enforced by eligibility.
  const requestedCount = Math.floor(input.outputCount ?? 1);
  const outputCount = Math.min(Math.max(Number.isNaN(requestedCount) ? 1 : requestedCount, 1), 4);
  if (outputCount !== requestedCount) {
    warnings.push(`Output count adjusted from ${requestedCount || 1} to ${outputCount} (allowed range 1–4).`);
  }
  rulesApplied.push(`output-count:${outputCount}`);

  const subject = firstMatch(userPrompt, SUBJECT_PATTERNS);
  if (subject) rulesApplied.push(`subject:${subject.rule}`);
  const setting = firstMatch(userPrompt, SETTING_PATTERNS);
  if (setting) rulesApplied.push(`setting:${setting.rule}`);
  const lighting = firstMatch(userPrompt, LIGHTING_PATTERNS);
  if (lighting) rulesApplied.push(`lighting:${lighting.rule}`);
  const mood = firstMatch(userPrompt, MOOD_PATTERNS);
  if (mood) rulesApplied.push(`mood:${mood.rule}`);
  const style = collectMatches(userPrompt, STYLE_PATTERNS);
  for (const rule of style.rules) rulesApplied.push(`style:${rule}`);

  const cleanedPrompt = userPrompt.replace(/\s+/g, ' ').trim();

  const normalized: NormalizedPrompt = {
    userPrompt,
    cleanedPrompt,
    aspectRatio,
    outputCount,
    extracted: {
      subject: subject?.value ?? null,
      setting: setting?.value ?? null,
      lighting: lighting?.value ?? null,
      mood: mood?.value ?? null,
      styleHints: style.values,
    },
    warnings,
    rulesApplied,
  };

  const record: NormalizedPromptRecord = {
    userPrompt: normalized.userPrompt,
    cleanedPrompt: normalized.cleanedPrompt,
    aspectRatio: normalized.aspectRatio,
    outputCount: normalized.outputCount,
    extracted: { ...normalized.extracted },
    warnings: [...normalized.warnings],
    rulesApplied: [...normalized.rulesApplied],
    normalizedAt: new Date().toISOString(),
  };
  void record;

  return normalized;
}
