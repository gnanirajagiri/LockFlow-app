/**
 * Generated-media store — where ingested provider results are persisted.
 * The private `lockflow-gallery-media` bucket in real mode (service-role
 * upload from the worker); an in-memory store in demo/tests. Bytes never
 * pass through the browser and URLs are never persisted.
 */
export interface GeneratedMediaStore {
  put(bucket: string, path: string, bytes: Uint8Array, contentType: string): Promise<void>;
}

export const GALLERY_MEDIA_BUCKET = 'lockflow-gallery-media';

export const REFERENCE_MEDIA_BUCKET = 'lockflow-references';
export const PREVIEW_MEDIA_BUCKET = 'lockflow-previews';

/** Canonical private output path (spec: workspaces/{ws}/jobs/{job}/runs/{run}/outputs/{output}/{file}). */
export function buildOutputMediaPath(parts: {
  workspaceId: string;
  contentJobRequestId: string;
  providerRunId: string;
  galleryOutputId: string;
  safeFilename: string;
}): string {
  const safe = parts.safeFilename.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[._-]+|[._-]+$/g, '') || 'output';
  return `workspaces/${parts.workspaceId}/jobs/${parts.contentJobRequestId}/runs/${parts.providerRunId}/outputs/${parts.galleryOutputId}/${safe}`;
}

/** In-memory store for demo/tests (counts writes; never touches disk). */
export class InMemoryGeneratedMediaStore implements GeneratedMediaStore {
  readonly objects = new Map<string, { bytes: Uint8Array; contentType: string }>();

  async put(bucket: string, path: string, bytes: Uint8Array, contentType: string): Promise<void> {
    this.objects.set(`${bucket}/${path}`, { bytes, contentType });
  }
}
