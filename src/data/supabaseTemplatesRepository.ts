/**
 * Supabase-backed Templates repository.
 *
 * Straight table access for template editing; status transitions stay
 * service-guarded (soft archive/restore, archived read-only). RLS enforces
 * workspace membership on every path. The suggestions table has no version
 * columns by design, so no code path here could store one.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ContentTemplateBeatRecord,
  ContentTemplateEventRecord,
  ContentTemplateRecord,
  ContentTemplateSceneRecord,
  ContentTemplateSuggestionRecord,
  CreateContentTemplateInput,
  TemplateStatus,
  UpdateContentTemplateInput,
  UpdateTemplateBeatInput,
  UpdateTemplateSceneInput,
  UpdateTemplateSuggestionInput,
} from '../domain/templates';
import type { TemplatesRepository, TemplateSummary } from './templatesRepository';

type Row = Record<string, unknown>;

function mapTemplate(row: Row): ContentTemplateRecord {
  return {
    id: row.id as string,
    workspaceId: row.workspace_id as string,
    name: row.name as string,
    slug: row.slug as string,
    description: (row.description as string | null) ?? null,
    category: row.category as ContentTemplateRecord['category'],
    status: row.status as ContentTemplateRecord['status'],
    defaultOutputType: row.default_output_type as ContentTemplateRecord['defaultOutputType'],
    defaultVariants: (row.default_variants as number | null) ?? 1,
    briefTemplate: (row.brief_template ?? {}) as ContentTemplateRecord['briefTemplate'],
    creativeDirection: (row.creative_direction as string | null) ?? null,
    createdBy: row.created_by as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    archivedAt: (row.archived_at as string | null) ?? null,
  };
}

function mapScene(row: Row): ContentTemplateSceneRecord {
  return {
    id: row.id as string,
    contentTemplateId: row.content_template_id as string,
    title: row.title as string,
    purpose: (row.purpose as string | null) ?? null,
    settingNotes: (row.setting_notes as string | null) ?? null,
    shotNotes: (row.shot_notes as string | null) ?? null,
    sceneOrder: row.scene_order as number,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapBeat(row: Row): ContentTemplateBeatRecord {
  return {
    id: row.id as string,
    contentTemplateSceneId: row.content_template_scene_id as string,
    title: row.title as string,
    actionDescription: (row.action_description as string | null) ?? null,
    dialogueOrOverlay: (row.dialogue_or_overlay as string | null) ?? null,
    cameraDirection: (row.camera_direction as string | null) ?? null,
    durationSeconds: (row.duration_seconds as number | null) ?? null,
    beatOrder: row.beat_order as number,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapSuggestion(row: Row): ContentTemplateSuggestionRecord {
  return {
    id: row.id as string,
    contentTemplateId: row.content_template_id as string,
    suggestionType: row.suggestion_type as ContentTemplateSuggestionRecord['suggestionType'],
    suggestedRole: row.suggested_role as ContentTemplateSuggestionRecord['suggestedRole'],
    suggestedAssetId: (row.suggested_asset_id as string | null) ?? null,
    suggestedAssetType: (row.suggested_asset_type as string | null) ?? null,
    compatibilityNotes: (row.compatibility_notes as string | null) ?? null,
    sortOrder: row.sort_order as number,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapEvent(row: Row): ContentTemplateEventRecord {
  return {
    id: row.id as string,
    contentTemplateId: row.content_template_id as string,
    eventType: row.event_type as ContentTemplateEventRecord['eventType'],
    message: row.message as string,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: row.created_at as string,
  };
}

export class SupabaseTemplatesRepository implements TemplatesRepository {
  constructor(private readonly client: SupabaseClient) {}

  // ── Templates ──────────────────────────────────────────────────────────────

  async listTemplates(workspaceId: string): Promise<TemplateSummary[]> {
    const [templatesRes, scenesRes, beatsRes, suggestionsRes] = await Promise.all([
      this.client.from('content_templates').select('*').eq('workspace_id', workspaceId).order('updated_at', { ascending: false }),
      this.client.from('content_template_scenes').select('id,content_template_id'),
      this.client.from('content_template_beats').select('id,content_template_scene_id'),
      this.client.from('content_template_input_suggestions').select('id,content_template_id'),
    ]);
    for (const res of [templatesRes, scenesRes, beatsRes, suggestionsRes]) {
      if (res.error) throw res.error;
    }
    const sceneCountByTemplate = new Map<string, number>();
    const beatCountByScene = new Map<string, number>();
    const suggestionCountByTemplate = new Map<string, number>();
    for (const scene of (scenesRes.data ?? []) as Row[]) {
      const key = scene.content_template_id as string;
      sceneCountByTemplate.set(key, (sceneCountByTemplate.get(key) ?? 0) + 1);
    }
    for (const beat of (beatsRes.data ?? []) as Row[]) {
      const key = beat.content_template_scene_id as string;
      beatCountByScene.set(key, (beatCountByScene.get(key) ?? 0) + 1);
    }
    for (const suggestion of (suggestionsRes.data ?? []) as Row[]) {
      const key = suggestion.content_template_id as string;
      suggestionCountByTemplate.set(key, (suggestionCountByTemplate.get(key) ?? 0) + 1);
    }
    return ((templatesRes.data ?? []) as Row[]).map((row) => {
      const templateId = row.id as string;
      let beatCount = 0;
      for (const scene of (scenesRes.data ?? []) as Row[]) {
        if (scene.content_template_id === templateId) {
          beatCount += beatCountByScene.get(scene.id as string) ?? 0;
        }
      }
      return {
        template: mapTemplate(row),
        sceneCount: sceneCountByTemplate.get(templateId) ?? 0,
        beatCount,
        suggestionCount: suggestionCountByTemplate.get(templateId) ?? 0,
      };
    });
  }

  async getTemplate(templateId: string): Promise<ContentTemplateRecord> {
    const { data, error } = await this.client
      .from('content_templates')
      .select('*')
      .eq('id', templateId)
      .single();
    if (error) throw error;
    return mapTemplate(data);
  }

  async assertSlugAvailable(workspaceId: string, slug: string): Promise<void> {
    const { data } = await this.client
      .from('content_templates')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('slug', slug)
      .maybeSingle();
    if (data) throw new Error(`Slug "${slug}" is already used in this workspace.`);
  }

  async createTemplate(input: CreateContentTemplateInput, createdBy: string): Promise<ContentTemplateRecord> {
    const brief = input.briefTemplate ?? {};
    const { data, error } = await this.client
      .from('content_templates')
      .insert({
        workspace_id: input.workspaceId,
        name: input.name,
        slug: input.slug,
        ...(input.description !== undefined ? { description: input.description } : {}),
        category: input.category,
        default_output_type: input.defaultOutputType,
        ...(input.defaultVariants !== undefined ? { default_variants: input.defaultVariants } : {}),
        brief_template: {
          objective: brief.objective ?? null,
          audience: brief.audience ?? null,
          brandVoice: brief.brandVoice ?? null,
          campaignBrief: brief.campaignBrief ?? null,
        },
        ...(input.creativeDirection !== undefined ? { creative_direction: input.creativeDirection } : {}),
        created_by: createdBy,
      })
      .select('*')
      .single();
    if (error) throw error;
    return mapTemplate(data);
  }

  async updateTemplate(templateId: string, patch: UpdateContentTemplateInput): Promise<ContentTemplateRecord> {
    const payload: Row = {};
    if (patch.name !== undefined) payload.name = patch.name;
    if (patch.description !== undefined) payload.description = patch.description;
    if (patch.category !== undefined) payload.category = patch.category;
    if (patch.defaultOutputType !== undefined) payload.default_output_type = patch.defaultOutputType;
    if (patch.defaultVariants !== undefined) payload.default_variants = patch.defaultVariants;
    if (patch.creativeDirection !== undefined) payload.creative_direction = patch.creativeDirection;
    if (patch.briefTemplate !== undefined) payload.brief_template = patch.briefTemplate;
    const { data, error } = await this.client
      .from('content_templates')
      .update(payload)
      .eq('id', templateId)
      .select('*')
      .single();
    if (error) throw error;
    return mapTemplate(data);
  }

  async updateTemplateStatus(templateId: string, status: TemplateStatus): Promise<ContentTemplateRecord> {
    const { data, error } = await this.client
      .from('content_templates')
      .update({
        status,
        ...(status === 'archived' ? { archived_at: new Date().toISOString() } : { archived_at: null }),
      })
      .eq('id', templateId)
      .select('*')
      .single();
    if (error) throw error;
    return mapTemplate(data);
  }

  // ── Scenes ─────────────────────────────────────────────────────────────────

  async listScenes(contentTemplateId: string): Promise<ContentTemplateSceneRecord[]> {
    const { data, error } = await this.client
      .from('content_template_scenes')
      .select('*')
      .eq('content_template_id', contentTemplateId)
      .order('scene_order');
    if (error) throw error;
    return (data ?? []).map(mapScene);
  }

  async getScene(sceneId: string): Promise<ContentTemplateSceneRecord> {
    const { data, error } = await this.client
      .from('content_template_scenes')
      .select('*')
      .eq('id', sceneId)
      .single();
    if (error) throw error;
    return mapScene(data);
  }

  async addScene(
    input: Omit<ContentTemplateSceneRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ContentTemplateSceneRecord> {
    const { data, error } = await this.client
      .from('content_template_scenes')
      .insert({
        content_template_id: input.contentTemplateId,
        title: input.title,
        purpose: input.purpose,
        setting_notes: input.settingNotes,
        shot_notes: input.shotNotes,
        scene_order: input.sceneOrder,
      })
      .select('*')
      .single();
    if (error) throw error;
    return mapScene(data);
  }

  async updateScene(sceneId: string, patch: UpdateTemplateSceneInput): Promise<ContentTemplateSceneRecord> {
    const payload: Row = {};
    if (patch.title !== undefined) payload.title = patch.title;
    if (patch.purpose !== undefined) payload.purpose = patch.purpose;
    if (patch.settingNotes !== undefined) payload.setting_notes = patch.settingNotes;
    if (patch.shotNotes !== undefined) payload.shot_notes = patch.shotNotes;
    const { data, error } = await this.client
      .from('content_template_scenes')
      .update(payload)
      .eq('id', sceneId)
      .select('*')
      .single();
    if (error) throw error;
    return mapScene(data);
  }

  async deleteScene(sceneId: string): Promise<void> {
    const { error } = await this.client.from('content_template_scenes').delete().eq('id', sceneId);
    if (error) throw error;
  }

  async reorderScenes(_contentTemplateId: string, orderedIds: string[]): Promise<void> {
    for (const [index, id] of orderedIds.entries()) {
      const { error } = await this.client
        .from('content_template_scenes')
        .update({ scene_order: index })
        .eq('id', id);
      if (error) throw error;
    }
  }

  // ── Beats ──────────────────────────────────────────────────────────────────

  async listBeats(contentTemplateSceneId: string): Promise<ContentTemplateBeatRecord[]> {
    const { data, error } = await this.client
      .from('content_template_beats')
      .select('*')
      .eq('content_template_scene_id', contentTemplateSceneId)
      .order('beat_order');
    if (error) throw error;
    return (data ?? []).map(mapBeat);
  }

  async getBeat(beatId: string): Promise<ContentTemplateBeatRecord> {
    const { data, error } = await this.client
      .from('content_template_beats')
      .select('*')
      .eq('id', beatId)
      .single();
    if (error) throw error;
    return mapBeat(data);
  }

  async addBeat(
    input: Omit<ContentTemplateBeatRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ContentTemplateBeatRecord> {
    const { data, error } = await this.client
      .from('content_template_beats')
      .insert({
        content_template_scene_id: input.contentTemplateSceneId,
        title: input.title,
        action_description: input.actionDescription,
        dialogue_or_overlay: input.dialogueOrOverlay,
        camera_direction: input.cameraDirection,
        duration_seconds: input.durationSeconds,
        beat_order: input.beatOrder,
      })
      .select('*')
      .single();
    if (error) throw error;
    return mapBeat(data);
  }

  async updateBeat(beatId: string, patch: UpdateTemplateBeatInput): Promise<ContentTemplateBeatRecord> {
    const payload: Row = {};
    if (patch.title !== undefined) payload.title = patch.title;
    if (patch.actionDescription !== undefined) payload.action_description = patch.actionDescription;
    if (patch.dialogueOrOverlay !== undefined) payload.dialogue_or_overlay = patch.dialogueOrOverlay;
    if (patch.cameraDirection !== undefined) payload.camera_direction = patch.cameraDirection;
    if (patch.durationSeconds !== undefined) payload.duration_seconds = patch.durationSeconds;
    const { data, error } = await this.client
      .from('content_template_beats')
      .update(payload)
      .eq('id', beatId)
      .select('*')
      .single();
    if (error) throw error;
    return mapBeat(data);
  }

  async deleteBeat(beatId: string): Promise<void> {
    const { error } = await this.client.from('content_template_beats').delete().eq('id', beatId);
    if (error) throw error;
  }

  async reorderBeats(_contentTemplateSceneId: string, orderedIds: string[]): Promise<void> {
    for (const [index, id] of orderedIds.entries()) {
      const { error } = await this.client
        .from('content_template_beats')
        .update({ beat_order: index })
        .eq('id', id);
      if (error) throw error;
    }
  }

  // ── Suggestions ────────────────────────────────────────────────────────────

  async listSuggestions(contentTemplateId: string): Promise<ContentTemplateSuggestionRecord[]> {
    const { data, error } = await this.client
      .from('content_template_input_suggestions')
      .select('*')
      .eq('content_template_id', contentTemplateId)
      .order('sort_order');
    if (error) throw error;
    return (data ?? []).map(mapSuggestion);
  }

  async getSuggestion(suggestionId: string): Promise<ContentTemplateSuggestionRecord> {
    const { data, error } = await this.client
      .from('content_template_input_suggestions')
      .select('*')
      .eq('id', suggestionId)
      .single();
    if (error) throw error;
    return mapSuggestion(data);
  }

  async addSuggestion(
    input: Omit<ContentTemplateSuggestionRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ContentTemplateSuggestionRecord> {
    const { data, error } = await this.client
      .from('content_template_input_suggestions')
      .insert({
        content_template_id: input.contentTemplateId,
        suggestion_type: input.suggestionType,
        suggested_role: input.suggestedRole,
        suggested_asset_id: input.suggestedAssetId,
        suggested_asset_type: input.suggestedAssetType,
        compatibility_notes: input.compatibilityNotes,
        sort_order: input.sortOrder,
      })
      .select('*')
      .single();
    if (error) throw error;
    return mapSuggestion(data);
  }

  async updateSuggestion(suggestionId: string, patch: UpdateTemplateSuggestionInput): Promise<ContentTemplateSuggestionRecord> {
    const payload: Row = {};
    if (patch.suggestedRole !== undefined) payload.suggested_role = patch.suggestedRole;
    if (patch.suggestedAssetType !== undefined) payload.suggested_asset_type = patch.suggestedAssetType;
    if (patch.compatibilityNotes !== undefined) payload.compatibility_notes = patch.compatibilityNotes;
    const { data, error } = await this.client
      .from('content_template_input_suggestions')
      .update(payload)
      .eq('id', suggestionId)
      .select('*')
      .single();
    if (error) throw error;
    return mapSuggestion(data);
  }

  async removeSuggestion(suggestionId: string): Promise<void> {
    const { error } = await this.client.from('content_template_input_suggestions').delete().eq('id', suggestionId);
    if (error) throw error;
  }

  async reorderSuggestions(_contentTemplateId: string, orderedIds: string[]): Promise<void> {
    for (const [index, id] of orderedIds.entries()) {
      const { error } = await this.client
        .from('content_template_input_suggestions')
        .update({ sort_order: index })
        .eq('id', id);
      if (error) throw error;
    }
  }

  // ── Events ─────────────────────────────────────────────────────────────────

  async listEvents(contentTemplateId: string): Promise<ContentTemplateEventRecord[]> {
    const { data, error } = await this.client
      .from('content_template_events')
      .select('*')
      .eq('content_template_id', contentTemplateId)
      .order('created_at');
    if (error) throw error;
    return (data ?? []).map(mapEvent);
  }

  async appendEvent(event: Omit<ContentTemplateEventRecord, 'id' | 'createdAt'>): Promise<ContentTemplateEventRecord> {
    const { data, error } = await this.client
      .from('content_template_events')
      .insert({
        content_template_id: event.contentTemplateId,
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
