/**
 * Environments domain — types.
 *
 * An Environment is a standalone reusable asset. It is never model-specific
 * and never classified "global" vs "model-specific"; models and environments
 * meet only later, through content jobs. There is deliberately no model_id
 * anywhere in this module.
 *
 * A locked environment version preserves its approved defining anchors:
 * room type + layout feel, hero camera angle, lighting style, furniture
 * anchors, signature props, palette/material direction, and (where
 * applicable) the product zone.
 */
export type EnvironmentStatus = 'draft' | 'ready' | 'archived';
export type EnvironmentVersionStatus = 'draft' | 'locked' | 'superseded';

/** How tightly the locked anchors bind future content jobs. */
export type EnvironmentLockLevel = 'flexible' | 'balanced' | 'strict';

export type EnvironmentReferenceType =
  | 'wide'
  | 'hero_angle'
  | 'detail'
  | 'layout'
  | 'lighting'
  | 'product_zone'
  | 'other';

/** Shortcut categories — pointers into the ONE shared Library, never assets. */
export type EnvironmentAssetCategory =
  | 'furniture'
  | 'prop'
  | 'product'
  | 'lighting'
  | 'decor'
  | 'other';

export interface EnvironmentRecord {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  status: EnvironmentStatus;
  activeVersionId: string | null;
  coverImagePath: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface EnvironmentVersionRecord {
  id: string;
  environmentId: string;
  versionNumber: number;
  status: EnvironmentVersionStatus;
  changeSummary: string;
  coverImagePath: string | null;
  /** Editable while draft; frozen when the version locks. */
  lockLevel: EnvironmentLockLevel;
  lockedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** Structured JSON payloads (JSONB in Postgres). */
export type SpecJson = Record<string, unknown>;

export interface EnvironmentSpecRecord {
  id: string;
  environmentVersionId: string;
  roomType: string;
  layoutFeel: string;
  heroAngle: string;
  lightingStyle: string;
  furnitureAnchors: SpecJson;
  signatureProps: SpecJson;
  paletteMaterials: SpecJson;
  /** Nullable — not every environment presents products. */
  productZone: SpecJson | null;
  continuityNotes: string;
  lockRules: SpecJson;
  createdAt: string;
  updatedAt: string;
}

export interface EnvironmentReferenceRecord {
  id: string;
  environmentVersionId: string;
  storagePath: string;
  referenceType: EnvironmentReferenceType;
  caption: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Quick-access shortcut into the ONE unified shared Library. Pointers only —
 * must never duplicate or replace Library assets. `libraryAssetId` is nullable
 * until the shared Library migration exists (no FK yet, by design).
 */
export interface EnvironmentAssetShortcutRecord {
  id: string;
  environmentId: string;
  libraryAssetId: string | null;
  category: EnvironmentAssetCategory;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

// ── Input payloads ──────────────────────────────────────────────────────────

export interface CreateEnvironmentInput {
  workspaceId: string;
  name: string;
  slug?: string;
}

export interface UpdateEnvironmentDraftInput {
  name?: string;
  status?: EnvironmentStatus;
  coverImagePath?: string | null;
}

export interface UpdateEnvironmentSpecInput {
  roomType?: string;
  layoutFeel?: string;
  heroAngle?: string;
  lightingStyle?: string;
  furnitureAnchors?: SpecJson;
  signatureProps?: SpecJson;
  paletteMaterials?: SpecJson;
  productZone?: SpecJson | null;
  continuityNotes?: string;
  lockRules?: SpecJson;
}

export interface UpdateEnvironmentVersionDraftInput {
  /** How tightly the locked anchors bind future jobs; frozen on lock. */
  lockLevel?: EnvironmentLockLevel;
  changeSummary?: string;
}

export interface CreateEnvironmentVersionInput {
  environmentId: string;
  sourceVersionId: string;
  changeSummary?: string;
}

export interface LockEnvironmentVersionInput {
  versionId: string;
}

export interface EnvironmentWithVersion extends EnvironmentRecord {
  activeVersion: EnvironmentVersionRecord | null;
}
