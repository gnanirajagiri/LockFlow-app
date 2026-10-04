/**
 * Prompt 34 — Content Studio storyboard: scenes, beats, prompt bar and
 * locked generation handoff (workflow).
 *
 * Pure, deterministic rules over the EXISTING content project/scene/beat
 * structures (nothing replaces them):
 *
 *   * A scene is a structured unit of content creation; a Beat is an ordered
 *     action/moment/camera unit within a scene. Both stay editable and
 *     reorderable throughout the storyboard process.
 *   * Selected model/environment versions and Library assets are
 *     version-pinned; protected identity remains governed by the Character
 *     Sheet — model-based scenes require an identity baseline.
 *   * The prompt bar classifies creative intent but NEVER bypasses
 *     validation: it only adds safe descriptive metadata to the snapshot.
 *   * A generation handoff preserves a locked snapshot of the storyboard
 *     state; results flow to Gallery through the existing prompt-27/28
 *     services.
 */
import type {
  ContentBeatRecord,
  ContentSceneRecord,
} from '../domain/content/types';

// ── Beat types ───────────────────────────────────────────────────────────────

export const STORYBOARD_BEAT_TYPES = ['action', 'camera', 'dialogue', 'product', 'transition'] as const;
export type StoryboardBeatType = (typeof STORYBOARD_BEAT_TYPES)[number];

export const BEAT_TYPE_LABELS: Record<StoryboardBeatType, string> = {
  action: 'Action',
  camera: 'Camera',
  dialogue: 'Dialogue / overlay',
  product: 'Product moment',
  transition: 'Transition',
};

/** Movement options for the structured motion configuration. */
export const BEAT_MOVEMENTS = ['static', 'dolly_in', 'dolly_out', 'trolley_left', 'trolley_right', 'handheld'] as const;
export type BeatMovement = (typeof BEAT_MOVEMENTS)[number];

export const BEAT_MOVEMENT_LABELS: Record<BeatMovement, string> = {
  static: 'Static',
  dolly_in: 'Dolly in',
  dolly_out: 'Dolly out',
  trolley_left: 'Trolley left',
  trolley_right: 'Trolley right',
  handheld: 'Handheld',
};

export const GENERATION_TYPES = ['image', 'video', 'story', 'content_set'] as const;
export type SceneGenerationType = (typeof GENERATION_TYPES)[number];

// ── Ordering (stable, collision-free) ────────────────────────────────────────

/**
 * Reorders by id list; positions are compacted 0..n-1 so reorders never
 * collide and appended items land last.
 */
export function normalizeOrder(orderedIds: string[], currentIds: string[]): Array<{ id: string; order: number }> {
  const known = new Set(currentIds);
  const ordered = orderedIds.filter((id) => known.has(id));
  const rest = currentIds.filter((id) => !ordered.includes(id));
  return [...ordered, ...rest].map((id, index) => ({ id, order: index }));
}

// ── Prompt bar (safe intent classification) ──────────────────────────────────

export type PromptBarIntent =
  | 'explain_scene'
  | 'adjust_beat'
  | 'request_variation'
  | 'generation_intent'
  | 'note';

export const PROMPT_INTENT_LABELS: Record<PromptBarIntent, string> = {
  explain_scene: 'Explain scene',
  adjust_beat: 'Adjust beat',
  request_variation: 'Request variation',
  generation_intent: 'Generation intent',
  note: 'Note',
};

/**
 * Classifies prompt-bar input into a safe, descriptive intent. This NEVER
 * changes validation outcomes — it only labels the creative note so the
 * snapshot and audit stay readable.
 */
export function classifyPromptIntent(text: string): { intent: PromptBarIntent; trimmed: string } {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('explain')) return { intent: 'explain_scene', trimmed };
  if (lower.startsWith('adjust') || lower.startsWith('change beat')) return { intent: 'adjust_beat', trimmed };
  if (lower.startsWith('variation') || lower.startsWith('vary')) return { intent: 'request_variation', trimmed };
  if (lower.startsWith('generate') || lower.startsWith('prepare') || lower.startsWith('hand off')) {
    return { intent: 'generation_intent', trimmed };
  }
  return { intent: 'note', trimmed };
}

/** Assembles the generation prompt from the scene + beats (safe text only). */
export function assembleGenerationPrompt(scene: ContentSceneRecord, beats: ContentBeatRecord[]): string {
  const parts: string[] = [];
  if (scene.purpose) parts.push(scene.purpose);
  if (scene.settingNotes) parts.push(`Setting: ${scene.settingNotes}`);
  if (scene.shotNotes) parts.push(`Shot: ${scene.shotNotes}`);
  for (const beat of beats) {
    const beatBits = [beat.title, beat.actionDescription, beat.cameraDirection]
      .filter((bit): bit is string => Boolean(bit && bit.trim()));
    if (beatBits.length > 0) parts.push(beatBits.join(' — '));
  }
  return parts.join('\n').slice(0, 4000);
}

// ── Bindings & snapshot ──────────────────────────────────────────────────────

export type SceneBindingKind = 'model_version' | 'environment_version' | 'library_asset';

export const SCENE_BINDING_KIND_LABELS: Record<SceneBindingKind, string> = {
  model_version: 'Model version',
  environment_version: 'Environment version',
  library_asset: 'Library asset',
};

/** One version-pinned input of a scene. */
export interface SceneAssetBindingRecord {
  id: string;
  workspaceId: string;
  contentSceneId: string;
  kind: SceneBindingKind;
  /** Version/asset id — always a pinned version, never a loose record. */
  refId: string;
  /** Safe display label resolved server-side (never a storage path). */
  label: string;
  role: string | null;
  createdBy: string;
  createdAt: string;
}

/** Generation handoff snapshot (locked storyboard state). */
export interface SceneGenerationSnapshot {
  scene: ContentSceneRecord;
  beats: Array<Pick<ContentBeatRecord, 'id' | 'title' | 'beatOrder' | 'beatType' | 'cameraDirection' | 'motionConfig' | 'durationSeconds'>>;
  bindings: Array<Pick<SceneAssetBindingRecord, 'kind' | 'refId' | 'label' | 'role'>>;
  generationType: SceneGenerationType;
  promptBarNotes: string[];
  assembledPrompt: string;
  capturedAt: string;
}

// ── Readiness rules ──────────────────────────────────────────────────────────

export interface SceneGenerationReadiness {
  ready: boolean;
  blockers: string[];
  /** True when the scene binds a model version (identity-governed path). */
  modelGoverned: boolean;
}

/**
 * Scene generation readiness. Model-based scenes REQUIRE an active Character
 * Sheet baseline (protected traits present) — the prompt bar and generation
 * intent can never bypass this.
 */
export function validateSceneForGenerationRules(input: {
  scene: ContentSceneRecord;
  beats: ContentBeatRecord[];
  bindings: Array<Pick<SceneAssetBindingRecord, 'kind' | 'label'>>;
  characterSheetOk: boolean;
  generationType: SceneGenerationType;
}): SceneGenerationReadiness {
  const blockers: string[] = [];
  const modelGoverned = input.bindings.some((binding) => binding.kind === 'model_version');

  if (input.generationType === 'content_set') {
    blockers.push('Full content sets run through the campaign-brief orchestrator (prompt 29) — hand scenes off per output type here.');
  }
  if (input.beats.length === 0) {
    blockers.push('Add at least one beat before handing off to generation.');
  }
  if (!input.scene.purpose && input.beats.every((beat) => !beat.actionDescription)) {
    blockers.push('Describe the scene purpose or at least one beat action before generation.');
  }
  if (modelGoverned && !input.characterSheetOk) {
    blockers.push('Model-based scenes require an active Character Sheet identity baseline (protected traits present).');
  }
  return { ready: blockers.length === 0, blockers, modelGoverned };
}
