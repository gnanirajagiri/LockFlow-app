/**
 * Development-only Content Studio seed — fictional, no real brands, people
 * or provider requests.
 *
 * One draft Content Project ("Morning Skincare Routine") assembling seeded
 * canonical inputs — Aisha's locked v1, Warm Bedroom Studio's locked v1, the
 * Luma Dew Serum locked asset version and the locked Neutral creator outfit
 * Look version — plus three ordered scenes with ordered beats, and one draft
 * content_set job request with a draft-created event. No execution pins, no
 * provider call, no outputs.
 */
import type {
  ContentBeatRecord,
  ContentJobEventRecord,
  ContentJobRequestRecord,
  ContentProjectInputRecord,
  ContentProjectRecord,
  ContentSceneRecord,
} from '../domain/content';

const WORKSPACE_ID = 'ws_demo';

export const CONTENT_PROJECT_ID = 'content_project_morning_routine';
export const CONTENT_JOB_REQUEST_ID = 'content_job_morning_routine_set';

const SCENE_IDS = {
  setup: 'scene_morning_setup',
  product: 'scene_product_moment',
  wrapUp: 'scene_routine_wrapup',
} as const;

function project(): ContentProjectRecord {
  return {
    id: CONTENT_PROJECT_ID,
    workspaceId: WORKSPACE_ID,
    name: 'Morning Skincare Routine',
    slug: 'morning-skincare-routine',
    status: 'draft',
    campaignBrief:
      'A short, calm morning skincare sequence for social — natural light, minimal props, honest presentation.',
    objective: 'Demonstrate a simple morning skincare routine.',
    audience: 'Skincare-focused social viewers.',
    brandVoice: 'Warm, practical, calm.',
    createdBy: 'demo-user',
    createdAt: '2026-09-27T10:00:00.000Z',
    updatedAt: '2026-09-27T10:00:00.000Z',
  };
}

function inputs(): ContentProjectInputRecord[] {
  const stamp = '2026-09-27T10:00:00.000Z';
  return [
    {
      id: 'cinput_aisha_v1',
      contentProjectId: CONTENT_PROJECT_ID,
      inputType: 'model',
      modelId: 'model_aisha',
      modelVersionId: 'mv_aisha_v1', // locked v1
      environmentId: null,
      environmentVersionId: null,
      libraryAssetId: null,
      libraryAssetVersionId: null,
      role: 'primary_model',
      sortOrder: 0,
      notes: 'The on-camera model for the routine.',
      createdAt: stamp,
      updatedAt: stamp,
    },
    {
      id: 'cinput_wbs_v1',
      contentProjectId: CONTENT_PROJECT_ID,
      inputType: 'environment',
      modelId: null,
      modelVersionId: null,
      environmentId: 'env_warm_bedroom_studio',
      environmentVersionId: 'env_ver_wbs_v1', // locked v1
      libraryAssetId: null,
      libraryAssetVersionId: null,
      role: 'environment',
      sortOrder: 1,
      notes: 'Vanity corner with warm morning light.',
      createdAt: stamp,
      updatedAt: stamp,
    },
    {
      id: 'cinput_serum_v1',
      contentProjectId: CONTENT_PROJECT_ID,
      inputType: 'library_asset',
      modelId: null,
      modelVersionId: null,
      environmentId: null,
      environmentVersionId: null,
      libraryAssetId: 'lib_luma_serum',
      libraryAssetVersionId: 'libver_serum_v1', // locked v1
      role: 'product',
      sortOrder: 2,
      notes: 'Hero product — held and countertop shots.',
      createdAt: stamp,
      updatedAt: stamp,
    },
    {
      id: 'cinput_look_v2',
      contentProjectId: CONTENT_PROJECT_ID,
      inputType: 'look',
      modelId: null,
      modelVersionId: null,
      environmentId: null,
      environmentVersionId: null,
      libraryAssetId: 'lib_neutral_creator_outfit',
      libraryAssetVersionId: 'libver_look_v2', // LOCKED look version
      role: 'look',
      sortOrder: 3,
      notes: 'Neutral creator outfit for on-camera consistency.',
      createdAt: stamp,
      updatedAt: stamp,
    },
  ];
}

function scenes(): ContentSceneRecord[] {
  const stamp = '2026-09-27T10:00:00.000Z';
  return [
    {
      id: SCENE_IDS.setup,
      contentProjectId: CONTENT_PROJECT_ID,
      title: 'Morning setup',
      purpose: 'Introduction at the vanity.',
      sceneOrder: 0,
      settingNotes: 'Vanity corner, soft morning window light, serum bottle within reach.',
      shotNotes: 'Medium shot settling into a close-up as the routine begins.',
      createdAt: stamp,
      updatedAt: stamp,
    },
    {
      id: SCENE_IDS.product,
      contentProjectId: CONTENT_PROJECT_ID,
      title: 'Product moment',
      purpose: 'Product close-up and application.',
      sceneOrder: 1,
      settingNotes: 'Same vanity, tighter framing on hands and the serum bottle.',
      shotNotes: 'Macro-style close-up of the pump, then a hand-held application shot.',
      createdAt: stamp,
      updatedAt: stamp,
    },
    {
      id: SCENE_IDS.wrapUp,
      contentProjectId: CONTENT_PROJECT_ID,
      title: 'Routine wrap-up',
      purpose: 'Final natural result.',
      sceneOrder: 2,
      settingNotes: 'Back to the wider vanity framing, calm and unhurried.',
      shotNotes: 'Relaxed medium shot, soft smile, bottle resting on the counter.',
      createdAt: stamp,
      updatedAt: stamp,
    },
  ];
}

function beats(): Record<string, ContentBeatRecord[]> {
  const stamp = '2026-09-27T10:00:00.000Z';
  const beat = (
    id: string,
    sceneId: string,
    order: number,
    title: string,
    action: string,
    extra: Partial<ContentBeatRecord> = {},
  ): ContentBeatRecord => ({
    id,
    contentSceneId: sceneId,
    title,
    beatOrder: order,
    actionDescription: action,
    dialogueOrOverlay: null,
    cameraDirection: null,
    durationSeconds: null,
    createdAt: stamp,
    updatedAt: stamp,
    ...extra,
  });

  return {
    [SCENE_IDS.setup]: [
      beat('beat_setup_1', SCENE_IDS.setup, 0, 'Arrive at the vanity', 'Aisha steps to the vanity and picks up the serum bottle.', {
        cameraDirection: 'Slow push-in from medium to medium close-up.',
        durationSeconds: 6,
      }),
      beat('beat_setup_2', SCENE_IDS.setup, 1, 'Morning greeting', 'A calm greeting to camera; product placed on the counter.', {
        dialogueOrOverlay: '“Good morning — let’s keep it simple today.”',
        durationSeconds: 4,
      }),
    ],
    [SCENE_IDS.product]: [
      beat('beat_product_1', SCENE_IDS.product, 0, 'Pump detail', 'Close-up of the matte white pump dispensing a single dose.', {
        cameraDirection: 'Top-down macro on the pump.',
        durationSeconds: 5,
      }),
      beat('beat_product_2', SCENE_IDS.product, 1, 'Application', 'Fingertips apply the serum evenly; unhurried, gentle motions.', {
        durationSeconds: 8,
      }),
    ],
    [SCENE_IDS.wrapUp]: [
      beat('beat_wrapup_1', SCENE_IDS.wrapUp, 0, 'Natural finish', 'A relaxed look to camera; skin bare and dewy.', {
        cameraDirection: 'Medium shot, soft natural light.',
        durationSeconds: 5,
      }),
      beat('beat_wrapup_2', SCENE_IDS.wrapUp, 1, 'Sign-off', 'A short warm sign-off; the bottle rests on the counter.', {
        dialogueOrOverlay: '“That’s the whole routine.”',
        durationSeconds: 4,
      }),
    ],
  };
}

function jobRequest(): ContentJobRequestRecord {
  return {
    id: CONTENT_JOB_REQUEST_ID,
    workspaceId: WORKSPACE_ID,
    contentProjectId: CONTENT_PROJECT_ID,
    name: 'Morning Skincare Routine — Content Set',
    requestedOutputType: 'content_set',
    status: 'draft',
    briefSnapshot: {
      objective: 'Demonstrate a simple morning skincare routine.',
      audience: 'Skincare-focused social viewers.',
      brandVoice: 'Warm, practical, calm.',
    },
    planSnapshot: {
      capturedAt: '2026-09-27T10:00:00.000Z',
      scenes: ['Morning setup', 'Product moment', 'Routine wrap-up'],
      inputCount: 4,
    },
    requestedVariants: 3,
    providerName: null,
    providerRequestId: null,
    errorCode: null,
    errorMessage: null,
    submittedAt: null,
    completedAt: null,
    createdBy: 'demo-user',
    createdAt: '2026-09-27T10:00:00.000Z',
    updatedAt: '2026-09-27T10:00:00.000Z',
  };
}

function jobEvents(): ContentJobEventRecord[] {
  return [
    {
      id: 'cevent_morning_routine_created',
      contentJobRequestId: CONTENT_JOB_REQUEST_ID,
      eventType: 'draft_created',
      message: 'Job request created as a draft from the Morning Skincare Routine plan.',
      metadata: { requestedOutputType: 'content_set', requestedVariants: 3 },
      createdAt: '2026-09-27T10:00:00.000Z',
    },
  ];
}

export interface ContentSeed {
  project: ContentProjectRecord;
  inputs: ContentProjectInputRecord[];
  scenes: ContentSceneRecord[];
  beats: Record<string, ContentBeatRecord[]>;
  jobRequest?: ContentJobRequestRecord;
  jobEvents: ContentJobEventRecord[];
}

export const CONTENT_SEED: ContentSeed[] = [
  {
    project: project(),
    inputs: inputs(),
    scenes: scenes(),
    beats: beats(),
    jobRequest: jobRequest(),
    jobEvents: jobEvents(),
  },
];

export const SEED_CONTENT_WORKSPACE_ID = WORKSPACE_ID;
