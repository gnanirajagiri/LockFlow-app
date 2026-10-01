/**
 * Data-access factory — Publishing Review (Prompt 19).
 *
 * Phase 1 ships the in-memory mock (demo mode). A Supabase adapter can
 * mirror the other adapters once the hosted review/submission runtime
 * exists; the repository contract is already shaped for it.
 */
import { MockPublishingReviewRepository } from './mockPublishingReviewRepository';
import type { PublishingReviewRepositories } from './publishingReviewRepository';

let instance: PublishingReviewRepositories | null = null;

export function getPublishingReviewRepository(): PublishingReviewRepositories {
  if (instance) return instance;
  instance = new MockPublishingReviewRepository();
  return instance;
}

/** Test isolation hook — discards the memoised repository. */
export function resetPublishingReviewRepository(): void {
  instance = null;
}

export type { PublishingReviewRepositories } from './publishingReviewRepository';
