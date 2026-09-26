/**
 * Data-access factory.
 *
 * Chooses the Supabase-backed repository when configured, or the in-memory
 * mock repository (over the dev seed) in demo mode. UI code always asks here,
 * never for Supabase directly.
 */
import { isDemoMode } from '../lib/env';
import { getSupabase } from '../lib/supabase';
import { MockModelsRepository } from './mockModelsRepository';
import { SupabaseModelsRepository } from './supabaseModelsRepository';
import type { ModelsRepository } from './modelsRepository';

export function getModelsRepository(): ModelsRepository {
  if (!isDemoMode) {
    const client = getSupabase();
    if (client) return new SupabaseModelsRepository(client);
  }
  return new MockModelsRepository();
}

export type { ModelsRepository } from './modelsRepository';
