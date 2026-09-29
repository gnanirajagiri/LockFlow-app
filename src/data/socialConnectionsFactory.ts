/**
 * Data-access factory — Social Connections.
 *
 * Mirrors the Campaigns factory: Supabase-backed when configured,
 * in-memory mock in demo mode. Memoised per process; tests reset via
 * `resetSocialConnectionsRepository`.
 */
import { isDemoMode } from '../lib/env';
import { getSupabase } from '../lib/supabase';
import { MockSocialConnectionsRepository } from './mockSocialConnectionsRepository';
import { SupabaseSocialConnectionsRepository } from './supabaseSocialConnectionsRepository';
import type { SocialConnectionsRepository } from './socialConnectionsRepository';

let instance: SocialConnectionsRepository | null = null;

export function getSocialConnectionsRepository(): SocialConnectionsRepository {
  if (instance) return instance;
  if (!isDemoMode) {
    const client = getSupabase();
    if (client) {
      instance = new SupabaseSocialConnectionsRepository(client);
      return instance;
    }
  }
  instance = new MockSocialConnectionsRepository();
  return instance;
}

/** Test isolation hook — discards the memoised repository (mock state included). */
export function resetSocialConnectionsRepository(): void {
  instance = null;
}

export type { SocialConnectionsRepository } from './socialConnectionsRepository';
