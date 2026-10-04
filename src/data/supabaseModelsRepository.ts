/**
 * Supabase-backed Models repository.
 *
 * Version creation and locking go through the transaction-safe RPCs
 * (`create_next_model_version`, `lock_model_version`) so numbering and
 * active-version bookkeeping are atomic. The DB triggers provide the same
 * immutability guarantees the service-layer guards do.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CharacterSheetAuditEvent,
  CharacterSheetAuditRow,
  CharacterSheetRecord,
  CreateModelInput,
  CreateVersionInput,
  LockVersionInput,
  ModelAssetShortcutRecord,
  ModelRecord,
  ModelReferenceRecord,
  ModelVersionRecord,
  UpdateCharacterSheetInput,
  UpdateModelDraftInput,
} from '../domain/models';
import type { ModelsRepository } from './modelsRepository';

// snake_case DB rows → camelCase domain records
function mapModel(row: Record<string, unknown>): ModelRecord {
  return {
    id: row.id as string,
    workspaceId: row.workspace_id as string,
    name: row.name as string,
    slug: row.slug as string,
    status: row.status as ModelRecord['status'],
    activeVersionId: (row.active_version_id as string | null) ?? null,
    coverImagePath: (row.cover_image_path as string | null) ?? null,
    createdBy: row.created_by as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapVersion(row: Record<string, unknown>): ModelVersionRecord {
  return {
    id: row.id as string,
    modelId: row.model_id as string,
    versionNumber: row.version_number as number,
    status: row.status as ModelVersionRecord['status'],
    changeSummary: (row.change_summary as string | null) ?? '',
    coverImagePath: (row.cover_image_path as string | null) ?? null,
    lockedAt: (row.locked_at as string | null) ?? null,
    createdBy: row.created_by as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapSheet(row: Record<string, unknown>): CharacterSheetRecord {
  return {
    id: row.id as string,
    modelVersionId: row.model_version_id as string,
    identitySummary: (row.identity_summary as string | null) ?? '',
    faceFeatures: (row.face_features ?? {}) as CharacterSheetRecord['faceFeatures'],
    hairIdentity: (row.hair_identity ?? {}) as CharacterSheetRecord['hairIdentity'],
    complexion: (row.complexion ?? {}) as CharacterSheetRecord['complexion'],
    bodyProportions: (row.body_proportions ?? {}) as CharacterSheetRecord['bodyProportions'],
    distinctiveDetails: (row.distinctive_details ?? {}) as CharacterSheetRecord['distinctiveDetails'],
    lockRules: (row.lock_rules ?? {}) as CharacterSheetRecord['lockRules'],
    referenceNotes: (row.reference_notes as string | null) ?? '',
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapReference(row: Record<string, unknown>): ModelReferenceRecord {
  return {
    id: row.id as string,
    modelVersionId: row.model_version_id as string,
    storagePath: row.storage_path as string,
    referenceType: row.reference_type as ModelReferenceRecord['referenceType'],
    caption: (row.caption as string | null) ?? '',
    sortOrder: row.sort_order as number,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    storageBucket: (row.storage_bucket as string | null) ?? null,
    originalFilename: (row.original_filename as string | null) ?? null,
    displayFilename: (row.display_filename as string | null) ?? null,
    mimeType: (row.mime_type as string | null) ?? null,
    fileSizeBytes: (row.file_size_bytes as number | null) ?? null,
    width: (row.width as number | null) ?? null,
    height: (row.height as number | null) ?? null,
    uploadStatus: (row.upload_status as ModelReferenceRecord['uploadStatus'] | null) ?? 'uploaded',
    rightsConfirmedAt: (row.rights_confirmed_at as string | null) ?? null,
  };
}

function mapShortcut(row: Record<string, unknown>): ModelAssetShortcutRecord {
  return {
    id: row.id as string,
    modelId: row.model_id as string,
    libraryAssetId: (row.library_asset_id as string | null) ?? null,
    category: row.category as ModelAssetShortcutRecord['category'],
    sortOrder: row.sort_order as number,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export class SupabaseModelsRepository implements ModelsRepository {
  constructor(private readonly client: SupabaseClient) {}

  async listModels(workspaceId: string): Promise<ModelRecord[]> {
    const { data, error } = await this.client
      .from('models')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapModel);
  }

  async getModel(modelId: string): Promise<ModelRecord> {
    const { data, error } = await this.client.from('models').select('*').eq('id', modelId).single();
    if (error) throw error;
    return mapModel(data);
  }

  async getVersions(modelId: string): Promise<ModelVersionRecord[]> {
    const { data, error } = await this.client
      .from('model_versions')
      .select('*')
      .eq('model_id', modelId)
      .order('version_number');
    if (error) throw error;
    return (data ?? []).map(mapVersion);
  }

  async getVersion(versionId: string): Promise<ModelVersionRecord> {
    const { data, error } = await this.client
      .from('model_versions')
      .select('*')
      .eq('id', versionId)
      .single();
    if (error) throw error;
    return mapVersion(data);
  }

  async getCharacterSheet(versionId: string): Promise<CharacterSheetRecord> {
    const { data, error } = await this.client
      .from('character_sheets')
      .select('*')
      .eq('model_version_id', versionId)
      .single();
    if (error) throw error;
    return mapSheet(data);
  }  async getReferences(versionId: string): Promise<ModelReferenceRecord[]> {
    const { data, error } = await this.client
      .from('model_references')
      .select('*')
      .eq('model_version_id', versionId)
      .order('sort_order');
    if (error) throw error;
    return (data ?? []).map(mapReference);
  }

  /** Adds reference metadata to a draft version (guard-checked upstream). */
  async addReference(
    versionId: string,
    input: { storagePath: string; referenceType: ModelReferenceRecord['referenceType']; caption: string },
  ): Promise<ModelReferenceRecord> {
    const { data, error } = await this.client
      .from('model_references')
      .insert({
        model_version_id: versionId,
        storage_path: input.storagePath,
        reference_type: input.referenceType,
        caption: input.caption,
        sort_order: (await this.getReferences(versionId)).length,
      })
      .select('*')
      .single();
    if (error) throw error;
    return mapReference(data);
  }

  /** Updates reference metadata on a draft version (guard-checked upstream). */
  async updateReference(
    versionId: string,
    referenceId: string,
    patch: { storagePath?: string; referenceType?: ModelReferenceRecord['referenceType']; caption?: string },
  ): Promise<void> {
    const { error } = await this.client
      .from('model_references')
      .update({
        ...(patch.storagePath !== undefined ? { storage_path: patch.storagePath } : {}),
        ...(patch.referenceType !== undefined ? { reference_type: patch.referenceType } : {}),
        ...(patch.caption !== undefined ? { caption: patch.caption } : {}),
      })
      .eq('model_version_id', versionId)
      .eq('id', referenceId);
    if (error) throw error;
  }

  /** Removes a draft version's reference metadata row (guard-checked upstream). */
  async removeReference(versionId: string, referenceId: string): Promise<void> {
    const { error } = await this.client
      .from('model_references')
      .delete()
      .eq('model_version_id', versionId)
      .eq('id', referenceId);
    if (error) throw error;
  }

  async listAssetShortcuts(modelId: string): Promise<ModelAssetShortcutRecord[]> {
    const { data, error } = await this.client
      .from('model_asset_shortcuts')
      .select('*')
      .eq('model_id', modelId)
      .order('sort_order');
    if (error) throw error;
    return (data ?? []).map(mapShortcut);
  }

  async createModel(input: CreateModelInput, createdBy: string): Promise<ModelRecord> {
    const { data, error } = await this.client
      .from('models')
      .insert({
        workspace_id: input.workspaceId,
        name: input.name,
        slug: input.slug,
        created_by: createdBy,
      })
      .select('*')
      .single();
    if (error) throw error;
    return mapModel(data);
  }

  /**
   * First draft version (v1) for a freshly created model: version + empty
   * sheet, then the model points at it. `versions_insert_member` RLS covers
   * the inserts (member of the workspace + created_by = auth.uid()); the
   * models update is covered by `models_update_member`.
   */
  async createFirstVersion(
    modelId: string,
    _createdBy: string,
    changeSummary = 'Initial identity draft',
  ): Promise<ModelVersionRecord> {
    void _createdBy; // auth.uid() is applied by RLS; the mock uses this arg

    const { data: versionRow, error: versionError } = await this.client
      .from('model_versions')
      .insert({
        model_id: modelId,
        version_number: 1,
        status: 'draft' as const,
        change_summary: changeSummary,
      })
      .select('*')
      .single();
    if (versionError) throw versionError;

    const { error: sheetError } = await this.client
      .from('character_sheets')
      .insert({ model_version_id: versionRow.id })
      .select('id')
      .single();
    if (sheetError) throw sheetError;

    // v1 is the only version, so it is the active one.
    const { error: updateError } = await this.client
      .from('models')
      .update({ active_version_id: versionRow.id })
      .eq('id', modelId)
      .select('id')
      .single();
    if (updateError) throw updateError;

    return mapVersion(versionRow);
  }

  async updateModelDraft(modelId: string, patch: UpdateModelDraftInput): Promise<ModelRecord> {
    const payload: Record<string, unknown> = {};
    if (patch.name !== undefined) payload.name = patch.name;
    if (patch.status !== undefined) payload.status = patch.status;
    if (patch.coverImagePath !== undefined) payload.cover_image_path = patch.coverImagePath;
    const { data, error } = await this.client
      .from('models')
      .update(payload)
      .eq('id', modelId)
      .select('*')
      .single();
    if (error) throw error;
    return mapModel(data);
  }

  async createVersion(input: CreateVersionInput, _createdBy: string): Promise<ModelVersionRecord> {
    // auth.uid() is resolved inside the RPC; createdBy is used only by the mock.
    void _createdBy;
    const { data, error } = await this.client.rpc('create_next_model_version', {
      p_model_id: input.modelId,
      p_source_version_id: input.sourceVersionId,
      p_change_summary: input.changeSummary ?? '',
    });
    if (error) throw error;
    return this.getVersion(data as string);
  }

  /** Copies reference metadata rows (storage paths etc.) into the target draft. */
  async copyReferences(sourceVersionId: string, targetVersionId: string): Promise<void> {
    const existing = await this.getReferences(sourceVersionId);
    if (existing.length === 0) return;
    const { error } = await this.client.from('model_references').insert(
      existing.map((reference, index) => ({
        model_version_id: targetVersionId,
        storage_path: reference.storagePath,
        reference_type: reference.referenceType,
        caption: reference.caption,
        sort_order: index,
      })),
    );
    if (error) throw error;
  }

  async lockVersion(input: LockVersionInput): Promise<ModelVersionRecord> {
    const { error } = await this.client.rpc('lock_model_version', {
      p_version_id: input.versionId,
    });
    if (error) throw error;
    return this.getVersion(input.versionId);
  }

  async updateCharacterSheet(
    versionId: string,
    patch: UpdateCharacterSheetInput,
  ): Promise<CharacterSheetRecord> {
    const payload: Record<string, unknown> = {};
    if (patch.identitySummary !== undefined) payload.identity_summary = patch.identitySummary;
    if (patch.referenceNotes !== undefined) payload.reference_notes = patch.referenceNotes;
    if (patch.faceFeatures !== undefined) payload.face_features = patch.faceFeatures;
    if (patch.hairIdentity !== undefined) payload.hair_identity = patch.hairIdentity;
    if (patch.complexion !== undefined) payload.complexion = patch.complexion;
    if (patch.bodyProportions !== undefined) payload.body_proportions = patch.bodyProportions;
    if (patch.distinctiveDetails !== undefined) payload.distinctive_details = patch.distinctiveDetails;
    if (patch.lockRules !== undefined) payload.lock_rules = patch.lockRules;

    const { data, error } = await this.client
      .from('character_sheets')
      .update(payload)
      .eq('model_version_id', versionId)
      .select('*')
      .single();
    if (error) throw error;
    return mapSheet(data);
  }

  // ── Character Sheet audit trail (prompt 26) ─────────────────────────────

  /** Resolves a version's sheet id + owning workspace for audit attribution. */
  private async sheetContextForVersion(
    versionId: string,
  ): Promise<{ sheetId: string; workspaceId: string }> {
    const { data: sheetRow, error: sheetError } = await this.client
      .from('character_sheets')
      .select('id, model_version_id')
      .eq('model_version_id', versionId)
      .single();
    if (sheetError) throw sheetError;

    const { data: versionRow, error: versionError } = await this.client
      .from('model_versions')
      .select('model_id')
      .eq('id', sheetRow.model_version_id as string)
      .single();
    if (versionError) throw versionError;

    const { data: modelRow, error: modelError } = await this.client
      .from('models')
      .select('workspace_id')
      .eq('id', versionRow.model_id as string)
      .single();
    if (modelError) throw modelError;

    return { sheetId: sheetRow.id as string, workspaceId: modelRow.workspace_id as string };
  }

  async listCharacterSheetAudit(versionId: string): Promise<CharacterSheetAuditRow[]> {
    const { sheetId } = await this.sheetContextForVersion(versionId);
    const { data, error } = await this.client
      .from('character_sheet_audit')
      .select('*')
      .eq('character_sheet_id', sheetId)
      .order('created_at');
    if (error) throw error;
    return (data ?? []).map((row) => ({
      id: row.id as string,
      workspaceId: row.workspace_id as string,
      characterSheetId: row.character_sheet_id as string,
      event: row.event as CharacterSheetAuditRow['event'],
      actorId: (row.actor_id as string | null) ?? null,
      detail: (row.detail as string | null) ?? null,
      createdAt: row.created_at as string,
    }));
  }

  async appendCharacterSheetAudit(
    versionId: string,
    event: CharacterSheetAuditEvent,
    detail: string | null,
    actorId: string | null = null,
  ): Promise<void> {
    const { sheetId, workspaceId } = await this.sheetContextForVersion(versionId);
    const { error } = await this.client.from('character_sheet_audit').insert({
      workspace_id: workspaceId,
      character_sheet_id: sheetId,
      event,
      actor_id: actorId,
      detail,
    });
    if (error) throw error;
  }
}
