/**
 * Development-only seed data — fictional, no real people, no external URLs.
 *
 * One model (Aisha), status `ready`:
 *   v1 locked      — "Original approved identity"
 *   v2 draft       — "Hair and lighting refinement"
 * Character Sheets for both versions, plus three local placeholder references
 * (portrait, full_body, profile). Replace with Supabase-backed data when the
 * Models features move off demo mode.
 */
import type {
  CharacterSheetRecord,
  ModelRecord,
  ModelReferenceRecord,
  ModelVersionRecord,
} from '../domain/models';

const WORKSPACE_ID = 'ws_demo';

const V1_ID = 'mv_aisha_v1';
const V2_ID = 'mv_aisha_v2';

const MODEL: ModelRecord = {
  id: 'model_aisha',
  workspaceId: WORKSPACE_ID,
  name: 'Aisha',
  slug: 'aisha',
  status: 'ready',
  activeVersionId: V1_ID,
  coverImagePath: null,
  createdBy: 'demo-user',
  createdAt: '2026-09-20T09:00:00.000Z',
  updatedAt: '2026-09-25T14:30:00.000Z',
};

const V1: ModelVersionRecord = {
  id: V1_ID,
  modelId: MODEL.id,
  versionNumber: 1,
  status: 'locked',
  changeSummary: 'Original approved identity',
  coverImagePath: null,
  lockedAt: '2026-09-21T10:00:00.000Z',
  createdBy: 'demo-user',
  createdAt: '2026-09-20T09:00:00.000Z',
  updatedAt: '2026-09-21T10:00:00.000Z',
};

const V2: ModelVersionRecord = {
  id: V2_ID,
  modelId: MODEL.id,
  versionNumber: 2,
  status: 'draft',
  changeSummary: 'Hair and lighting refinement',
  coverImagePath: null,
  lockedAt: null,
  createdBy: 'demo-user',
  createdAt: '2026-09-25T14:00:00.000Z',
  updatedAt: '2026-09-25T14:30:00.000Z',
};

const SHEET_V1: CharacterSheetRecord = {
  id: 'cs_aisha_v1',
  modelVersionId: V1_ID,
  identitySummary:
    'Woman in her late twenties with a warm oval face, defined cheekbones and an open, confident expression. Consistent across all content jobs.',
  faceFeatures: {
    faceShape: 'oval',
    eyes: 'almond, dark brown, softly arched brows',
    nose: 'straight bridge, rounded tip',
    lips: 'full, natural rose tone',
    jawline: 'softly defined',
  },
  hairIdentity: {
    colour: 'deep black with warm undertones',
    texture: 'dense, 3B curls',
    length: 'shoulder-length, parted slightly off-centre',
  },
  complexion: {
    skinTone: 'medium-deep with golden undertone',
    undertone: 'golden',
    features: 'natural luminosity, faint freckles across the nose bridge',
  },
  bodyProportions: {
    height: '175cm',
    build: 'athletic, balanced shoulders and hips',
    posture: 'upright, relaxed',
  },
  distinctiveDetails: {
    marks: 'small mole below the left eye',
    jewellery: 'plain gold studs (identity-adjacent, may vary per job)',
  },
  lockRules: {
    immutableTraits: ['faceFeatures', 'hairIdentity', 'complexion', 'bodyProportions', 'distinctiveDetails'],
    note: 'Identity traits are locked with the version. Clothing, accessories, props and environments attach from the shared Library at job time.',
  },
  referenceNotes: 'Approved for production use. Referenced by two launch campaigns.',
  createdAt: '2026-09-20T09:00:00.000Z',
  updatedAt: '2026-09-21T10:00:00.000Z',
};

const SHEET_V2: CharacterSheetRecord = {
  id: 'cs_aisha_v2',
  modelVersionId: V2_ID,
  identitySummary: SHEET_V1.identitySummary,
  faceFeatures: structuredClone(SHEET_V1.faceFeatures),
  hairIdentity: {
    ...structuredClone(SHEET_V1.hairIdentity),
    styling: 'softer volume, curtain parting for lower-key lighting',
  },
  complexion: structuredClone(SHEET_V1.complexion),
  bodyProportions: structuredClone(SHEET_V1.bodyProportions),
  distinctiveDetails: structuredClone(SHEET_V1.distinctiveDetails),
  lockRules: structuredClone(SHEET_V1.lockRules),
  referenceNotes: 'Draft — reviewing hair styling notes before locking.',
  createdAt: '2026-09-25T14:00:00.000Z',
  updatedAt: '2026-09-25T14:30:00.000Z',
};

function ref(
  id: string,
  versionId: string,
  referenceType: ModelReferenceRecord['referenceType'],
  caption: string,
  sortOrder: number,
): ModelReferenceRecord {
  return {
    id,
    modelVersionId: versionId,
    // Local placeholder paths (no external URLs, no copyrighted imagery).
    storagePath: `placeholders/models/aisha/${id}.svg`,
    referenceType,
    caption,
    sortOrder,
    createdAt: '2026-09-20T09:00:00.000Z',
    updatedAt: '2026-09-20T09:00:00.000Z',
  };
}

export interface ModelSeed {
  model: ModelRecord;
  versions: ModelVersionRecord[];
  sheets: Record<string, CharacterSheetRecord>;
  references: Record<string, ModelReferenceRecord[]>;
}

export const MODELS_SEED: ModelSeed[] = [
  {
    model: MODEL,
    versions: [V1, V2],
    sheets: {
      [V1_ID]: SHEET_V1,
      [V2_ID]: SHEET_V2,
    },
    references: {
      [V1_ID]: [
        ref('ref_aisha_p1', V1_ID, 'portrait', 'Front-facing portrait — neutral expression', 0),
        ref('ref_aisha_f1', V1_ID, 'full_body', 'Full body — standing, relaxed posture', 1),
        ref('ref_aisha_pr1', V1_ID, 'profile', 'Left profile — hairline and jawline detail', 2),
      ],
      [V2_ID]: [],
    },
  },
];

export const SEED_WORKSPACE_ID = WORKSPACE_ID;
