/**
 * Development-only seed data — fictional, no real places, no external URLs.
 *
 * One reusable environment, **Warm Bedroom Studio** (status `ready`):
 *   v1 locked (balanced) — "Original approved setup"
 *   v2 draft             — "Soft evening lighting variation"
 * Full Environment Specs for both versions (defining anchors per the brief),
 * plus three local placeholder references (wide, hero_angle, product_zone).
 *
 * A second fixture lives in another workspace and exists only for
 * workspace-isolation tests, mirroring the Models seed convention.
 */
import type {
  EnvironmentAssetShortcutRecord,
  EnvironmentRecord,
  EnvironmentReferenceRecord,
  EnvironmentSpecRecord,
  EnvironmentVersionRecord,
} from '../domain/environments';

const WORKSPACE_ID = 'ws_demo';
/** Separate workspace; environments in it are invisible to the demo workspace (isolation). */
const OTHER_WORKSPACE_ID = 'ws_other';

const V1_ID = 'env_ver_wbs_v1';
const V2_ID = 'env_ver_wbs_v2';

const ENVIRONMENT: EnvironmentRecord = {
  id: 'env_warm_bedroom_studio',
  workspaceId: WORKSPACE_ID,
  name: 'Warm Bedroom Studio',
  slug: 'warm-bedroom-studio',
  status: 'ready',
  activeVersionId: V1_ID,
  coverImagePath: null,
  createdBy: 'demo-user',
  createdAt: '2026-09-22T09:00:00.000Z',
  updatedAt: '2026-09-26T15:30:00.000Z',
};

const V1: EnvironmentVersionRecord = {
  id: V1_ID,
  environmentId: ENVIRONMENT.id,
  versionNumber: 1,
  status: 'locked',
  changeSummary: 'Original approved setup',
  coverImagePath: null,
  lockLevel: 'balanced',
  lockedAt: '2026-09-23T10:00:00.000Z',
  createdBy: 'demo-user',
  createdAt: '2026-09-22T09:00:00.000Z',
  updatedAt: '2026-09-23T10:00:00.000Z',
};

const V2: EnvironmentVersionRecord = {
  id: V2_ID,
  environmentId: ENVIRONMENT.id,
  versionNumber: 2,
  status: 'draft',
  changeSummary: 'Soft evening lighting variation',
  coverImagePath: null,
  lockLevel: 'balanced', // inherited from the source version at copy time
  lockedAt: null,
  createdBy: 'demo-user',
  createdAt: '2026-09-26T15:00:00.000Z',
  updatedAt: '2026-09-26T15:30:00.000Z',
};

const SPEC_V1: EnvironmentSpecRecord = {
  id: 'spec_wbs_v1',
  environmentVersionId: V1_ID,
  roomType: 'bedroom creator setup',
  layoutFeel: 'warm, lived-in, clean creator corner',
  heroAngle: 'three-quarter angle facing desk and vanity',
  lightingStyle: 'soft morning window light with warm practical lamp',
  furnitureAnchors: {
    items: ['bed', 'light oak desk', 'vanity mirror', 'upholstered chair'],
    note: 'Anchor positions are part of the approved layout; finishes may vary slightly per job.',
  },
  signatureProps: {
    items: ['small plant', 'ceramic mug', 'notebook', 'skincare tray'],
    note: 'Signature dressing — keep recognisable, exact items may swap via the shared Library.',
  },
  paletteMaterials: {
    palette: ['cream', 'warm beige', 'oak', 'muted terracotta'],
    materials: 'light oak wood, soft linen, matte ceramics',
  },
  productZone: {
    area: 'vanity/desk presentation area',
    note: 'Products are staged on the vanity and desk edge for close-ups.',
  },
  continuityNotes:
    'Keep the corner composition and morning light direction consistent between jobs. Bed styling may be refreshed.',
  lockRules: {
    immutableAnchors: [
      'roomType',
      'layoutFeel',
      'heroAngle',
      'lightingStyle',
      'furnitureAnchors',
      'signatureProps',
      'paletteMaterials',
      'productZone',
    ],
    note: 'Defining anchors are locked with the version. Props and products attach from the shared Library at job time.',
  },
  createdAt: '2026-09-22T09:00:00.000Z',
  updatedAt: '2026-09-23T10:00:00.000Z',
};

const SPEC_V2: EnvironmentSpecRecord = {
  id: 'spec_wbs_v2',
  environmentVersionId: V2_ID,
  roomType: SPEC_V1.roomType,
  layoutFeel: SPEC_V1.layoutFeel,
  heroAngle: SPEC_V1.heroAngle,
  lightingStyle: 'soft morning window light with warm practical lamp, plus sheer-curtain diffusion',
  furnitureAnchors: structuredClone(SPEC_V1.furnitureAnchors),
  signatureProps: structuredClone(SPEC_V1.signatureProps),
  paletteMaterials: structuredClone(SPEC_V1.paletteMaterials),
  productZone: structuredClone(SPEC_V1.productZone),
  continuityNotes: 'Draft — testing evening-grade diffusion without losing the morning warmth.',
  lockRules: structuredClone(SPEC_V1.lockRules),
  createdAt: '2026-09-26T15:00:00.000Z',
  updatedAt: '2026-09-26T15:30:00.000Z',
};

function ref(
  id: string,
  versionId: string,
  referenceType: EnvironmentReferenceRecord['referenceType'],
  caption: string,
  sortOrder: number,
): EnvironmentReferenceRecord {
  return {
    id,
    environmentVersionId: versionId,
    // Local placeholder paths (no external URLs, no copyrighted imagery).
    storagePath: `placeholders/environments/warm-bedroom-studio/${id}.svg`,
    referenceType,
    caption,
    sortOrder,
    createdAt: '2026-09-22T09:00:00.000Z',
    updatedAt: '2026-09-22T09:00:00.000Z',
  };
}

export interface EnvironmentSeed {
  environment: EnvironmentRecord;
  versions: EnvironmentVersionRecord[];
  specs: Record<string, EnvironmentSpecRecord>;
  references: Record<string, EnvironmentReferenceRecord[]>;
  /** Library shortcut pointers (canonical library_asset ids — never copies). */
  shortcuts?: EnvironmentAssetShortcutRecord[];
}

/** Demo shortcuts into the ONE shared Library for Warm Bedroom Studio. */
const WBS_SHORTCUTS: EnvironmentAssetShortcutRecord[] = [
  {
    id: 'shortcut_wbs_serum',
    environmentId: 'env_warm_bedroom_studio',
    libraryAssetId: 'lib_luma_serum',
    category: 'product',
    sortOrder: 0,
    createdAt: '2026-09-26T17:00:00.000Z',
    updatedAt: '2026-09-26T17:00:00.000Z',
  },
  {
    id: 'shortcut_wbs_laptop',
    environmentId: 'env_warm_bedroom_studio',
    libraryAssetId: 'lib_silver_laptop',
    category: 'lighting',
    sortOrder: 1,
    createdAt: '2026-09-26T17:00:00.000Z',
    updatedAt: '2026-09-26T17:00:00.000Z',
  },
];

export const ENVIRONMENTS_SEED: EnvironmentSeed[] = [
  {
    environment: ENVIRONMENT,
    versions: [V1, V2],
    specs: {
      [V1_ID]: SPEC_V1,
      [V2_ID]: SPEC_V2,
    },
    references: {
      [V1_ID]: [
        ref('eref_wbs_wide', V1_ID, 'wide', 'Wide room — full corner from the doorway', 0),
        ref('eref_wbs_hero', V1_ID, 'hero_angle', 'Hero angle — three-quarter view of desk and vanity', 1),
        ref('eref_wbs_zone', V1_ID, 'product_zone', 'Product zone — vanity presentation area', 2),
      ],
      [V2_ID]: [],
    },
    shortcuts: WBS_SHORTCUTS,
  },
  {
    // Second-workspace fixture — used by workspace-isolation tests only. It
    // never appears in the demo listing because the mock repository filters
    // by workspace (mirroring the RLS membership policies).
    environment: {
      ...ENVIRONMENT,
      id: 'env_glass_loft',
      name: 'Glass Loft Kitchen',
      slug: 'glass-loft-kitchen',
      workspaceId: OTHER_WORKSPACE_ID,
      activeVersionId: 'env_ver_glk_v1',
      updatedAt: '2026-09-24T11:00:00.000Z',
    },
    versions: [
      {
        ...V1,
        id: 'env_ver_glk_v1',
        environmentId: 'env_glass_loft',
        versionNumber: 1,
        status: 'locked' as const,
        changeSummary: 'Original approved setup',
        lockLevel: 'strict' as const,
        lockedAt: '2026-09-23T09:00:00.000Z',
      },
    ],
    specs: {
      env_ver_glk_v1: {
        ...SPEC_V1,
        id: 'spec_glk_v1',
        environmentVersionId: 'env_ver_glk_v1',
        roomType: 'loft kitchen with glazed wall',
        layoutFeel: 'airy, minimal, steel-and-stone',
        heroAngle: 'eye-level angle along the island toward the glazed wall',
        lightingStyle: 'bright north-facing daylight',
      },
    },
    references: { env_ver_glk_v1: [] },
  },
];

export const SEED_ENVIRONMENT_WORKSPACE_ID = WORKSPACE_ID;
export const SEED_OTHER_WORKSPACE_ID = OTHER_WORKSPACE_ID;
