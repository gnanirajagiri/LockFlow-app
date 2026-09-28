/**
 * Data-access factory — Gallery.
 *
 * Mirrors the Models/Environments/Library/Content factories: Supabase-backed
 * when configured, in-memory mock (over the dev seed) in demo mode. Memoised
 * per process; tests reset via `resetGalleryRepository`.
 */
import { isDemoMode } from '../lib/env';
import { getSupabase } from '../lib/supabase';
import { MockGalleryRepository } from './mockGalleryRepository';
import { SupabaseGalleryRepository } from './supabaseGalleryRepository';
import type { GalleryRepository } from './galleryRepository';

let instance: GalleryRepository | null = null;

export function getGalleryRepository(): GalleryRepository {
  if (instance) return instance;
  if (!isDemoMode) {
    const client = getSupabase();
    if (client) {
      instance = new SupabaseGalleryRepository(client);
      return instance;
    }
  }
  instance = new MockGalleryRepository();
  return instance;
}

/** Test isolation hook — discards the memoised repository (mock state included). */
export function resetGalleryRepository(): void {
  instance = null;
}

export type { GalleryRepository } from './galleryRepository';
