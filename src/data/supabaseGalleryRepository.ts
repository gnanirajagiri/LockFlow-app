/**
 * Supabase-backed Gallery repository.
 *
 * Straight table access for reads and metadata; status transitions and review
 * decisions stay service-guarded (strict state machine + review rules). RLS
 * enforces workspace membership on every path.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
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
import type { GalleryRepository } from './galleryRepository';

function mapOutput(row: Record<string, unknown>): GalleryOutputRecord {
  return {
    id: row.id as string,
    workspaceId: row.workspace_id as string,
    contentJobRequestId: row.content_job_request_id as string,
    parentGalleryOutputId: (row.parent_gallery_output_id as string | null) ?? null,
    title: row.title as string,
    outputType: row.output_type as GalleryOutputRecord['outputType'],
    status: row.status as GalleryOutputRecord['status'],
    mediaStoragePath: (row.media_storage_path as string | null) ?? null,
    thumbnailStoragePath: (row.thumbnail_storage_path as string | null) ?? null,
    durationSeconds: (row.duration_seconds as number | null) ?? null,
    width: (row.width as number | null) ?? null,
    height: (row.height as number | null) ?? null,
    fileSizeBytes: (row.file_size_bytes as number | null) ?? null,
    mimeType: (row.mime_type as string | null) ?? null,
    outputIndex: row.output_index as number,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdBy: row.created_by as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapReview(row: Record<string, unknown>): GalleryOutputReviewRecord {
  return {
    id: row.id as string,
    galleryOutputId: row.gallery_output_id as string,
    reviewerId: row.reviewer_id as string,
    decision: row.decision as GalleryOutputReviewRecord['decision'],
    feedback: (row.feedback as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapTag(row: Record<string, unknown>): GalleryOutputTagRecord {
  return {
    id: row.id as string,
    workspaceId: row.workspace_id as string,
    name: row.name as string,
    normalizedName: row.normalized_name as string,
    createdAt: row.created_at as string,
  };
}

function mapCollection(row: Record<string, unknown>): GalleryCollectionRecord {
  return {
    id: row.id as string,
    workspaceId: row.workspace_id as string,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    status: row.status as GalleryCollectionRecord['status'],
    createdBy: row.created_by as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapCollectionItem(row: Record<string, unknown>): GalleryCollectionItemRecord {
  return {
    id: row.id as string,
    galleryCollectionId: row.gallery_collection_id as string,
    galleryOutputId: row.gallery_output_id as string,
    sortOrder: row.sort_order as number,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapEvent(row: Record<string, unknown>): GalleryOutputEventRecord {
  return {
    id: row.id as string,
    galleryOutputId: row.gallery_output_id as string,
    eventType: row.event_type as string,
    message: row.message as string,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: row.created_at as string,
  };
}

export class SupabaseGalleryRepository implements GalleryRepository {
  constructor(private readonly client: SupabaseClient) {}

  async listOutputs(workspaceId: string): Promise<GalleryOutputRecord[]> {
    const { data, error } = await this.client
      .from('gallery_outputs')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapOutput);
  }

  async getOutput(outputId: string): Promise<GalleryOutputRecord> {
    const { data, error } = await this.client
      .from('gallery_outputs')
      .select('*')
      .eq('id', outputId)
      .single();
    if (error) throw error;
    return mapOutput(data);
  }

  async nextOutputIndex(contentJobRequestId: string): Promise<number> {
    const { count, error } = await this.client
      .from('gallery_outputs')
      .select('id', { count: 'exact', head: true })
      .eq('content_job_request_id', contentJobRequestId);
    if (error) throw error;
    return (count ?? 0) + 1;
  }

  async createOutput(input: CreateGalleryOutputInput, createdBy: string): Promise<GalleryOutputRecord> {
    const { data, error } = await this.client
      .from('gallery_outputs')
      .insert({
        workspace_id: input.workspaceId,
        content_job_request_id: input.contentJobRequestId,
        ...(input.parentGalleryOutputId !== undefined ? { parent_gallery_output_id: input.parentGalleryOutputId } : {}),
        title: input.title,
        output_type: input.outputType,
        status: input.status ?? 'draft',
        ...(input.mediaStoragePath !== undefined ? { media_storage_path: input.mediaStoragePath } : {}),
        ...(input.thumbnailStoragePath !== undefined ? { thumbnail_storage_path: input.thumbnailStoragePath } : {}),
        ...(input.durationSeconds !== undefined ? { duration_seconds: input.durationSeconds } : {}),
        ...(input.width !== undefined ? { width: input.width } : {}),
        ...(input.height !== undefined ? { height: input.height } : {}),
        ...(input.fileSizeBytes !== undefined ? { file_size_bytes: input.fileSizeBytes } : {}),
        ...(input.mimeType !== undefined ? { mime_type: input.mimeType } : {}),
        ...(input.outputIndex !== undefined ? { output_index: input.outputIndex } : {}),
        metadata: { placeholder: true, provider: null, ...(input.metadata ?? {}) },
        created_by: createdBy,
      })
      .select('*')
      .single();
    if (error) throw error;
    return mapOutput(data);
  }

  async updateOutputMetadata(
    outputId: string,
    patch: UpdateGalleryOutputInput,
  ): Promise<GalleryOutputRecord> {
    const payload: Record<string, unknown> = {};
    if (patch.title !== undefined) payload.title = patch.title;
    if (patch.durationSeconds !== undefined) payload.duration_seconds = patch.durationSeconds;
    if (patch.width !== undefined) payload.width = patch.width;
    if (patch.height !== undefined) payload.height = patch.height;
    if (patch.mediaStoragePath !== undefined) payload.media_storage_path = patch.mediaStoragePath;
    if (patch.thumbnailStoragePath !== undefined) payload.thumbnail_storage_path = patch.thumbnailStoragePath;
    if (patch.fileSizeBytes !== undefined) payload.file_size_bytes = patch.fileSizeBytes;
    if (patch.mimeType !== undefined) payload.mime_type = patch.mimeType;
    if (patch.generationProviderRunId !== undefined) payload.generation_provider_run_id = patch.generationProviderRunId;
    if (patch.metadata !== undefined) payload.metadata = patch.metadata;
    const { data, error } = await this.client
      .from('gallery_outputs')
      .update(payload)
      .eq('id', outputId)
      .select('*')
      .single();
    if (error) throw error;
    return mapOutput(data);
  }

  async updateOutputStatus(
    outputId: string,
    status: GalleryOutputRecord['status'],
    restoredFrom?: GalleryOutputRecord['status'] | null,
  ): Promise<GalleryOutputRecord> {
    // metadata merge (restoredFrom bookkeeping) is done via a read-modify-write
    // through the service; here we only write status and the marker column.
    const payload: Record<string, unknown> = { status };
    if (restoredFrom !== undefined) {
      payload.metadata = restoredFrom === null ? {} : { restoredFrom };
    }
    const { data, error } = await this.client
      .from('gallery_outputs')
      .update(payload)
      .eq('id', outputId)
      .select('*')
      .single();
    if (error) throw error;
    return mapOutput(data);
  }

  // ── Reviews ───────────────────────────────────────────────────────────────

  async listReviews(galleryOutputId: string): Promise<GalleryOutputReviewRecord[]> {
    const { data, error } = await this.client
      .from('gallery_output_reviews')
      .select('*')
      .eq('gallery_output_id', galleryOutputId)
      .order('created_at');
    if (error) throw error;
    return (data ?? []).map(mapReview);
  }

  async addReview(
    review: Omit<GalleryOutputReviewRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<GalleryOutputReviewRecord> {
    const { data, error } = await this.client
      .from('gallery_output_reviews')
      .insert({
        gallery_output_id: review.galleryOutputId,
        reviewer_id: review.reviewerId,
        decision: review.decision,
        feedback: review.feedback,
      })
      .select('*')
      .single();
    if (error) throw error;
    return mapReview(data);
  }

  // ── Tags ──────────────────────────────────────────────────────────────────

  async listTagsForOutput(galleryOutputId: string): Promise<GalleryOutputTagRecord[]> {
    const { data, error } = await this.client
      .from('gallery_output_tag_links')
      .select('tag:gallery_output_tags(*)')
      .eq('gallery_output_id', galleryOutputId);
    if (error) throw error;
    return (data ?? []).map((entry) => mapTag((entry as unknown as { tag: Record<string, unknown> }).tag));
  }

  async addTagToOutput(
    input: { galleryOutputId: string; name: string },
    workspaceId: string,
  ): Promise<GalleryOutputTagRecord> {
    const normalizedName = input.name
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
    // Get-or-create the workspace tag, then link.
    const { data: existing } = await this.client
      .from('gallery_output_tags')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('normalized_name', normalizedName)
      .maybeSingle();
    const tag = existing
      ? mapTag(existing)
      : await this.client
          .from('gallery_output_tags')
          .insert({ workspace_id: workspaceId, name: input.name.trim(), normalized_name: normalizedName })
          .select('*')
          .single()
          .then(({ data, error }) => {
            if (error) throw error;
            return mapTag(data);
          });
    const { error: linkError } = await this.client
      .from('gallery_output_tag_links')
      .insert({ gallery_output_id: input.galleryOutputId, tag_id: tag.id });
    if (linkError && !String(linkError.message).includes('duplicate')) throw linkError;
    return tag;
  }

  async removeTagFromOutput(galleryOutputId: string, tagId: string): Promise<void> {
    const { error } = await this.client
      .from('gallery_output_tag_links')
      .delete()
      .eq('gallery_output_id', galleryOutputId)
      .eq('tag_id', tagId);
    if (error) throw error;
  }

  // ── Collections ───────────────────────────────────────────────────────────

  async listCollections(workspaceId: string): Promise<GalleryCollectionRecord[]> {
    const { data, error } = await this.client
      .from('gallery_collections')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapCollection);
  }

  async getCollection(collectionId: string): Promise<GalleryCollectionRecord> {
    const { data, error } = await this.client
      .from('gallery_collections')
      .select('*')
      .eq('id', collectionId)
      .single();
    if (error) throw error;
    return mapCollection(data);
  }

  async createCollection(
    input: CreateGalleryCollectionInput,
    createdBy: string,
  ): Promise<GalleryCollectionRecord> {
    const { data, error } = await this.client
      .from('gallery_collections')
      .insert({
        workspace_id: input.workspaceId,
        name: input.name,
        ...(input.description !== undefined ? { description: input.description } : {}),
        created_by: createdBy,
      })
      .select('*')
      .single();
    if (error) throw error;
    return mapCollection(data);
  }

  async archiveCollection(collectionId: string): Promise<GalleryCollectionRecord> {
    const { data, error } = await this.client
      .from('gallery_collections')
      .update({ status: 'archived' })
      .eq('id', collectionId)
      .select('*')
      .single();
    if (error) throw error;
    return mapCollection(data);
  }

  async listCollectionItems(collectionId: string): Promise<GalleryCollectionItemRecord[]> {
    const { data, error } = await this.client
      .from('gallery_collection_items')
      .select('*')
      .eq('gallery_collection_id', collectionId)
      .order('sort_order');
    if (error) error;
    return (data ?? []).map(mapCollectionItem);
  }

  async addCollectionItem(collectionId: string, galleryOutputId: string): Promise<GalleryCollectionItemRecord> {
    const items = await this.listCollectionItems(collectionId);
    const { data, error } = await this.client
      .from('gallery_collection_items')
      .insert({
        gallery_collection_id: collectionId,
        gallery_output_id: galleryOutputId,
        sort_order: items.length,
      })
      .select('*')
      .single();
    if (error) throw error;
    return mapCollectionItem(data);
  }

  async removeCollectionItem(itemId: string): Promise<void> {
    const { error } = await this.client
      .from('gallery_collection_items')
      .delete()
      .eq('id', itemId);
    if (error) throw error;
  }

  async reorderCollectionItems(_collectionId: string, orderedItemIds: string[]): Promise<void> {
    for (const [index, id] of orderedItemIds.entries()) {
      const { error } = await this.client
        .from('gallery_collection_items')
        .update({ sort_order: index })
        .eq('id', id);
      if (error) throw error;
    }
  }

  // ── Events ────────────────────────────────────────────────────────────────

  async listEvents(galleryOutputId: string): Promise<GalleryOutputEventRecord[]> {
    const { data, error } = await this.client
      .from('gallery_output_events')
      .select('*')
      .eq('gallery_output_id', galleryOutputId)
      .order('created_at');
    if (error) throw error;
    return (data ?? []).map(mapEvent);
  }

  async appendEvent(event: Omit<GalleryOutputEventRecord, 'id' | 'createdAt'>): Promise<GalleryOutputEventRecord> {
    const { data, error } = await this.client
      .from('gallery_output_events')
      .insert({
        gallery_output_id: event.galleryOutputId,
        event_type: event.eventType,
        message: event.message,
        metadata: event.metadata,
      })
      .select('*')
      .single();
    if (error) throw error;
    return mapEvent(data);
  }
}
