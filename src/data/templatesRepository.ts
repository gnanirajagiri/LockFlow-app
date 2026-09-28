/**
 * Templates repository contract.
 *
 * UI never calls Supabase directly; it goes through TemplatesService (and the
 * application service), which apply domain guards and then call one of these
 * adapters. Workspace scoping is enforced by the service AND by RLS.
 */
import type {
  ContentTemplateBeatRecord,
  ContentTemplateEventRecord,
  ContentTemplateRecord,
  ContentTemplateSceneRecord,
  ContentTemplateSuggestionRecord,
  CreateContentTemplateInput,
  CreateTemplateBeatInput,
  CreateTemplateSceneInput,
  TemplateStatus,
  UpdateContentTemplateInput,
  UpdateTemplateBeatInput,
  UpdateTemplateSceneInput,
  UpdateTemplateSuggestionInput,
} from '../domain/templates';

export interface TemplateSummary {
  template: ContentTemplateRecord;
  sceneCount: number;
  beatCount: number;
  suggestionCount: number;
}

export interface TemplatesRepository {
  // Templates
  listTemplates(workspaceId: string): Promise<TemplateSummary[]>;
  getTemplate(templateId: string): Promise<ContentTemplateRecord>;
  createTemplate(input: CreateContentTemplateInput, createdBy: string): Promise<ContentTemplateRecord>;
  updateTemplate(templateId: string, patch: UpdateContentTemplateInput): Promise<ContentTemplateRecord>;
  updateTemplateStatus(templateId: string, status: TemplateStatus): Promise<ContentTemplateRecord>;
  /** Unique (workspace_id, slug); throws when taken. */
  assertSlugAvailable(workspaceId: string, slug: string): Promise<void>;

  // Scenes
  listScenes(contentTemplateId: string): Promise<ContentTemplateSceneRecord[]>;
  getScene(sceneId: string): Promise<ContentTemplateSceneRecord>;
  addScene(input: Omit<ContentTemplateSceneRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<ContentTemplateSceneRecord>;
  updateScene(sceneId: string, patch: UpdateTemplateSceneInput): Promise<ContentTemplateSceneRecord>;
  deleteScene(sceneId: string): Promise<void>;
  /** Persists a full order (transaction-safe in Supabase; straight write in mock). */
  reorderScenes(contentTemplateId: string, orderedIds: string[]): Promise<void>;

  // Beats
  listBeats(contentTemplateSceneId: string): Promise<ContentTemplateBeatRecord[]>;
  getBeat(beatId: string): Promise<ContentTemplateBeatRecord>;
  addBeat(input: Omit<ContentTemplateBeatRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<ContentTemplateBeatRecord>;
  updateBeat(beatId: string, patch: UpdateTemplateBeatInput): Promise<ContentTemplateBeatRecord>;
  deleteBeat(beatId: string): Promise<void>;
  reorderBeats(contentTemplateSceneId: string, orderedIds: string[]): Promise<void>;

  // Suggestions
  listSuggestions(contentTemplateId: string): Promise<ContentTemplateSuggestionRecord[]>;
  getSuggestion(suggestionId: string): Promise<ContentTemplateSuggestionRecord>;
  addSuggestion(
    input: Omit<ContentTemplateSuggestionRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ContentTemplateSuggestionRecord>;
  updateSuggestion(suggestionId: string, patch: UpdateTemplateSuggestionInput): Promise<ContentTemplateSuggestionRecord>;
  removeSuggestion(suggestionId: string): Promise<void>;
  reorderSuggestions(contentTemplateId: string, orderedIds: string[]): Promise<void>;

  // Events (append-only audit timeline)
  listEvents(contentTemplateId: string): Promise<ContentTemplateEventRecord[]>;
  appendEvent(event: Omit<ContentTemplateEventRecord, 'id' | 'createdAt'>): Promise<ContentTemplateEventRecord>;
}

/** Explicit insert shape used by duplicate/apply scene/beat copies. */
export type CreateTemplateSceneRow = Omit<ContentTemplateSceneRecord, 'id' | 'createdAt' | 'updatedAt'>;
export type CreateTemplateBeatRow = Omit<ContentTemplateBeatRecord, 'id' | 'createdAt' | 'updatedAt'>;
export type { CreateTemplateSceneInput, CreateTemplateBeatInput };
