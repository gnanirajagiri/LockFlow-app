/**
 * Library domain — guard functions.
 *
 * Pure, framework-free and unit-tested. Reuses the shared version-numbering
 * and workspace guards; adds asset-specific checks (locked immutability with
 * its own error type, look-type validation, canonical-item rules).
 */
import { isInWorkspace, isInWorkspaceStrict, nextVersionNumber } from '../models/guards';
import type {
  LibraryAssetRecord,
  LibraryAssetVersionRecord,
} from './types';

export { isInWorkspace, isInWorkspaceStrict, nextVersionNumber };

export class LockedAssetVersionError extends Error {
  constructor(versionId: string) {
    super(`Library asset version ${versionId} is locked and cannot be edited.`);
    this.name = 'LockedAssetVersionError';
  }
}

/** Rule 1 — locked asset versions are read-only on every edit path. */
export function refuseAssetLocked(
  version: Pick<LibraryAssetVersionRecord, 'id' | 'status'>,
): void {
  if (version.status === 'locked') {
    throw new LockedAssetVersionError(version.id);
  }
}

/** Rule 5 — look_details only exist for look-type assets. */
export function assertLookAssetType(asset: Pick<LibraryAssetRecord, 'assetType'>): void {
  if (asset.assetType !== 'look') {
    throw new Error(`A Look requires asset_type "look" (got "${asset.assetType}").`);
  }
}

/** Rule 6 — Look items reference canonical assets; they never embed copies. */
export function assertCanonicalLookItems(
  items: Array<{ libraryAssetId: string; libraryAssetVersionId?: string | null }>,
): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (!item.libraryAssetId) {
      throw new Error('Look items must point at a canonical Library asset.');
    }
    if (seen.has(item.libraryAssetId)) {
      throw new Error('A Look cannot link the same asset twice.');
    }
    seen.add(item.libraryAssetId);
  }
}

/** Legal asset-version lifecycle transitions (superseded only via lock RPC). */
const VERSION_TRANSITIONS: Record<AssetVersionStatusLike, AssetVersionStatusLike[]> = {
  draft: ['locked'],
  locked: ['superseded'],
  superseded: [],
};

type AssetVersionStatusLike = LibraryAssetVersionRecord['status'];

export function canTransitionAssetVersion(
  from: AssetVersionStatusLike,
  to: AssetVersionStatusLike,
): boolean {
  return VERSION_TRANSITIONS[from].includes(to);
}

/** Convenience: is this asset type one of the physical reusable inputs? */

