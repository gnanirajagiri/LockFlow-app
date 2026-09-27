/**
 * Data-access factory — Library.
 *
 * Mirrors the Models/Environments factories: Supabase-backed when configured,
 * in-memory mock (over the dev seed) in demo mode. Memoised per process;
 * tests reset via `resetLibraryRepository`.
 */
import { isDemoMode } from '../lib/env';
import { getSupabase } from '../lib/supabase';
import { MockLibraryRepository } from './mockLibraryRepository';
import { SupabaseLibraryRepository } from './supabaseLibraryRepository';
import type { LibraryRepository } from './libraryRepository';

let instance: LibraryRepository | null = null;

export function getLibraryRepository(): LibraryRepository {
  if (instance) return instance;
  if (!isDemoMode) {
    const client = getSupabase();
    if (client) {
      instance = new SupabaseLibraryRepository(client);
      return instance;
    }
  }
  instance = new MockLibraryRepository();
  return instance;
}

/** Test isolation hook — discards the memoised repository (mock state included). */
export function resetLibraryRepository(): void {
  instance = null;
}

export type { LibraryRepository } from './libraryRepository';
