/**
 * Quality domain — types.
 *
 * Continuity quality reviews, findings and correction requests attach to
 * GALLERY OUTPUTS only. They never edit source modules (Models, Environments,
 * Library, Looks), never mutate job pins or output media, and never create
 * Library assets. Expected context and all snapshots are minimal immutable
 * read models derived from the output's job pins / frozen run snapshots at
 * record-creation time — later source changes cannot alter historic review
 * context, and no correction can silently select newer source versions.
 */

// ── Finding taxonomy ────────────────────────────────────────────────────────

export const QUALITY_FINDING_CATEGORIES = [
  'model_identity',
  'face',
  'hairstyle',
  'skin_tone',
  'body_proportions',
  'wardrobe',
  'accessory',
  'product',
  'prop',
  'environment_layout',
  'furniture_anchor',
  'lighting',
  'palette_material',
  'camera',
  'composition',
  'text_overlay',
  'motion',
  'continuity',
  'other',
] as const;
export type QualityFindingCategory = (typeof QUALITY_FINDING_CATEGORIES)[number];

export const QUALITY_RESULTS = ['pass', 'warning', 'fail', 'not_checked'] as const;
export type QualityResult = (typeof QUALITY_RESULTS)[number];

export const QUALITY_SEVERITIES = ['low', 'medium', 'high'] as const;
export type QualitySeverity = (typeof QUALITY_SEVERITIES)[number];

/** Checklist sections group findings for the review UI. */
export const QUALITY_CHECKLIST_SECTIONS = [
  'model_identity',
  'wardrobe_accessories',
  'product_props',
  'environment_lighting',
  'camera_composition',
  'motion_continuity',
] as const;
export type QualityChecklistSection = (typeof QUALITY_CHECKLIST_SECTIONS)[number];

/** Which checklist section a finding category belongs to. */
export const CATEGORY_SECTION_MAP: Record<QualityFindingCategory, QualityChecklistSection> = {
  model_identity: 'model_identity',
  face: 'model_identity',
  hairstyle: 'model_identity',
  skin_tone: 'model_identity',
  body_proportions: 'model_identity',
  wardrobe: 'wardrobe_accessories',
  accessory: 'wardrobe_accessories',
  product: 'product_props',
  prop: 'product_props',
  palette_material: 'product_props',
  environment_layout: 'environment_lighting',
  furniture_anchor: 'environment_lighting',
  lighting: 'environment_lighting',
  camera: 'camera_composition',
  composition: 'camera_composition',
  text_overlay: 'camera_composition',
  motion: 'motion_continuity',
  continuity: 'motion_continuity',
  other: 'other' as QualityChecklistSection,
};

// ── Reviews ─────────────────────────────────────────────────────────────────

export type QualityReviewStatus = 'draft' | 'completed' | 'archived';

export interface QualityReviewRecord {
  id: string;
  workspaceId: string;
  galleryOutputId: string;
  status: QualityReviewStatus;
  overallResult: QualityResult;
  reviewerId: string;
  summary: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QualityFindingRecord {
  id: string;
  qualityReviewId: string;
  category: QualityFindingCategory;
  result: QualityResult;
  severity: QualitySeverity;
  /** Minimal immutable read model from pins/snapshots at review creation. */
  expectedContext: Record<string, unknown>;
  observedNote: string | null;
  correctionNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateQualityFindingInput {
  category: QualityFindingCategory;
  result: QualityResult;
  severity?: QualitySeverity;
  observedNote?: string;
  correctionNote?: string;
}

export interface UpdateQualityFindingInput {
  result?: QualityResult;
  severity?: QualitySeverity;
  observedNote?: string | null;
  correctionNote?: string | null;
}

// ── Correction requests ─────────────────────────────────────────────────────

export const CORRECTION_SCOPES = [
  'composition',
  'framing',
  'camera',
  'lighting',
  'product_framing',
  'motion',
  'continuity',
  'prompt_direction',
  'other',
] as const;
export type CorrectionScope = (typeof CORRECTION_SCOPES)[number];

export const CORRECTION_STATUSES = [
  'draft',
  'ready',
  'submitted',
  'processing',
  'completed',
  'failed',
  'cancelled',
  'archived',
] as const;
export type CorrectionRequestStatus = (typeof CORRECTION_STATUSES)[number];

export const CORRECTION_EVENT_TYPES = [
  'created',
  'updated',
  'validation_failed',
  'marked_ready',
  'submitted',
  'provider_accepted',
  'provider_failed',
  'output_created',
  'cancelled',
  'archived',
  'restored',
] as const;
export type CorrectionRequestEventType = (typeof CORRECTION_EVENT_TYPES)[number];

export interface CorrectionRequestRecord {
  id: string;
  workspaceId: string;
  sourceGalleryOutputId: string;
  sourceContentJobRequestId: string;
  sourceGenerationProviderRunId: string | null;
  status: CorrectionRequestStatus;
  title: string;
  requestedChange: string;
  scope: CorrectionScope;
  /** Frozen when the request leaves draft — never rewritten afterwards. */
  sourceSnapshot: Record<string, unknown>;
  /** Exact pinned versions — frozen when the request leaves draft. */
  pinSnapshot: Record<string, unknown>;
  providerOptionsSnapshot: Record<string, unknown> | null;
  createdBy: string;
  submittedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CorrectionRequestEventRecord {
  id: string;
  correctionRequestId: string;
  eventType: CorrectionRequestEventType;
  message: string;
  /** Never secrets, signed URLs or raw media. */
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface CorrectionRequestFindingLinkRecord {
  correctionRequestId: string;
  qualityFindingId: string;
  createdAt: string;
}

export interface CreateCorrectionRequestInput {
  workspaceId: string;
  sourceGalleryOutputId: string;
  title: string;
  requestedChange: string;
  scope: CorrectionScope;
}

export interface UpdateCorrectionRequestInput {
  title?: string;
  requestedChange?: string;
  scope?: CorrectionScope;
}

// ── Recurring issues ────────────────────────────────────────────────────────

export const ESCALATION_LEVELS = [
  'first_notice',
  'strengthen_references',
  'constrain_prompt',
  'provider_review',
] as const;
export type EscalationLevel = (typeof ESCALATION_LEVELS)[number];

export interface RecurringIssueRecord {
  id: string;
  workspaceId: string;
  issueKey: string;
  category: QualityFindingCategory;
  sourceContextHash: string;
  occurrenceCount: number;
  lastSeenAt: string;
  escalationLevel: EscalationLevel;
  createdAt: string;
  updatedAt: string;
}

/** The exact advisory copy per escalation level (never an automatic action). */
export const ESCALATION_RECOMMENDATIONS: Record<EscalationLevel, string> = {
  first_notice: 'Add clearer direction to the correction request.',
  strengthen_references: 'Consider adding stronger or more specific approved references.',
  constrain_prompt: 'Consider constrained provider settings or a provider-specific workflow review.',
  provider_review:
    'This issue is recurring. Review the source references and provider workflow before further generation.',
};

// ── Source-change classifier ────────────────────────────────────────────────

export type SourceChangeTarget = 'model' | 'environment' | 'library_asset_or_look';

export interface ClassifierTargetInfo {
  target: SourceChangeTarget;
  /** Human label of the module that needs a new version. */
  label: string;
  /** Read-only links to the pinned source profiles involved. */
  links: Array<{ label: string; href: string }>;
}

export interface SourceChangeClassification {
  sourceChangeRequired: boolean;
  targets: ClassifierTargetInfo[];
  /** Transparent explanation of the matched rules. */
  explanation: string;
}

/** Pin-shaped projection used by the classifier and snapshot builders. */
export interface PinProjection {
  pinType: 'model_version' | 'environment_version' | 'library_asset_version' | 'look_version';
  sourceRecordId: string;
  sourceVersionId: string;
  label: string;
  versionNumber: number | null;
  role: string | null;
  resolvedVia: string | null;
}
