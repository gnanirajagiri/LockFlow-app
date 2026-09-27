/**
 * Environments domain — guard functions.
 *
 * Pure, framework-free and unit-tested. The service layer calls these BEFORE
 * any repository write, so locked environment versions can never be edited
 * through the normal application path. (The database enforces the same rule
 * with triggers.)
 *
 * `refuseIfLocked`, `nextVersionNumber` and the workspace-isolation guards are
 * shared utilities reused from the Models domain — the rule semantics are
 * identical across builder systems.
 */
import { isInWorkspace, isInWorkspaceStrict, nextVersionNumber } from '../models/guards';
import type {
  EnvironmentRecord,
  EnvironmentSpecRecord,
  EnvironmentVersionRecord,
  EnvironmentVersionStatus,
} from './types';

export { isInWorkspace, isInWorkspaceStrict, nextVersionNumber };

export class LockedEnvironmentVersionError extends Error {
  constructor(versionId: string) {
    super(`Environment version ${versionId} is locked and cannot be edited.`);
    this.name = 'LockedEnvironmentVersionError';
  }
}

/**
 * Rule — locked versions are read-only. Any edit path must pass through this
 * guard first. (Owns its error type; the semantics match the shared
 * `refuseIfLocked` used by Models.)
 */
export function refuseEnvironmentLocked(
  version: Pick<EnvironmentVersionRecord, 'id' | 'status'>,
): void {
  if (version.status === 'locked') {
    throw new LockedEnvironmentVersionError(version.id);
  }
}

/**
 * Copies an Environment Spec into a new draft version. Duplicates every
 * defining anchor (spec content only); timestamps/status belong to the new
 * draft and the source record is never touched.
 */
export function copyEnvironmentSpec(
  source: EnvironmentSpecRecord,
  targetVersionId: string,
): Omit<EnvironmentSpecRecord, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    environmentVersionId: targetVersionId,
    roomType: source.roomType,
    layoutFeel: source.layoutFeel,
    heroAngle: source.heroAngle,
    lightingStyle: source.lightingStyle,
    furnitureAnchors: structuredClone(source.furnitureAnchors),
    signatureProps: structuredClone(source.signatureProps),
    paletteMaterials: structuredClone(source.paletteMaterials),
    productZone: source.productZone === null ? null : structuredClone(source.productZone),
    continuityNotes: source.continuityNotes,
    lockRules: structuredClone(source.lockRules),
  };
}

/** Rule — workspace isolation for environments. */
export function assertEnvironmentInWorkspace(
  record: Pick<EnvironmentRecord, 'workspaceId'>,
  activeWorkspaceId: string,
): void {
  isInWorkspaceStrict(record.workspaceId, activeWorkspaceId);
}

/** Legal version lifecycle transitions (superseded is set only by the lock RPC). */
const VERSION_TRANSITIONS: Record<EnvironmentVersionStatus, EnvironmentVersionStatus[]> = {
  draft: ['locked'],
  locked: ['superseded'], // only via lock_environment_version
  superseded: [], // immutable terminal history
};

export function canTransitionEnvironmentVersion(
  from: EnvironmentVersionStatus,
  to: EnvironmentVersionStatus,
): boolean {
  return VERSION_TRANSITIONS[from].includes(to);
}
