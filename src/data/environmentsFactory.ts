/**
 * Data-access factory — Environments.
 *
 * Mirrors the Models factory: chooses the Supabase-backed repository when
 * configured, or the in-memory mock repository (over the dev seed) in demo
 * mode. Memoised per process so demo edits survive navigation; tests reset
 * via `resetEnvironmentsRepository`.
 */
import { isDemoMode } from '../lib/env';
import { getSupabase } from '../lib/supabase';
import { MockEnvironmentsRepository } from './mockEnvironmentsRepository';
import { SupabaseEnvironmentsRepository } from './supabaseEnvironmentsRepository';
import type { EnvironmentsRepository } from './environmentsRepository';

let instance: EnvironmentsRepository | null = null;

export function getEnvironmentsRepository(): EnvironmentsRepository {
  if (instance) return instance;
  if (!isDemoMode) {
    const client = getSupabase();
    if (client) {
      instance = new SupabaseEnvironmentsRepository(client);
      return instance;
    }
  }
  instance = new MockEnvironmentsRepository();
  return instance;
}

/** Test isolation hook — discards the memoised repository (mock state included). */
export function resetEnvironmentsRepository(): void {
  instance = null;
}

export type { EnvironmentsRepository } from './environmentsRepository';
