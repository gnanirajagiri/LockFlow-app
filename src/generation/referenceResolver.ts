/**
 * Reference resolver — rule: provider requests reference the EXACT pinned
 * versions only. Media is delivered through short-lived signed URLs minted
 * here (server-side, 10-minute default TTL from IMAGE_SIGNED_REFERENCE_URL_TTL_SECONDS);
 * URLs are used once for submission and never persisted.
 */
import type { ProviderReferenceImage, ReferenceRole } from './types';
import { PIN_ROLE_MAP } from './types';

export interface PinnedReferenceRow {
  referenceId: string;
  versionId: string;
  uploadStatus: string;
  mimeType: string | null;
  storageBucket: string | null;
  storagePath: string;
  role: ReferenceRole;
}

export interface ReferenceSource {
  /** Returns a short-lived signed URL for the exact object path. */
  createSignedUrl(bucket: string, path: string, ttlSeconds: number): Promise<string>;
}

export const DEFAULT_REFERENCE_TTL_SECONDS = 600;

/**
 * Resolves signed provider-access URLs for the pinned version's uploaded
 * references. Rows that are pending/failed/deleted are skipped (they are
 * eligibility-blocked separately); rows without a bucket are placeholder
 * metadata and likewise skipped.
 */
export async function resolvePinnedReferences(
  rows: PinnedReferenceRow[],
  source: ReferenceSource,
  ttlSeconds = DEFAULT_REFERENCE_TTL_SECONDS,
): Promise<ProviderReferenceImage[]> {
  const usable = rows.filter(
    (row) => row.uploadStatus === 'uploaded' && row.mimeType && row.storageBucket,
  );
  const resolved: ProviderReferenceImage[] = [];
  for (const row of usable) {
    const url = await source.createSignedUrl(row.storageBucket!, row.storagePath, ttlSeconds);
    resolved.push({
      role: PIN_ROLE_MAP[row.role] ?? 'other',
      urlOrSecureHandle: url,
      mimeType: row.mimeType!,
    });
  }
  return resolved;
}
