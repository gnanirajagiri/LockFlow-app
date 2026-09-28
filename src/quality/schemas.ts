/**
 * Quality domain — validation schemas.
 *
 * Dependency-free validators matching the Gallery/Content Studio conventions
 * (ValidationResult + explicit error strings).
 */
import type { ValidationResult } from '../domain/models/schemas';
import {
  CORRECTION_SCOPES,
  ESCALATION_LEVELS,
  QUALITY_FINDING_CATEGORIES,
  QUALITY_RESULTS,
  QUALITY_SEVERITIES,
  CORRECTION_STATUSES,
} from './types';
import type {
  CorrectionScope,
  CorrectionRequestStatus,
  CreateCorrectionRequestInput,
  CreateQualityFindingInput,
  EscalationLevel,
  QualityFindingCategory,
  QualityResult,
  QualitySeverity,
  UpdateCorrectionRequestInput,
  UpdateQualityFindingInput,
} from './types';

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function isQualityFindingCategory(value: unknown): value is QualityFindingCategory {
  return QUALITY_FINDING_CATEGORIES.includes(value as QualityFindingCategory);
}

export function isQualityResult(value: unknown): value is QualityResult {
  return QUALITY_RESULTS.includes(value as QualityResult);
}

export function isQualitySeverity(value: unknown): value is QualitySeverity {
  return QUALITY_SEVERITIES.includes(value as QualitySeverity);
}

export function isCorrectionScope(value: unknown): value is CorrectionScope {
  return CORRECTION_SCOPES.includes(value as CorrectionScope);
}

export function isCorrectionStatus(value: unknown): value is CorrectionRequestStatus {
  return CORRECTION_STATUSES.includes(value as CorrectionRequestStatus);
}

export function isEscalationLevel(value: unknown): value is EscalationLevel {
  return ESCALATION_LEVELS.includes(value as EscalationLevel);
}

/** Sanitises free text: trimmed, hard length cap, control characters dropped. */
export function sanitizeNote(value: unknown, maxLength = 2000): string | null {
  const raw = str(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
  return raw === '' ? null : raw.slice(0, maxLength);
}

export function validateCreateQualityFinding(input: unknown): ValidationResult<CreateQualityFindingInput> {
  const errors: string[] = [];
  const raw = (input ?? {}) as Record<string, unknown>;

  if (!isQualityFindingCategory(raw.category)) errors.push('category must be a valid finding category');
  if (!isQualityResult(raw.result)) errors.push('result must be pass, warning, fail or not_checked');
  if (raw.severity !== undefined && !isQualitySeverity(raw.severity)) {
    errors.push('severity must be low, medium or high');
  }
  const observedNote = raw.observedNote === undefined ? undefined : sanitizeNote(raw.observedNote);
  const correctionNote = raw.correctionNote === undefined ? undefined : sanitizeNote(raw.correctionNote);
  if (raw.observedNote !== undefined && str(raw.observedNote) !== '' && observedNote === null) {
    errors.push('observedNote must be text');
  }
  if (raw.correctionNote !== undefined && str(raw.correctionNote) !== '' && correctionNote === null) {
    errors.push('correctionNote must be text');
  }

  return errors.length
    ? { ok: false, errors }
    : {
        ok: true,
        value: {
          category: raw.category as QualityFindingCategory,
          result: raw.result as QualityResult,
          ...(raw.severity !== undefined ? { severity: raw.severity as QualitySeverity } : {}),
          ...(observedNote !== undefined && observedNote !== null ? { observedNote } : {}),
          ...(correctionNote !== undefined && correctionNote !== null ? { correctionNote } : {}),
        },
      };
}

export function validateUpdateQualityFinding(input: unknown): ValidationResult<UpdateQualityFindingInput> {
  const errors: string[] = [];
  const raw = (input ?? {}) as Record<string, unknown>;
  const out: UpdateQualityFindingInput = {};

  if (raw.result !== undefined) {
    if (!isQualityResult(raw.result)) errors.push('result must be pass, warning, fail or not_checked');
    else out.result = raw.result;
  }
  if (raw.severity !== undefined) {
    if (!isQualitySeverity(raw.severity)) errors.push('severity must be low, medium or high');
    else out.severity = raw.severity;
  }
  if (raw.observedNote !== undefined) {
    if (raw.observedNote === null) out.observedNote = null;
    else {
      const note = sanitizeNote(raw.observedNote);
      if (note === null && str(raw.observedNote) !== '') errors.push('observedNote must be text');
      else out.observedNote = note;
    }
  }
  if (raw.correctionNote !== undefined) {
    if (raw.correctionNote === null) out.correctionNote = null;
    else {
      const note = sanitizeNote(raw.correctionNote);
      if (note === null && str(raw.correctionNote) !== '') errors.push('correctionNote must be text');
      else out.correctionNote = note;
    }
  }

  return errors.length ? { ok: false, errors } : { ok: true, value: out };
}

export function validateCreateCorrectionRequest(input: unknown): ValidationResult<CreateCorrectionRequestInput> {
  const errors: string[] = [];
  const raw = (input ?? {}) as Record<string, unknown>;
  const workspaceId = str(raw.workspaceId);
  const sourceGalleryOutputId = str(raw.sourceGalleryOutputId);
  const title = str(raw.title).trim();
  const requestedChange = sanitizeNote(raw.requestedChange);
  const scope = raw.scope;

  if (!workspaceId) errors.push('workspaceId is required');
  if (!sourceGalleryOutputId) errors.push('sourceGalleryOutputId is required');
  if (title.length < 1 || title.length > 120) errors.push('title must be 1–120 characters');
  if (!requestedChange) errors.push('requestedChange is required');
  if (!isCorrectionScope(scope)) errors.push('scope must be a permitted correction scope');

  return errors.length
    ? { ok: false, errors }
    : {
        ok: true,
        value: {
          workspaceId,
          sourceGalleryOutputId,
          title,
          requestedChange: requestedChange as string,
          scope: scope as CorrectionScope,
        },
      };
}

export function validateUpdateCorrectionRequest(input: unknown): ValidationResult<UpdateCorrectionRequestInput> {
  const errors: string[] = [];
  const raw = (input ?? {}) as Record<string, unknown>;
  const out: UpdateCorrectionRequestInput = {};

  if (raw.title !== undefined) {
    const title = str(raw.title).trim();
    if (title.length < 1 || title.length > 120) errors.push('title must be 1–120 characters');
    else out.title = title;
  }
  if (raw.requestedChange !== undefined) {
    const requestedChange = sanitizeNote(raw.requestedChange);
    if (!requestedChange) errors.push('requestedChange is required');
    else out.requestedChange = requestedChange;
  }
  if (raw.scope !== undefined) {
    if (!isCorrectionScope(raw.scope)) errors.push('scope must be a permitted correction scope');
    else out.scope = raw.scope;
  }

  return errors.length ? { ok: false, errors } : { ok: true, value: out };
}
