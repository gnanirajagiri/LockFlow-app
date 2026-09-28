/**
 * Gallery domain — types.
 *
 * Gallery holds GENERATED content: output records, in-progress jobs,
 * review-ready and approved work, plus collections that group outputs.
 * It is distinct from the unified Library (reusable inputs only) — a Gallery
 * output never becomes a reusable source asset, and every output traces back
 * to exactly one content_job_request whose immutable pins carry the historic
 * provenance (exact model/environment/Look/asset versions used).
 *
 * Storage paths and dimensions are private placeholder metadata until secure
 * storage and a real provider are connected; nothing here uploads media.
 */
export type GalleryOutputType = 'image' | 'video' | 'story';

export type GalleryOutputStatus =
  | 'draft'
  | 'processing'
  | 'ready_for_review'
  | 'approved'
  | 'rejected'
  | 'archived'
  | 'failed';

export type GalleryReviewDecision = 'approved' | 'rejected' | 'changes_requested';

export interface GalleryOutputRecord {
  id: string;
  workspaceId: string;
  contentJobRequestId: string;
  /** Future variants/derivatives point at the output they derive from. */
  parentGalleryOutputId: string | null;
  title: string;
  outputType: GalleryOutputType;
  status: GalleryOutputStatus;
  /** Placeholder path until secure storage exists — never a public URL. */
  mediaStoragePath: string | null;
  thumbnailStoragePath: string | null;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  fileSizeBytes: number | null;
  mimeType: string | null;
  outputIndex: number;
  /** Development/placeholder marker plus provider-agnostic context. */
  metadata: Record<string, unknown>;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface GalleryOutputReviewRecord {
  id: string;
  galleryOutputId: string;
  reviewerId: string;
  decision: GalleryReviewDecision;
  feedback: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GalleryOutputTagRecord {
  id: string;
  workspaceId: string;
  name: string;
  normalizedName: string;
  createdAt: string;
}

export interface GalleryOutputTagLinkRecord {
  galleryOutputId: string;
  tagId: string;
  createdAt: string;
}

export interface GalleryCollectionRecord {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  status: 'active' | 'archived';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface GalleryCollectionItemRecord {
  id: string;
  galleryCollectionId: string;
  galleryOutputId: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface GalleryOutputEventRecord {
  id: string;
  galleryOutputId: string;
  eventType: string;
  message: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

// ── Input payloads ──────────────────────────────────────────────────────────

export interface CreateGalleryOutputInput {
  workspaceId: string;
  contentJobRequestId: string;
  title: string;
  outputType: GalleryOutputType;
  status?: GalleryOutputStatus;
  parentGalleryOutputId?: string;
  mediaStoragePath?: string;
  thumbnailStoragePath?: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
  fileSizeBytes?: number;
  mimeType?: string;
  outputIndex?: number;
  metadata?: Record<string, unknown>;
}

export interface UpdateGalleryOutputInput {
  title?: string;
  durationSeconds?: number | null;
  width?: number | null;
  height?: number | null;
  metadata?: Record<string, unknown>;
  /** Generation ingestion only: the private media path (never a public URL). */
  mediaStoragePath?: string;
  thumbnailStoragePath?: string;
  fileSizeBytes?: number;
  mimeType?: string;
  generationProviderRunId?: string;
}

export interface SubmitGalleryReviewInput {
  galleryOutputId: string;
  reviewerId: string;
  decision: GalleryReviewDecision;
  feedback?: string;
}

export interface CreateGalleryCollectionInput {
  workspaceId: string;
  name: string;
  description?: string;
}
