/**
 * Lock flow — pure gate for the "confirm before lock" rule.
 *
 * The Versions/Character Sheet UI never calls the lock service directly:
 * it must first route the user through the confirmation dialog, and this
 * gate records that contract in code. The service + repository still refuse
 * non-draft locks independently (defence in depth).
 */
import type { ModelVersionRecord } from '../../domain/models';

export interface LockIntention {
  versionId: string;
  /** True only after the user has affirmed the lock-confirmation dialog. */
  confirmed: boolean;
}

export const LOCK_CONFIRMATION_COPY =
  'Locking protects this identity version. It cannot be edited afterward. Future changes create a new version.';

/**
 * The pure rule: a draft may proceed to lock only through an explicit,
 * recorded confirmation. Locked/superseded versions never pass.
 */
export function assertLockAllowed(
  version: Pick<ModelVersionRecord, 'id' | 'status'>,
  intention: LockIntention,
): void {
  if (!intention.confirmed) {
    throw new Error('Lock confirmation is required before a draft becomes locked.');
  }
  if (version.status !== 'draft') {
    throw new Error(`Only draft versions can be locked (status: ${version.status}).`);
  }
  if (intention.versionId !== version.id) {
    throw new Error('Lock confirmation does not match the requested version.');
  }
}
