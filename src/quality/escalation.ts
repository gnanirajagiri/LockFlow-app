/**
 * Quality domain — recurring-issue escalation (advisory only).
 *
 * Issue keys are deterministic over NON-SENSITIVE inputs only: the finding
 * category plus a hash of the workspace's pinned version IDs (never file
 * contents, never media, never URLs). Escalation is advisory: it only ever
 * produces a recommendation string; it never changes providers, prompts,
 * versions or settings automatically.
 */
import type { EscalationLevel, PinProjection, QualityFindingCategory } from './types';
import { ESCALATION_RECOMMENDATIONS } from './types';

/**
 * Deterministic non-sensitive hash of the pinned version context. FNV-1a over
 * the sorted `pinType:sourceVersionId` pairs — readable, stable across
 * processes, and reveals nothing about source contents.
 */
export function computeSourceContextHash(pins: ReadonlyArray<PinProjection>): string {
  const material = pins
    .map((pin) => `${pin.pinType}:${pin.sourceVersionId}`)
    .sort()
    .join('|');
  // FNV-1a 32-bit
  let hash = 0x811c9dc5;
  for (let i = 0; i < material.length; i += 1) {
    hash ^= material.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** Workspace-scoped issue key: category + source-context hash. */
export function computeIssueKey(
  category: QualityFindingCategory,
  sourceContextHash: string,
): string {
  return `qissue:${category}:${sourceContextHash}`;
}

/** Escalation level from the occurrence count (1-based). */
export function escalationLevelFor(occurrenceCount: number): EscalationLevel {
  if (occurrenceCount <= 1) return 'first_notice';
  if (occurrenceCount === 2) return 'strengthen_references';
  if (occurrenceCount === 3) return 'constrain_prompt';
  return 'provider_review';
}

/** The exact advisory recommendation for an escalation level. */
export function recommendationFor(level: EscalationLevel): string {
  return ESCALATION_RECOMMENDATIONS[level];
}
