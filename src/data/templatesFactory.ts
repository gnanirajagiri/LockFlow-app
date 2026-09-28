/**
 * Data-access factory — Templates.
 *
 * Mirrors the Content Studio factory: Supabase-backed when configured,
 * in-memory mock (over the dev seed) in demo mode. Memoised per process;
 * tests reset via `resetTemplatesRepository`.
 */
import { isDemoMode } from '../lib/env';
import { getSupabase } from '../lib/supabase';
import { MockTemplatesRepository } from './mockTemplatesRepository';
import { SupabaseTemplatesRepository } from './supabaseTemplatesRepository';
import type { TemplatesRepository } from './templatesRepository';

let instance: TemplatesRepository | null = null;

export function getTemplatesRepository(): TemplatesRepository {
  if (instance) return instance;
  if (!isDemoMode) {
    const client = getSupabase();
    if (client) {
      instance = new SupabaseTemplatesRepository(client);
      return instance;
    }
  }
  instance = new MockTemplatesRepository();
  return instance;
}

/** Test isolation hook — discards the memoised repository (mock state included). */
export function resetTemplatesRepository(): void {
  instance = null;
}

export type { TemplatesRepository } from './templatesRepository';
