/**
 * Data-access factory.
 *
 * Chooses the Supabase-backed repository when configured, or the in-memory
 * mock repository (over the dev seed) in demo mode. UI code always asks here,
 * never for Supabase directly.
 *
 * The repository is memoised per process: the mock keeps its state in memory,
 * so re-creating it on every call would silently reset demo edits between
 * navigations. Tests can reset the singleton via `resetModelsRepository`.
 */
import { isDemoMode } from '../lib/env';
import { getSupabase } from '../lib/supabase';
import { MockModelsRepository } from './mockModelsRepository';
import { SupabaseModelsRepository } from './supabaseModelsRepository';
import type { ModelsRepository } from './modelsRepository';

let instance: ModelsRepository | null = null;

export function getModelsRepository(): ModelsRepository {
  if (instance) return instance;
  if (!isDemoMode) {
    const client = getSupabase();
    if (client) {
      instance = new SupabaseModelsRepository(client);
      return instance;
    }
  }
  instance = new MockModelsRepository();
  return instance;
}

/** Test isolation hook — discards the memoised repository (mock state included). */
export function resetModelsRepository(): void {
  instance = null;
}

export type { ModelsRepository } from './modelsRepository';
