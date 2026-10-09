/**
 * In-memory Gallery repository — demo mode.
 *
 * Runs on the development seed data and enforces the same structural rules
 * the Supabase path guarantees (unique output_index per job, append-only
 * reviews/events, unique normalized tag names per workspace, unique
 * collection/output pairs) so UI behaviour matches.
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
import {
  GALLERY_COLLECTIONS,
  GALLERY_COLLECTION_ITEMS,
  GALLERY_EVENTS,
  GALLERY_OUTPUTS,
  GALLERY_REVIEWS,
  GALLERY_TAG_LINKS,
  GALLERY_TAGS,
} from '../mock/gallerySeed';
import type { GalleryRepository } from './galleryRepository';

const now = () => new Date().toISOString();

function notFound(what: string, id: string): never {
  throw new Error(`${what} not found: ${id}`);
}

export class MockGalleryRepository implements GalleryRepository {
  private outputs = new Map<string, GalleryOutputRecord>();
  private reviews = new Map<string, GalleryOutputReviewRecord[]>(); // key: outputId
  private tags = new Map<string, GalleryOutputTagRecord>(GALLERY_TAGS.map((tag) => [tag.id, tag]));
  private tagLinks = new Set<string>(GALLERY_TAG_LINKS.map((link) => `${link.galleryOutputId}:${link.tagId}`));
  private collections = new Map<string, GalleryCollectionRecord>();
  private collectionItems = new Map<string, GalleryCollectionItemRecord[]>(); // key: collectionId
  private events = new Map<string, GalleryOutputEventRecord[]>(); // key: outputId

  constructor() {
    for (const output of GALLERY_OUTPUTS) this.outputs.set(output.id, structuredClone(output));
    for (const review of GALLERY_REVIEWS) {
      this.reviews.set(review.galleryOutputId, [
        ...(this.reviews.get(review.galleryOutputId) ?? []),
        structuredClone(review),
      ]);
    }
    for (const collection of GALLERY_COLLECTIONS) {
      this.collections.set(collection.id, structuredClone(collection));
    }
    this.collectionItems.set(
      'gcollection_morning_campaign',
      GALLERY_COLLECTION_ITEMS.map((item) => structuredClone(item)),
    );
    for (const event of GALLERY_EVENTS) {
      this.events.set(event.galleryOutputId, [
        ...(this.events.get(event.galleryOutputId) ?? []),
        structuredClone(event),
      ]);
    }
  }

  // ── Outputs ───────────────────────────────────────────────────────────────

  async listOutputs(workspaceId: string): Promise<GalleryOutputRecord[]> {
    return [...this.outputs.values()]
      .filter((output) => output.workspaceId === workspaceId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((output) => structuredClone(output));
  }

  async getOutput(outputId: string): Promise<GalleryOutputRecord> {
    const output = this.outputs.get(outputId);
    if (!output) notFound('Gallery output', outputId);
    return structuredClone(output);
  }

  async nextOutputIndex(contentJobRequestId: string): Promise<number> {
    const existing = [...this.outputs.values()].filter(
      (output) => output.contentJobRequestId === contentJobRequestId,
    );
    return existing.length + 1;
  }

  async createOutput(input: CreateGalleryOutputInput, createdBy: string): Promise<GalleryOutputRecord> {
    const stamp = now();
    const record: GalleryOutputRecord = {
      id: crypto.randomUUID(),
      workspaceId: input.workspaceId,
      contentJobRequestId: input.contentJobRequestId,
      parentGalleryOutputId: input.parentGalleryOutputId ?? null,
      title: input.title,
      outputType: input.outputType,
      status: input.status ?? 'draft',
      mediaStoragePath: input.mediaStoragePath ?? 'placeholders/gallery/generic-output.svg',
      thumbnailStoragePath: input.thumbnailStoragePath ?? 'placeholders/gallery/generic-output.svg',
      durationSeconds: input.durationSeconds ?? null,
      width: input.width ?? null,
      height: input.height ?? null,
      fileSizeBytes: input.fileSizeBytes ?? null,
      mimeType: input.mimeType ?? null,
      outputIndex: input.outputIndex ?? (await this.nextOutputIndex(input.contentJobRequestId)),
      // Placeholder identification is mandatory while no provider exists.
      metadata: { placeholder: true, provider: null, ...(input.metadata ?? {}) },
      createdBy,
      createdAt: stamp,
      updatedAt: stamp,
    };
    this.outputs.set(record.id, record);
    return structuredClone(record);
  }

  async updateOutputMetadata(
    outputId: string,
    patch: UpdateGalleryOutputInput,
  ): Promise<GalleryOutputRecord> {
    const output = await this.getOutput(outputId);
    const next: GalleryOutputRecord = {
      ...output,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.durationSeconds !== undefined ? { durationSeconds: patch.durationSeconds } : {}),
      ...(patch.width !== undefined ? { width: patch.width } : {}),
      ...(patch.height !== undefined ? { height: patch.height } : {}),
      ...(patch.mediaStoragePath !== undefined ? { mediaStoragePath: patch.mediaStoragePath } : {}),
      ...(patch.thumbnailStoragePath !== undefined ? { thumbnailStoragePath: patch.thumbnailStoragePath } : {}),
      ...(patch.fileSizeBytes !== undefined ? { fileSizeBytes: patch.fileSizeBytes } : {}),
      ...(patch.mimeType !== undefined ? { mimeType: patch.mimeType } : {}),
      ...(patch.generationProviderRunId !== undefined ? { generationProviderRunId: patch.generationProviderRunId } : {}),
      ...(patch.metadata !== undefined
        ? { metadata: { ...output.metadata, ...patch.metadata } }
        : {}),
      updatedAt: now(),
    };
    this.outputs.set(outputId, next);
    return structuredClone(next);
  }

  async updateOutputStatus(
    outputId: string,
    status: GalleryOutputRecord['status'],
    restoredFrom?: GalleryOutputRecord['status'] | null,
  ): Promise<GalleryOutputRecord> {
    const output = await this.getOutput(outputId);
    const metadata = { ...output.metadata };
    if (restoredFrom !== undefined) {
      // Explicit bookkeeping from the service (archive sets, restore clears).
      if (restoredFrom === null) delete metadata.restoredFrom;
      else metadata.restoredFrom = restoredFrom;
    }
    if (status !== 'archived' && restoredFrom === undefined) {
      delete metadata.restoredFrom;
    }
    const next: GalleryOutputRecord = { ...output, status, metadata, updatedAt: now() };
    this.outputs.set(outputId, next);
    return structuredClone(next);
  }

  // ── Reviews ───────────────────────────────────────────────────────────────

  async listReviews(galleryOutputId: string): Promise<GalleryOutputReviewRecord[]> {
    return (this.reviews.get(galleryOutputId) ?? []).map((review) => structuredClone(review));
  }

  async addReview(
    review: Omit<GalleryOutputReviewRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<GalleryOutputReviewRecord> {
    const stamp = now();
    const row: GalleryOutputReviewRecord = { ...review, id: crypto.randomUUID(), createdAt: stamp, updatedAt: stamp };
    this.reviews.set(row.galleryOutputId, [...(this.reviews.get(row.galleryOutputId) ?? []), row]);
    return structuredClone(row);
  }

  // ── Tags ──────────────────────────────────────────────────────────────────

  async listTagsForOutput(galleryOutputId: string): Promise<GalleryOutputTagRecord[]> {
    const tagIds = new Set(
      [...this.tagLinks]
        .filter((key) => key.startsWith(`${galleryOutputId}:`))
        .map((key) => key.split(':')[1]),
    );
    return [...this.tags.values()].filter((tag) => tagIds.has(tag.id));
  }

  async addTagToOutput(
    input: { galleryOutputId: string; name: string },
    workspaceId: string,
  ): Promise<GalleryOutputTagRecord> {
    const normalized = input.name
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
    const existing = [...this.tags.values()].find(
      (tag) => tag.workspaceId === workspaceId && tag.normalizedName === normalized,
    );
    const tag = existing ?? {
      id: crypto.randomUUID(),
      workspaceId,
      name: input.name.trim(),
      normalizedName: normalized,
      createdAt: now(),
    };
    if (!existing) this.tags.set(tag.id, tag);
    this.tagLinks.add(`${input.galleryOutputId}:${tag.id}`);
    return structuredClone(tag);
  }

  async removeTagFromOutput(galleryOutputId: string, tagId: string): Promise<void> {
    this.tagLinks.delete(`${galleryOutputId}:${tagId}`);
  }

  // ── Collections ───────────────────────────────────────────────────────────

  async listCollections(workspaceId: string): Promise<GalleryCollectionRecord[]> {
    return [...this.collections.values()]
      .filter((collection) => collection.workspaceId === workspaceId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((collection) => structuredClone(collection));
  }

  async getCollection(collectionId: string): Promise<GalleryCollectionRecord> {
    const collection = this.collections.get(collectionId);
    if (!collection) notFound('Gallery collection', collectionId);
    return structuredClone(collection);
  }

  async createCollection(
    input: CreateGalleryCollectionInput,
    createdBy: string,
  ): Promise<GalleryCollectionRecord> {
    const stamp = now();
    const record: GalleryCollectionRecord = {
      id: crypto.randomUUID(),
      workspaceId: input.workspaceId,
      name: input.name,
      description: input.description ?? null,
      status: 'active',
      createdBy,
      createdAt: stamp,
      updatedAt: stamp,
    };
    this.collections.set(record.id, record);
    this.collectionItems.set(record.id, []);
    return structuredClone(record);
  }

  async archiveCollection(collectionId: string): Promise<GalleryCollectionRecord> {
    const collection = await this.getCollection(collectionId);
    const next: GalleryCollectionRecord = { ...collection, status: 'archived', updatedAt: now() };
    this.collections.set(collectionId, next);
    return structuredClone(next);
  }

  async listCollectionItems(collectionId: string): Promise<GalleryCollectionItemRecord[]> {
    return (this.collectionItems.get(collectionId) ?? [])
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((item) => structuredClone(item));
  }

  async addCollectionItem(collectionId: string, galleryOutputId: string): Promise<GalleryCollectionItemRecord> {
    const items = await this.listCollectionItems(collectionId);
    if (items.some((item) => item.galleryOutputId === galleryOutputId)) {
      throw new Error('This output is already in the collection.');
    }
    const stamp = now();
    const row: GalleryCollectionItemRecord = {
      id: crypto.randomUUID(),
      galleryCollectionId: collectionId,
      galleryOutputId,
      sortOrder: items.length,
      createdAt: stamp,
      updatedAt: stamp,
    };
    this.collectionItems.set(collectionId, [...items, row]);
    const collection = await this.getCollection(collectionId);
    this.collections.set(collectionId, { ...collection, updatedAt: now() });
    return structuredClone(row);
  }

  async removeCollectionItem(itemId: string): Promise<void> {
    for (const [collectionId, items] of this.collectionItems) {
      const filtered = items.filter((item) => item.id !== itemId);
      if (filtered.length !== items.length) {
        this.collectionItems.set(
          collectionId,
          filtered.map((item, index) => ({ ...item, sortOrder: index, updatedAt: now() })),
        );
        return;
      }
    }
    notFound('Collection item', itemId);
  }

  async reorderCollectionItems(collectionId: string, orderedItemIds: string[]): Promise<void> {
    const items = await this.listCollectionItems(collectionId);
    const map = new Map(orderedItemIds.map((id, index) => [id, index]));
    if (items.some((item) => !map.has(item.id)) || map.size !== items.length) {
      throw new Error('Reorder must include every collection item exactly once.');
    }
    this.collectionItems.set(
      collectionId,
      items.map((item) => ({ ...item, sortOrder: map.get(item.id)!, updatedAt: now() })),
    );
  }

  // ── Events ────────────────────────────────────────────────────────────────

  async listEvents(galleryOutputId: string): Promise<GalleryOutputEventRecord[]> {
    return (this.events.get(galleryOutputId) ?? []).map((event) => structuredClone(event));
  }

  async appendEvent(event: Omit<GalleryOutputEventRecord, 'id' | 'createdAt'>): Promise<GalleryOutputEventRecord> {
    const row: GalleryOutputEventRecord = { ...event, id: crypto.randomUUID(), createdAt: now() };
    this.events.set(row.galleryOutputId, [...(this.events.get(row.galleryOutputId) ?? []), row]);
    return structuredClone(row);
  }
}
