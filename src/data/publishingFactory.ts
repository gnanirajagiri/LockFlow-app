/**
 * Data-access factory — Publishing.
 *
 * Phase 1 ships the in-memory mock (demo mode). A Supabase adapter will
 * mirror the campaigns/connections adapters once the hosted publishing
 * runtime (server routes for submission/webhooks) exists; the repository
 * contract is already shaped for it.
 */
import { MockPublishingRepository } from './mockPublishingRepository';
import type { PublishingRepositories } from './publishingRepository';

let instance: PublishingRepositories | null = null;

export function getPublishingRepository(): PublishingRepositories {
  if (instance) return instance;
  instance = new MockPublishingRepository();
  return instance;
}

/** Test isolation hook — discards the memoised repository. */
export function resetPublishingRepository(): void {
  instance = null;
}

export type { PublishingRepositories } from './publishingRepository';
