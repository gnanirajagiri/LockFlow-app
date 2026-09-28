/**
 * Templates domain — guard functions.
 *
 * Pure, framework-free and unit-tested. Templates are planning blueprints:
 * the guards refuse archived-template edits/apply, keep status transitions
 * soft, and enforce the non-binding-suggestion shape rules.
 */
import type {
  ContentTemplateRecord,
  ContentTemplateSuggestionRecord,
  TemplateStatus,
} from './types';

/** Permitted template status transitions — soft archive, restore from archive. */
export const TEMPLATE_STATUS_TRANSITIONS: Record<TemplateStatus, TemplateStatus[]> = {
  draft: ['active', 'archived'],
  active: ['archived'],
  archived: ['draft'], // restore is a soft return to editable draft
};

export function canTransitionTemplateStatus(from: TemplateStatus, to: TemplateStatus): boolean {
  return TEMPLATE_STATUS_TRANSITIONS[from].includes(to);
}

export class TemplateStateError extends Error {
  constructor(from: TemplateStatus, to: TemplateStatus) {
    super(`A template cannot move from ${from} to ${to}.`);
    this.name = 'TemplateStateError';
  }
}

export function refuseInvalidTemplateTransition(from: TemplateStatus, to: TemplateStatus): void {
  if (!canTransitionTemplateStatus(from, to)) {
    throw new TemplateStateError(from, to);
  }
}

/** Rule — archived templates are read-only. */
export class TemplateArchivedError extends Error {
  constructor(templateId: string) {
    super(`Template ${templateId} is archived and read-only. Restore it first.`);
    this.name = 'TemplateArchivedError';
  }
}

export function assertTemplateEditable(
  template: Pick<ContentTemplateRecord, 'id' | 'status'>,
): void {
  if (template.status === 'archived') {
    throw new TemplateArchivedError(template.id);
  }
}

/**
 * Rule — archived templates cannot be applied until restored. (Deliberate
 * product decision: apply-from-archive is not supported; restoring is one
 * click and keeps "archived" unambiguous.)
 */
export function assertTemplateApplicable(
  template: Pick<ContentTemplateRecord, 'id' | 'status'>,
): void {
  if (template.status === 'archived') {
    throw new TemplateArchivedError(template.id);
  }
}

/**
 * Rule — suggestions are non-binding. A suggestion record must never carry a
 * version id; the record shape has no field for one, so this guard checks the
 * canonical-asset discipline instead: category suggestions must not reference
 * a concrete asset, and asset suggestions must reference one.
 */
export function suggestionShapeProblem(
  suggestion: Pick<ContentTemplateSuggestionRecord, 'suggestionType' | 'suggestedAssetId'>,
): string | null {
  const needsAsset = ['model', 'environment', 'look', 'library_asset'].includes(suggestion.suggestionType);
  if (needsAsset && !suggestion.suggestedAssetId) {
    return `${suggestion.suggestionType} suggestions must reference a canonical workspace asset`;
  }
  if (!needsAsset && suggestion.suggestedAssetId) {
    return 'category suggestions must not reference a concrete asset';
  }
  return null;
}
