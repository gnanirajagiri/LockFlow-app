/**
 * Private storage path construction for reference media.
 *
 * Paths follow the migration's canonical pattern — the workspace segment is
 * part of the object key itself, which is what the storage policies parse to
 * authorize access. Filenames must already be sanitized (validateUpload).
 *
 * workspaces/{workspaceId}/models/{modelId}/versions/{modelVersionId}/references/{referenceId}/{safeFilename}
 * workspaces/{workspaceId}/environments/{environmentId}/versions/{environmentVersionId}/references/{referenceId}/{safeFilename}
 * workspaces/{workspaceId}/library/{libraryAssetId}/versions/{libraryAssetVersionId}/references/{referenceId}/{safeFilename}
 */

import type { ReferenceMimeType } from './validateUpload';

export const REFERENCES_BUCKET = 'lockflow-references';
/** Bucket reserved for a later preview/thumbnail milestone. Kept private. */
export const PREVIEWS_BUCKET = 'lockflow-previews';

export type ReferenceTargetType = 'model_reference' | 'environment_reference' | 'library_asset_reference';

const SEGMENT_BY_TARGET: Record<ReferenceTargetType, 'models' | 'environments' | 'library'> = {
  model_reference: 'models',
  environment_reference: 'environments',
  library_asset_reference: 'library',
};

const EXTENSION_BY_MIME: Record<ReferenceMimeType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Restricts an id segment to UUID-ish characters (defense in depth). */
function idSegment(value: string): string {
  if (!/^[0-9a-fA-F-]{1,64}$/.test(value)) {
    throw new Error(`Unsafe id segment for storage path: ${value.slice(0, 8)}…`);
  }
  return value.toLowerCase();
}

export interface ReferencePathContext {
  targetType: ReferenceTargetType;
  workspaceId: string;
  /** Model / environment / asset id owning the version. */
  ownerId: string;
  versionId: string;
  referenceId: string;
  safeFilename: string;
}

/** Builds the canonical private object path for a reference upload. */
export function buildReferencePath(context: ReferencePathContext): string {
  const filename = context.safeFilename;
  const extension = filename.includes('.') ? filename.split('.').pop()!.toLowerCase() : '';
  if (!extension || !Object.values(EXTENSION_BY_MIME).includes(extension)) {
    throw new Error(`Reference filename must carry a canonical image extension, got: ${filename}`);
  }

  return [
    'workspaces',
    idSegment(context.workspaceId),
    SEGMENT_BY_TARGET[context.targetType],
    idSegment(context.ownerId),
    'versions',
    idSegment(context.versionId),
    'references',
    idSegment(context.referenceId),
    filename,
  ].join('/');
}

/** Canonical extension for a verified MIME type. */
export function canonicalExtension(mime: ReferenceMimeType): string {
  return EXTENSION_BY_MIME[mime];
}

/**
 * Extracts the workspace segment from an object path — the same parsing the
 * storage policies perform server-side. Returns null for malformed paths.
 */
export function workspaceSegmentFromPath(path: string): string | null {
  const parts = path.split('/');
  if (parts.length < 2 || parts[0] !== 'workspaces') return null;
  const segment = parts[1];
  return /^[0-9a-f-]{36}$/.test(segment) ? segment : null;
}
