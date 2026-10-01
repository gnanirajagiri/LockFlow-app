/**
 * Development-only seed data — fictional, no real brands, people or URLs.
 *
 * Five reusable assets in the demo workspace (all v1 locked unless noted):
 *   1. Luma Dew Serum Bottle  — product,      tags: skincare, bottle, countertop
 *   2. Silver creator laptop  — creator_tool, tags: desk, technology, creator
 *   3. Oversized beige blazer — wardrobe,     tags: neutral, tailored, creator
 *   4. Gold hoop earrings     — accessory,    tags: gold, minimal
 *   5. Neutral creator outfit — look (v1 draft), for Aisha, linking the
 *      blazer + earrings as canonical Library items (never copies).
 *
 * A second-workspace asset exists for tag/shortcut scoping tests only.
 */
import type {
  LibraryAssetRecord,
  LibraryAssetVersionRecord,
  LibraryReferenceRecord,
  LibraryTagLinkRecord,
  LibraryTagRecord,
  LookAssetItemRecord,
  LookDetailsRecord,
} from '../domain/library';

const WORKSPACE_ID = 'ws_demo';
const OTHER_WORKSPACE_ID = 'ws_other';

const ASSET_IDS = {
  serum: 'lib_luma_serum',
  laptop: 'lib_silver_laptop',
  blazer: 'lib_beige_blazer',
  earrings: 'lib_gold_hoops',
  look: 'lib_neutral_creator_outfit',
  otherWs: 'lib_other_ws_prop',
} as const;

const VERSION_IDS = {
  serum: 'libver_serum_v1',
  laptop: 'libver_laptop_v1',
  blazer: 'libver_blazer_v1',
  earrings: 'libver_earrings_v1',
  look: 'libver_look_v1',
  lookV2: 'libver_look_v2',
  otherWs: 'libver_other_v1',
} as const;

function asset(
  id: string,
  name: string,
  slug: string,
  assetType: LibraryAssetRecord['assetType'],
  status: LibraryAssetRecord['status'],
  description: string,
  updatedAt: string,
  activeVersionId: string | null,
): LibraryAssetRecord {
  return {
    id,
    workspaceId: WORKSPACE_ID,
    name,
    slug,
    assetType,
    status,
    activeVersionId,
    coverImagePath: null,
    description,
    createdBy: 'demo-user',
    createdAt: '2026-09-18T09:00:00.000Z',
    updatedAt,
    // Prompt 21 unified-taxonomy defaults (null = legacy/unset rows stay legal).
    usageScope: null,
    sourceKind: 'manual',
    linkedModelId: null,
    linkedItemId: null,
    linkedEnvironmentId: null,
    linkedBrandId: null,
    primaryFileId: null,
    thumbnailFileId: null,
    metadata: null,
    archivedAt: null,
    archivedBy: null,
  };
}

function lockedVersion(
  id: string,
  libraryAssetId: string,
  changeSummary: string,
  structuredDetails: Record<string, unknown>,
  rightsStatus: LibraryAssetVersionRecord['rightsStatus'],
): LibraryAssetVersionRecord {
  return {
    id,
    libraryAssetId,
    versionNumber: 1,
    status: 'locked',
    changeSummary,
    coverImagePath: null,
    structuredDetails,
    rightsStatus,
    lockedAt: '2026-09-19T10:00:00.000Z',
    createdBy: 'demo-user',
    createdAt: '2026-09-18T09:00:00.000Z',
    updatedAt: '2026-09-19T10:00:00.000Z',
  };
}

function ref(
  id: string,
  versionId: string,
  referenceType: LibraryReferenceRecord['referenceType'],
  caption: string,
  sortOrder: number,
): LibraryReferenceRecord {
  return {
    id,
    libraryAssetVersionId: versionId,
    // Local placeholder paths (no external URLs, no copyrighted imagery).
    storagePath: `placeholders/library/${id}.svg`,
    referenceType,
    caption,
    sortOrder,
    createdAt: '2026-09-18T09:00:00.000Z',
    updatedAt: '2026-09-18T09:00:00.000Z',
  };
}

// ── Assets ──────────────────────────────────────────────────────────────────

export const SERUM_ASSET = asset(
  ASSET_IDS.serum,
  'Luma Dew Serum Bottle',
  'luma-dew-serum-bottle',
  'product',
  'ready',
  'Fictional skincare serum bottle for countertop and hand-held shots.',
  '2026-09-19T10:00:00.000Z',
  VERSION_IDS.serum,
);

export const LAPTOP_ASSET = asset(
  ASSET_IDS.laptop,
  'Silver creator laptop',
  'silver-creator-laptop',
  'creator_tool',
  'ready',
  'Generic silver laptop used on desks and vanities. No visible branding.',
  '2026-09-19T10:30:00.000Z',
  VERSION_IDS.laptop,
);

export const BLAZER_ASSET = asset(
  ASSET_IDS.blazer,
  'Oversized beige blazer',
  'oversized-beige-blazer',
  'wardrobe',
  'ready',
  'Neutral oversized blazer — a studio wardrobe staple.',
  '2026-09-19T11:00:00.000Z',
  VERSION_IDS.blazer,
);

export const EARRINGS_ASSET = asset(
  ASSET_IDS.earrings,
  'Gold hoop earrings',
  'gold-hoop-earrings',
  'accessory',
  'ready',
  'Simple gold hoops that pair with most creator outfits.',
  '2026-09-19T11:30:00.000Z',
  VERSION_IDS.earrings,
);

export const LOOK_ASSET = asset(
  ASSET_IDS.look,
  'Neutral creator outfit',
  'neutral-creator-outfit',
  'look',
  'ready',
  'Aisha\u2019s neutral creator look: blazer and gold hoops, soft presentation.',
  '2026-09-27T09:00:00.000Z',
  VERSION_IDS.lookV2,
);

export const LOOK_ASSET_SCOPED: LibraryAssetRecord = {
  ...LOOK_ASSET,
  usageScope: 'model' as const,
};

export const OTHER_WS_ASSET: LibraryAssetRecord = {
  ...SERUM_ASSET,
  id: ASSET_IDS.otherWs,
  name: 'Other workspace prop',
  slug: 'other-workspace-prop',
  workspaceId: OTHER_WORKSPACE_ID,
  activeVersionId: VERSION_IDS.otherWs,
  description: 'Lives outside the demo workspace; invisible to demo listing.',
};

// ── Versions ────────────────────────────────────────────────────────────────

export const SERUM_V1 = lockedVersion(
  VERSION_IDS.serum,
  ASSET_IDS.serum,
  'Original approved product configuration',
  {
    bottle: 'frosted glass, 30ml',
    cap: 'matte white pump',
    label: 'minimal, cream background, no branding',
    liquidTone: 'clear with a pearl sheen',
  },
  'confirmed',
);

export const LAPTOP_V1 = lockedVersion(
  VERSION_IDS.laptop,
  ASSET_IDS.laptop,
  'Original approved configuration',
  {
    finish: 'silver, no stickers',
    screenState: 'on, warm neutral wallpaper',
    position: 'open, slight angle',
  },
  'unknown',
);

export const BLAZER_V1 = lockedVersion(
  VERSION_IDS.blazer,
  ASSET_IDS.blazer,
  'Original approved configuration',
  {
    colour: 'warm beige',
    fit: 'oversized, structured shoulders',
    fabric: 'soft wool blend',
    careNote: 'steam before shoots',
  },
  'confirmed',
);

export const EARRINGS_V1 = lockedVersion(
  VERSION_IDS.earrings,
  ASSET_IDS.earrings,
  'Original approved configuration',
  {
    metal: 'polished gold tone',
    size: 'medium hoop, 25mm',
    backing: 'hinged',
  },
  'confirmed',
);

export const LOOK_V1: LibraryAssetVersionRecord = {
  id: VERSION_IDS.look,
  libraryAssetId: ASSET_IDS.look,
  versionNumber: 1,
  status: 'draft',
  changeSummary: 'First cut of the neutral creator look for Aisha',
  coverImagePath: null,
  structuredDetails: {
    mood: 'clean, warm, professional',
    grooming: 'natural, minimal',
  },
  rightsStatus: 'confirmed',
  lockedAt: null,
  createdBy: 'demo-user',
  createdAt: '2026-09-26T15:00:00.000Z',
  updatedAt: '2026-09-26T16:00:00.000Z',
};

/** The approved Look version — locked, and the one Content Studio pins. */
export const LOOK_V2: LibraryAssetVersionRecord = {
  id: VERSION_IDS.lookV2,
  libraryAssetId: ASSET_IDS.look,
  versionNumber: 2,
  status: 'locked',
  changeSummary: 'Approved neutral creator look',
  coverImagePath: null,
  structuredDetails: {
    mood: 'clean, warm, professional',
    grooming: 'natural, minimal',
  },
  rightsStatus: 'confirmed',
  lockedAt: '2026-09-27T09:00:00.000Z',
  createdBy: 'demo-user',
  createdAt: '2026-09-27T08:00:00.000Z',
  updatedAt: '2026-09-27T09:00:00.000Z',
};

export const OTHER_WS_V1 = lockedVersion(
  VERSION_IDS.otherWs,
  ASSET_IDS.otherWs,
  'Isolation fixture',
  { note: 'other workspace' },
  'unknown',
);

// ── Look details + canonical items ──────────────────────────────────────────

export const LOOK_DETAILS: LookDetailsRecord = {
  id: 'lookdetails_neutral_outfit',
  libraryAssetVersionId: VERSION_IDS.look,
  modelId: 'model_aisha',
  presentationNotes:
    'Blazer over a simple top, sleeves pushed up, gold hoops as the only jewellery. Presentation only — this Look never changes Aisha\u2019s protected Character Sheet.',
  createdAt: '2026-09-26T15:00:00.000Z',
  updatedAt: '2026-09-26T16:00:00.000Z',
};

export const LOOK_ITEMS: LookAssetItemRecord[] = [
  {
    id: 'lookitem_blazer',
    lookDetailsId: LOOK_DETAILS.id,
    libraryAssetId: ASSET_IDS.blazer, // canonical reference, not a copy
    libraryAssetVersionId: VERSION_IDS.blazer, // exact approved version pinned
    role: 'wardrobe',
    sortOrder: 0,
    createdAt: '2026-09-26T15:00:00.000Z',
    updatedAt: '2026-09-26T15:00:00.000Z',
  },
  {
    id: 'lookitem_earrings',
    lookDetailsId: LOOK_DETAILS.id,
    libraryAssetId: ASSET_IDS.earrings,
    libraryAssetVersionId: null, // follows the asset's active version
    role: 'accessory',
    sortOrder: 1,
    createdAt: '2026-09-26T15:00:00.000Z',
    updatedAt: '2026-09-26T15:00:00.000Z',
  },
];

// ── Locked Look details + items (v2, the version Content Studio pins) ───────

export const LOOK_DETAILS_V2: LookDetailsRecord = {
  id: 'lookdetails_neutral_outfit_v2',
  libraryAssetVersionId: VERSION_IDS.lookV2,
  modelId: 'model_aisha',
  presentationNotes:
    'Approved cut: blazer over a simple top, sleeves pushed up, gold hoops as the only jewellery. Presentation only.',
  createdAt: '2026-09-27T08:00:00.000Z',
  updatedAt: '2026-09-27T09:00:00.000Z',
};

export const LOOK_ITEMS_V2: LookAssetItemRecord[] = [
  {
    id: 'lookitem_blazer_v2',
    lookDetailsId: LOOK_DETAILS_V2.id,
    libraryAssetId: ASSET_IDS.blazer,
    libraryAssetVersionId: VERSION_IDS.blazer, // exact approved version pinned
    role: 'wardrobe',
    sortOrder: 0,
    createdAt: '2026-09-27T08:00:00.000Z',
    updatedAt: '2026-09-27T08:00:00.000Z',
  },
  {
    id: 'lookitem_earrings_v2',
    lookDetailsId: LOOK_DETAILS_V2.id,
    libraryAssetId: ASSET_IDS.earrings,
    libraryAssetVersionId: null, // follows the asset's active (locked) version
    role: 'accessory',
    sortOrder: 1,
    createdAt: '2026-09-27T08:00:00.000Z',
    updatedAt: '2026-09-27T08:00:00.000Z',
  },
];

// ── Tags ────────────────────────────────────────────────────────────────────

function tag(id: string, name: string, workspaceId: string): LibraryTagRecord {
  return {
    id,
    workspaceId,
    name,
    normalizedName: name.toLowerCase().replace(/\s+/g, '-'),
    createdAt: '2026-09-18T09:00:00.000Z',
  };
}

export const TAGS: LibraryTagRecord[] = [
  tag('tag_skincare', 'skincare', WORKSPACE_ID),
  tag('tag_bottle', 'bottle', WORKSPACE_ID),
  tag('tag_countertop', 'countertop', WORKSPACE_ID),
  tag('tag_desk', 'desk', WORKSPACE_ID),
  tag('tag_technology', 'technology', WORKSPACE_ID),
  tag('tag_creator', 'creator', WORKSPACE_ID),
  tag('tag_neutral', 'neutral', WORKSPACE_ID),
  tag('tag_tailored', 'tailored', WORKSPACE_ID),
  tag('tag_gold', 'gold', WORKSPACE_ID),
  tag('tag_minimal', 'minimal', WORKSPACE_ID),
  tag('tag_other_ws', 'other-workspace-tag', OTHER_WORKSPACE_ID),
];

export const TAG_LINKS: LibraryTagLinkRecord[] = [
  { libraryAssetId: ASSET_IDS.serum, tagId: 'tag_skincare', createdAt: '2026-09-18T09:00:00.000Z' },
  { libraryAssetId: ASSET_IDS.serum, tagId: 'tag_bottle', createdAt: '2026-09-18T09:00:00.000Z' },
  { libraryAssetId: ASSET_IDS.serum, tagId: 'tag_countertop', createdAt: '2026-09-18T09:00:00.000Z' },
  { libraryAssetId: ASSET_IDS.laptop, tagId: 'tag_desk', createdAt: '2026-09-18T09:00:00.000Z' },
  { libraryAssetId: ASSET_IDS.laptop, tagId: 'tag_technology', createdAt: '2026-09-18T09:00:00.000Z' },
  { libraryAssetId: ASSET_IDS.laptop, tagId: 'tag_creator', createdAt: '2026-09-18T09:00:00.000Z' },
  { libraryAssetId: ASSET_IDS.blazer, tagId: 'tag_neutral', createdAt: '2026-09-18T09:00:00.000Z' },
  { libraryAssetId: ASSET_IDS.blazer, tagId: 'tag_tailored', createdAt: '2026-09-18T09:00:00.000Z' },
  { libraryAssetId: ASSET_IDS.blazer, tagId: 'tag_creator', createdAt: '2026-09-18T09:00:00.000Z' },
  { libraryAssetId: ASSET_IDS.earrings, tagId: 'tag_gold', createdAt: '2026-09-18T09:00:00.000Z' },
  { libraryAssetId: ASSET_IDS.earrings, tagId: 'tag_minimal', createdAt: '2026-09-18T09:00:00.000Z' },
];

// ── References ──────────────────────────────────────────────────────────────

export const REFERENCES: Record<string, LibraryReferenceRecord[]> = {
  [VERSION_IDS.serum]: [
    ref('libref_serum_front', VERSION_IDS.serum, 'front', 'Bottle front — label centred', 0),
    ref('libref_serum_detail', VERSION_IDS.serum, 'detail', 'Pump detail close-up', 1),
    ref('libref_serum_material', VERSION_IDS.serum, 'material', 'Frosted glass texture', 2),
  ],
  [VERSION_IDS.laptop]: [
    ref('libref_laptop_front', VERSION_IDS.laptop, 'front', 'Lid front — no branding', 0),
    ref('libref_laptop_in_context', VERSION_IDS.laptop, 'in_context', 'Open on desk, warm wallpaper', 1),
  ],
  [VERSION_IDS.blazer]: [
    ref('libref_blazer_front', VERSION_IDS.blazer, 'front', 'Front — structured shoulders', 0),
    ref('libref_blazer_material', VERSION_IDS.blazer, 'material', 'Wool blend texture', 1),
  ],
  [VERSION_IDS.earrings]: [
    ref('libref_earrings_front', VERSION_IDS.earrings, 'front', 'Hoops on neutral card', 0),
  ],
  [VERSION_IDS.look]: [
    ref('libref_look_context', VERSION_IDS.look, 'in_context', 'Full outfit reference frame', 0),
  ],
  [VERSION_IDS.otherWs]: [],
};

// ── Aggregate for the mock repository ───────────────────────────────────────

export interface LibraryAssetSeed {
  asset: LibraryAssetRecord;
  versions: LibraryAssetVersionRecord[];
  looks?: Array<{ details: LookDetailsRecord; items: LookAssetItemRecord[] }>;
  tagIds: string[];
}

export const LIBRARY_SEED: LibraryAssetSeed[] = [
  { asset: SERUM_ASSET, versions: [SERUM_V1], tagIds: ['tag_skincare', 'tag_bottle', 'tag_countertop'] },
  { asset: LAPTOP_ASSET, versions: [LAPTOP_V1], tagIds: ['tag_desk', 'tag_technology', 'tag_creator'] },
  { asset: BLAZER_ASSET, versions: [BLAZER_V1], tagIds: ['tag_neutral', 'tag_tailored', 'tag_creator'] },
  { asset: EARRINGS_ASSET, versions: [EARRINGS_V1], tagIds: ['tag_gold', 'tag_minimal'] },
  { asset: LOOK_ASSET, versions: [LOOK_V1, LOOK_V2], looks: [{ details: LOOK_DETAILS, items: LOOK_ITEMS }, { details: LOOK_DETAILS_V2, items: LOOK_ITEMS_V2 }], tagIds: ['tag_neutral', 'tag_creator'] },
  { asset: OTHER_WS_ASSET, versions: [OTHER_WS_V1], tagIds: ['tag_other_ws'] },
];

export const LIBRARY_TAG_LINKS = TAG_LINKS;
export const LIBRARY_REFERENCES = REFERENCES;

export const SEED_LIBRARY_WORKSPACE_ID = WORKSPACE_ID;
export const SEED_LIBRARY_OTHER_WORKSPACE_ID = OTHER_WORKSPACE_ID;
export const LIBRARY_ASSET_SEED_IDS = ASSET_IDS;
export const LIBRARY_VERSION_SEED_IDS = VERSION_IDS;
export const LIBRARY_TAG_SEED_IDS = {
  skincare: 'tag_skincare',
  otherWorkspace: 'tag_other_ws',
} as const;
