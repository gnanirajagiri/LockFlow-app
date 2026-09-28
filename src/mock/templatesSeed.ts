/**
 * Development-only Templates seed — fictional, no real brands, people or URLs.
 *
 * Two templates in the demo workspace (ws_demo):
 *   1. Morning Skincare Launch Set — active; mirrors the seeded Content
 *      Studio plan's shape (3 scenes) so the demo apply flow feels real.
 *   2. Calm Creator Tutorial — draft; one scene, category suggestions only
 *      (no concrete asset references).
 *
 * A third-workspace template exists for cross-workspace denial tests only.
 *
 * Suggestions are NON-BINDING: concrete suggestions point at canonical
 * workspace assets (never versions) and category suggestions carry no asset.
 */
import type {
  ContentTemplateBeatRecord,
  ContentTemplateEventRecord,
  ContentTemplateRecord,
  ContentTemplateSceneRecord,
  ContentTemplateSuggestionRecord,
} from '../domain/templates';

const WORKSPACE_ID = 'ws_demo';
const OTHER_WORKSPACE_ID = 'ws_other';

const CREATED_BY = 'seed-user';

export const TEMPLATE_IDS = {
  morningLaunch: 'tmpl_morning_skincare_launch',
  calmTutorial: 'tmpl_calm_creator_tutorial',
  otherWorkspace: 'tmpl_other_ws',
} as const;

function template(
  partial: Omit<ContentTemplateRecord, 'workspaceId' | 'createdBy' | 'status' | 'archivedAt'> &
    Partial<Pick<ContentTemplateRecord, 'status' | 'archivedAt' | 'briefTemplate'>>,
): ContentTemplateRecord {
  const {
    status = 'active',
    archivedAt = null,
    briefTemplate = { objective: null, audience: null, brandVoice: null, campaignBrief: null },
    ...rest
  } = partial;
  return {
    workspaceId: WORKSPACE_ID,
    status,
    archivedAt,
    createdBy: CREATED_BY,
    briefTemplate,
    ...rest,
  };
}

export const MORNING_LAUNCH_TEMPLATE: ContentTemplateRecord = template({
  id: TEMPLATE_IDS.morningLaunch,
  name: 'Morning Skincare Launch Set',
  slug: 'morning-skincare-launch-set',
  description: 'Three-scene vertical set: calm creator opens, close-up product moment, routine wrap-up.',
  category: 'product_launch',
  defaultOutputType: 'content_set',
  defaultVariants: 3,
  briefTemplate: {
    objective: 'Introduce the morning skincare line with an authentic creator routine.',
    audience: 'Viewers interested in simple, calm morning routines.',
    brandVoice: 'Calm, precise, unhurried.',
    campaignBrief: 'Show the routine in natural morning light; the product is present, never shouted about.',
  },
  creativeDirection: 'Soft natural window light throughout. Slow, steady camera. Skin and product tones stay true.',
  createdAt: '2026-09-26T08:00:00.000Z',
  updatedAt: '2026-09-27T09:30:00.000Z',
});

export const CALM_TUTORIAL_TEMPLATE: ContentTemplateRecord = template({
  id: TEMPLATE_IDS.calmTutorial,
  name: 'Calm Creator Tutorial',
  slug: 'calm-creator-tutorial',
  description: 'Single-scene explainer draft: creator at a desk, one clear product moment.',
  category: 'tutorial',
  status: 'draft',
  defaultOutputType: 'video',
  defaultVariants: 1,
  briefTemplate: {
    objective: 'Explain one small step clearly.',
    audience: null,
    brandVoice: 'Friendly, plain-spoken.',
    campaignBrief: null,
  },
  creativeDirection: null,
  createdAt: '2026-09-27T10:00:00.000Z',
  updatedAt: '2026-09-27T10:00:00.000Z',
});

export const OTHER_WS_TEMPLATE: ContentTemplateRecord = {
  id: TEMPLATE_IDS.otherWorkspace,
  workspaceId: OTHER_WORKSPACE_ID,
  name: 'Other Workspace Template',
  slug: 'other-workspace-template',
  description: null,
  category: 'custom',
  status: 'draft',
  defaultOutputType: 'photo',
  defaultVariants: 1,
  briefTemplate: { objective: null, audience: null, brandVoice: null, campaignBrief: null },
  creativeDirection: null,
  createdBy: CREATED_BY,
  createdAt: '2026-09-20T08:00:00.000Z',
  updatedAt: '2026-09-20T08:00:00.000Z',
  archivedAt: null,
};

// ── Scenes & beats ───────────────────────────────────────────────────────────

export const LAUNCH_SCENE_IDS = {
  opening: 'tmpl_scene_launch_opening',
  product: 'tmpl_scene_launch_product',
  wrapUp: 'tmpl_scene_launch_wrapup',
} as const;

export const LAUNCH_SCENES: ContentTemplateSceneRecord[] = [
  {
    id: LAUNCH_SCENE_IDS.opening,
    contentTemplateId: TEMPLATE_IDS.morningLaunch,
    title: 'Morning setup',
    purpose: 'Establish the routine and the calm tone.',
    settingNotes: 'Warm bedroom-adjacent vanity space, morning window light.',
    shotNotes: 'Medium shot, eye level, gentle push-in.',
    sceneOrder: 0,
    createdAt: '2026-09-26T08:05:00.000Z',
    updatedAt: '2026-09-26T08:05:00.000Z',
  },
  {
    id: LAUNCH_SCENE_IDS.product,
    contentTemplateId: TEMPLATE_IDS.morningLaunch,
    title: 'Product moment',
    purpose: 'One clear look at the product in use.',
    settingNotes: 'Countertop close to the sink; soft reflections only.',
    shotNotes: 'Close-up on hands and product, shallow depth of field.',
    sceneOrder: 1,
    createdAt: '2026-09-26T08:05:00.000Z',
    updatedAt: '2026-09-26T08:05:00.000Z',
  },
  {
    id: LAUNCH_SCENE_IDS.wrapUp,
    contentTemplateId: TEMPLATE_IDS.morningLaunch,
    title: 'Routine wrap-up',
    purpose: 'Close the routine with a settled, complete feeling.',
    settingNotes: 'Same vanity space, slightly wider.',
    shotNotes: 'Static medium shot, natural exit from frame.',
    sceneOrder: 2,
    createdAt: '2026-09-26T08:05:00.000Z',
    updatedAt: '2026-09-26T08:05:00.000Z',
  },
  {
    id: 'tmpl_scene_tutorial_desk',
    contentTemplateId: TEMPLATE_IDS.calmTutorial,
    title: 'Desk explainer',
    purpose: 'Explain the step from one fixed setup.',
    settingNotes: 'Tidy desk, neutral backdrop.',
    shotNotes: 'Static medium shot.',
    sceneOrder: 0,
    createdAt: '2026-09-27T10:05:00.000Z',
    updatedAt: '2026-09-27T10:05:00.000Z',
  },
];

export const LAUNCH_BEATS: ContentTemplateBeatRecord[] = [
  {
    id: 'tmpl_beat_opening_reach',
    contentTemplateSceneId: LAUNCH_SCENE_IDS.opening,
    title: 'Reach for the routine',
    actionDescription: 'The creator settles in and begins the routine naturally.',
    dialogueOrOverlay: 'Overlay: "the 7 a.m. routine"',
    cameraDirection: 'Slow push-in from medium.',
    durationSeconds: 4,
    beatOrder: 0,
    createdAt: '2026-09-26T08:06:00.000Z',
    updatedAt: '2026-09-26T08:06:00.000Z',
  },
  {
    id: 'tmpl_beat_opening_greet',
    contentTemplateSceneId: LAUNCH_SCENE_IDS.opening,
    title: 'Quiet greeting',
    actionDescription: 'A brief look to camera; no spoken intro needed.',
    dialogueOrOverlay: null,
    cameraDirection: 'Hold.',
    durationSeconds: 2,
    beatOrder: 1,
    createdAt: '2026-09-26T08:06:00.000Z',
    updatedAt: '2026-09-26T08:06:00.000Z',
  },
  {
    id: 'tmpl_beat_product_closeup',
    contentTemplateSceneId: LAUNCH_SCENE_IDS.product,
    title: 'Dispense and apply',
    actionDescription: 'One measured dispense into the palm; product label faces camera briefly.',
    dialogueOrOverlay: 'Overlay: "one pump, every morning"',
    cameraDirection: 'Close-up, shallow focus, no movement.',
    durationSeconds: 3,
    beatOrder: 0,
    createdAt: '2026-09-26T08:06:00.000Z',
    updatedAt: '2026-09-26T08:06:00.000Z',
  },
  {
    id: 'tmpl_beat_wrapup_settle',
    contentTemplateSceneId: LAUNCH_SCENE_IDS.wrapUp,
    title: 'Settle and finish',
    actionDescription: 'The creator steps back from the vanity; the scene resolves.',
    dialogueOrOverlay: null,
    cameraDirection: 'Static.',
    durationSeconds: 3,
    beatOrder: 0,
    createdAt: '2026-09-26T08:06:00.000Z',
    updatedAt: '2026-09-26T08:06:00.000Z',
  },
  {
    id: 'tmpl_beat_tutorial_intro',
    contentTemplateSceneId: 'tmpl_scene_tutorial_desk',
    title: 'State the step',
    actionDescription: 'Say the one step this tutorial covers.',
    dialogueOrOverlay: 'Overlay: the step name in three words',
    cameraDirection: null,
    durationSeconds: 3,
    beatOrder: 0,
    createdAt: '2026-09-27T10:06:00.000Z',
    updatedAt: '2026-09-27T10:06:00.000Z',
  },
];

// ── Suggestions (non-binding) ────────────────────────────────────────────────

export const LAUNCH_SUGGESTIONS: ContentTemplateSuggestionRecord[] = [
  {
    id: 'tmpl_sugg_launch_model',
    contentTemplateId: TEMPLATE_IDS.morningLaunch,
    suggestionType: 'model',
    suggestedRole: 'primary_model',
    suggestedAssetId: 'model_aisha',
    suggestedAssetType: null,
    compatibilityNotes: 'Calm on-camera presence; any approved primary model works.',
    sortOrder: 0,
    createdAt: '2026-09-26T08:07:00.000Z',
    updatedAt: '2026-09-26T08:07:00.000Z',
  },
  {
    id: 'tmpl_sugg_launch_env',
    contentTemplateId: TEMPLATE_IDS.morningLaunch,
    suggestionType: 'environment',
    suggestedRole: 'environment',
    suggestedAssetId: 'env_warm_bedroom_studio',
    suggestedAssetType: null,
    compatibilityNotes: 'Morning light; any warm vanity space suits.',
    sortOrder: 1,
    createdAt: '2026-09-26T08:07:00.000Z',
    updatedAt: '2026-09-26T08:07:00.000Z',
  },
  {
    id: 'tmpl_sugg_launch_look',
    contentTemplateId: TEMPLATE_IDS.morningLaunch,
    suggestionType: 'look',
    suggestedRole: 'look',
    suggestedAssetId: 'lib_neutral_creator_outfit',
    suggestedAssetType: 'look',
    compatibilityNotes: 'Neutral creator look keeps attention on the product.',
    sortOrder: 2,
    createdAt: '2026-09-26T08:07:00.000Z',
    updatedAt: '2026-09-26T08:07:00.000Z',
  },
  {
    id: 'tmpl_sugg_launch_product_cat',
    contentTemplateId: TEMPLATE_IDS.morningLaunch,
    suggestionType: 'library_asset_category',
    suggestedRole: 'product',
    suggestedAssetId: null,
    suggestedAssetType: 'product',
    compatibilityNotes: 'Choose the launch product from the Library — no fixed suggestion.',
    sortOrder: 3,
    createdAt: '2026-09-26T08:07:00.000Z',
    updatedAt: '2026-09-26T08:07:00.000Z',
  },
  {
    id: 'tmpl_sugg_tutorial_tool',
    contentTemplateId: TEMPLATE_IDS.calmTutorial,
    suggestionType: 'library_asset_category',
    suggestedRole: 'creator_tool',
    suggestedAssetId: null,
    suggestedAssetType: 'creator_tool',
    compatibilityNotes: 'Whatever tool the tutorial demonstrates.',
    sortOrder: 0,
    createdAt: '2026-09-27T10:07:00.000Z',
    updatedAt: '2026-09-27T10:07:00.000Z',
  },
];

// ── Events ───────────────────────────────────────────────────────────────────

export const LAUNCH_EVENTS: ContentTemplateEventRecord[] = [
  {
    id: 'tmpl_ev_launch_created',
    contentTemplateId: TEMPLATE_IDS.morningLaunch,
    eventType: 'created',
    message: 'Template created.',
    metadata: {},
    createdAt: '2026-09-26T08:00:00.000Z',
  },
  {
    id: 'tmpl_ev_launch_updated',
    contentTemplateId: TEMPLATE_IDS.morningLaunch,
    eventType: 'updated',
    message: 'Storyboard updated: added the wrap-up scene.',
    metadata: {},
    createdAt: '2026-09-27T09:30:00.000Z',
  },
];

export const TUTORIAL_EVENTS: ContentTemplateEventRecord[] = [
  {
    id: 'tmpl_ev_tutorial_created',
    contentTemplateId: TEMPLATE_IDS.calmTutorial,
    eventType: 'created',
    message: 'Template created.',
    metadata: {},
    createdAt: '2026-09-27T10:00:00.000Z',
  },
];

export interface TemplateSeed {
  template: ContentTemplateRecord;
  scenes: ContentTemplateSceneRecord[];
  beats: Record<string, ContentTemplateBeatRecord[]>;
  suggestions: ContentTemplateSuggestionRecord[];
  events: ContentTemplateEventRecord[];
}

export const TEMPLATES_SEED: TemplateSeed[] = [
  {
    template: MORNING_LAUNCH_TEMPLATE,
    scenes: LAUNCH_SCENES.filter((scene) => scene.contentTemplateId === TEMPLATE_IDS.morningLaunch),
    beats: {
      [LAUNCH_SCENE_IDS.opening]: LAUNCH_BEATS.filter((beat) => beat.contentTemplateSceneId === LAUNCH_SCENE_IDS.opening),
      [LAUNCH_SCENE_IDS.product]: LAUNCH_BEATS.filter((beat) => beat.contentTemplateSceneId === LAUNCH_SCENE_IDS.product),
      [LAUNCH_SCENE_IDS.wrapUp]: LAUNCH_BEATS.filter((beat) => beat.contentTemplateSceneId === LAUNCH_SCENE_IDS.wrapUp),
    },
    suggestions: LAUNCH_SUGGESTIONS.filter((s) => s.contentTemplateId === TEMPLATE_IDS.morningLaunch),
    events: LAUNCH_EVENTS,
  },
  {
    template: CALM_TUTORIAL_TEMPLATE,
    scenes: LAUNCH_SCENES.filter((scene) => scene.contentTemplateId === TEMPLATE_IDS.calmTutorial),
    beats: {
      tmpl_scene_tutorial_desk: LAUNCH_BEATS.filter((beat) => beat.contentTemplateSceneId === 'tmpl_scene_tutorial_desk'),
    },
    suggestions: LAUNCH_SUGGESTIONS.filter((s) => s.contentTemplateId === TEMPLATE_IDS.calmTutorial),
    events: TUTORIAL_EVENTS,
  },
  {
    template: OTHER_WS_TEMPLATE,
    scenes: [],
    beats: {},
    suggestions: [],
    events: [],
  },
];
