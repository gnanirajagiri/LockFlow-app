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
  CharacterSheetRecord,
  CreateModelInput,
  CreateVersionInput,
  LockVersionInput,
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
  }

  async getReferences(versionId: string): Promise<ModelReferenceRecord[]> {
    const { data, error } = await this.client
      .from('model_references')
      .select('*')
      .eq('model_version_id', versionId)
      .order('sort_order');
    if (error) throw error;
    return (data ?? []).map(mapReference);
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
}
