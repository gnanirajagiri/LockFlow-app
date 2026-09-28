/**
 * Gallery repository contract.
 *
 * UI never calls Supabase directly; it goes through the GalleryService,
 * which applies domain guards, which then calls one of these adapters.
 */
import type {
  CreateGalleryCollectionInput,
  CreateGalleryOutputInput,
  GalleryCollectionItemRecord,
  GalleryCollectionRecord,
  GalleryOutputEventRecord,
  GalleryOutputRecord,
  GalleryOutputReviewRecord,
  GalleryOutputTagRecord,
  UpdateGalleryOutputInput,
} from '../domain/gallery';

export interface GalleryRepository {
  // Outputs
  listOutputs(workspaceId: string): Promise<GalleryOutputRecord[]>;
  getOutput(outputId: string): Promise<GalleryOutputRecord>;
  createOutput(input: CreateGalleryOutputInput, createdBy: string): Promise<GalleryOutputRecord>;
  updateOutputMetadata(outputId: string, patch: UpdateGalleryOutputInput): Promise<GalleryOutputRecord>;
  /** Status-only transition; guards applied in the service. */
  updateOutputStatus(outputId: string, status: GalleryOutputRecord['status'], restoredFrom?: GalleryOutputRecord['status'] | null): Promise<GalleryOutputRecord>;
  nextOutputIndex(contentJobRequestId: string): Promise<number>;

  // Reviews (append-only history)
  listReviews(galleryOutputId: string): Promise<GalleryOutputReviewRecord[]>;
  addReview(review: Omit<GalleryOutputReviewRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<GalleryOutputReviewRecord>;

  // Tags (workspace-scoped vocabulary)
  listTagsForOutput(galleryOutputId: string): Promise<GalleryOutputTagRecord[]>;
  addTagToOutput(input: { galleryOutputId: string; name: string }, workspaceId: string): Promise<GalleryOutputTagRecord>;
  removeTagFromOutput(galleryOutputId: string, tagId: string): Promise<void>;

  // Collections
  listCollections(workspaceId: string): Promise<GalleryCollectionRecord[]>;
  getCollection(collectionId: string): Promise<GalleryCollectionRecord>;
  createCollection(input: CreateGalleryCollectionInput, createdBy: string): Promise<GalleryCollectionRecord>;
  archiveCollection(collectionId: string): Promise<GalleryCollectionRecord>;
  listCollectionItems(collectionId: string): Promise<GalleryCollectionItemRecord[]>;
  addCollectionItem(collectionId: string, galleryOutputId: string): Promise<GalleryCollectionItemRecord>;
  removeCollectionItem(itemId: string): Promise<void>;
  reorderCollectionItems(collectionId: string, orderedItemIds: string[]): Promise<void>;

  // Audit events (append-only)
  listEvents(galleryOutputId: string): Promise<GalleryOutputEventRecord[]>;
  appendEvent(event: Omit<GalleryOutputEventRecord, 'id' | 'createdAt'>): Promise<GalleryOutputEventRecord>;
}
