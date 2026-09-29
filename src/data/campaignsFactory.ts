/**
 * Data-access factory — Campaigns.
 *
 * Mirrors the Templates factory: Supabase-backed when configured,
 * in-memory mock (over the dev seed) in demo mode. Memoised per process;
 * tests reset via `resetCampaignsRepository`.
 */
import { isDemoMode } from '../lib/env';
import { getSupabase } from '../lib/supabase';
import { MockCampaignsRepository } from './mockCampaignsRepository';
import { SupabaseCampaignsRepository } from './supabaseCampaignsRepository';
import type { CampaignsRepository } from './campaignsRepository';

let instance: CampaignsRepository | null = null;

export function getCampaignsRepository(): CampaignsRepository {
  if (instance) return instance;
  if (!isDemoMode) {
    const client = getSupabase();
    if (client) {
      instance = new SupabaseCampaignsRepository(client);
      return instance;
    }
  }
  instance = new MockCampaignsRepository();
  return instance;
}

/** Test isolation hook — discards the memoised repository (mock state included). */
export function resetCampaignsRepository(): void {
  instance = null;
}

export type { CampaignsRepository } from './campaignsRepository';
