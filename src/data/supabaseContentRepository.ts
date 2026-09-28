/**
 * Supabase-backed Content Studio repository.
 *
 * Straight table access for plan-editing; the job-status transitions stay
 * service-guarded (strict state machine + provider boundary). RLS enforces
 * workspace membership on every path.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ContentBeatRecord,
  ContentJobEventRecord,
  ContentJobPinRecord,
  ContentJobRequestRecord,
  ContentProjectInputRecord,
  ContentProjectRecord,
  ContentSceneRecord,
  CreateContentProjectInput,
  UpdateContentProjectDraftInput,
} from '../domain/content';
import type { ContentRepository } from './contentRepository';

function mapProject(row: Record<string, unknown>): ContentProjectRecord {
  return {
    id: row.id as string,
    workspaceId: row.workspace_id as string,
    name: row.name as string,
    slug: row.slug as string,
    status: row.status as ContentProjectRecord['status'],
    campaignBrief: (row.campaign_brief as string | null) ?? null,
    objective: (row.objective as string | null) ?? null,
    audience: (row.audience as string | null) ?? null,
    brandVoice: (row.brand_voice as string | null) ?? null,
    plannedOutputType: (row.planned_output_type as ContentProjectRecord['plannedOutputType'] | null) ?? null,
    requestedVariants: (row.requested_variants as number | null) ?? 1,
    creativeDirection: (row.creative_direction as string | null) ?? null,
    storyboardDirection: (row.storyboard_direction as string | null) ?? null,
    createdBy: row.created_by as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapInput(row: Record<string, unknown>): ContentProjectInputRecord {
  return {
    id: row.id as string,
    contentProjectId: row.content_project_id as string,
    inputType: row.input_type as ContentProjectInputRecord['inputType'],
    modelId: (row.model_id as string | null) ?? null,
    modelVersionId: (row.model_version_id as string | null) ?? null,
    environmentId: (row.environment_id as string | null) ?? null,
    environmentVersionId: (row.environment_version_id as string | null) ?? null,
    libraryAssetId: (row.library_asset_id as string | null) ?? null,
    libraryAssetVersionId: (row.library_asset_version_id as string | null) ?? null,
    role: row.role as ContentProjectInputRecord['role'],
    sortOrder: row.sort_order as number,
    notes: (row.notes as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapScene(row: Record<string, unknown>): ContentSceneRecord {
  return {
    id: row.id as string,
    contentProjectId: row.content_project_id as string,
    title: row.title as string,
    purpose: (row.purpose as string | null) ?? null,
    sceneOrder: row.scene_order as number,
    settingNotes: (row.setting_notes as string | null) ?? null,
    shotNotes: (row.shot_notes as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapBeat(row: Record<string, unknown>): ContentBeatRecord {
  return {
    id: row.id as string,
    contentSceneId: row.content_scene_id as string,
    title: row.title as string,
    beatOrder: row.beat_order as number,
    actionDescription: (row.action_description as string | null) ?? null,
    dialogueOrOverlay: (row.dialogue_or_overlay as string | null) ?? null,
    cameraDirection: (row.camera_direction as string | null) ?? null,
    durationSeconds: (row.duration_seconds as number | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapJobRequest(row: Record<string, unknown>): ContentJobRequestRecord {
  return {
    id: row.id as string,
    workspaceId: row.workspace_id as string,
    contentProjectId: (row.content_project_id as string | null) ?? null,
    name: row.name as string,
    requestedOutputType: row.requested_output_type as ContentJobRequestRecord['requestedOutputType'],
    status: row.status as ContentJobRequestRecord['status'],
    briefSnapshot: (row.brief_snapshot ?? {}) as Record<string, unknown>,
    planSnapshot: (row.plan_snapshot ?? {}) as Record<string, unknown>,
    requestedVariants: (row.requested_variants as number | null) ?? 1,
    providerName: (row.provider_name as string | null) ?? null,
    providerRequestId: (row.provider_request_id as string | null) ?? null,
    errorCode: (row.error_code as string | null) ?? null,
    errorMessage: (row.error_message as string | null) ?? null,
    submittedAt: (row.submitted_at as string | null) ?? null,
    completedAt: (row.completed_at as string | null) ?? null,
    createdBy: row.created_by as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapPin(row: Record<string, unknown>): ContentJobPinRecord {
  return {
    id: row.id as string,
    contentJobRequestId: row.content_job_request_id as string,
    pinType: row.pin_type as ContentJobPinRecord['pinType'],
    sourceRecordId: row.source_record_id as string,
    sourceVersionId: row.source_version_id as string,
    resolvedDetails: (row.resolved_details ?? {}) as Record<string, unknown>,
    role: row.role as ContentJobPinRecord['role'],
    sortOrder: row.sort_order as number,
    createdAt: row.created_at as string,
  };
}

function mapEvent(row: Record<string, unknown>): ContentJobEventRecord {
  return {
    id: row.id as string,
    contentJobRequestId: row.content_job_request_id as string,
    eventType: row.event_type as string,
    message: row.message as string,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: row.created_at as string,
  };
}

export class SupabaseContentRepository implements ContentRepository {
  constructor(private readonly client: SupabaseClient) {}

  // ── Projects ───────────────────────────────────────────────────────────────

  async listProjects(workspaceId: string): Promise<ContentProjectRecord[]> {
    const { data, error } = await this.client
      .from('content_projects')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapProject);
  }

  async getProject(projectId: string): Promise<ContentProjectRecord> {
    const { data, error } = await this.client
      .from('content_projects')
      .select('*')
      .eq('id', projectId)
      .single();
    if (error) throw error;
    return mapProject(data);
  }

  async assertSlugAvailable(workspaceId: string, slug: string): Promise<void> {
    const { data } = await this.client
      .from('content_projects')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('slug', slug)
      .maybeSingle();
    if (data) throw new Error(`Slug "${slug}" is already used in this workspace.`);
  }

  async createProject(input: CreateContentProjectInput, createdBy: string): Promise<ContentProjectRecord> {
    const { data, error } = await this.client
      .from('content_projects')
      .insert({
        workspace_id: input.workspaceId,
        name: input.name,
        slug: input.slug,
        ...(input.campaignBrief !== undefined ? { campaign_brief: input.campaignBrief } : {}),
        ...(input.objective !== undefined ? { objective: input.objective } : {}),
        ...(input.audience !== undefined ? { audience: input.audience } : {}),
        ...(input.brandVoice !== undefined ? { brand_voice: input.brandVoice } : {}),
        ...(input.plannedOutputType !== undefined ? { planned_output_type: input.plannedOutputType } : {}),
        ...(input.requestedVariants !== undefined ? { requested_variants: input.requestedVariants } : {}),
        created_by: createdBy,
      })
      .select('*')
      .single();
    if (error) throw error;
    return mapProject(data);
  }

  async updateProjectDraft(
    projectId: string,
    patch: UpdateContentProjectDraftInput,
  ): Promise<ContentProjectRecord> {
    const payload: Record<string, unknown> = {};
    if (patch.name !== undefined) payload.name = patch.name;
    if (patch.campaignBrief !== undefined) payload.campaign_brief = patch.campaignBrief;
    if (patch.objective !== undefined) payload.objective = patch.objective;
    if (patch.audience !== undefined) payload.audience = patch.audience;
    if (patch.brandVoice !== undefined) payload.brand_voice = patch.brandVoice;
    if (patch.plannedOutputType !== undefined) payload.planned_output_type = patch.plannedOutputType;
    if (patch.requestedVariants !== undefined) payload.requested_variants = patch.requestedVariants;
    if (patch.creativeDirection !== undefined) payload.creative_direction = patch.creativeDirection;
    if (patch.storyboardDirection !== undefined) payload.storyboard_direction = patch.storyboardDirection;
    const { data, error } = await this.client
      .from('content_projects')
      .update(payload)
      .eq('id', projectId)
      .select('*')
      .single();
    if (error) throw error;
    return mapProject(data);
  }

  async archiveProject(projectId: string): Promise<ContentProjectRecord> {
    const { data, error } = await this.client
      .from('content_projects')
      .update({ status: 'archived' })
      .eq('id', projectId)
      .select('*')
      .single();
    if (error) throw error;
    return mapProject(data);
  }

  // ── Project inputs ─────────────────────────────────────────────────────────

  async listInputs(contentProjectId: string): Promise<ContentProjectInputRecord[]> {
    const { data, error } = await this.client
      .from('content_project_inputs')
      .select('*')
      .eq('content_project_id', contentProjectId)
      .order('sort_order');
    if (error) throw error;
    return (data ?? []).map(mapInput);
  }

  async getInput(inputId: string): Promise<ContentProjectInputRecord> {
    const { data, error } = await this.client
      .from('content_project_inputs')
      .select('*')
      .eq('id', inputId)
      .single();
    if (error) throw error;
    return mapInput(data);
  }

  async addInput(
    input: Omit<ContentProjectInputRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ContentProjectInputRecord> {
    const { data, error } = await this.client
      .from('content_project_inputs')
      .insert({
        content_project_id: input.contentProjectId,
        input_type: input.inputType,
        model_id: input.modelId,
        model_version_id: input.modelVersionId,
        environment_id: input.environmentId,
        environment_version_id: input.environmentVersionId,
        library_asset_id: input.libraryAssetId,
        library_asset_version_id: input.libraryAssetVersionId,
        role: input.role,
        sort_order: input.sortOrder,
        notes: input.notes,
      })
      .select('*')
      .single();
    if (error) throw error;
    return mapInput(data);
  }

  async removeInput(inputId: string): Promise<void> {
    const { error } = await this.client.from('content_project_inputs').delete().eq('id', inputId);
    if (error) throw error;
  }

  async reorderInputs(_contentProjectId: string, orderedIds: string[]): Promise<void> {
    // Sequential compaction avoids transient unique(order) collisions.
    for (const [index, id] of orderedIds.entries()) {
      const { error } = await this.client
        .from('content_project_inputs')
        .update({ sort_order: index })
        .eq('id', id);
      if (error) throw error;
    }
  }

  // ── Scenes ─────────────────────────────────────────────────────────────────

  async listScenes(contentProjectId: string): Promise<ContentSceneRecord[]> {
    const { data, error } = await this.client
      .from('content_scenes')
      .select('*')
      .eq('content_project_id', contentProjectId)
      .order('scene_order');
    if (error) throw error;
    return (data ?? []).map(mapScene);
  }

  async getScene(sceneId: string): Promise<ContentSceneRecord> {
    const { data, error } = await this.client
      .from('content_scenes')
      .select('*')
      .eq('id', sceneId)
      .single();
    if (error) throw error;
    return mapScene(data);
  }

  async addScene(
    input: Omit<ContentSceneRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ContentSceneRecord> {
    const { data, error } = await this.client
      .from('content_scenes')
      .insert({
        content_project_id: input.contentProjectId,
        title: input.title,
        purpose: input.purpose,
        scene_order: input.sceneOrder,
        setting_notes: input.settingNotes,
        shot_notes: input.shotNotes,
      })
      .select('*')
      .single();
    if (error) throw error;
    return mapScene(data);
  }

  async updateScene(sceneId: string, patch: Record<string, unknown>): Promise<ContentSceneRecord> {
    const payload: Record<string, unknown> = {};
    if (patch.title !== undefined) payload.title = patch.title;
    if (patch.purpose !== undefined) payload.purpose = patch.purpose;
    if (patch.settingNotes !== undefined) payload.setting_notes = patch.settingNotes;
    if (patch.shotNotes !== undefined) payload.shot_notes = patch.shotNotes;
    const { data, error } = await this.client
      .from('content_scenes')
      .update(payload)
      .eq('id', sceneId)
      .select('*')
      .single();
    if (error) throw error;
    return mapScene(data);
  }

  async deleteScene(sceneId: string): Promise<void> {
    const { error } = await this.client.from('content_scenes').delete().eq('id', sceneId);
    if (error) throw error;
  }

  async reorderScenes(_contentProjectId: string, orderedIds: string[]): Promise<void> {
    for (const [index, id] of orderedIds.entries()) {
      const { error } = await this.client
        .from('content_scenes')
        .update({ scene_order: index })
        .eq('id', id);
      if (error) throw error;
    }
  }

  // ── Beats ──────────────────────────────────────────────────────────────────

  async listBeats(contentSceneId: string): Promise<ContentBeatRecord[]> {
    const { data, error } = await this.client
      .from('content_beats')
      .select('*')
      .eq('content_scene_id', contentSceneId)
      .order('beat_order');
    if (error) throw error;
    return (data ?? []).map(mapBeat);
  }

  async getBeat(beatId: string): Promise<ContentBeatRecord> {
    const { data, error } = await this.client
      .from('content_beats')
      .select('*')
      .eq('id', beatId)
      .single();
    if (error) throw error;
    return mapBeat(data);
  }

  async addBeat(
    input: Omit<ContentBeatRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ContentBeatRecord> {
    const { data, error } = await this.client
      .from('content_beats')
      .insert({
        content_scene_id: input.contentSceneId,
        title: input.title,
        beat_order: input.beatOrder,
        action_description: input.actionDescription,
        dialogue_or_overlay: input.dialogueOrOverlay,
        camera_direction: input.cameraDirection,
        duration_seconds: input.durationSeconds,
      })
      .select('*')
      .single();
    if (error) throw error;
    return mapBeat(data);
  }

  async updateBeat(beatId: string, patch: Record<string, unknown>): Promise<ContentBeatRecord> {
    const payload: Record<string, unknown> = {};
    if (patch.title !== undefined) payload.title = patch.title;
    if (patch.actionDescription !== undefined) payload.action_description = patch.actionDescription;
    if (patch.dialogueOrOverlay !== undefined) payload.dialogue_or_overlay = patch.dialogueOrOverlay;
    if (patch.cameraDirection !== undefined) payload.camera_direction = patch.cameraDirection;
    if (patch.durationSeconds !== undefined) payload.duration_seconds = patch.durationSeconds;
    const { data, error } = await this.client
      .from('content_beats')
      .update(payload)
      .eq('id', beatId)
      .select('*')
      .single();
    if (error) throw error;
    return mapBeat(data);
  }

  async deleteBeat(beatId: string): Promise<void> {
    const { error } = await this.client.from('content_beats').delete().eq('id', beatId);
    if (error) throw error;
  }

  async reorderBeats(_contentSceneId: string, orderedIds: string[]): Promise<void> {
    for (const [index, id] of orderedIds.entries()) {
      const { error } = await this.client
        .from('content_beats')
        .update({ beat_order: index })
        .eq('id', id);
      if (error) throw error;
    }
  }

  // ── Job requests ───────────────────────────────────────────────────────────

  async listJobRequests(workspaceId: string): Promise<ContentJobRequestRecord[]> {
    const { data, error } = await this.client
      .from('content_job_requests')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapJobRequest);
  }

  async getJobRequest(jobRequestId: string): Promise<ContentJobRequestRecord> {
    const { data, error } = await this.client
      .from('content_job_requests')
      .select('*')
      .eq('id', jobRequestId)
      .single();
    if (error) throw error;
    return mapJobRequest(data);
  }

  async createJobRequest(
    input: Omit<ContentJobRequestRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ContentJobRequestRecord> {
    const { data, error } = await this.client
      .from('content_job_requests')
      .insert({
        workspace_id: input.workspaceId,
        content_project_id: input.contentProjectId,
        name: input.name,
        requested_output_type: input.requestedOutputType,
        status: input.status,
        brief_snapshot: input.briefSnapshot,
        plan_snapshot: input.planSnapshot,
        requested_variants: input.requestedVariants,
        created_by: input.createdBy,
      })
      .select('*')
      .single();
    if (error) throw error;
    return mapJobRequest(data);
  }

  async updateJobRequestStatus(
    jobRequestId: string,
    status: ContentJobRequestRecord['status'],
  ): Promise<ContentJobRequestRecord> {
    const { data, error } = await this.client
      .from('content_job_requests')
      .update({ status })
      .eq('id', jobRequestId)
      .select('*')
      .single();
    if (error) throw error;
    return mapJobRequest(data);
  }

  // ── Job pins ───────────────────────────────────────────────────────────────

  async listJobPins(contentJobRequestId: string): Promise<ContentJobPinRecord[]> {
    const { data, error } = await this.client
      .from('content_job_pins')
      .select('*')
      .eq('content_job_request_id', contentJobRequestId)
      .order('sort_order');
    if (error) throw error;
    return (data ?? []).map(mapPin);
  }

  async createJobPins(
    pins: Array<Omit<ContentJobPinRecord, 'id' | 'createdAt'>>,
  ): Promise<ContentJobPinRecord[]> {
    const { data, error } = await this.client
      .from('content_job_pins')
      .insert(
        pins.map((pin) => ({
          content_job_request_id: pin.contentJobRequestId,
          pin_type: pin.pinType,
          source_record_id: pin.sourceRecordId,
          source_version_id: pin.sourceVersionId,
          resolved_details: pin.resolvedDetails,
          role: pin.role,
          sort_order: pin.sortOrder,
        })),
      )
      .select('*');
    if (error) throw error;
    return (data ?? []).map(mapPin);
  }

  async removeJobPins(contentJobRequestId: string): Promise<void> {
    const { error } = await this.client
      .from('content_job_pins')
      .delete()
      .eq('content_job_request_id', contentJobRequestId);
    if (error) throw error;
  }

  // ── Job events ─────────────────────────────────────────────────────────────

  async listJobEvents(contentJobRequestId: string): Promise<ContentJobEventRecord[]> {
    const { data, error } = await this.client
      .from('content_job_events')
      .select('*')
      .eq('content_job_request_id', contentJobRequestId)
      .order('created_at');
    if (error) throw error;
    return (data ?? []).map(mapEvent);
  }

  async appendJobEvent(event: Omit<ContentJobEventRecord, 'id' | 'createdAt'>): Promise<ContentJobEventRecord> {
    const { data, error } = await this.client
      .from('content_job_events')
      .insert({
        content_job_request_id: event.contentJobRequestId,
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
