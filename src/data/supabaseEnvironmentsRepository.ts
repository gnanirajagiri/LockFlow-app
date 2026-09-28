/**
 * Supabase-backed Environments repository.
 *
 * Version creation and locking go through the transaction-safe RPCs
 * (`create_next_environment_version`, `lock_environment_version`) so numbering
 * and active-version bookkeeping are atomic. The DB triggers provide the same
 * immutability guarantees the service-layer guards do.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CreateEnvironmentInput,
  CreateEnvironmentVersionInput,
  EnvironmentAssetShortcutRecord,
  EnvironmentRecord,
  EnvironmentReferenceRecord,
  EnvironmentSpecRecord,
  EnvironmentVersionRecord,
  LockEnvironmentVersionInput,
  UpdateEnvironmentDraftInput,
  UpdateEnvironmentSpecInput,
  UpdateEnvironmentVersionDraftInput,
} from '../domain/environments';
import type { EnvironmentsRepository } from './environmentsRepository';

// snake_case DB rows → camelCase domain records
function mapEnvironment(row: Record<string, unknown>): EnvironmentRecord {
  return {
    id: row.id as string,
    workspaceId: row.workspace_id as string,
    name: row.name as string,
    slug: row.slug as string,
    status: row.status as EnvironmentRecord['status'],
    activeVersionId: (row.active_version_id as string | null) ?? null,
    coverImagePath: (row.cover_image_path as string | null) ?? null,
    createdBy: row.created_by as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapVersion(row: Record<string, unknown>): EnvironmentVersionRecord {
  return {
    id: row.id as string,
    environmentId: row.environment_id as string,
    versionNumber: row.version_number as number,
    status: row.status as EnvironmentVersionRecord['status'],
    changeSummary: (row.change_summary as string | null) ?? '',
    coverImagePath: (row.cover_image_path as string | null) ?? null,
    lockLevel: row.lock_level as EnvironmentVersionRecord['lockLevel'],
    lockedAt: (row.locked_at as string | null) ?? null,
    createdBy: row.created_by as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapSpec(row: Record<string, unknown>): EnvironmentSpecRecord {
  return {
    id: row.id as string,
    environmentVersionId: row.environment_version_id as string,
    roomType: (row.room_type as string | null) ?? '',
    layoutFeel: (row.layout_feel as string | null) ?? '',
    heroAngle: (row.hero_angle as string | null) ?? '',
    lightingStyle: (row.lighting_style as string | null) ?? '',
    furnitureAnchors: (row.furniture_anchors ?? {}) as EnvironmentSpecRecord['furnitureAnchors'],
    signatureProps: (row.signature_props ?? {}) as EnvironmentSpecRecord['signatureProps'],
    paletteMaterials: (row.palette_materials ?? {}) as EnvironmentSpecRecord['paletteMaterials'],
    productZone: (row.product_zone ?? null) as EnvironmentSpecRecord['productZone'],
    continuityNotes: (row.continuity_notes as string | null) ?? '',
    lockRules: (row.lock_rules ?? {}) as EnvironmentSpecRecord['lockRules'],
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapReference(row: Record<string, unknown>): EnvironmentReferenceRecord {
  return {
    id: row.id as string,
    environmentVersionId: row.environment_version_id as string,
    storagePath: row.storage_path as string,
    referenceType: row.reference_type as EnvironmentReferenceRecord['referenceType'],
    caption: (row.caption as string | null) ?? '',
    sortOrder: row.sort_order as number,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapShortcut(row: Record<string, unknown>): EnvironmentAssetShortcutRecord {
  return {
    id: row.id as string,
    environmentId: row.environment_id as string,
    libraryAssetId: (row.library_asset_id as string | null) ?? null,
    category: row.category as EnvironmentAssetShortcutRecord['category'],
    sortOrder: row.sort_order as number,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export class SupabaseEnvironmentsRepository implements EnvironmentsRepository {
  constructor(private readonly client: SupabaseClient) {}

  async listEnvironments(workspaceId: string): Promise<EnvironmentRecord[]> {
    const { data, error } = await this.client
      .from('environments')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapEnvironment);
  }

  async getEnvironment(environmentId: string): Promise<EnvironmentRecord> {
    const { data, error } = await this.client
      .from('environments')
      .select('*')
      .eq('id', environmentId)
      .single();
    if (error) throw error;
    return mapEnvironment(data);
  }

  async getVersions(environmentId: string): Promise<EnvironmentVersionRecord[]> {
    const { data, error } = await this.client
      .from('environment_versions')
      .select('*')
      .eq('environment_id', environmentId)
      .order('version_number');
    if (error) throw error;
    return (data ?? []).map(mapVersion);
  }

  async getVersion(versionId: string): Promise<EnvironmentVersionRecord> {
    const { data, error } = await this.client
      .from('environment_versions')
      .select('*')
      .eq('id', versionId)
      .single();
    if (error) throw error;
    return mapVersion(data);
  }

  async getSpec(versionId: string): Promise<EnvironmentSpecRecord> {
    const { data, error } = await this.client
      .from('environment_specs')
      .select('*')
      .eq('environment_version_id', versionId)
      .single();
    if (error) throw error;
    return mapSpec(data);
  }

  async getReferences(versionId: string): Promise<EnvironmentReferenceRecord[]> {
    const { data, error } = await this.client
      .from('environment_references')
      .select('*')
      .eq('environment_version_id', versionId)
      .order('sort_order');
    if (error) throw error;
    return (data ?? []).map(mapReference);
  }

  async listAssetShortcuts(environmentId: string): Promise<EnvironmentAssetShortcutRecord[]> {
    const { data, error } = await this.client
      .from('environment_asset_shortcuts')
      .select('*')
      .eq('environment_id', environmentId)
      .order('sort_order');
    if (error) throw error;
    return (data ?? []).map(mapShortcut);
  }

  /** Adds a reference-metadata row (draft versions only; trigger + RLS guard). */
  async addReference(
    versionId: string,
    input: { storagePath: string; referenceType: EnvironmentReferenceRecord['referenceType']; caption: string },
  ): Promise<EnvironmentReferenceRecord> {
    const { count } = await this.client
      .from('environment_references')
      .select('id', { count: 'exact', head: true })
      .eq('environment_version_id', versionId);
    const { data, error } = await this.client
      .from('environment_references')
      .insert({
        environment_version_id: versionId,
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
    patch: { storagePath?: string; referenceType?: EnvironmentReferenceRecord['referenceType']; caption?: string },
  ): Promise<void> {
    const payload: Record<string, unknown> = {};
    if (patch.storagePath !== undefined) payload.storage_path = patch.storagePath;
    if (patch.referenceType !== undefined) payload.reference_type = patch.referenceType;
    if (patch.caption !== undefined) payload.caption = patch.caption;
    const { error } = await this.client
      .from('environment_references')
      .update(payload)
      .eq('id', referenceId)
      .eq('environment_version_id', versionId);
    if (error) throw error;
  }

  async removeReference(versionId: string, referenceId: string): Promise<void> {
    const { error } = await this.client
      .from('environment_references')
      .delete()
      .eq('id', referenceId)
      .eq('environment_version_id', versionId);
    if (error) throw error;
  }

  async createEnvironment(input: CreateEnvironmentInput, createdBy: string): Promise<EnvironmentRecord> {
    const { data, error } = await this.client
      .from('environments')
      .insert({
        workspace_id: input.workspaceId,
        name: input.name,
        slug: input.slug,
        created_by: createdBy,
      })
      .select('*')
      .single();
    if (error) throw error;
    return mapEnvironment(data);
  }

  /**
   * First draft version (v1) for a freshly created environment: version +
   * empty spec, then the environment points at it. RLS covers every write
   * (`environment_versions_insert_member`, `environment_specs_insert_member`,
   * `environments_update_member`).
   */
  async createFirstVersion(
    environmentId: string,
    _createdBy: string,
    changeSummary = 'Initial environment draft',
  ): Promise<EnvironmentVersionRecord> {
    void _createdBy; // auth.uid() is applied by RLS; the mock uses this arg

    const { data: versionRow, error: versionError } = await this.client
      .from('environment_versions')
      .insert({
        environment_id: environmentId,
        version_number: 1,
        status: 'draft' as const,
        change_summary: changeSummary,
      })
      .select('*')
      .single();
    if (versionError) throw versionError;

    const { error: specError } = await this.client
      .from('environment_specs')
      .insert({ environment_version_id: versionRow.id })
      .select('id')
      .single();
    if (specError) throw specError;

    // v1 is the only version, so it is the active one.
    const { error: updateError } = await this.client
      .from('environments')
      .update({ active_version_id: versionRow.id })
      .eq('id', environmentId)
      .select('id')
      .single();
    if (updateError) throw updateError;

    return mapVersion(versionRow);
  }

  async updateEnvironmentDraft(
    environmentId: string,
    patch: UpdateEnvironmentDraftInput,
  ): Promise<EnvironmentRecord> {
    const payload: Record<string, unknown> = {};
    if (patch.name !== undefined) payload.name = patch.name;
    if (patch.status !== undefined) payload.status = patch.status;
    if (patch.coverImagePath !== undefined) payload.cover_image_path = patch.coverImagePath;
    const { data, error } = await this.client
      .from('environments')
      .update(payload)
      .eq('id', environmentId)
      .select('*')
      .single();
    if (error) throw error;
    return mapEnvironment(data);
  }

  async createVersion(
    input: CreateEnvironmentVersionInput,
    _createdBy: string,
  ): Promise<EnvironmentVersionRecord> {
    // auth.uid() is resolved inside the RPC; createdBy is used only by the mock.
    void _createdBy;
    const { data, error } = await this.client.rpc('create_next_environment_version', {
      p_environment_id: input.environmentId,
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
    const { error } = await this.client.from('environment_references').insert(
      existing.map((reference, index) => ({
        environment_version_id: targetVersionId,
        storage_path: reference.storagePath,
        reference_type: reference.referenceType,
        caption: reference.caption,
        sort_order: index,
      })),
    );
    if (error) throw error;
  }

  async lockVersion(input: LockEnvironmentVersionInput): Promise<EnvironmentVersionRecord> {
    const { error } = await this.client.rpc('lock_environment_version', {
      p_version_id: input.versionId,
    });
    if (error) throw error;
    return this.getVersion(input.versionId);
  }

  /** Draft-only: update a version's own fields (lock level, change summary). */
  async updateVersionDraft(
    versionId: string,
    patch: UpdateEnvironmentVersionDraftInput,
  ): Promise<EnvironmentVersionRecord> {
    const payload: Record<string, unknown> = {};
    if (patch.lockLevel !== undefined) payload.lock_level = patch.lockLevel;
    if (patch.changeSummary !== undefined) payload.change_summary = patch.changeSummary;
    if (Object.keys(payload).length === 0) return this.getVersion(versionId);

    // RLS gates the write; the trigger + service guard refuse locked versions.
    const { data, error } = await this.client
      .from('environment_versions')
      .update(payload)
      .eq('id', versionId)
      .select('*')
      .single();
    if (error) throw error;
    return mapVersion(data);
  }

  async updateSpec(
    versionId: string,
    patch: UpdateEnvironmentSpecInput,
  ): Promise<EnvironmentSpecRecord> {
    const payload: Record<string, unknown> = {};
    if (patch.roomType !== undefined) payload.room_type = patch.roomType;
    if (patch.layoutFeel !== undefined) payload.layout_feel = patch.layoutFeel;
    if (patch.heroAngle !== undefined) payload.hero_angle = patch.heroAngle;
    if (patch.lightingStyle !== undefined) payload.lighting_style = patch.lightingStyle;
    if (patch.furnitureAnchors !== undefined) payload.furniture_anchors = patch.furnitureAnchors;
    if (patch.signatureProps !== undefined) payload.signature_props = patch.signatureProps;
    if (patch.paletteMaterials !== undefined) payload.palette_materials = patch.paletteMaterials;
    if (patch.productZone !== undefined) payload.product_zone = patch.productZone;
    if (patch.continuityNotes !== undefined) payload.continuity_notes = patch.continuityNotes;
    if (patch.lockRules !== undefined) payload.lock_rules = patch.lockRules;

    const { data, error } = await this.client
      .from('environment_specs')
      .update(payload)
      .eq('environment_version_id', versionId)
      .select('*')
      .single();
    if (error) throw error;
    return mapSpec(data);
  }
}
