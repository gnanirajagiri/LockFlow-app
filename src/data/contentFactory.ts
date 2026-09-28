/**
 * Data-access factory — Content Studio.
 *
 * Mirrors the Models/Environments/Library factories: Supabase-backed when
 * configured, in-memory mock (over the dev seed) in demo mode. Memoised per
 * process; tests reset via `resetContentRepository`.
 */
import { isDemoMode } from '../lib/env';
import { getSupabase } from '../lib/supabase';
import { MockContentRepository } from './mockContentRepository';
import { SupabaseContentRepository } from './supabaseContentRepository';
import type { ContentRepository } from './contentRepository';

let instance: ContentRepository | null = null;

export function getContentRepository(): ContentRepository {
  if (instance) return instance;
  if (!isDemoMode) {
    const client = getSupabase();
    if (client) {
      instance = new SupabaseContentRepository(client);
      return instance;
    }
  }
  instance = new MockContentRepository();
  return instance;
}

/** Test isolation hook — discards the memoised repository (mock state included). */
export function resetContentRepository(): void {
  instance = null;
}

export type { ContentRepository } from './contentRepository';
