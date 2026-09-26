/**
 * Models domain — guard functions.
 *
 * Pure, framework-free and unit-tested. The service layer calls these BEFORE
 * any repository write, so locked versions can never be edited through the
 * normal application path. (The database enforces the same rule with triggers.)
 */
import type {
  CharacterSheetRecord,
  ModelVersionRecord,
  ModelVersionStatus,
} from './types';

export class LockedVersionError extends Error {
  constructor(versionId: string) {
    super(`Model version ${versionId} is locked and cannot be edited.`);
    this.name = 'LockedVersionError';
  }
}

/**
 * Rule 3 — locked versions are read-only. Any edit path must pass through
 * this guard first.
 */
export function refuseIfLocked(version: Pick<ModelVersionRecord, 'id' | 'status'>): void {
  if (version.status === 'locked') {
    throw new LockedVersionError(version.id);
  }
}

/** Version numbering starts at 1 and increments by 1. */
export function nextVersionNumber(existingNumbers: number[]): number {
  return existingNumbers.length === 0 ? 1 : Math.max(...existingNumbers) + 1;
}

/**
 * Rule 3 — a new draft is created by copying a selected existing version.
 * Copies identity fields only; timestamps/status belong to the new draft.
 */
export function copyCharacterSheet(
  source: CharacterSheetRecord,
  targetVersionId: string,
): Omit<CharacterSheetRecord, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    modelVersionId: targetVersionId,
    identitySummary: source.identitySummary,
    faceFeatures: structuredClone(source.faceFeatures),
    hairIdentity: structuredClone(source.hairIdentity),
    complexion: structuredClone(source.complexion),
    bodyProportions: structuredClone(source.bodyProportions),
    distinctiveDetails: structuredClone(source.distinctiveDetails),
    lockRules: structuredClone(source.lockRules),
    referenceNotes: source.referenceNotes,
  };
}

/** Rule 4 — workspace isolation: a record may only be touched inside its own workspace. */
export function isInWorkspace(
  recordWorkspaceId: string,
  activeWorkspaceId: string,
): boolean {
  return recordWorkspaceId === activeWorkspaceId;
}

export function isInWorkspaceStrict(
  recordWorkspaceId: string,
  activeWorkspaceId: string,
): void {
  if (!isInWorkspace(recordWorkspaceId, activeWorkspaceId)) {
    throw new Error(`Cross-workspace access denied (record in ${recordWorkspaceId}, session in ${activeWorkspaceId}).`);
  }
}

/** Legal version lifecycle transitions. */
const VERSION_TRANSITIONS: Record<ModelVersionStatus, ModelVersionStatus[]> = {
  draft: ['locked'],
  locked: [], // immutable terminal state
  superseded: [], // terminal; set only by the lock RPC
};

export function canTransition(from: ModelVersionStatus, to: ModelVersionStatus): boolean {
  return VERSION_TRANSITIONS[from].includes(to);
}
