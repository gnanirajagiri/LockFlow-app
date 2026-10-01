/**
 * Supabase-backed Library repository.
 *
 * Version creation and locking go through the transaction-safe RPCs
 * (`create_next_library_asset_version`, `lock_library_asset_version`) so
 * numbering and active-version bookkeeping are atomic. DB triggers enforce
 * the same immutability and consistency rules the service guards do.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AddAssetTagInput,
  CreateAssetVersionInput,
  CreateLibraryAssetInput,
  CreateLibraryAssetExtendedInput,
  LibraryAssetFilters,
  LibraryAssetRecord,
  LibraryEventRecord,
  LibraryEventType,
  LibraryAssetVersionRecord,
  LibraryReferenceRecord,
  LibraryTagRecord,
  LookAssetItemRecord,
  LookDetailsRecord,
  LockAssetVersionInput,
  SetLookItemsInput,
  UpdateAssetVersionDraftInput,
  UpdateLibraryAssetDraftInput,
  UpdateLibraryAssetExtendedInput,
} from '../domain/library';
import { normalizeTagName } from '../domain/library';
import type { LibraryRepository } from './libraryRepository';

function mapAsset(row: Record<string, unknown>): LibraryAssetRecord {
  return {
    id: row.id as string,
    workspaceId: row.workspace_id as string,
    name: row.name as string,
    slug: row.slug as string,
    assetType: row.asset_type as LibraryAssetRecord['assetType'],
    status: row.status as LibraryAssetRecord['status'],
    activeVersionId: (row.active_version_id as string | null) ?? null,
    coverImagePath: (row.cover_image_path as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    createdBy: row.created_by as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    // Prompt 21 unified-taxonomy columns (null-safe before migration runs).
    usageScope: (row.usage_scope as LibraryAssetRecord['usageScope']) ?? null,
    sourceKind: (row.source_kind as LibraryAssetRecord['sourceKind']) ?? null,
    linkedModelId: (row.linked_model_id as string | null) ?? null,
    linkedItemId: (row.linked_item_id as string | null) ?? null,
    linkedEnvironmentId: (row.linked_environment_id as string | null) ?? null,
    linkedBrandId: (row.linked_brand_id as string | null) ?? null,
    primaryFileId: (row.primary_file_id as string | null) ?? null,
    thumbnailFileId: (row.thumbnail_file_id as string | null) ?? null,
    metadata: (row.metadata ?? null) as Record<string, unknown> | null,
    archivedAt: (row.archived_at as string | null) ?? null,
    archivedBy: (row.archived_by as string | null) ?? null,
  };
}

function mapVersion(row: Record<string, unknown>): LibraryAssetVersionRecord {
  return {
    id: row.id as string,
    libraryAssetId: row.library_asset_id as string,
    versionNumber: row.version_number as number,
    status: row.status as LibraryAssetVersionRecord['status'],
    changeSummary: (row.change_summary as string | null) ?? '',
    coverImagePath: (row.cover_image_path as string | null) ?? null,
    structuredDetails: (row.structured_details ?? {}) as Record<string, unknown>,
    rightsStatus: row.rights_status as LibraryAssetVersionRecord['rightsStatus'],
    lockedAt: (row.locked_at as string | null) ?? null,
    createdBy: row.created_by as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapReference(row: Record<string, unknown>): LibraryReferenceRecord {
  return {
    id: row.id as string,
    libraryAssetVersionId: row.library_asset_version_id as string,
    storagePath: row.storage_path as string,
    referenceType: row.reference_type as LibraryReferenceRecord['referenceType'],
    caption: (row.caption as string | null) ?? '',
    sortOrder: row.sort_order as number,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapTag(row: Record<string, unknown>): LibraryTagRecord {
  return {
    id: row.id as string,
    workspaceId: row.workspace_id as string,
    name: row.name as string,
    normalizedName: row.normalized_name as string,
    createdAt: row.created_at as string,
  };
}

function mapLookDetails(row: Record<string, unknown>): LookDetailsRecord {
  return {
    id: row.id as string,
    libraryAssetVersionId: row.library_asset_version_id as string,
    modelId: row.model_id as string,
    presentationNotes: (row.presentation_notes as string | null) ?? '',
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapLookItem(row: Record<string, unknown>): LookAssetItemRecord {
  return {
    id: row.id as string,
    lookDetailsId: row.look_details_id as string,
    libraryAssetId: row.library_asset_id as string,
    libraryAssetVersionId: (row.library_asset_version_id as string | null) ?? null,
    role: row.role as LookAssetItemRecord['role'],
    sortOrder: row.sort_order as number,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export class SupabaseLibraryRepository implements LibraryRepository {
  constructor(private readonly client: SupabaseClient) {}

  async listAssets(workspaceId: string): Promise<LibraryAssetRecord[]> {
    const { data, error } = await this.client
      .from('library_assets')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapAsset);
  }

  async getAsset(assetId: string): Promise<LibraryAssetRecord> {
    const { data, error } = await this.client
      .from('library_assets')
      .select('*')
      .eq('id', assetId)
      .single();
    if (error) throw error;
    return mapAsset(data);
  }

  async createAsset(input: CreateLibraryAssetInput, createdBy: string): Promise<LibraryAssetRecord> {
    const { data, error } = await this.client
      .from('library_assets')
      .insert({
        workspace_id: input.workspaceId,
        name: input.name,
        slug: input.slug,
        asset_type: input.assetType,
        ...(input.description !== undefined ? { description: input.description } : {}),
        created_by: createdBy,
      })
      .select('*')
      .single();
    if (error) throw error;
    return mapAsset(data);
  }

  async createFirstVersion(
    assetId: string,
    _createdBy: string,
    changeSummary = 'Initial asset draft',
  ): Promise<LibraryAssetVersionRecord> {
    void _createdBy;
    const { data: versionRow, error: versionError } = await this.client
      .from('library_asset_versions')
      .insert({
        library_asset_id: assetId,
        version_number: 1,
        status: 'draft' as const,
        change_summary: changeSummary,
      })
      .select('*')
      .single();
    if (versionError) throw versionError;

    // v1 is the only version, so it is the active one.
    const { error: updateError } = await this.client
      .from('library_assets')
      .update({ active_version_id: versionRow.id })
      .eq('id', assetId)
      .select('id')
      .single();
    if (updateError) throw updateError;

    return mapVersion(versionRow);
  }

  async updateAssetDraft(assetId: string, patch: UpdateLibraryAssetDraftInput): Promise<LibraryAssetRecord> {
    const payload: Record<string, unknown> = {};
    if (patch.name !== undefined) payload.name = patch.name;
    if (patch.status !== undefined) payload.status = patch.status;
    if (patch.coverImagePath !== undefined) payload.cover_image_path = patch.coverImagePath;
    if (patch.description !== undefined) payload.description = patch.description;
    const { data, error } = await this.client
      .from('library_assets')
      .update(payload)
      .eq('id', assetId)
      .select('*')
      .single();
    if (error) throw error;
    return mapAsset(data);
  }

  async getVersions(assetId: string): Promise<LibraryAssetVersionRecord[]> {
    const { data, error } = await this.client
      .from('library_asset_versions')
      .select('*')
      .eq('library_asset_id', assetId)
      .order('version_number');
    if (error) throw error;
    return (data ?? []).map(mapVersion);
  }

  async getVersion(versionId: string): Promise<LibraryAssetVersionRecord> {
    const { data, error } = await this.client
      .from('library_asset_versions')
      .select('*')
      .eq('id', versionId)
      .single();
    if (error) throw error;
    return mapVersion(data);
  }

  async createVersion(
    input: CreateAssetVersionInput,
    _createdBy: string,
  ): Promise<LibraryAssetVersionRecord> {
    void _createdBy; // auth.uid() resolved inside the RPC
    const { data, error } = await this.client.rpc('create_next_library_asset_version', {
      p_asset_id: input.libraryAssetId,
      p_source_version_id: input.sourceVersionId,
      p_change_summary: input.changeSummary ?? '',
    });
    if (error) throw error;
    return this.getVersion(data as string);
  }

  async updateVersionDraft(
    versionId: string,
    patch: UpdateAssetVersionDraftInput,
  ): Promise<LibraryAssetVersionRecord> {
    const payload: Record<string, unknown> = {};
    if (patch.changeSummary !== undefined) payload.change_summary = patch.changeSummary;
    if (patch.rightsStatus !== undefined) payload.rights_status = patch.rightsStatus;
    if (patch.structuredDetails !== undefined) payload.structured_details = patch.structuredDetails;
    if (Object.keys(payload).length === 0) return this.getVersion(versionId);

    const { data, error } = await this.client
      .from('library_asset_versions')
      .update(payload)
      .eq('id', versionId)
      .select('*')
      .single();
    if (error) throw error;
    return mapVersion(data);
  }

  async lockVersion(input: LockAssetVersionInput): Promise<LibraryAssetVersionRecord> {
    const { error } = await this.client.rpc('lock_library_asset_version', {
      p_version_id: input.versionId,
    });
    if (error) throw error;
    return this.getVersion(input.versionId);
  }

  async getReferences(versionId: string): Promise<LibraryReferenceRecord[]> {
    const { data, error } = await this.client
      .from('library_asset_references')
      .select('*')
      .eq('library_asset_version_id', versionId)
      .order('sort_order');
    if (error) throw error;
    return (data ?? []).map(mapReference);
  }

  async addReference(
    versionId: string,
    input: { storagePath: string; referenceType: LibraryReferenceRecord['referenceType']; caption: string },
  ): Promise<LibraryReferenceRecord> {
    const { count } = await this.client
      .from('library_asset_references')
      .select('id', { count: 'exact', head: true })
      .eq('library_asset_version_id', versionId);
    const { data, error } = await this.client
      .from('library_asset_references')
      .insert({
        library_asset_version_id: versionId,
        storage_path: input.storagePath,
        reference_type: input.referenceType,
        caption: input.caption,
        sort_order: count ?? 0,
      })
      .select('*')
      .single();
    if (error) throw error;
    return mapReference(data);
  }

  async updateReference(
    versionId: string,
    referenceId: string,
    patch: { storagePath?: string; referenceType?: LibraryReferenceRecord['referenceType']; caption?: string },
  ): Promise<void> {
    const payload: Record<string, unknown> = {};
    if (patch.storagePath !== undefined) payload.storage_path = patch.storagePath;
    if (patch.referenceType !== undefined) payload.reference_type = patch.referenceType;
    if (patch.caption !== undefined) payload.caption = patch.caption;
    const { error } = await this.client
      .from('library_asset_references')
      .update(payload)
      .eq('id', referenceId)
      .eq('library_asset_version_id', versionId);
    if (error) throw error;
  }

  async removeReference(versionId: string, referenceId: string): Promise<void> {
    const { error } = await this.client
      .from('library_asset_references')
      .delete()
      .eq('id', referenceId)
      .eq('library_asset_version_id', versionId);
    if (error) throw error;
  }

  async copyReferences(sourceVersionId: string, targetVersionId: string): Promise<void> {
    const existing = await this.getReferences(sourceVersionId);
    if (existing.length === 0) return;
    const { error } = await this.client.from('library_asset_references').insert(
      existing.map((reference, index) => ({
        library_asset_version_id: targetVersionId,
        storage_path: reference.storagePath,
        reference_type: reference.referenceType,
        caption: reference.caption,
        sort_order: index,
      })),
    );
    if (error) throw error;
  }

  async getTagsForAsset(assetId: string): Promise<LibraryTagRecord[]> {
    const { data, error } = await this.client
      .from('library_asset_tag_links')
      .select('tag:library_asset_tags(*)')
      .eq('library_asset_id', assetId);
    if (error) throw error;
    return (data ?? []).map((row) => mapTag((row as unknown as { tag: Record<string, unknown> }).tag));
  }

  async addTagToAsset(
    input: AddAssetTagInput & { normalizedName?: string },
    workspaceId: string,
  ): Promise<LibraryTagRecord> {
    const normalized = input.normalizedName ?? input.name.toLowerCase().replace(/\s+/g, '-');
    // Get-or-create the workspace-local tag, then link.
    const { data: existing } = await this.client
      .from('library_asset_tags')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('normalized_name', normalized)
      .maybeSingle();

    let tagId: string;
    if (existing) {
      tagId = existing.id;
    } else {
      const { data: created, error: createError } = await this.client
        .from('library_asset_tags')
        .insert({ workspace_id: workspaceId, name: input.name, normalized_name: normalized })
        .select('*')
        .single();
      if (createError) throw createError;
      tagId = created.id;
    }

    const { error: linkError } = await this.client
      .from('library_asset_tag_links')
      .insert({ library_asset_id: input.libraryAssetId, tag_id: tagId });
    if (linkError && !`${linkError.message}`.includes('duplicate key')) throw linkError;

    const { data: tag, error: tagError } = await this.client
      .from('library_asset_tags')
      .select('*')
      .eq('id', tagId)
      .single();
    if (tagError) throw tagError;
    return mapTag(tag);
  }

  async removeTagFromAsset(assetId: string, tagId: string): Promise<void> {
    const { error } = await this.client
      .from('library_asset_tag_links')
      .delete()
      .eq('library_asset_id', assetId)
      .eq('tag_id', tagId);
    if (error) throw error;
  }

  async getLookDetails(versionId: string): Promise<LookDetailsRecord | null> {
    const { data, error } = await this.client
      .from('look_details')
      .select('*')
      .eq('library_asset_version_id', versionId)
      .maybeSingle();
    if (error) throw error;
    return data ? mapLookDetails(data) : null;
  }

  async updateLookDetails(versionId: string, patch: { presentationNotes?: string }): Promise<LookDetailsRecord> {
    const payload: Record<string, unknown> = {};
    if (patch.presentationNotes !== undefined) payload.presentation_notes = patch.presentationNotes;
    const { data, error } = await this.client
      .from('look_details')
      .update(payload)
      .eq('library_asset_version_id', versionId)
      .select('*')
      .single();
    if (error) throw error;
    return mapLookDetails(data);
  }

  async ensureLookDetails(versionId: string, modelId: string, presentationNotes = ''): Promise<LookDetailsRecord> {
    const existing = await this.getLookDetails(versionId);
    if (existing) return existing;
    const { data, error } = await this.client
      .from('look_details')
      .insert({ library_asset_version_id: versionId, model_id: modelId, presentation_notes: presentationNotes })
      .select('*')
      .single();
    if (error) throw error;
    return mapLookDetails(data);
  }

  async getLookItems(lookDetailsId: string): Promise<LookAssetItemRecord[]> {
    const { data, error } = await this.client
      .from('look_asset_items')
      .select('*')
      .eq('look_details_id', lookDetailsId)
      .order('sort_order');
    if (error) throw error;
    return (data ?? []).map(mapLookItem);
  }

  async setLookItems(input: SetLookItemsInput): Promise<LookAssetItemRecord[]> {
    // Replace the item set for the Look (canonical references only).
    const { error: deleteError } = await this.client
      .from('look_asset_items')
      .delete()
      .eq('look_details_id', input.lookDetailsId);
    if (deleteError) throw deleteError;
    if (input.items.length === 0) return [];

    const { data, error } = await this.client
      .from('look_asset_items')
      .insert(
        input.items.map((item) => ({
          look_details_id: input.lookDetailsId,
          library_asset_id: item.libraryAssetId,
          ...(item.libraryAssetVersionId !== undefined
            ? { library_asset_version_id: item.libraryAssetVersionId }
            : {}),
          role: item.role,
          sort_order: item.sortOrder,
        })),
      )
      .select('*');
    if (error) throw error;
    return (data ?? []).map(mapLookItem);
  }

  // ── Prompt 21: unified-taxonomy operations ────────────────────────────────

  async listAssetsFiltered(
    workspaceId: string,
    filters: LibraryAssetFilters,
  ): Promise<LibraryAssetRecord[]> {
    let query = this.client
      .from('library_assets')
      .select('*')
      .eq('workspace_id', workspaceId);
    if (filters.archivedOnly) {
      query = query.not('archived_at', 'is', null);
    } else if (!filters.includeArchived) {
      query = query.is('archived_at', null).neq('status', 'archived');
    }
    if (filters.search) query = query.ilike('name', `%${filters.search}%`);
    if (filters.assetType) {
      const types = Array.isArray(filters.assetType) ? filters.assetType : [filters.assetType];
      query = query.in('asset_type', types);
    }
    if (filters.status) query = query.eq('status', filters.status);
    if (filters.usageScope) query = query.eq('usage_scope', filters.usageScope);
    if (filters.linkedModelId) query = query.eq('linked_model_id', filters.linkedModelId);
    if (filters.linkedItemId) query = query.eq('linked_item_id', filters.linkedItemId);
    if (filters.linkedEnvironmentId) query = query.eq('linked_environment_id', filters.linkedEnvironmentId);
    if (filters.createdBy) query = query.eq('created_by', filters.createdBy);
    if (filters.updatedFrom) query = query.gte('updated_at', filters.updatedFrom);
    if (filters.updatedTo) query = query.lte('updated_at', filters.updatedTo);
    // Tag filtering resolves through the normalized tag vocabulary.
    if (filters.tag) {
      const tagRes = await this.client
        .from('library_asset_tags')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('normalized_name', normalizeTagName(filters.tag))
        .maybeSingle();
      if (tagRes.error) throw tagRes.error;
      if (!tagRes.data) return [];
      const linkRes = await this.client
        .from('library_asset_tag_links')
        .select('library_asset_id')
        .eq('tag_id', (tagRes.data as { id: string }).id);
      if (linkRes.error) throw linkRes.error;
      const ids = (linkRes.data as Array<{ library_asset_id: string }>).map((r) => r.library_asset_id);
      if (!ids.length) return [];
      query = query.in('id', ids);
    }
    const res = await query.order('updated_at', { ascending: false });
    if (res.error) throw res.error;
    return (res.data as Array<Record<string, unknown>>).map(mapAsset);
  }

  async createAssetExtended(
    input: CreateLibraryAssetExtendedInput,
    createdBy: string,
  ): Promise<LibraryAssetRecord> {
    const created = await this.createAsset(
      {
        workspaceId: input.workspaceId,
        name: input.name,
        ...(input.slug ? { slug: input.slug } : {}),
        assetType: input.assetType,
        ...(input.description !== undefined ? { description: input.description } : {}),
      },
      createdBy,
    );
    const patch: UpdateLibraryAssetExtendedInput = {
      usageScope: input.usageScope ?? null,
      linkedModelId: input.linkedModelId ?? null,
      linkedItemId: input.linkedItemId ?? null,
      linkedEnvironmentId: input.linkedEnvironmentId ?? null,
      linkedBrandId: input.linkedBrandId ?? null,
      primaryFileId: input.primaryFileId ?? null,
      thumbnailFileId: input.thumbnailFileId ?? null,
      metadata: input.metadata ?? null,
    };
    const extended = await this.updateAssetExtended(created.id, patch);
    for (const tagName of input.tags ?? []) {
      await this.addTagToAsset(
        { libraryAssetId: created.id, name: tagName, normalizedName: normalizeTagName(tagName) },
        input.workspaceId,
      );
    }
    return extended;
  }

  async updateAssetExtended(
    assetId: string,
    patch: UpdateLibraryAssetExtendedInput,
  ): Promise<LibraryAssetRecord> {
    const res = await this.client
      .from('library_assets')
      .update({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.coverImagePath !== undefined ? { cover_image_path: patch.coverImagePath } : {}),
        ...(patch.usageScope !== undefined ? { usage_scope: patch.usageScope } : {}),
        ...(patch.linkedModelId !== undefined ? { linked_model_id: patch.linkedModelId } : {}),
        ...(patch.linkedItemId !== undefined ? { linked_item_id: patch.linkedItemId } : {}),
        ...(patch.linkedEnvironmentId !== undefined ? { linked_environment_id: patch.linkedEnvironmentId } : {}),
        ...(patch.linkedBrandId !== undefined ? { linked_brand_id: patch.linkedBrandId } : {}),
        ...(patch.primaryFileId !== undefined ? { primary_file_id: patch.primaryFileId } : {}),
        ...(patch.thumbnailFileId !== undefined ? { thumbnail_file_id: patch.thumbnailFileId } : {}),
        ...(patch.metadata !== undefined ? { metadata: patch.metadata ?? {} } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('id', assetId)
      .select('*')
      .single();
    if (res.error) throw res.error;
    return mapAsset(res.data as unknown as Record<string, unknown>);
  }

  async archiveAsset(assetId: string, archivedBy: string): Promise<LibraryAssetRecord> {
    return (async () => {
      const res = await this.client
        .from('library_assets')
        .update({ status: 'archived', archived_at: new Date().toISOString(), archived_by: archivedBy, updated_at: new Date().toISOString() })
        .eq('id', assetId)
        .select('*')
        .single();
      if (res.error) throw res.error;
      return mapAsset(res.data as unknown as Record<string, unknown>);
    })();
  }

  async restoreAsset(assetId: string): Promise<LibraryAssetRecord> {
    const res = await this.client
      .from('library_assets')
      .update({ status: 'draft', archived_at: null, archived_by: null, updated_at: new Date().toISOString() })
      .eq('id', assetId)
      .select('*')
      .single();
    if (res.error) throw res.error;
    return mapAsset(res.data as unknown as Record<string, unknown>);
  }

  async appendLibraryEvent(input: {
    workspaceId: string;
    libraryAssetId: string | null;
    actorId: string | null;
    eventType: LibraryEventType;
    message: string;
    metadata?: Record<string, string | number | boolean> | null;
  }): Promise<LibraryEventRecord> {
    const res = await this.client
      .from('library_asset_events')
      .insert({
        workspace_id: input.workspaceId,
        library_asset_id: input.libraryAssetId,
        actor_id: input.actorId,
        event_type: input.eventType,
        message: input.message.slice(0, 400),
        metadata: input.metadata ?? {},
      })
      .select('*')
      .single();
    if (res.error) throw res.error;
    const row = res.data as Record<string, unknown>;
    return {
      id: row.id as string,
      workspaceId: row.workspace_id as string,
      libraryAssetId: (row.library_asset_id as string | null) ?? null,
      actorId: (row.actor_id as string | null) ?? null,
      eventType: row.event_type as LibraryEventType,
      message: row.message as string,
      metadata: (row.metadata ?? null) as Record<string, string | number | boolean> | null,
      createdAt: row.created_at as string,
    };
  }

  async listLibraryEvents(
    workspaceId: string,
    filter?: { libraryAssetId?: string; eventType?: LibraryEventType; limit?: number },
  ): Promise<LibraryEventRecord[]> {
    let query = this.client
      .from('library_asset_events')
      .select('*')
      .eq('workspace_id', workspaceId);
    if (filter?.libraryAssetId) query = query.eq('library_asset_id', filter.libraryAssetId);
    if (filter?.eventType) query = query.eq('event_type', filter.eventType);
    const res = await query
      .order('created_at', { ascending: false })
      .limit(filter?.limit ?? 50);
    if (res.error) throw res.error;
    return (res.data as Array<Record<string, unknown>>).map((row) => ({
      id: row.id as string,
      workspaceId: row.workspace_id as string,
      libraryAssetId: (row.library_asset_id as string | null) ?? null,
      actorId: (row.actor_id as string | null) ?? null,
      eventType: row.event_type as LibraryEventType,
      message: row.message as string,
      metadata: (row.metadata ?? null) as Record<string, string | number | boolean> | null,
      createdAt: row.created_at as string,
    }));
  }
}