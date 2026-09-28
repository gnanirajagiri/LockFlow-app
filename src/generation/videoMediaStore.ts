/**
 * Video output media paths — same private `lockflow-gallery-media` bucket as
 * images, with clips under `videos/` and provider-supplied thumbnails under
 * `thumbnails/` (spec path convention). No transcoding infrastructure exists;
 * thumbnails are stored only when the provider supplies one.
 */
export function buildVideoOutputMediaPath(parts: {
  workspaceId: string;
  contentJobRequestId: string;
  providerRunId: string;
  galleryOutputId: string;
  safeFilename: string;
  kind: 'videos' | 'thumbnails';
}): string {
  const safe = parts.safeFilename.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[._-]+|[._-]+$/g, '') || 'clip';
  return `workspaces/${parts.workspaceId}/jobs/${parts.contentJobRequestId}/runs/${parts.providerRunId}/${parts.kind}/${parts.galleryOutputId}/${safe}`;
}
