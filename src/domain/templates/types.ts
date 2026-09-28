/**
 * Templates domain — types.
 *
 * Templates are reusable planning blueprints for Content Studio, NOT
 * generated content. A template owns nothing: it may *suggest* compatible
 * Models, Environments, Looks and Library asset roles/categories, but it
 * never pins versions, never creates job requests and never produces media.
 * Applying a template copies its structure into a NEW draft Content Project
 * — the template itself is never modified and nothing is generated.
 *
 * Deliberately absent: any exact version column (DB-level guarantee), any
 * provider/media/gallery fields.
 */
export type TemplateCategory =
  | 'product_launch'
  | 'social_series'
  | 'product_demo'
  | 'tutorial'
  | 'testimonial'
  | 'lifestyle'
  | 'announcement'
  | 'seasonal'
  | 'creator_content'
  | 'custom';

export type TemplateStatus = 'draft' | 'active' | 'archived';

/** Structured brief fields captured on the template and copied on apply. */
export interface TemplateBriefTemplate {
  objective: string | null;
  audience: string | null;
  brandVoice: string | null;
  campaignBrief: string | null;
}

export interface ContentTemplateRecord {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  description: string | null;
  category: TemplateCategory;
  status: TemplateStatus;
  defaultOutputType: ContentOutputTypeShared;
  defaultVariants: number;
  briefTemplate: TemplateBriefTemplate;
  /** Natural-language direction — also the target of the honest prompt bars. */
  creativeDirection: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

/** Shared literal to avoid an import cycle with the content domain. */
export type ContentOutputTypeShared = 'photo' | 'video' | 'story' | 'content_set';

export interface ContentTemplateSceneRecord {
  id: string;
  contentTemplateId: string;
  title: string;
  purpose: string | null;
  settingNotes: string | null;
  shotNotes: string | null;
  sceneOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface ContentTemplateBeatRecord {
  id: string;
  contentTemplateSceneId: string;
  title: string;
  actionDescription: string | null;
  /** Written direction only — never a promise of audio generation. */
  dialogueOrOverlay: string | null;
  cameraDirection: string | null;
  durationSeconds: number | null;
  beatOrder: number;
  createdAt: string;
  updatedAt: string;
}

export type TemplateSuggestionType =
  | 'model'
  | 'environment'
  | 'look'
  | 'library_asset_category'
  | 'library_asset';

/**
 * A NON-BINDING suggestion. If a concrete asset is referenced it stays
 * workspace-scoped and canonical (never a version); category suggestions
 * need no asset at all. Nothing here resolves or pins a version.
 */
export interface ContentTemplateSuggestionRecord {
  id: string;
  contentTemplateId: string;
  suggestionType: TemplateSuggestionType;
  suggestedRole: TemplateSuggestedRole;
  suggestedAssetId: string | null;
  suggestedAssetType: string | null;
  compatibilityNotes: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export type TemplateSuggestedRole =
  | 'primary_model'
  | 'environment'
  | 'look'
  | 'product'
  | 'prop'
  | 'wardrobe'
  | 'accessory'
  | 'creator_tool'
  | 'brand_asset'
  | 'reference'
  | 'other';

export interface ContentTemplateEventRecord {
  id: string;
  contentTemplateId: string;
  eventType: 'created' | 'updated' | 'duplicated' | 'applied' | 'archived' | 'restored';
  message: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

// ── Input payloads ──────────────────────────────────────────────────────────

export interface CreateContentTemplateInput {
  workspaceId: string;
  name: string;
  slug?: string;
  description?: string;
  category: TemplateCategory;
  defaultOutputType: ContentOutputTypeShared;
  defaultVariants?: number;
  briefTemplate?: Partial<TemplateBriefTemplate>;
  creativeDirection?: string;
}

export interface UpdateContentTemplateInput {
  name?: string;
  description?: string | null;
  category?: TemplateCategory;
  defaultOutputType?: ContentOutputTypeShared;
  defaultVariants?: number;
  briefTemplate?: Partial<TemplateBriefTemplate>;
  creativeDirection?: string | null;
}

export interface CreateTemplateSceneInput {
  contentTemplateId: string;
  title: string;
  purpose?: string;
  settingNotes?: string;
  shotNotes?: string;
}

export interface UpdateTemplateSceneInput {
  title?: string;
  purpose?: string | null;
  settingNotes?: string | null;
  shotNotes?: string | null;
}

export interface CreateTemplateBeatInput {
  contentTemplateSceneId: string;
  title: string;
  actionDescription?: string;
  dialogueOrOverlay?: string;
  cameraDirection?: string;
  durationSeconds?: number;
}

export interface UpdateTemplateBeatInput {
  title?: string;
  actionDescription?: string | null;
  dialogueOrOverlay?: string | null;
  cameraDirection?: string | null;
  durationSeconds?: number | null;
}

export interface CreateTemplateSuggestionInput {
  contentTemplateId: string;
  suggestionType: TemplateSuggestionType;
  suggestedRole: TemplateSuggestedRole;
  suggestedAssetId?: string;
  suggestedAssetType?: string;
  compatibilityNotes?: string;
}

export interface UpdateTemplateSuggestionInput {
  suggestedRole?: TemplateSuggestedRole;
  suggestedAssetType?: string | null;
  compatibilityNotes?: string | null;
}

/** Payload for TemplateApplicationService — the /apply form. */
export interface ApplyTemplateInput {
  /** New user-provided plan name (required). */
  projectName: string;
  campaignBriefOverride?: string;
  requestedVariantsOverride?: number;
}
